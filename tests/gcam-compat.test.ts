import { expect, test } from "bun:test";
import { createHash } from "node:crypto";

import baseline from "../data/gcam-92-v14.json";
import defaults from "../data/profile.json";
import { generate, parseProfile } from "../src/generator";

// Reviewed source-exported preferences only. This is a narrow compatibility
// A/B candidate, not proof that a capture/finalization crash is fixed.
const restored = {
  boolean: {
    "camera.pck_analysis_yuv": "true",
    "camera.pck_large_yuv": "true",
    "camera.pck_reprocessing_yuv": "true",
  },
  string: {
    pref_camera_single_shot_sound_key: "0",
    pref_camera_sounds_key: "0",
    pref_pckstream_raw_hdrplus: "1",
    pref_pckstream_viewfinder: "1",
    pref_pckstream_yuv_analysis: "1",
  },
} as const;
const restoredKeys = new Set(Object.values(restored).flatMap((group) => Object.keys(group)));

function compareEntries(left: [string, unknown], right: [string, unknown]): number {
  return left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0;
}

test("recovery patch restores the complete six-entry source PCK group and both sound switches", () => {
  for (const [type, group] of Object.entries(restored)) {
    expect(baseline[type as keyof typeof restored]).toMatchObject(group);
  }
  const actualPck = Object.values(baseline)
    .flatMap((group) => Object.keys(group))
    .filter((key) => key.includes("pck"));
  expect(actualPck.sort()).toEqual([...restoredKeys].filter((key) => key.includes("pck")).sort());
  expect(
    Object.values(baseline).reduce((total, group) => total + Object.keys(group).length, 0),
  ).toBe(459);
});

test("all 451 pre-patch preferences retain their exact values, types and set order", () => {
  const unchanged = Object.fromEntries(
    Object.entries(baseline)
      .sort(compareEntries)
      .map(([type, group]) => [
        type,
        Object.fromEntries(
          Object.entries(group)
            .filter(([key]) => !restoredKeys.has(key))
            .sort(compareEntries),
        ),
      ]),
  );
  // Golden digest of the public pre-recovery baseline, not of private media or
  // the full private export. Deliberate tuning changes must review this guard.
  expect(createHash("sha256").update(JSON.stringify(unchanged)).digest("hex")).toBe(
    "4f892646301ad05e90326ee31783031880257476afc83a9dc6df7b1e797ea70f",
  );
});

test("generated XML keeps Android preference types, with sound off as strings not booleans", () => {
  const xml = generate(parseProfile(defaults), "gcam").get("Basile-S23-AGC9.2-V14.agc");
  expect(typeof xml).toBe("string");
  for (const [key, value] of Object.entries(restored.boolean)) {
    expect(xml).toContain(`<boolean name="${key}" value="${value}" />`);
  }
  for (const [key, value] of Object.entries(restored.string)) {
    expect(xml).toContain(`<string name="${key}">${value}</string>`);
    expect(xml).not.toContain(`<boolean name="${key}"`);
    expect(xml).not.toContain(`<int name="${key}"`);
  }
});

test("recovery does not reintroduce large buffers, lifecycle state, binary patches or private metadata", () => {
  const keys = Object.values(baseline).flatMap((group) => Object.keys(group));
  for (const key of [
    "max_imagereader_image_count",
    "max_hdr_plus_imagereader_image_count",
    "finish_video_capture",
    "finish_long_shot_capture",
    "pref_disabled_discard_frames",
    "camera.mts_gpu_yuv",
    "pref_enable_log_file_key",
    "pref_update_color_online_key",
    "pref_config_nickname_key",
    "pref_config_changelog_key",
    "xml_file_name",
  ])
    expect(keys).not.toContain(key);
  for (const key of keys) {
    expect(key).not.toMatch(
      /lib_custom_|watermark|recordlocation|latitude|longitude|fingerprint|account|permission|history|_path|email/iu,
    );
  }
});
