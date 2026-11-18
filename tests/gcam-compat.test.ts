import { expect, test } from "bun:test";
import { createHash } from "node:crypto";

import baseline from "../data/gcam-92-v14.json";
import defaults from "../data/profile.json";
import { generate, parseProfile } from "../src/generator";

const sounds = new Set(["pref_camera_sounds_key", "pref_camera_single_shot_sound_key"]);
const removed = [
  "camera.pck_analysis_yuv",
  "camera.pck_large_yuv",
  "camera.pck_reprocessing_yuv",
  "pref_pckstream_raw_hdrplus",
  "pref_pckstream_viewfinder",
  "pref_pckstream_yuv_analysis",
];
function compareEntries(left: [string, unknown], right: [string, unknown]): number {
  return left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0;
}

test("rollback is exactly the original 451-key project baseline plus the two sound opt-outs", () => {
  const unchanged = Object.fromEntries(
    Object.entries(baseline)
      .sort(compareEntries)
      .map(([type, group]) => [
        type,
        Object.fromEntries(
          Object.entries(group)
            .filter(([key]) => !sounds.has(key))
            .sort(compareEntries),
        ),
      ]),
  );
  expect(createHash("sha256").update(JSON.stringify(unchanged)).digest("hex")).toBe(
    "4f892646301ad05e90326ee31783031880257476afc83a9dc6df7b1e797ea70f",
  );
  expect(Object.values(baseline).reduce((n, values) => n + Object.keys(values).length, 0)).toBe(
    453,
  );
});

test("both source sound opt-outs are Android strings; no guessed boolean or numeric switch", () => {
  const xml = generate(parseProfile(defaults), "gcam").get("Basile-S23-AGC9.2-V14.agc");
  for (const key of sounds) {
    expect(xml).toContain(`<string name="${key}">0</string>`);
    expect(xml).not.toContain(`<boolean name="${key}"`);
    expect(xml).not.toContain(`<int name="${key}"`);
  }
});

test("none of the six ineffective experiment switches is emitted, even set to an alternate value", () => {
  const xml = generate(parseProfile(defaults), "gcam").get("Basile-S23-AGC9.2-V14.agc");
  for (const key of removed) expect(xml).not.toContain(`name="${key}"`);
});

test("rollback does not ship disabled binary patch payloads, private data or unrelated overrides", () => {
  const keys = Object.values(baseline).flatMap((group) => Object.keys(group));
  for (const key of [
    "max_imagereader_image_count",
    "max_hdr_plus_imagereader_image_count",
    "finish_video_capture",
    "finish_long_shot_capture",
    "pref_disabled_discard_frames",
    "camera.mts_gpu_yuv",
    "pref_config_nickname_key",
    "pref_config_changelog_key",
    "xml_file_name",
  ])
    expect(keys).not.toContain(key);
  for (const key of keys)
    expect(key).not.toMatch(
      /lib_custom_|watermark|recordlocation|latitude|longitude|fingerprint|account|permission|history|_path|email/iu,
    );
});
