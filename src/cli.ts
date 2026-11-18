import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { Effect } from "effect";

import { generate, parseProfile, type Target } from "./generator";
import { useOriginal, type OriginalOverlay } from "./lossless";

const usage =
  "bun run generate|validate [--target all|gcam|standalone] [--profile FILE] [--out DIRECTORY] or --source ORIGINAL.agc --out EXISTING_PRIVATE_DIRECTORY [--overlay none|sounds-off|video-hdr30|video-sdr60]";
const err = (e: unknown) => (e instanceof Error ? e : new Error("Generation failed"));
const io = <T>(action: () => Promise<T>) => Effect.tryPromise({ try: action, catch: err });
const checked = <T>(action: () => T) => Effect.try({ try: action, catch: err });

function parseArgs(args: string[]) {
  const [command, ...rest] = args;
  if (command !== "generate" && command !== "validate") throw new Error(usage);
  let source: string | undefined;
  let overlay: OriginalOverlay = "none";
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
    else if (flag === "--source") source = resolve(value);
    else if (
      flag === "--overlay" &&
      (value === "none" ||
        value === "sounds-off" ||
        value === "video-hdr30" ||
        value === "video-sdr60")
    )
      overlay = value;
    else if (flag === "--profile") profile = resolve(value);
    else if (flag === "--out") out = resolve(value);
    else throw new Error(usage);
  }
  if (
    source &&
    (!seen.has("--out") || seen.has("--profile") || (seen.has("--target") && target !== "gcam"))
  )
    throw new Error(usage);
  if (!source && seen.has("--overlay")) throw new Error(usage);
  return { command: command as "generate" | "validate", target, profile, out, source, overlay };
}

function run(args: string[]) {
  return Effect.gen(function* () {
    if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
      console.log(usage);
      return;
    }
    const { command, profile, target, out, source, overlay } = yield* checked(() =>
      parseArgs(args),
    );
    if (source) {
      const result = yield* useOriginal(command, source, out, overlay);
      console.log(
        (command === "generate" ? "Generated" : "Verified") +
          (result.identical
            ? " private GCam config: byte-identical to source."
            : overlay.startsWith("video-")
              ? " private GCam video candidate: requested settings saved; S23 recording not verified."
              : " private GCam config: only requested sound values changed."),
      );
      return;
    }
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
