import { expect, test } from "bun:test";

import { Effect, Exit } from "effect";

import { type Repository } from "../src/release/policy";
import {
  assetNames,
  checkedAssets,
  owns,
  publish,
  prune,
  releaseNotes,
  type ReleaseService,
  type RemoteRelease,
} from "../src/release/publish";
import { githubService, runProduction } from "../src/release/run";

const base = "a".repeat(40),
  tip = "b".repeat(40),
  tag = `pre-20260101T000000Z-${base}`;
const expected = Object.fromEntries(assetNames.map((name) => [name, "sha256:" + "c".repeat(64)]));
function record(name: string, sha: string, pre = false, id = 1): RemoteRelease {
  const notes = releaseNotes(name, sha, pre);
  return {
    id,
    tag_name: name,
    name: notes.title,
    body: notes.body,
    draft: false,
    prerelease: pre,
    immutable: false,
    author: { login: "github-actions[bot]", type: "Bot" },
    assets: assetNames.map((name) => ({
      name,
      state: "uploaded",
      digest: expected[name]!,
      uploader: { login: "github-actions[bot]" },
    })),
  };
}
function fixture() {
  const records = new Map<string, RemoteRelease>(),
    refs = new Map<string, string>([["v1", tip]]),
    created: string[] = [],
    deleted: number[] = [];
  const repo: Repository = {
    commit: (ref) => Effect.succeed(ref),
    resolveTag: (t) => Effect.succeed(refs.get(t) ?? null),
    timestamp: () => Effect.succeed("20260101T000000Z"),
    isAncestor: () => Effect.succeed(true),
    assertFullHistory: () => Effect.void,
    assetDigests: () => Effect.succeed(expected),
  };
  const api: ReleaseService = {
    releases: () => Effect.succeed([...records.values()]),
    byTag: (t) => Effect.succeed(records.get(t) ?? null),
    byId: (id) => Effect.succeed([...records.values()].find((r) => r.id === id) ?? null),
    refSha: (t) => Effect.succeed(refs.get(t) ?? null),
    create: (t, sha, pre) =>
      Effect.sync(() => {
        refs.set(t, sha);
        created.push(t);
        records.set(t, record(t, sha, pre, 90));
      }),
    deleteRelease: (id) =>
      Effect.sync(() => {
        deleted.push(id);
        for (const [t, r] of records) if (r.id === id) records.delete(t);
      }),
  };
  return { records, refs, created, deleted, repo, api };
}
test("stable create and retry verify without duplicates", async () => {
  const f = fixture();
  await Effect.runPromise(publish(f.repo, f.api, tip, expected, "v1"));
  await Effect.runPromise(publish(f.repo, f.api, tip, expected, "v1"));
  expect(f.created).toEqual(["v1"]);
  expect(f.deleted).toEqual([]);
});
test("prune deletes included preview record but preserves tag", async () => {
  const f = fixture();
  await Effect.runPromise(publish(f.repo, f.api, base, expected));
  f.records.get(tag)!.id = 2;
  await Effect.runPromise(publish(f.repo, f.api, tip, expected, "v1"));
  expect(f.deleted).toEqual([2]);
  expect(f.refs.get(tag)).toBe(base);
  expect(f.records.has("v1")).toBe(true);
});
test("draft, foreign, unowned, wrong assets or prerelease stable never triggers cleanup", async () => {
  for (const change of [
    { draft: true },
    { author: { login: "human", type: "User" } },
    { body: "manual" },
    { assets: [] },
    { prerelease: true },
  ]) {
    const f = fixture();
    f.records.set("v1", { ...record("v1", tip), ...change });
    expect(
      Exit.isFailure(await Effect.runPromiseExit(publish(f.repo, f.api, tip, expected, "v1"))),
    ).toBe(true);
    expect([...f.created, ...f.deleted]).toEqual([]);
  }
});
test("missing or moved stable target blocks writes", async () => {
  for (const sha of [null, base]) {
    const f = fixture();
    if (sha) f.refs.set("v1", sha);
    else f.refs.delete("v1");
    expect(
      Exit.isFailure(await Effect.runPromiseExit(publish(f.repo, f.api, tip, expected, "v1"))),
    ).toBe(true);
    expect(f.created).toEqual([]);
  }
});
test("manually changed preview title, notes, uploader or assets survive", async () => {
  const good = record(tag, base, true, 2);
  const changes: Partial<RemoteRelease>[] = [
    { name: "personal" },
    { body: good.body + "extra notes" },
    { immutable: true },
    { draft: true },
    { prerelease: false },
    { author: { login: "human", type: "User" } },
    {
      assets: [
        ...good.assets,
        { name: "manual.txt", state: "uploaded", digest: "sha256:x", uploader: { login: "human" } },
      ],
    },
    { assets: good.assets.map((a) => ({ ...a, digest: "sha256:replaced" })) },
    { assets: good.assets.map((a) => ({ ...a, uploader: { login: "human" } })) },
  ];
  for (const change of changes) {
    const f = fixture();
    f.refs.set(tag, base);
    f.records.set("v1", record("v1", tip));
    f.records.set(tag, { ...good, ...change });
    await Effect.runPromise(prune(f.repo, f.api, "v1", tip, expected));
    expect(f.deleted).toEqual([]);
  }
});
test("candidate changed between inventory and by-ID recheck survives", async () => {
  const f = fixture();
  f.refs.set(tag, base);
  f.records.set("v1", record("v1", tip));
  f.records.set(tag, record(tag, base, true, 2));
  f.api.byId = () => Effect.succeed({ ...record(tag, base, true, 2), body: "manual" });
  await Effect.runPromise(prune(f.repo, f.api, "v1", tip, expected));
  expect(f.deleted).toEqual([]);
});
test("candidate tag moved remotely survives", async () => {
  const f = fixture();
  f.refs.set(tag, base);
  f.records.set("v1", record("v1", tip));
  f.records.set(tag, record(tag, base, true, 2));
  f.api.refSha = (t) => Effect.succeed(t === tag ? tip : tip);
  await Effect.runPromise(prune(f.repo, f.api, "v1", tip, expected));
  expect(f.deleted).toEqual([]);
});
test("already released commits do not regenerate previews", async () => {
  const f = fixture();
  f.records.set("v1", record("v1", tip));
  expect(await Effect.runPromise(publish(f.repo, f.api, base, expected))).toBe("already-in-stable");
  expect(f.created).toEqual([]);
});
test("digest and marker checks reject ambiguous identity", () => {
  const r = record("v1", tip);
  expect(checkedAssets(r, expected)).toBe(true);
  r.assets[0]!.digest = "sha256:x";
  expect(checkedAssets(r, expected)).toBe(false);
  r.body += "<!-- basile-agc:auto-pre:v1:invalid -->\n";
  expect(owns(r, "v1", tip, false)).toBe(false);
});
test("HTTP handles annotated tag peeling and exact identity", async () => {
  const calls: string[] = [];
  const service = githubService("/unused", "not-a-live-token", async (url) => {
    calls.push(url);
    return Response.json(
      calls.length === 1
        ? { ref: `refs/tags/v1`, object: { type: "tag", sha: base } }
        : { object: { type: "commit", sha: tip } },
    );
  });
  expect(await Effect.runPromise(service.refSha("v1"))).toBe(tip);
  expect(calls.length).toBe(2);
});
test("existing preview tag without release is not hijacked", async () => {
  let writes = 0;
  const service = githubService("/unused", "not-a-live-token", async (_url, init) => {
    if (init.method !== "GET") writes++;
    return Response.json({ ref: `refs/tags/${tag}`, object: { type: "commit", sha: base } });
  });
  expect(Exit.isFailure(await Effect.runPromiseExit(service.create(tag, base, true)))).toBe(true);
  expect(writes).toBe(0);
});
test("outside Actions production guard fails before I/O", async () => {
  expect(Exit.isFailure(await Effect.runPromiseExit(runProduction("/does-not-exist", {})))).toBe(
    true,
  );
});
