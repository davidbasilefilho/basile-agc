import { expect, test } from "bun:test";

import defaults from "../data/profile.json";
import { generate, parseProfile } from "../src/generator";
const profile = parseProfile(defaults);
test("same input yields exactly the same three artifacts and digest manifest", () => {
  const first = generate(profile),
    second = generate(profile);
  expect([...first]).toEqual([...second]);
  expect([...first.keys()].sort()).toEqual([
    "Basile-AGC-Camera-photo-look.xmp",
    "Basile-AGC-Camera-profile.zip",
    "Basile-S23-AGC9.2-V14.agc",
    "manifest.json",
  ]);
});
test("published GCam preserves the complete photo and video baseline", async () => {
  const source = await Bun.file(new URL("../data/gcam-92-v14.xml", import.meta.url)).text();
  const result = generate(profile, "gcam");
  expect(result.get("Basile-S23-AGC9.2-V14.agc")).toBe(
    source.replace(
      '<string name="pref_camera_recordlocation_key">0</string>',
      '<string name="pref_camera_recordlocation_key">1</string>',
    ),
  );
  expect(result.size).toBe(2);
  expect(result.has("Basile-S23-AGC9.2-V14-FHD60-SDR.agc")).toBe(false);
  const manifest = JSON.parse(String(result.get("manifest.json")));
  expect(manifest.schemaVersion).toBe(4);
  expect(manifest.releaseLayout).toBe("photo-first-v1");
  expect(manifest.outputs[0].videoPolicy).toBe("preserve-source");
  expect(manifest.outputs[0].videoRequest).toBeUndefined();
});
test("variant affects both display names, requested quality and digests without adding raw settings", () => {
  const variants = generate({ ...profile, name: "Basile & Field", jpegQuality: 92 });
  const agc = variants.get("Basile-S23-AGC9.2-V14.agc")!;
  expect(agc).toContain("Basile &amp; Field");
  expect(agc).toContain('name="pref_qjpg_key">92</string>');
  expect(variants.get("Basile-AGC-Camera-photo-look.xmp")).toContain("Basile &amp; Field");
  expect(variants.get("manifest.json")).not.toBe(generate(profile).get("manifest.json"));
});
test("unsafe or unrecognized profile fields fail closed", () => {
  for (const raw of [
    null,
    [],
    { ...defaults, jpegQuality: 0 },
    { ...defaults, jpegQuality: 97.5 },
    { ...defaults, name: "../../no" },
    { ...defaults, unreviewedSetting: 1 },
    { ...defaults, videoHdr: "always" },
  ])
    expect(() => parseProfile(raw)).toThrow();
});

test("standalone requires manual icon selection rather than an invented XMP preference", () => {
  const result = generate(profile);
  const manifest = JSON.parse(String(result.get("manifest.json")!)) as {
    outputs: { file: string; launcherIcon?: { preferred: string; application: string } }[];
  };
  const xmp = manifest.outputs.find((entry) => entry.file.endsWith(".xmp"))!;
  expect(xmp.launcherIcon?.preferred).toBe("old GCam");
  expect(xmp.launcherIcon?.application).toContain("manual");
  expect(result.get(xmp.file)).not.toMatch(/launcherIcon|desktopIcon/i);
  expect(
    manifest.outputs.find((entry) => entry.file.endsWith(".agc"))?.launcherIcon,
  ).toBeUndefined();
});
