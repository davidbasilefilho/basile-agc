import { expect, test } from "bun:test";

import defaults from "../data/profile.json";
import { generate, parseProfile } from "../src/generator";
const profile = parseProfile(defaults);
test("same input yields exactly the same four artifacts and digest manifest", () => {
  const first = generate(profile),
    second = generate(profile);
  expect([...first]).toEqual([...second]);
  expect([...first.keys()].sort()).toEqual([
    "Basile-AGC-Camera-photo-look.xmp",
    "Basile-AGC-Camera-profile.zip",
    "Basile-S23-AGC9.2-V14-FHD60-SDR.agc",
    "Basile-S23-AGC9.2-V14.agc",
    "manifest.json",
  ]);
});
test("published GCam targets use only the chosen normal-video overrides", () => {
  const result = generate(profile, "gcam");
  const hdr = result.get("Basile-S23-AGC9.2-V14.agc");
  const sdr = result.get("Basile-S23-AGC9.2-V14-FHD60-SDR.agc");
  for (const [xml, fps, hdrValue] of [
    [hdr, "FPS_30", "1"],
    [sdr, "FPS_60", "0"],
  ] as const) {
    expect(xml).toContain('name="pref_video_stabilization_key">1</string>');
    expect(xml).toContain('name="pref_video_resolution">RES_1080P</string>');
    expect(xml).toContain('name="pref_video_fps_p2018_key">' + fps + "</string>");
    expect(xml).toContain('name="pref_video_fps_key">' + fps + "</string>");
    expect(xml).toContain('name="pref_video_amethyst_key">' + hdrValue + "</string>");
    expect(xml).toContain('name="pref_video_fps_4k_key">FPS_30</string>');
    expect(xml).toContain('name="pref_video_fps_cm_key">FPS_30</string>');
    expect(xml).toContain('name="pref_video_fps_vb_key">FPS_30</string>');
    expect(xml).not.toMatch(
      /info_fingerprint|tooltip_latest_impression_timestamp[^>]*value="[1-9]/,
    );
    for (let i = 0; i < 6; i++)
      expect(xml).toContain(
        'name="pref_camera_hdr_plus_override_key_p0_' + i + '">hdrnet</string>',
      );
  }
  expect(result.size).toBe(3);
  expect([...generate(profile, "standalone").keys()].sort()).toEqual([
    "Basile-AGC-Camera-photo-look.xmp",
    "Basile-AGC-Camera-profile.zip",
    "manifest.json",
  ]);
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

test("release generation preserves each source byte outside the exact requested normal-video patch", async () => {
  const sourceBytes = await Bun.file(new URL("../data/gcam-92-v14.xml", import.meta.url)).bytes();
  const xml = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(sourceBytes);
  const newline = xml.includes("\r\n") ? "\r\n" : "\n";
  const candidates = generate(profile, "gcam");
  for (const [file, fps, hdr] of [
    ["Basile-S23-AGC9.2-V14.agc", "FPS_30", "1"],
    ["Basile-S23-AGC9.2-V14-FHD60-SDR.agc", "FPS_60", "0"],
  ] as const) {
    const expected = xml
      .replace('name="pref_video_resolution">RES_2160P<', 'name="pref_video_resolution">RES_1080P<')
      .replace(
        'name="pref_video_fps_p2018_key">FPS_AUTO<',
        `name="pref_video_fps_p2018_key">${fps}<`,
      )
      .replace(
        "</map>",
        `    <string name="pref_video_amethyst_key">${hdr}</string>` +
          newline +
          `    <string name="pref_video_fps_key">${fps}</string>` +
          newline +
          "</map>",
      );
    expect(candidates.get(file)).toBe(expected);
  }
});
