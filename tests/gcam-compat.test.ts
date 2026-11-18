import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { SaxesParser } from "saxes";

const xml = readFileSync(new URL("../data/gcam-92-v14.xml", import.meta.url), "utf8");
const protectedSource = "e35f89ad9dc2c5597b28170b805fd4182c5fc1564d9d0bb2790e1f8783f14b4d";
function inventory(input: string) {
  const parser = new SaxesParser();
  const data = new Map<string, { type: string; value: string | string[] }>();
  let depth = 0,
    key = "",
    type = "",
    value = "",
    members: string[] = [];
  parser.on("doctype", () => {
    throw new Error("Unexpected DOCTYPE");
  });
  parser.on("opentag", (t) => {
    depth++;
    if (depth === 2) {
      key = t.attributes.name ?? "";
      type = t.name;
      value = t.attributes.value ?? "";
      members = [];
    } else if (depth === 3) value = "";
  });
  parser.on("text", (s) => {
    if (depth === 3 || (depth === 2 && type === "string")) value += s;
  });
  parser.on("closetag", () => {
    if (depth === 3) members.push(value);
    if (depth === 2) {
      if (data.has(key)) throw new Error("duplicate");
      data.set(key, { type, value: type === "set" ? members : value });
    }
    depth--;
  });
  parser.write(input).close();
  return data;
}
const data = inventory(xml);
test("public authoring reference is exactly the separately privacy-reviewed snapshot", () => {
  // Intentional changes require a fresh audit. Do not just update the golden
  // from an unreviewed upstream export: this is a public GitHub repository.
  expect(createHash("sha256").update(xml).digest("hex")).toBe(protectedSource);
  expect(data.size).toBe(1318);
  const values = [...data.values()];
  expect(values.filter((v) => v.value === "Off (as in library)")).toHaveLength(207);
  expect(values.filter((v) => v.type === "string" && v.value === "")).toHaveLength(355);
  expect(values.filter((v) => v.type === "long")).toHaveLength(3);
  expect(values.filter((v) => v.type === "int")).toHaveLength(15);
  expect(values.filter((v) => v.type === "boolean")).toHaveLength(27);
  expect(values.filter((v) => v.type === "set")).toHaveLength(2);
});
test("all 37 disabled patch slots keep the off switch and contain only empty editor defaults", () => {
  const slots = [...data.keys()].filter((k) =>
    /^lib_custom_\d+_key(?:_p\d+_\d+)?_enabled$/.test(k),
  );
  expect(slots).toHaveLength(37);
  for (const k of slots) {
    expect(data.get(k)).toEqual({ type: "string", value: "0" });
    for (const suffix of ["address", "value", "title"])
      expect(data.get(k.replace(/enabled$/, suffix))).toEqual({ type: "string", value: "" });
  }
  expect(
    [...data.keys()].filter((k) => /^lib_custom_patch_count_key(?:_p\d+_\d+)?$/.test(k)),
  ).toHaveLength(7);
});
test("no personal export metadata, per-app sharing choices, location opt-in, watermark text or UI history", () => {
  for (const k of [
    "info_fingerprint_key",
    "xml_file_name",
    "pref_config_id_key",
    "pref_config_nickname_key",
    "pref_config_changelog_key",
  ])
    expect(data.has(k)).toBe(false);
  for (const k of data.keys()) {
    expect(k.startsWith("pref_social_app_")).toBe(false);
    if (
      /^(?:tooltip_(?:latest_impression_timestamp|impression_count|impression_trigger_count)_for_|perf_has_(?:run_|shown_)|pref_has_(?:checked_|seen_|set_social_share_apps$|shown_longp_education$)|pref_(?:double_tap_launch_edu_count|hdr_tooltip_countdown|lens_moved_notification_count|update_available_chip_dismissal_times)$)/.test(
        k,
      )
    )
      expect(data.get(k)?.value).toBe("0");
  }
  for (const k of [
    "pref_camera_recordlocation_key",
    "pref_photo_watermark_key",
    "key_social_share_opt_in",
    "pref_enable_log_file_key",
  ])
    expect(data.get(k)).toEqual({ type: "string", value: "0" });
  expect(data.get("enable_social_share")).toEqual({ type: "boolean", value: "false" });
  expect(data.get("pref_watermark_title_key")?.value).toBe("");
  expect(data.get("pref_vid_prefix_key")?.value).toBe("VID_");
  expect(data.get("pref_prefix_key")?.value).toBe("AGC_");
  expect(xml).not.toMatch(
    /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----|[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}|https?:\/\/|\/storage\/emulated|\/home\//i,
  );
});
test("capture controls and explicit defaults missing from the old partial subset are retained", () => {
  for (const k of [
    "camera.pck_analysis_yuv",
    "camera.pck_large_yuv",
    "camera.pck_reprocessing_yuv",
    "camera.mts_gpu_yuv",
    "finish_video_capture",
    "finish_long_shot_capture",
  ])
    expect(data.get(k)).toEqual({ type: "boolean", value: "true" });
  for (const k of [
    "pref_pckstream_yuv_analysis",
    "pref_pckstream_viewfinder",
    "pref_pckstream_raw_hdrplus",
    "pref_ois_key",
    "pref_video_stabilization_key",
  ])
    expect(data.get(k)).toEqual({ type: "string", value: "1" });
  for (const k of ["pref_camera_sounds_key", "pref_camera_single_shot_sound_key"])
    expect(data.get(k)).toEqual({ type: "string", value: "0" });
  for (const k of ["max_imagereader_image_count", "max_hdr_plus_imagereader_image_count"])
    expect(data.get(k)).toEqual({ type: "int", value: "200" });
  for (const k of ["pref_all_camera_id_list_key", "pref_camera_id_list_key"]) {
    const v = data.get(k);
    expect(v?.type).toBe("set");
    expect(Array.isArray(v?.value) && v.value.every((x) => /^\d{1,2}$/.test(x))).toBe(true);
  }
});
