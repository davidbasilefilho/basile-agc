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
