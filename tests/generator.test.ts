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
    "Basile-S23-AGC9.2-V14-r17.agc",
    "manifest.json",
  ]);
});
test("published GCam changes only approved photo controls and preserves all remaining settings", async () => {
  let source = await Bun.file(new URL("../data/gcam-92-v14.xml", import.meta.url)).text();
  for (const [slot, before, after] of [
    ["0", "1.05", "1.10"],
    ["1", "1.0", "1.05"],
    ["2", "1.05", "1.10"],
    ["3", "1.0", "1.05"],
    ["4", "0.95", "1.00"],
    ["5", "1.05", "1.10"],
  ])
    source = source.replace(
      '<string name="pref_satcct_key_' + slot + '">' + before + "</string>",
      '<string name="pref_satcct_key_' + slot + '">' + after + "</string>",
    );
  source = source.replace(
    '<string name="lib_shadow_compensation_key_p0_2">3.50</string>',
    '<string name="lib_shadow_compensation_key_p0_2">3.60</string>',
  );
  const result = generate(profile, "gcam");
  expect(result.get("Basile-S23-AGC9.2-V14-r17.agc")).toBe(
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
  const agc = variants.get("Basile-S23-AGC9.2-V14-r17.agc")!;
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

test("preserves verified original camera defaults without sharing-app history", () => {
  const xml = String(generate(profile, "gcam").get("Basile-S23-AGC9.2-V14-r17.agc"));
  for (const [key, value] of [
    ["pref_camera_recordlocation_key", "1"],
    ["pref_p3_key", "1"],
    ["pref_gallery_key", "1"],
    ["pref_camera_sounds_key", "0"],
    ["pref_camera_single_shot_sound_key", "0"],
    ["key_social_share_opt_in", "0"],
  ])
    expect(xml).toContain('<string name="' + key + '">' + value + "</string>");
  expect(xml).toContain('<boolean name="enable_social_share" value="false" />');
});
