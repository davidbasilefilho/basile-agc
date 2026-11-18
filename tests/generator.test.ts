import { expect, test } from "bun:test";

import defaults from "../data/profile.json";
import { generate, parseProfile } from "../src/generator";
const profile = parseProfile(defaults);
test("same input yields exactly the same two artifacts and digest manifest", () => {
  const first = generate(profile),
    second = generate(profile);
  expect([...first]).toEqual([...second]);
  expect([...first.keys()].sort()).toEqual([
    "Basile-AGC-Camera-photo-look.xmp",
    "Basile-S23-AGC9.2-V14.agc",
    "manifest.json",
  ]);
});
test("photo tuning and HDR policy stay separate", () => {
  const [, xml] = [...generate(profile, "gcam")][0]!;
  expect(xml).toContain('name="pref_video_stabilization_key">1</string>');
  expect(xml).toContain('name="pref_video_resolution">RES_2160P</string>');
  expect(xml).toContain('name="pref_video_fps_p2018_key">FPS_AUTO</string>');
  expect(xml).not.toMatch(/info_fingerprint|lib_custom_|recordlocation|timestamp/);
  for (let i = 0; i < 6; i++)
    expect(xml).toContain(`name="pref_camera_hdr_plus_override_key_p0_${i}">hdrnet</string>`);
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
  const manifest = JSON.parse(result.get("manifest.json")!) as {
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
