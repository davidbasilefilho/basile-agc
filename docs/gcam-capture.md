# GCam 9.2 V14: shutter sound and capture/recording compatibility

Applies only to the base Snapdragon S23 and BigKaka's **AGC9.2.14 V14.0 GCam mod**. It is not the fix or import route for the standalone AGC Camera app.

**Report:** the GCam process closed on taking a photo and on stopping a video. Shutter sounds also returned. No crash trace or on-device reproduction was available. The previous public preset contained 451 of 1,328 source preferences, omitting both explicit sound opt-outs; the 451 retained values and their XML types matched the original default profile. Omitting a key is not equivalent to exporting “off”: the app can fall back to other settings.

## What changed in the generator

Exactly eight settings from the supplied v15 export were restored. None of the previously emitted 451 preferences changed. These are original values and original types, not newly guessed AGC enums:

| Source preference                                                                        | XML type | Value  |
| ---------------------------------------------------------------------------------------- | -------- | ------ |
| `pref_camera_sounds_key`, `pref_camera_single_shot_sound_key`                            | string   | `0`    |
| `camera.pck_analysis_yuv`, `camera.pck_large_yuv`, `camera.pck_reprocessing_yuv`         | boolean  | `true` |
| `pref_pckstream_yuv_analysis`, `pref_pckstream_viewfinder`, `pref_pckstream_raw_hdrplus` | string   | `1`    |

The sound preferences restore the source's two opt-outs; this does not remove audio from videos. The other six restore a **related capture-stream group** missing from the earlier curated export. This is a compatibility candidate, not evidence that the missing group caused either crash. We did not change HEVC, stabilization, resolution, frame-rate selections, RAW/lens mapping, noise/tonal tuning, Night, or HDR values. We did not restore session history, lifecycle/completion flags, memory overrides or binary patches. Video defaults in the original export were 2160p and mode-specific 30fps preferences, not a forced FHD60 setting.

## Test without losing the known-good baseline

1. Back up current settings. Use the same installed APK/package for every comparison. Load the newly generated `.agc`, reopen GCam, and check that the shutter-sound toggle is off if exposed.
2. On rear main 1×, take one normal photo and record a short video at the same resolution/fps as the failure. Confirm both files actually open afterward; a working viewfinder isn't a pass.
3. If either fails, avoid changing several switches together. Compare the original v15 and the generated candidate with a clean, equivalent starting configuration between tests. If both fail, try that same build's defaults without a custom profile after backing up. FHD30 can be a second diagnostic comparison, not a forced project default.
4. Report which of **default / original v15 / new candidate** failed, the installed package name, lens, resolution/fps, and whether a media file was written. If possible, provide just the crash exception and nearby camera/codec lines, stripped of names, paths and location. Do not post a full personal bug report in a public issue.

An isolated failure with only the generated candidate is evidence to investigate other omitted settings or import behavior. A failure on defaults too points beyond this particular preset. Do not reinstall an unrelated port, force arbitrary stream IDs, or change all tuning as a blanket remedy. See [V14 build/package variants](https://www.celsoazevedo.com/files/android/google-camera/dev-BigKaka/f/dl80/) and [distributor troubleshooting](https://www.celsoazevedo.com/files/android/google-camera/troubleshooting/).
