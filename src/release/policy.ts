import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

import { Data, Effect } from "effect";

const shaPattern = /^[0-9a-f]{40}$/u;
const prereleasePattern = /^pre-([0-9]{8}T[0-9]{6}Z)-([0-9a-f]{40})$/u;
const stablePattern = /^v[A-Za-z0-9][A-Za-z0-9.+_-]{0,126}$/u;
const markerPrefix = "<!-- basile-agc:auto-pre:";
const maximumAssetSize = 4 * 1024 * 1024;

/** A validation or Git failure that invalidates the entire deletion plan. */
export class PolicyError extends Data.TaggedError("PolicyError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

/** Authoritative release metadata, never inferred from a tag's name alone. */
export interface Release {
  readonly tagName: string;
  readonly body: string;
  readonly prerelease: boolean;
  readonly draft: boolean;
}

/** Release-only deletion candidates; independent tag deletion is prohibited. */
export interface PrunePlan {
  readonly releaseTags: readonly string[];
  readonly tagNamesToDelete: readonly [];
}

function wholeMatch(pattern: RegExp, text: string): RegExpExecArray | null {
  const match = pattern.exec(text);
  return match?.[0] === text ? match : null;
}

function ensureSha(sha: string): void {
  if (!wholeMatch(shaPattern, sha)) {
    throw new PolicyError({ message: "Expected a full lowercase 40-character commit SHA" });
  }
}

function checked<A>(operation: () => A): Effect.Effect<A, PolicyError> {
  return Effect.try({
    try: operation,
    catch: (cause) =>
      cause instanceof PolicyError
        ? cause
        : new PolicyError({ message: "Git policy operation failed", cause }),
  });
}

/** Structural read-only repository contract for policy and publisher testing. */
export interface Repository {
  /** Resolve a commit reference. */
  commit(ref: string): Effect.Effect<string, PolicyError>;
  /** Resolve and peel an exact tag, returning null when absent. */
  resolveTag(tag: string): Effect.Effect<string | null, PolicyError>;
  /** Return a UTC committer timestamp. */
  timestamp(sha: string): Effect.Effect<string, PolicyError>;
  /** Fail when complete local history is unavailable. */
  assertFullHistory(): Effect.Effect<void, PolicyError>;
  /** Test commit ancestry, including the identical commit. */
  isAncestor(ancestor: string, descendant: string): Effect.Effect<boolean, PolicyError>;
  /** List safe regular-file assets from the exact historical generated directory. */
  generatedAssetNames(sha: string): Effect.Effect<readonly string[], PolicyError>;
  /** Identify the committed photo-first release schema. */
  photoFirstSchema(sha: string): Effect.Effect<boolean, PolicyError>;
  /** Hash bytes of generated assets at the specified historical commit. */
  assetDigests(
    sha: string,
    names: readonly string[],
  ): Effect.Effect<Record<string, string>, PolicyError>;
}

/** Checked, read-only Git operations with typed errors and no shell evaluation. */
export class GitRepository implements Repository {
  private readonly path: string;

  /** Bind policy operations to an existing local repository. */
  constructor(path: string) {
    this.path = path;
  }

  private run(arguments_: readonly string[], allowed: readonly number[] = [0]) {
    return checked(() => {
      const result = spawnSync("git", ["--no-replace-objects", "-C", this.path, ...arguments_], {
        timeout: 30_000,
        maxBuffer: maximumAssetSize + 1024,
        windowsHide: true,
      });
      if (
        result.error ||
        result.signal ||
        result.status === null ||
        !allowed.includes(result.status)
      ) {
        throw new PolicyError({
          message: `Git operation failed (${arguments_[0] ?? "unknown"})`,
          cause: result.error,
        });
      }
      return { stdout: result.stdout, exitCode: result.status };
    });
  }

  /** Resolve a reference to its commit, peeling annotated tags. */
  commit(ref: string): Effect.Effect<string, PolicyError> {
    return this.run(["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`]).pipe(
      Effect.flatMap(({ stdout }) =>
        checked(() => {
          const sha = stdout.toString("utf8").trim();
          ensureSha(sha);
          return sha;
        }),
      ),
    );
  }

  /** Resolve an exact tag ref, returning null only when that tag is absent. */
  resolveTag(tag: string): Effect.Effect<string | null, PolicyError> {
    return Effect.gen({ self: this }, function* () {
      const ref = `refs/tags/${tag}`;
      yield* this.run(["check-ref-format", ref]);
      const result = yield* this.run(["show-ref", "--verify", "--quiet", ref], [0, 1]);
      return result.exitCode === 1 ? null : yield* this.commit(ref);
    });
  }

  /** Return the commit's committer date as a UTC prerelease-tag component. */
  timestamp(sha: string): Effect.Effect<string, PolicyError> {
    return Effect.gen({ self: this }, function* () {
      yield* checked(() => ensureSha(sha));
      const { stdout } = yield* this.run(["show", "-s", "--format=%ct", sha, "--"]);
      return yield* checked(() => {
        const raw = stdout.toString("utf8").trim();
        if (!wholeMatch(/^-?[0-9]+$/u, raw))
          throw new PolicyError({ message: "Invalid Git committer timestamp" });
        const seconds = Number(raw);
        if (!Number.isSafeInteger(seconds))
          throw new PolicyError({ message: "Invalid Git committer timestamp" });
        const formatted = new Date(seconds * 1000)
          .toISOString()
          .replace(/[-:]/gu, "")
          .replace(".000", "");
        if (!wholeMatch(/^[0-9]{8}T[0-9]{6}Z$/u, formatted))
          throw new PolicyError({ message: "Unsupported Git committer date" });
        return formatted;
      });
    });
  }

  /** Require complete local history before considering any deletion. */
  assertFullHistory(): Effect.Effect<void, PolicyError> {
    return this.run(["rev-parse", "--is-shallow-repository"]).pipe(
      Effect.flatMap(({ stdout }) =>
        stdout.toString("utf8").trim() === "false"
          ? Effect.void
          : Effect.fail(
              new PolicyError({ message: "Complete Git history is required for release pruning" }),
            ),
      ),
    );
  }

  /** Return true for ancestors or the same commit; command errors fail closed. */
  isAncestor(ancestor: string, descendant: string): Effect.Effect<boolean, PolicyError> {
    return Effect.gen({ self: this }, function* () {
      yield* checked(() => {
        ensureSha(ancestor);
        ensureSha(descendant);
      });
      const result = yield* this.run(["merge-base", "--is-ancestor", ancestor, descendant], [0, 1]);
      return result.exitCode === 0;
    });
  }

  /** List exact historical tree entries, rejecting missing directories and unsafe names. */
  generatedAssetNames(sha: string): Effect.Effect<readonly string[], PolicyError> {
    return Effect.gen({ self: this }, function* () {
      yield* checked(() => ensureSha(sha));
      const { stdout } = yield* this.run(["ls-tree", "-z", `${sha}^{commit}:generated`, "--"]);
      return yield* checked(() => {
        // Latin-1 preserves each byte; non-ASCII filenames then fail the allowlist
        // rather than being replaced, normalized or interpreted as quoted names.
        const raw = stdout.toString("latin1");
        if (!raw.endsWith("\0"))
          throw new PolicyError({ message: "Missing or empty historical generated assets" });
        const names = new Set<string>();
        for (const entry of raw.slice(0, -1).split("\0")) {
          const match = wholeMatch(
            /^(100644|100755) blob ([0-9a-f]{40})\t([A-Za-z0-9._-]+)$/u,
            entry,
          );
          const name = match?.[3];
          if (
            name === undefined ||
            name === "." ||
            name === ".." ||
            name === "__proto__" ||
            names.has(name)
          )
            throw new PolicyError({ message: "Unsafe historical generated tree entry" });
          names.add(name);
        }
        return [...names].sort();
      });
    });
  }

  /** Read the fixed schema marker from the historical tree, never the working tree. */
  photoFirstSchema(sha: string): Effect.Effect<boolean, PolicyError> {
    return Effect.gen({ self: this }, function* () {
      yield* checked(() => ensureSha(sha));
      const { stdout } = yield* this.run([
        "ls-tree",
        "-z",
        `${sha}^{commit}`,
        "--",
        "src/release/photo-first.marker",
      ]);
      const entry = stdout.toString("utf8");
      if (entry === "") return false;
      const match = /^100644 blob ([0-9a-f]{40})\tsrc\/release\/photo-first\.marker\0$/.exec(entry);
      if (!match)
        return yield* Effect.fail(new PolicyError({ message: "Invalid schema marker entry" }));
      const content = yield* this.run(["cat-file", "blob", match[1]!]);
      if (content.stdout.toString("utf8") !== "basile-agc-photo-first-v1\n")
        return yield* Effect.fail(new PolicyError({ message: "Invalid schema marker content" }));
      return true;
    });
  }

  /** Hash exact historical generated blobs as bytes, without line-ending conversion. */
  assetDigests(
    sha: string,
    names: readonly string[],
  ): Effect.Effect<Record<string, string>, PolicyError> {
    return Effect.gen({ self: this }, function* () {
      yield* checked(() => ensureSha(sha));
      const digests: Record<string, string> = {};
      for (const name of names) {
        yield* checked(() => {
          if (
            !wholeMatch(/^[A-Za-z0-9._-]+$/u, name) ||
            name === "." ||
            name === ".." ||
            name === "__proto__" ||
            Object.hasOwn(digests, name)
          ) {
            throw new PolicyError({ message: "Unexpected or duplicate asset name" });
          }
        });
        const object = `${sha}:generated/${name}`;
        const sizeResult = yield* this.run(["cat-file", "-s", object]);
        const size = yield* checked(() => {
          const raw = sizeResult.stdout.toString("utf8").trim();
          const value = Number(raw);
          if (
            !wholeMatch(/^[0-9]+$/u, raw) ||
            !Number.isSafeInteger(value) ||
            value <= 0 ||
            value > maximumAssetSize
          ) {
            throw new PolicyError({ message: "Unexpected asset size" });
          }
          return value;
        });
        const { stdout } = yield* this.run(["cat-file", "blob", object]);
        if (stdout.length !== size)
          return yield* Effect.fail(
            new PolicyError({ message: "Historical asset byte length mismatch" }),
          );
        digests[name] = `sha256:${createHash("sha256").update(stdout).digest("hex")}`;
      }
      return digests;
    });
  }
}

/** Accept bounded ASCII v-prefixed versions, not only three-component SemVer. */
export function isStableTag(tag: string): boolean {
  return (
    wholeMatch(stablePattern, tag) !== null &&
    !tag.includes("..") &&
    !tag.endsWith(".") &&
    !tag.endsWith(".lock")
  );
}

/** Build the exact standalone ownership marker; invalid SHA arguments throw PolicyError. */
export function managedMarker(sha: string): string {
  ensureSha(sha);
  return `<!-- basile-agc:auto-pre:v1:${sha} -->`;
}

/** Derive a deterministic prerelease name from the exact commit's committer date. */
export function prereleaseTag(repo: Repository, ref = "HEAD"): Effect.Effect<string, PolicyError> {
  return Effect.gen(function* () {
    const sha = yield* repo.commit(ref);
    const timestamp = yield* repo.timestamp(sha);
    return `pre-${timestamp}-${sha}`;
  });
}

/** Plan release-only deletion when ownership, SHA, date and ancestry all agree.
 * Missing/manual/draft/stable/side-branch records are retained. Checked errors,
 * duplicate release records or incomplete history abort the entire plan.
 */
export function planPrune(
  repo: Repository,
  releases: readonly Release[],
  stableTag: string,
): Effect.Effect<PrunePlan, PolicyError> {
  return Effect.gen(function* () {
    if (!isStableTag(stableTag))
      return yield* Effect.fail(new PolicyError({ message: "Unsafe stable version tag" }));
    const stableSha = yield* repo.resolveTag(stableTag);
    if (stableSha === null)
      return yield* Effect.fail(
        new PolicyError({ message: "Stable version tag is missing locally" }),
      );
    yield* repo.assertFullHistory();
    const candidates: string[] = [];
    const seen = new Set<string>();
    for (const release of releases) {
      if (seen.has(release.tagName))
        return yield* Effect.fail(new PolicyError({ message: "Duplicate release tag metadata" }));
      seen.add(release.tagName);
      if (release.prerelease !== true || release.draft !== false) continue;
      const match = wholeMatch(prereleasePattern, release.tagName);
      const timestamp = match?.[1];
      const sha = match?.[2];
      if (timestamp === undefined || sha === undefined) continue;
      const markers = release.body.split(/\r?\n/u).filter((line) => line.includes(markerPrefix));
      if (markers.length !== 1 || markers[0] !== managedMarker(sha)) continue;
      const resolved = yield* repo.resolveTag(release.tagName);
      if (resolved !== sha || (yield* repo.timestamp(sha)) !== timestamp) continue;
      if (yield* repo.isAncestor(sha, stableSha)) candidates.push(release.tagName);
    }
    return { releaseTags: candidates.sort(), tagNamesToDelete: [] as const };
  });
}
