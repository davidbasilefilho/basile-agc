import { expect, test } from "bun:test";

import { fromOriginal, type OriginalOverlay } from "../src/lossless";

const encode = (s: string) => new TextEncoder().encode(s);
const decode = (b: Uint8Array) => new TextDecoder().decode(b);
const xml = (key: string, value: string) => `<string name="${key}">${value}</string>`;
const lines = [
  "<?xml version='1.0' encoding='utf-8'?>",
  "<map>",
  "<!-- fixture; no real export or media -->",
  xml("info_version_key", "AGC9.2 V14.0 (e23c52c7) synthetic"),
  xml("info_model_key", "SM-S911B"),
  xml("pref_camera_sounds_key", "0"),
  xml("pref_camera_single_shot_sound_key", "0"),
  xml("pref_video_resolution", "RES_2160P"),
  xml("pref_video_fps_p2018_key", "FPS_AUTO"),
  xml("pref_video_fps_4k_key", "FPS_30"),
  xml("pref_video_fps_cm_key", "FPS_30"),
  xml("pref_video_fps_vb_key", "FPS_30"),
  xml("pref_video_stabilization_key", "1"),
  xml("pref_ois_key", "1"),
  xml("pref_video_hevc_setting_key", "1"),
  xml("lens_and_photo_🌙", "do not change &amp; do not reorder"),
  "</map>",
  "",
];
const source = lines.join("\r\n");
function expected(hdr: boolean) {
  const fps = hdr ? "FPS_30" : "FPS_60";
  return source
    .replace(">RES_2160P<", ">RES_1080P<")
    .replace(">FPS_AUTO<", ">" + fps + "<")
    .replace(
      "</map>",
      "    " +
        xml("pref_video_amethyst_key", hdr ? "1" : "0") +
        "\r\n    " +
        xml("pref_video_fps_key", fps) +
        "\r\n</map>",
    );
}
for (const [mode, hdr] of [
  ["video-hdr30", true],
  ["video-sdr60", false],
] as const) {
  test(mode + " is byte-exact outside the four authorized normal-video changes", () => {
    const actual = fromOriginal(encode(source), mode);
    expect(decode(actual)).toBe(expected(hdr));
    expect(fromOriginal(actual, mode)).toEqual(actual);
    expect(decode(fromOriginal(actual, hdr ? "video-sdr60" : "video-hdr30"))).toBe(expected(!hdr));
    expect(fromOriginal(encode(source), "sounds-off")).toEqual(encode(source));
    expect(fromOriginal(encode(source), "none")).toEqual(encode(source));
  });
}
test("camera/video variants refuse the wrong target, type, duplicate, missing required key or unreviewed scalar", () => {
  for (const src of [
    source.replace("SM-S911B", "SM-S918B"),
    source.replace("e23c52c7", "different"),
    source.replace("pref_video_resolution", "other_key"),
    source.replace("RES_2160P", "something_else"),
    source.replace("FPS_AUTO", "FPS_FAKE"),
    source.replace("</map>", '<boolean name="pref_video_amethyst_key" value="true" /></map>'),
    source.replace(
      "</map>",
      xml("pref_video_amethyst_key", "1") + xml("pref_video_amethyst_key", "0") + "</map>",
    ),
  ])
    expect(() => fromOriginal(encode(src), "video-hdr30")).toThrow();
  expect(() => fromOriginal(encode(source), "global-hdr60" as OriginalOverlay)).toThrow();
});
test("a present string-backed HDR switch is replaced, never appended twice; other video submodes stay untouched", () => {
  const spliced = source.replace(
    "</map>",
    xml("pref_video_amethyst_key", "0") + xml("pref_video_amethyst_vb_key", "0") + "</map>",
  );
  const out = decode(fromOriginal(encode(spliced), "video-hdr30"));
  expect(out.match(/name="pref_video_amethyst_key"/g)).toHaveLength(1);
  expect(out).toContain(xml("pref_video_amethyst_key", "1"));
  expect(out).toContain(xml("pref_video_amethyst_vb_key", "0"));
});
