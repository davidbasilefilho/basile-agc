import { afterEach, beforeEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Effect } from "effect";

import { verifyArtifacts } from "../src/verify";

let root = "";
const gcam = "Basile-S23-AGC9.2-V14.agc";
const xmp = "Basile-AGC-Camera-photo-look.xmp";
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "basile-verify-"));
  for (const dir of ["data", "generated"])
    await cp(join(import.meta.dir, "..", dir), join(root, dir), { recursive: true });
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
async function change(file: string, mutate: (text: string) => string, fixDigest: boolean) {
  const path = join(root, "generated", file);
  const changed = mutate(await readFile(path, "utf8"));
  await writeFile(path, changed);
  if (fixDigest) {
    const path = join(root, "generated", "manifest.json");
    const manifest = JSON.parse(await readFile(path, "utf8")) as {
      outputs: { file: string; sha256: string }[];
    };
    manifest.outputs.find((a) => a.file === file)!.sha256 = createHash("sha256")
      .update(changed)
      .digest("hex");
    await writeFile(path, JSON.stringify(manifest));
  }
}
test("independent namespace-aware parser verifies all 451 typed preferences and XMP", async () => {
  expect(await Effect.runPromise(verifyArtifacts(root))).toBe(451);
});
test("validator rejects changed bits even when the XML still parses", async () => {
  await change(gcam, (s) => s + "\n", false);
  expect(await Effect.runPromise(Effect.result(verifyArtifacts(root)))).toHaveProperty(
    "_tag",
    "Failure",
  );
});
test("validator rejects duplicate AGC keys even with recomputed digest", async () => {
  await change(
    gcam,
    (s) => s.replace("</map>", '<string name="pref_qjpg_key">97</string></map>'),
    true,
  );
  expect(await Effect.runPromise(Effect.result(verifyArtifacts(root)))).toHaveProperty(
    "_tag",
    "Failure",
  );
});
test("validator rejects a look-alike Camera Raw namespace", async () => {
  await change(
    xmp,
    (s) => s.replace("http://ns.adobe.com/camera-raw-settings/1.0/", "https://example.invalid/"),
    true,
  );
  expect(await Effect.runPromise(Effect.result(verifyArtifacts(root)))).toHaveProperty(
    "_tag",
    "Failure",
  );
});
test("validator rejects DTDs", async () => {
  await change(gcam, (s) => s.replace("<map>", "<!DOCTYPE map><map>"), true);
  expect(await Effect.runPromise(Effect.result(verifyArtifacts(root)))).toHaveProperty(
    "_tag",
    "Failure",
  );
});
