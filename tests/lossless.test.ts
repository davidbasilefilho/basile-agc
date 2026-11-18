import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { fromOriginal } from "../src/lossless";

const encode = (s: string) => new TextEncoder().encode(s);
const sample = (a: string, b: string) =>
  "\uFEFF<?xml version='1.0' encoding='utf-8'?>\r\n" +
  [
    "<map>",
    "<!-- Keep formatting; XML-looking comments are not preferences. -->",
    "<string name='odd'>🌧 &amp; ☀</string>",
    "<string name='empty'/>",
    "<boolean name='unrelated' value='true' />",
    "<int value='20' name='unchanged_int'/>",
    "<long value='99' name='unchanged_long'/>",
    "<float name='decimal' value='0.25'/>",
    "<set name='ids'><string>4</string><string>2</string></set>",
    "<string name='explicit_default'>Off (as in library)</string>",
    "<string name='pref_camera_sounds_key'>" + a + "</string>",
    '<string  name = "pref_camera_single_shot_sound_key" >' + b + "</string>",
    "</map>",
    "",
  ].join("\r\n");
const key = "pref_camera_sounds_key";

test("identity mode preserves every byte, including BOM, CRLF, entity spelling, order and XML layout", () => {
  for (const s of [
    sample("1", "1"),
    sample("0", "&#48;"),
    "<map><string name='future.build.key'>unknown</string></map>",
  ]) {
    const src = encode(s);
    expect(fromOriginal(src)).toEqual(src);
  }
});

test("explicit mute modifies exactly the requested text bytes, leaving other controls and all metadata alone", () => {
  for (const [a, b] of [
    ["1", "1"],
    ["0", "1"],
    ["1", "0"],
  ] as const) {
    const output = fromOriginal(encode(sample(a, b)), "sounds-off");
    expect(output).toEqual(encode(sample("0", "0")));
    expect(fromOriginal(output, "sounds-off")).toEqual(output);
  }
  const alreadyOff = encode(sample("0", "&#48;"));
  expect(fromOriginal(alreadyOff, "sounds-off")).toEqual(alreadyOff);
});

test("recovery refuses unsafe or structurally ambiguous source input without guessing", () => {
  for (const value of [
    "",
    "<invalid/>",
    "<map/>",
    "<map><string/></map>",
    "<map><string name='x'/><int name='x' value='1'/></map>",
    "<map><string name='x'><string>nested</string></string></map>",
    "<map xmlns='urn:x'><string name='x'>abc</string></map>",
    "<!DOCTYPE map [<!ENTITY mark 'unsafe'>]><map><string name='x'>&mark;</string></map>",
    "<?xml version='1.0' encoding='windows-1252'?><map><string name='x'/></map>",
    "<map><boolean name='x'/></map>",
    "<map><set name='x'><int value='1'/></set></map>",
  ])
    expect(() => fromOriginal(encode(value))).toThrow();
  expect(() => fromOriginal(Uint8Array.from([0xff, 0xfe, 65]))).toThrow();
});

test("mute fails closed for absent, incorrectly typed, unexpected, or ambiguous sound values", () => {
  for (const s of [
    sample("1", "1").replace(key, "unrelated_key"),
    sample("1", "1").replace(
      "<string name='" + key + "'>1</string>",
      "<int name='" + key + "' value='1'/>",
    ),
    sample("false", "1"),
    sample("1<!--keep-->", "1"),
  ])
    expect(() => fromOriginal(encode(s), "sounds-off")).toThrow();
});

test("private generate/validate handle exclusive 0600 outputs and forbid checkout, overwrite or misleading flags", async () => {
  const root = await mkdtemp(join(tmpdir(), "basile-original-test-"));
  const source = join(root, "source.agc"),
    dir = join(root, "output"),
    dest = join(dir, "Basile-S23-AGC9.2-V14.agc");
  const repo = resolve(import.meta.dir, "..");
  const run = (cmd: string, opts: string[]) =>
    Bun.spawnSync([process.execPath, join(repo, "src/cli.ts"), cmd, "--source", source, ...opts], {
      cwd: repo,
    });
  try {
    await mkdir(dir);
    await writeFile(source, sample("1", "0"));
    for (const opts of [
      [],
      ["--out", repo],
      ["--out", dir, "--profile", "data/profile.json"],
      ["--out", dir, "--target", "all"],
      ["--out", dir, "--overlay", "adjust-color"],
    ])
      expect(run("generate", opts).exitCode).toBe(1);
    const alias = join(root, "alias");
    await symlink(repo, alias);
    expect(run("generate", ["--out", alias]).exitCode).toBe(1);
    const args = ["--target", "gcam", "--out", dir, "--overlay", "sounds-off"];
    expect(run("generate", args).exitCode).toBe(0);
    expect((await stat(dest)).mode & 0o777).toBe(0o600);
    expect(run("validate", args).exitCode).toBe(0);
    expect(run("generate", args).exitCode).toBe(1);
    expect(await readFile(source, "utf8")).toBe(sample("1", "0"));
    expect(await readFile(dest, "utf8")).toBe(sample("0", "0"));
    await writeFile(dest, sample("1", "1"));
    expect(run("validate", args).exitCode).toBe(1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
