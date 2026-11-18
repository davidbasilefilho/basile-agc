import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Effect } from "effect";

import {
  GitRepository,
  PolicyError,
  isStableTag,
  managedMarker,
  planPrune,
  prereleaseTag,
} from "../src/release/policy";
import type { Release } from "../src/release/policy";

class Fixture {
  readonly path = mkdtempSync(join(tmpdir(), "basile-release-policy-"));
  readonly repo = new GitRepository(this.path);
  readonly first: string;
  readonly second: string;
  readonly side: string;
  readonly tip: string;
  readonly initialBytes = Buffer.from("first\r\nsecond\r\n\u0000\u00ff", "utf8");

  constructor() {
    this.git(["init", "-q", "-b", "main"]);
    this.git(["config", "user.name", "Policy Test"]);
    this.git(["config", "user.email", "policy@example.invalid"]);
    mkdirSync(join(this.path, "generated"));
    writeFileSync(join(this.path, "generated", "config.agc"), this.initialBytes);
    this.git(["add", "generated"]);
    this.first = this.commit("first", "2026-01-01T03:04:05+03:00");
    writeFileSync(join(this.path, "generated", "config.agc"), "newer content\n");
    this.git(["add", "generated"]);
    this.second = this.commit("second", "2026-01-02T00:00:00Z");
    this.git(["checkout", "-q", "-b", "side", this.first]);
    this.side = this.commit("side", "2026-01-03T00:00:00Z");
    this.git(["checkout", "-q", "main"]);
    this.tip = this.commit("tip", "2026-01-04T00:00:00Z");
    this.git(["tag", "-a", "v1", "-m", "stable", this.tip]);
  }

  git(args: string[], env: NodeJS.ProcessEnv = process.env): string {
    const result = spawnSync("git", ["-C", this.path, ...args], {
      encoding: "utf8",
      env,
      input: "",
      timeout: 10_000,
    });
    if (result.status !== 0) throw new Error(`Git fixture failed: ${result.stderr}`);
    return result.stdout.trim();
  }

  commit(name: string, date: string): string {
    this.git(["commit", "--allow-empty", "-q", "-m", name], {
      ...process.env,
      GIT_COMMITTER_DATE: date,
      GIT_AUTHOR_DATE: "2025-01-01T00:00:00Z",
    });
    return this.git(["rev-parse", "HEAD"]);
  }

  release(sha: string, annotated = false): Release {
    const tagName = Effect.runSync(prereleaseTag(this.repo, sha));
    this.git(
      annotated ? ["tag", "-a", tagName, "-m", "managed prerelease", sha] : ["tag", tagName, sha],
    );
    return { tagName, body: `Notes\n\n${managedMarker(sha)}\n`, prerelease: true, draft: false };
  }
}

function expectPolicyFailure<A>(operation: Effect.Effect<A, PolicyError>): void {
  const result = Effect.runSync(
    operation.pipe(
      Effect.match({
        onFailure: (error) => error._tag,
        onSuccess: () => "unexpected success",
      }),
    ),
  );
  expect(result).toBe("PolicyError");
}

describe("read-only release policy with real Git DAGs", () => {
  let fixture: Fixture;
  beforeEach(() => {
    fixture = new Fixture();
  });
  afterEach(() => {
    rmSync(fixture.path, { recursive: true, force: true });
  });

  test("ancestors and same commit qualify, side branches do not; annotated tags peel", () => {
    const releases = [
      fixture.release(fixture.first),
      fixture.release(fixture.second, true),
      fixture.release(fixture.tip),
      fixture.release(fixture.side),
    ];
    const plan = Effect.runSync(planPrune(fixture.repo, releases, "v1"));
    expect(plan.releaseTags).toEqual(
      releases
        .slice(0, 3)
        .map((release) => release.tagName)
        .sort(),
    );
    expect(plan.tagNamesToDelete).toEqual([]);
    for (const release of releases)
      expect(Effect.runSync(fixture.repo.resolveTag(release.tagName))).not.toBeNull();
    expect(Effect.runSync(fixture.repo.resolveTag("v1"))).toBe(fixture.tip);
  });

  test("uses UTC committer date rather than author date or current time", () => {
    expect(Effect.runSync(prereleaseTag(fixture.repo, fixture.first))).toBe(
      `pre-20260101T000405Z-${fixture.first}`,
    );
  });

  test("near names and trailing newlines are not managed", () => {
    const release = fixture.release(fixture.first);
    for (const tagName of [
      `x${release.tagName}`,
      `${release.tagName}-extra`,
      release.tagName.toUpperCase(),
      release.tagName.slice(0, -1),
      `${release.tagName}\n`,
      "pre-latest",
      "v1",
    ]) {
      expect(
        Effect.runSync(planPrune(fixture.repo, [{ ...release, tagName }], "v1")).releaseTags,
      ).toEqual([]);
    }
  });

  test("manual, draft, stable and malformed or repeated markers are retained", () => {
    const release = fixture.release(fixture.first);
    const variations = [
      { ...release, prerelease: false },
      { ...release, draft: true },
      ...[
        "manual",
        ` ${managedMarker(fixture.first)}`,
        managedMarker(fixture.second),
        `${managedMarker(fixture.first)}\n${managedMarker(fixture.first)}`,
        `prefix ${managedMarker(fixture.first)}`,
      ].map((body) => ({ ...release, body })),
    ];
    for (const candidate of variations)
      expect(Effect.runSync(planPrune(fixture.repo, [candidate], "v1")).releaseTags).toEqual([]);
  });

  test("timestamp and encoded SHA must match resolved tag", () => {
    const release = fixture.release(fixture.first);
    const tagName = release.tagName.replace("20260101", "20260102");
    fixture.git(["tag", tagName, fixture.first]);
    expect(
      Effect.runSync(planPrune(fixture.repo, [{ ...release, tagName }], "v1")).releaseTags,
    ).toEqual([]);
    fixture.git(["tag", "-f", release.tagName, fixture.second]);
    expect(Effect.runSync(planPrune(fixture.repo, [release], "v1")).releaseTags).toEqual([]);
  });

  test("missing candidate tags are retained, missing stable tags abort", () => {
    const release: Release = {
      tagName: Effect.runSync(prereleaseTag(fixture.repo, fixture.first)),
      body: managedMarker(fixture.first),
      prerelease: true,
      draft: false,
    };
    expect(Effect.runSync(planPrune(fixture.repo, [release], "v1")).releaseTags).toEqual([]);
    expectPolicyFailure(planPrune(fixture.repo, [release], "v2"));
  });

  test("bounded stable names allow non-SemVer but reject ref tricks", () => {
    for (const tag of ["v1", "v1.2", "v1.2.3+build", "v2026-11-18", "vNext", "v1_test"])
      expect(isStableTag(tag)).toBe(true);
    for (const tag of [
      "v",
      "--help",
      "v1/branch",
      "v1..2",
      "v1@{0}",
      "v1^",
      "v1~1",
      "v1;echo",
      "v1\n",
      "v1.",
      "v1.lock",
      "v１",
      `v${"1".repeat(128)}`,
    ]) {
      expect(isStableTag(tag)).toBe(false);
      expectPolicyFailure(planPrune(fixture.repo, [], tag));
    }
  });

  test("checked failures discard the entire plan after an eligible record", () => {
    const releases = [fixture.release(fixture.first), fixture.release(fixture.second)];
    const mock = spyOn(fixture.repo, "isAncestor")
      .mockReturnValueOnce(Effect.succeed(true))
      .mockReturnValueOnce(Effect.fail(new PolicyError({ message: "checked failure" })));
    expectPolicyFailure(planPrune(fixture.repo, releases, "v1"));
    mock.mockRestore();
    expectPolicyFailure(new GitRepository(join(fixture.path, "missing")).commit("HEAD"));
    expectPolicyFailure(fixture.repo.isAncestor("a".repeat(40), fixture.tip));
  });

  test("duplicate metadata and shallow history abort", () => {
    const release = fixture.release(fixture.first);
    expectPolicyFailure(planPrune(fixture.repo, [release, release], "v1"));
    writeFileSync(join(fixture.path, ".git", "shallow"), `${fixture.first}\n`);
    expectPolicyFailure(planPrune(fixture.repo, [], "v1"));
  });

  test("non-commit stable tags fail closed", () => {
    const blob = fixture.git(["hash-object", "-w", "--stdin"]);
    fixture.git(["tag", "v2", blob]);
    expectPolicyFailure(planPrune(fixture.repo, [], "v2"));
  });

  test("historical digests preserve exact bytes including CRLF and differ from current", () => {
    const old = Effect.runSync(fixture.repo.assetDigests(fixture.first, ["config.agc"]));
    expect(old["config.agc"]).toBe(
      `sha256:${createHash("sha256").update(fixture.initialBytes).digest("hex")}`,
    );
    const current = Effect.runSync(fixture.repo.assetDigests(fixture.tip, ["config.agc"]));
    expect(old["config.agc"]).not.toBe(current["config.agc"]);
  });

  test("historical digest failures and unsafe names are typed and fail closed", () => {
    for (const names of [
      ["../config.agc"],
      ["."],
      [".."],
      ["config.agc\n"],
      ["missing.agc"],
      ["__proto__"],
      ["config.agc", "config.agc"],
    ])
      expectPolicyFailure(fixture.repo.assetDigests(fixture.first, names));
    expectPolicyFailure(fixture.repo.assetDigests("invalid", ["config.agc"]));
    expectPolicyFailure(fixture.repo.assetDigests("a".repeat(40), ["config.agc"]));
  });

  test("empty and oversized historical assets are rejected", () => {
    writeFileSync(join(fixture.path, "generated", "empty.agc"), "");
    writeFileSync(join(fixture.path, "generated", "large.agc"), Buffer.alloc(4 * 1024 * 1024 + 1));
    fixture.git(["add", "generated"]);
    const sha = fixture.commit("invalid assets", "2026-01-05T00:00:00Z");
    expectPolicyFailure(fixture.repo.assetDigests(sha, ["empty.agc"]));
    expectPolicyFailure(fixture.repo.assetDigests(sha, ["large.agc"]));
  });
});
