import { Data, Effect } from "effect";

import { isStableTag, managedMarker, planPrune, prereleaseTag, type Repository } from "./policy";

/** Fixed repository boundary for CI writes. */
export const repositoryName = "davidbasilefilho/basile-agc";
/** Only these generated artifacts may be attached. */
export const assetNames = [
  "Basile-S23-AGC9.2-V14.agc",
  "Basile-AGC-Camera-photo-look.xmp",
  "manifest.json",
] as const;
/** Sanitized failures never contain credentials or response bodies. */
export class PublishError extends Data.TaggedError("PublishError")<{ readonly message: string }> {}
/** Minimum remote asset metadata used in verification. */
export interface Asset {
  name: string;
  state: string;
  digest: string | null;
  uploader: { login?: string } | null;
}
/** Explicit release metadata: absent fields cannot silently authorize removal. */
export interface RemoteRelease {
  id: number;
  tag_name: string;
  name: string | null;
  body: string | null;
  draft: boolean;
  prerelease: boolean;
  immutable: boolean | null;
  author: { login: string; type: string };
  assets: Asset[];
}
/** Injectable service boundary. Tests never hold a live token. */
export interface ReleaseService {
  releases(): Effect.Effect<RemoteRelease[], PublishError>;
  byTag(tag: string): Effect.Effect<RemoteRelease | null, PublishError>;
  byId(id: number): Effect.Effect<RemoteRelease | null, PublishError>;
  refSha(tag: string): Effect.Effect<string | null, PublishError>;
  create(tag: string, sha: string, pre: boolean): Effect.Effect<void, PublishError>;
  deleteRelease(id: number): Effect.Effect<void, PublishError>;
}
/** Fail closed with a typed publication error. */
export function requireCondition(ok: unknown, message: string): Effect.Effect<void, PublishError> {
  return ok ? Effect.void : Effect.fail(new PublishError({ message }));
}
/** Canonical title/body protect manually edited previews during cleanup. */
export function releaseNotes(tag: string, sha: string, pre: boolean) {
  return {
    title: pre ? `${tag.slice(4, 20)} · ${sha.slice(0, 12)} (preview)` : tag,
    body: `${pre ? "Prerelease" : "Release"} of the Basile AGC generator at commit \`${sha}\`. Includes the GCam camera preset and an experimental, photo-only standalone XMP. See README and the manifest for device-validation limits.\n\n${pre ? managedMarker(sha) : `<!-- basile-agc:auto-stable:v1:${sha} -->`}\n`,
  };
}
function normalizedLines(value: string) {
  return value.replaceAll("\r\n", "\n").replace(/\n$/, "");
}
function isBot(r: RemoteRelease) {
  return r.author.login === "github-actions[bot]" && r.author.type === "Bot";
}
/** Require exact identity and one unambiguous managed marker. */
export function owns(r: RemoteRelease, tag: string, sha: string, pre: boolean) {
  const marker = pre ? managedMarker(sha) : `<!-- basile-agc:auto-stable:v1:${sha} -->`;
  const markers = (r.body ?? "")
    .split(/\r?\n/)
    .filter((line) => line.includes("<!-- basile-agc:auto-"));
  return (
    r.tag_name === tag &&
    !r.draft &&
    r.prerelease === pre &&
    isBot(r) &&
    markers.length === 1 &&
    markers[0] === marker
  );
}
/** Compare exact uploaded file names and SHA-256 digests, rejecting duplicates. */
export function checkedAssets(r: RemoteRelease, expected: Readonly<Record<string, string>>) {
  return (
    r.assets.length === Object.keys(expected).length &&
    new Set(r.assets.map((a) => a.name)).size === r.assets.length &&
    r.assets.every(
      (a) =>
        a.state === "uploaded" && Object.hasOwn(expected, a.name) && expected[a.name] === a.digest,
    )
  );
}
function included(repo: Repository, api: ReleaseService, sha: string) {
  return Effect.gen(function* () {
    for (const r of yield* api.releases()) {
      if (!isStableTag(r.tag_name) || !isBot(r) || r.prerelease || r.draft) continue;
      const stableSha = yield* repo.resolveTag(r.tag_name);
      if (
        stableSha &&
        owns(r, r.tag_name, stableSha, false) &&
        (yield* api.refSha(r.tag_name)) === stableSha &&
        (yield* repo.isAncestor(sha, stableSha))
      )
        return true;
    }
    return false;
  });
}
/** Publish idempotently, then prune only after the stable artifact set verifies. */
export function publish(
  repo: Repository,
  api: ReleaseService,
  sha: string,
  expected: Readonly<Record<string, string>>,
  stableTag?: string,
) {
  return Effect.gen(function* () {
    yield* requireCondition(/^[a-f0-9]{40}$/.test(sha), "Expected full commit ID");
    const pre = stableTag === undefined;
    const tag = stableTag ?? (yield* prereleaseTag(repo, sha));
    if (pre && (yield* included(repo, api, sha))) return "already-in-stable" as const;
    if (!pre) {
      yield* requireCondition(isStableTag(tag), "Unsafe stable tag");
      yield* requireCondition(
        (yield* repo.resolveTag(tag)) === sha && (yield* api.refSha(tag)) === sha,
        "Stable target differs from validated checkout",
      );
    }
    let r = yield* api.byTag(tag);
    if (!r) {
      yield* requireCondition(
        !(yield* api.releases()).some((item) => item.tag_name === tag),
        "Existing unrecognized release or draft; stopped",
      );
      yield* api.create(tag, sha, pre);
      r = yield* api.byTag(tag);
    }
    yield* requireCondition(
      r && owns(r, tag, sha, pre) && checkedAssets(r, expected) && (yield* api.refSha(tag)) === sha,
      "Published release target/assets did not verify",
    );
    if (!pre) yield* prune(repo, api, tag, sha, expected);
    return "verified" as const;
  });
}
/** Delete only unchanged managed preview records, never Git tags. */
export function prune(
  repo: Repository,
  api: ReleaseService,
  stable: string,
  sha: string,
  expected: Readonly<Record<string, string>>,
) {
  return Effect.gen(function* () {
    const candidates = new Map<string, RemoteRelease>();
    for (const r of yield* api.releases()) {
      if (
        !/^pre-[0-9]{8}T[0-9]{6}Z-[a-f0-9]{40}$/.test(r.tag_name) ||
        r.immutable !== false ||
        !owns(r, r.tag_name, r.tag_name.slice(-40), true)
      )
        continue;
      yield* requireCondition(!candidates.has(r.tag_name), "Ambiguous release inventory");
      candidates.set(r.tag_name, r);
    }
    const plan = yield* planPrune(
      repo,
      [...candidates.values()].map((r) => ({
        tagName: r.tag_name,
        body: r.body ?? "",
        prerelease: r.prerelease,
        draft: r.draft,
      })),
      stable,
    );
    yield* requireCondition(plan.tagNamesToDelete.length === 0, "Tag deletion prohibited");
    for (const tag of plan.releaseTags) {
      const candidate = candidates.get(tag)!;
      yield* requireCondition(
        Number.isSafeInteger(candidate.id) && candidate.id > 0,
        "Invalid release ID",
      );
      const final = yield* api.byTag(stable);
      yield* requireCondition(
        final &&
          owns(final, stable, sha, false) &&
          checkedAssets(final, expected) &&
          (yield* api.refSha(stable)) === sha,
        "Stable no longer verifies; pruning stopped",
      );
      const live = yield* api.byId(candidate.id);
      if (!live) continue;
      const previewSha = tag.slice(-40),
        notes = releaseNotes(tag, previewSha, true);
      if (
        live.id !== candidate.id ||
        live.immutable !== false ||
        !owns(live, tag, previewSha, true) ||
        live.name !== notes.title ||
        normalizedLines(live.body ?? "") !== normalizedLines(notes.body) ||
        !checkedAssets(live, yield* repo.assetDigests(previewSha, assetNames)) ||
        !live.assets.every((a) => a.uploader?.login === "github-actions[bot]") ||
        (yield* api.refSha(tag)) !== previewSha
      )
        continue;
      yield* api.deleteRelease(candidate.id);
    }
  });
}
