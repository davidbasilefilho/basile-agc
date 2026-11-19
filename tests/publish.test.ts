import { expect, test } from "bun:test";

import { Effect, Exit } from "effect";

import { PolicyError, type Repository } from "../src/release/policy";
import {
  assetNames,
  checkedAssets,
  legacyAssetNames,
  nativeAssetNames,
  videoAssetNames,
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
function historicalPreview(format: "legacy" | "native") {
  const names: readonly string[] = format === "legacy" ? legacyAssetNames : nativeAssetNames;
  const preview = record(tag, base, true, 2);
  preview.assets = names.map((name) => ({
    name,
    state: "uploaded",
    digest: "sha256:" + "c".repeat(64),
    uploader: { login: "github-actions[bot]" },
  }));
  preview.body = releaseNotes(tag, base, true, format).body;
  return { names, preview };
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
    assetDigests: (_sha, names) =>
      Effect.succeed(Object.fromEntries(names.map((name) => [name, "sha256:" + "c".repeat(64)]))),
    generatedAssetNames: () => Effect.succeed(assetNames),
    photoFirstSchema: () => Effect.succeed(true),
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

test("legacy three-file preview is pruned only when its exact commit tree predates ZIP", async () => {
  const f = fixture();
  f.refs.set(tag, base);
  f.records.set("v1", record("v1", tip));
  f.records.set(tag, historicalPreview("legacy").preview);
  const calls: string[] = [];
  f.repo.generatedAssetNames = (sha) => {
    calls.push(sha);
    return Effect.succeed(legacyAssetNames);
  };
  await Effect.runPromise(prune(f.repo, f.api, "v1", tip, expected));
  expect(calls).toEqual([base]);
  expect(f.deleted).toEqual([2]);
  expect(f.refs.get(tag)).toBe(base);
});

test("missing ZIP in a native-era preview cannot masquerade as a legacy release", async () => {
  const f = fixture();
  f.refs.set(tag, base);
  f.records.set("v1", record("v1", tip));
  f.records.set(tag, historicalPreview("legacy").preview);
  f.repo.generatedAssetNames = () => Effect.succeed(nativeAssetNames);
  // Historical tree still has the ZIP: remote omission and old notes prove nothing.
  await Effect.runPromise(prune(f.repo, f.api, "v1", tip, expected));
  expect(f.deleted).toEqual([]);
});

test("legacy preview with added ZIP or unknown artifact survives", async () => {
  for (const added of ["Basile-AGC-Camera-profile.zip", "manual.txt"]) {
    const f = fixture();
    f.refs.set(tag, base);
    f.records.set("v1", record("v1", tip));
    const { preview: legacy } = historicalPreview("legacy");
    legacy.assets.push({
      name: added,
      state: "uploaded",
      digest: expected["manifest.json"]!,
      uploader: { login: "github-actions[bot]" },
    });
    f.records.set(tag, legacy);
    f.repo.generatedAssetNames = () => Effect.succeed(legacyAssetNames);
    await Effect.runPromise(prune(f.repo, f.api, "v1", tip, expected));
    expect(f.deleted).toEqual([]);
  }
});

test("unknown historical generated layout remains untouched", async () => {
  const f = fixture();
  f.refs.set(tag, base);
  f.records.set("v1", record("v1", tip));
  f.records.set(tag, record(tag, base, true, 2));
  f.repo.generatedAssetNames = () => Effect.succeed([...assetNames, "future.json"]);
  await Effect.runPromise(prune(f.repo, f.api, "v1", tip, expected));
  expect(f.deleted).toEqual([]);
});

test("historical tree read failures are not interpreted as pre-ZIP history", async () => {
  const f = fixture();
  f.refs.set(tag, base);
  f.records.set("v1", record("v1", tip));
  f.records.set(tag, record(tag, base, true, 2));
  f.repo.generatedAssetNames = () => Effect.fail(new PolicyError({ message: "tree unavailable" }));
  expect(
    Exit.isFailure(await Effect.runPromiseExit(prune(f.repo, f.api, "v1", tip, expected))),
  ).toBe(true);
  expect(f.deleted).toEqual([]);
});

test("untouched native-era previews still prune with their exact original four-file tree and notes", async () => {
  const f = fixture();
  const { names, preview } = historicalPreview("native");
  f.refs.set(tag, base);
  f.records.set("v1", record("v1", tip));
  f.records.set(tag, preview);
  f.repo.generatedAssetNames = () => Effect.succeed(names);
  f.repo.photoFirstSchema = () => Effect.succeed(false);
  await Effect.runPromise(prune(f.repo, f.api, "v1", tip, expected));
  expect(f.deleted).toEqual([2]);
  expect(f.refs.get(tag)).toBe(base);
  expect(preview.body).toContain(
    "Includes the GCam camera preset, an experimental native standalone AGC Camera profile ZIP, and an optional photo-look XMP.",
  );
});

test("old native notes and assets cannot downgrade a current five-file preview", async () => {
  const f = fixture();
  f.refs.set(tag, base);
  f.records.set("v1", record("v1", tip));
  f.records.set(tag, historicalPreview("native").preview);
  f.repo.generatedAssetNames = () => Effect.succeed(videoAssetNames);
  await Effect.runPromise(prune(f.repo, f.api, "v1", tip, expected));
  expect(f.deleted).toEqual([]);
});

test("adding the SDR file to a historical native preview prevents pruning", async () => {
  const f = fixture();
  f.refs.set(tag, base);
  f.records.set("v1", record("v1", tip));
  const { preview } = historicalPreview("native");
  const sdr = {
    name: videoAssetNames[4],
    state: "uploaded",
    digest: "sha256:" + "c".repeat(64),
    uploader: { login: "github-actions[bot]" },
  };
  preview.assets.push(sdr);
  f.records.set(tag, preview);
  f.repo.generatedAssetNames = () => Effect.succeed(nativeAssetNames);
  await Effect.runPromise(prune(f.repo, f.api, "v1", tip, expected));
  expect(f.deleted).toEqual([]);
});

test("current stable publication requires all four assets", async () => {
  const f = fixture();
  const r = record("v1", tip);
  r.assets = r.assets.filter((a) => a.name !== "Basile-S23-AGC9.2-V14-r16.agc");
  f.records.set("v1", r);
  expect(
    Exit.isFailure(await Effect.runPromiseExit(publish(f.repo, f.api, tip, expected, "v1"))),
  ).toBe(true);
  expect(f.deleted).toEqual([]);
  expect(assetNames).toHaveLength(4);
});

test("incomplete or invalid current digests fail before publication and pruning", async () => {
  for (const wrong of [
    Object.fromEntries(legacyAssetNames.map((name) => [name, expected[name]!])),
    { ...expected, "manifest.json": "not-a-digest" },
    { ...expected, "other.agc": "sha256:" + "d".repeat(64) },
  ]) {
    const f = fixture();
    expect(
      Exit.isFailure(await Effect.runPromiseExit(publish(f.repo, f.api, tip, wrong, "v1"))),
    ).toBe(true);
    expect(
      Exit.isFailure(await Effect.runPromiseExit(prune(f.repo, f.api, "v1", tip, wrong))),
    ).toBe(true);
    expect([...f.created, ...f.deleted]).toEqual([]);
  }
});

test("historical five-file previews retain their original notes and assets", async () => {
  const f = fixture();
  f.refs.set(tag, base);
  f.records.set("v1", record("v1", tip));
  const preview = historicalPreview("native").preview;
  preview.body = releaseNotes(tag, base, true, "video").body;
  preview.assets.push({
    name: videoAssetNames[4],
    state: "uploaded",
    digest: "sha256:" + "c".repeat(64),
    uploader: { login: "github-actions[bot]" },
  });
  f.records.set(tag, preview);
  f.repo.generatedAssetNames = () => Effect.succeed(videoAssetNames);
  f.repo.assetDigests = (_sha, names) =>
    Effect.succeed(Object.fromEntries(names.map((name) => [name, "sha256:" + "c".repeat(64)])));
  await Effect.runPromise(prune(f.repo, f.api, "v1", tip, expected));
  expect(f.deleted).toEqual([2]);
});

test("new layout requires marker and cannot use historical notes", async () => {
  for (const [marked, oldNotes] of [
    [false, false],
    [true, true],
  ] as const) {
    const f = fixture();
    f.refs.set(tag, base);
    f.records.set("v1", record("v1", tip));
    const preview = record(tag, base, true, 2);
    if (oldNotes) preview.body = releaseNotes(tag, base, true, "native").body;
    f.records.set(tag, preview);
    f.repo.photoFirstSchema = () => Effect.succeed(marked);
    await Effect.runPromise(prune(f.repo, f.api, "v1", tip, expected));
    expect(f.deleted).toEqual([]);
  }
});

test("failed marker reads abort pruning", async () => {
  const f = fixture();
  f.refs.set(tag, base);
  f.records.set("v1", record("v1", tip));
  f.records.set(tag, record(tag, base, true, 2));
  f.repo.photoFirstSchema = () => Effect.fail(new PolicyError({ message: "marker unavailable" }));
  expect(
    Exit.isFailure(await Effect.runPromiseExit(prune(f.repo, f.api, "v1", tip, expected))),
  ).toBe(true);
  expect(f.deleted).toEqual([]);
});
