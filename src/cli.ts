import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { generate, parseProfile, type Target } from "./generator";

const usage =
  "bun run generate|validate [--target all|gcam|standalone] [--profile FILE] [--out DIRECTORY]";
async function main(args: string[]) {
  const [command, ...rest] = args;
  if (command === "--help" || command === "-h") {
    console.log(usage);
    return;
  }
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
  const model = parseProfile(JSON.parse(await readFile(profile, "utf8")) as unknown);
  const files = generate(model, target);
  if (command === "generate") await mkdir(out, { recursive: true });
  const existing = await readdir(out);
  if (existing.some((name) => !files.has(name)))
    throw new Error(
      "Output directory contains unrelated or stale files. Choose an empty directory; no files were removed.",
    );
  for (const [name, data] of files) {
    const dest = join(out, name);
    if (command === "generate") await writeFile(dest, data);
    else if ((await readFile(dest, "utf8")) !== data)
      throw new Error("Generated artifact differs: " + name);
    console.log((command === "generate" ? "Wrote " : "Verified ") + name);
  }
}
try {
  await main(Bun.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : "Generation failed");
  process.exitCode = 1;
}
