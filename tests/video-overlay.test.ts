import { expect, test } from "bun:test";

import { fromOriginal, type OriginalOverlay } from "../src/lossless";
const source = `<map>
<string name="pref_camera_sounds_key">1</string>
<string name="pref_camera_single_shot_sound_key">1</string>
<string name="pref_camera_recordlocation_key">1</string>
<string name="pref_video_resolution">RES_2160P</string>
<string name="pref_video_fps_p2018_key">FPS_AUTO</string>
<string name="pref_video_amethyst_key">0</string>
<string name="night_sight_suggestion">keep</string>
</map>`;
test("private sound-only generation preserves geotag consent, video and night settings", () => {
  const original = new TextEncoder().encode(source);
  expect(fromOriginal(original)).toEqual(original);
  const expected = source
    .replace('name="pref_camera_sounds_key">1', 'name="pref_camera_sounds_key">0')
    .replace(
      'name="pref_camera_single_shot_sound_key">1',
      'name="pref_camera_single_shot_sound_key">0',
    );
  expect(new TextDecoder().decode(fromOriginal(original, "sounds-off"))).toBe(expected);
  for (const overlay of ["video-hdr30", "video-sdr60", "global-hdr60"])
    expect(() => fromOriginal(original, overlay as OriginalOverlay)).toThrow();
});

test("public location overlay changes only the verified toggle and fails closed", () => {
  const muted = source
    .replaceAll('sounds_key">1', 'sounds_key">0')
    .replace('single_shot_sound_key">1', 'single_shot_sound_key">0');
  const disabled = muted.replace('recordlocation_key">1', 'recordlocation_key">0');
  const encode = (value: string) => new TextEncoder().encode(value);
  expect(new TextDecoder().decode(fromOriginal(encode(disabled), "sounds-off-geotag"))).toBe(muted);
  expect(fromOriginal(encode(disabled))).toEqual(encode(disabled));
  expect(fromOriginal(encode(disabled), "sounds-off")).toEqual(encode(disabled));
  expect(() =>
    fromOriginal(
      encode(disabled.replace('recordlocation_key">0', 'recordlocation_key">invalid')),
      "sounds-off-geotag",
    ),
  ).toThrow();
  expect(() =>
    fromOriginal(
      encode(disabled.replace('<string name="pref_camera_recordlocation_key">0</string>', "")),
      "sounds-off-geotag",
    ),
  ).toThrow();
});
