import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { Effect } from "effect";

import { GitRepository } from "./policy";
import {
  assetNames,
  publish,
  PublishError,
  releaseNotes,
  repositoryName,
  requireCondition,
  type Asset,
  type ReleaseService,
  type RemoteRelease,
} from "./publish";

function task<A>(message: string, run: () => Promise<A>) {
  return Effect.tryPromise({ try: run, catch: () => new PublishError({ message }) });
}
function object(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid object");
  return raw as Record<string, unknown>;
}
function string(raw: unknown): string {
  if (typeof raw !== "string") throw new Error("Invalid string");
  return raw;
}
function boolean(raw: unknown): boolean {
  if (typeof raw !== "boolean") throw new Error("Invalid boolean");
  return raw;
}
function nullable(raw: unknown): string | null {
  return raw === null ? null : string(raw);
}
function release(raw: unknown): RemoteRelease {
  const r = object(raw),
    author = object(r.author);
  if (
    !Number.isSafeInteger(r.id) ||
    typeof r.id !== "number" ||
    r.id < 1 ||
    !Array.isArray(r.assets)
  )
    throw new Error("Invalid release");
  const assets: Asset[] = r.assets.map((a: unknown) => {
    const item = object(a);
    return {
      name: string(item.name),
      state: string(item.state),
      digest: nullable(item.digest),
      uploader: item.uploader === null ? null : { login: string(object(item.uploader).login) },
    };
  });
  return {
    id: r.id,
    tag_name: string(r.tag_name),
    name: nullable(r.name),
    body: nullable(r.body),
    draft: boolean(r.draft),
    prerelease: boolean(r.prerelease),
    immutable: r.immutable === undefined || r.immutable === null ? null : boolean(r.immutable),
    author: { login: string(author.login), type: string(author.type) },
    assets,
  };
}
/** Minimal fetch boundary for testing the authenticated API without a live token. */
export type Fetch = (url: string, init: RequestInit) => Promise<Response>;
/** Live service is constructed only after runProduction verifies the GitHub event. */
export function githubService(root: string, token: string, fetcher: Fetch = fetch): ReleaseService {
  const api = (path: string, method = "GET", data?: unknown, missing = false) =>
    task("GitHub request failed; stopped", async () => {
      const response = await fetcher(`https://api.github.com/repos/${repositoryName}/${path}`, {
        method,
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
          "User-Agent": "basile-agc-ci",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      });
      if (missing && response.status === 404) return null;
      if (!response.ok) throw new Error("Request failed");
      return response.status === 204 ? null : ((await response.json()) as unknown);
    });
  const parse = (value: unknown) =>
    Effect.try({
      try: () => (value === null ? null : release(value)),
      catch: () => new PublishError({ message: "Malformed release response" }),
    });
  const refSha = (tag: string) =>
    Effect.gen(function* () {
      const raw = yield* api("git/ref/tags/" + encodeURIComponent(tag), "GET", undefined, true);
      if (raw === null) return null;
      const ref = yield* task("Malformed tag response", async () => object(raw));
      yield* requireCondition(ref.ref === "refs/tags/" + tag, "Unexpected ref identity");
      let node = ref.object;
      for (let i = 0; i < 16; i++) {
        const obj = yield* task("Malformed tag object", async () => object(node));
        const sha = yield* task("Malformed Git object ID", async () => string(obj.sha));
        yield* requireCondition(/^[a-f0-9]{40}$/.test(sha), "Invalid Git object ID");
        if (obj.type === "commit") return sha;
        yield* requireCondition(obj.type === "tag", "Tag does not reference a commit");
        const tagObject = yield* api("git/tags/" + sha);
        node = (yield* task("Malformed annotated tag", async () => object(tagObject))).object;
      }
      return yield* Effect.fail(new PublishError({ message: "Excessive tag indirection" }));
    });
  return {
    refSha,
    byTag: (tag) =>
      Effect.flatMap(
        api("releases/tags/" + encodeURIComponent(tag), "GET", undefined, true),
        parse,
      ),
    byId: (id) => Effect.flatMap(api("releases/" + id, "GET", undefined, true), parse),
    releases: () =>
      Effect.gen(function* () {
        const result: RemoteRelease[] = [];
        for (let page = 1; page <= 10000; page++) {
          const rows = yield* api(`releases?per_page=100&page=${page}`);
          const items = yield* task("Malformed release inventory", async () => {
            if (!Array.isArray(rows)) throw new Error();
            return rows.map(release);
          });
          result.push(...items);
          if (items.length < 100) return result;
        }
        return yield* Effect.fail(new PublishError({ message: "Incomplete release inventory" }));
      }),
    deleteRelease: (id) =>
      Effect.gen(function* () {
        yield* requireCondition(Number.isSafeInteger(id) && id > 0, "Invalid release ID");
        yield* api("releases/" + id, "DELETE");
      }),
    create: (tag, sha, pre) =>
      Effect.gen(function* () {
        const current = yield* refSha(tag);
        if (pre) {
          // A tag without a release may have been manually created. Never adopt it.
          yield* requireCondition(
            current === null,
            "Existing preview tag without owned release; inspect before retrying",
          );
          yield* api("git/refs", "POST", { ref: "refs/tags/" + tag, sha });
        } else yield* requireCondition(current === sha, "Missing or changed stable tag");
        yield* requireCondition(
          (yield* refSha(tag)) === sha,
          "Tag changed before release creation",
        );
        const notes = releaseNotes(tag, sha, pre);
        yield* task("Release creation failed; inspect partial state before retrying", async () => {
          const dir = await mkdtemp(join(tmpdir(), "basile-release-"));
          try {
            const path = join(dir, "notes.md");
            await writeFile(path, notes.body);
            const args = [
              "gh",
              "release",
              "create",
              tag,
              "--repo",
              repositoryName,
              "--verify-tag",
              "--title",
              notes.title,
              "--notes-file",
              path,
              "--target",
              sha,
              ...(pre ? ["--prerelease", "--latest=false"] : []),
              ...assetNames.map((name) => join(root, "generated", name)),
            ];
            const proc = Bun.spawn(args, {
              cwd: root,
              env: { ...process.env, GH_TOKEN: token },
              stdout: "ignore",
              stderr: "ignore",
            });
            if ((await proc.exited) !== 0) throw new Error("Command failed");
          } finally {
            await rm(dir, { recursive: true, force: true });
          }
        });
      }),
  };
}
/** Validate the event and checkout before constructing a write-capable service. */
export function runProduction(root: string, env: NodeJS.ProcessEnv = process.env) {
  return Effect.gen(function* () {
    yield* requireCondition(
      env.GITHUB_ACTIONS === "true" &&
        env.GITHUB_EVENT_NAME === "push" &&
        env.GITHUB_REPOSITORY === repositoryName,
      "Publication restricted to repository push on Actions",
    );
    yield* requireCondition(
      env.GH_TOKEN && env.GITHUB_EVENT_PATH && env.GITHUB_REF && env.GITHUB_SHA,
      "Missing workflow context",
    );
    const event = yield* task("Invalid event document", async () =>
      object(JSON.parse(await readFile(env.GITHUB_EVENT_PATH!, "utf8")) as unknown),
    );
    const ref = env.GITHUB_REF!;
    yield* requireCondition(event.deleted === false && event.ref === ref, "Not a live push ref");
    const repo = new GitRepository(root),
      sha = yield* repo.commit("HEAD");
    for (const candidate of [env.GITHUB_SHA, event.after]) {
      yield* requireCondition(
        typeof candidate === "string" && /^[a-f0-9]{40}$/.test(candidate),
        "Invalid event SHA",
      );
      yield* requireCondition(
        (yield* repo.commit(candidate as string)) === sha,
        "Checkout is not the event commit",
      );
    }
    const defaultBranch = yield* task("Invalid default branch", async () =>
      string(object(event.repository).default_branch),
    );
    if (ref !== "refs/heads/" + defaultBranch && !ref.startsWith("refs/tags/v")) return;
    const expected = yield* task("Cannot hash release artifacts", async () =>
      Object.fromEntries(
        await Promise.all(
          assetNames.map(async (name) => [
            name,
            "sha256:" +
              createHash("sha256")
                .update(await readFile(join(root, "generated", name)))
                .digest("hex"),
          ]),
        ),
      ),
    );
    const result = yield* publish(
      repo,
      githubService(root, env.GH_TOKEN!),
      sha,
      expected,
      ref.startsWith("refs/tags/") ? ref.slice(10) : undefined,
    );
    console.log("Release workflow:", result);
  });
}
if (import.meta.main) {
  await Effect.runPromise(runProduction(resolve(import.meta.dir, "../.."))).catch(() => {
    console.error("Release workflow stopped safely; inspect run and remote state before retrying.");
    process.exitCode = 1;
  });
}
