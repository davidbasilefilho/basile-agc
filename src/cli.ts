import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { Effect } from "effect";

import { generate, parseProfile, type Target } from "./generator";

const usage =
  "bun run generate|validate [--target all|gcam|standalone] [--profile FILE] [--out DIRECTORY]";
const err = (e: unknown) => (e instanceof Error ? e : new Error("Generation failed"));
const io = <T>(action: () => Promise<T>) => Effect.tryPromise({ try: action, catch: err });
const checked = <T>(action: () => T) => Effect.try({ try: action, catch: err });

function parseArgs(args: string[]) {
  const [command, ...rest] = args;
  if (command !== "generate" && command !== "validate") throw new Error(usage);
  let target: Target = "all",
    profile = resolve(import.meta.dir, "../data/profile.json"),
    out = resolve("generated");
  const seen = new Set<string>();
  for (let i = 0; i < rest.length; i += 2) {
    const flag = rest[i],
      value = rest[i + 1];
    if (!flag || !value || value.startsWith("--") || seen.has(flag)) throw new Error(usage);
    seen.add(flag);
    if (flag === "--target" && (value === "all" || value === "gcam" || value === "standalone"))
      target = value;
    else if (flag === "--profile") profile = resolve(value);
    else if (flag === "--out") out = resolve(value);
    else throw new Error(usage);
  }
  return { command, target, profile, out };
}

function run(args: string[]) {
  return Effect.gen(function* () {
    if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
      console.log(usage);
      return;
    }
    const { command, profile, target, out } = yield* checked(() => parseArgs(args));
    const json = yield* io(() => readFile(profile, "utf8"));
    const files = yield* checked(() => generate(parseProfile(JSON.parse(json) as unknown), target));
    if (command === "generate") yield* io(() => mkdir(out, { recursive: true }));
    const existing = yield* io(() => readdir(out));
    if (existing.some((name) => !files.has(name)))
      return yield* Effect.fail(
        new Error(
          "Output directory contains unrelated or stale files. Choose an empty directory; no files were removed.",
        ),
      );
    for (const [name, data] of files) {
      const dest = join(out, name);
      if (command === "generate") yield* io(() => writeFile(dest, data));
      else if (
        !(yield* io(() => readFile(dest))).equals(
          typeof data === "string" ? Buffer.from(data, "utf8") : data,
        )
      )
        return yield* Effect.fail(new Error("Generated artifact differs: " + name));
      console.log((command === "generate" ? "Wrote " : "Verified ") + name);
    }
  });
}
await Effect.runPromise(
  run(Bun.argv.slice(2)).pipe(
    Effect.match({
      onSuccess: () => {},
      onFailure: (error) => {
        console.error(error.message);
        process.exitCode = 1;
      },
    }),
  ),
);
