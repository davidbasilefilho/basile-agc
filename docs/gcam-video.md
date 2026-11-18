# GCam 9.2 V14: separate HDR and motion candidates

These are **capture requests for normal video**, not phone-verified results. On the base S23 the original GCam recording was FHD **30 fps SDR**, despite a reported 60 fps selection. All 171 decoded frames were distinct and their presentation spacing was consistently about 33.33 ms. The stock app recorded FHD **59.84 fps with 10-bit PQ/BT.2020 signaling**. It had 351 distinct frames and only one roughly 33 ms interval. Samsung recording 60 fps HDR does not establish that the GCam port can do so. Frame timing explains part of the motion difference; it does not measure stabilization strength.

## Use the full private v15, not the historical public fixture

For the previously verified interface on **SM-S911B, AGC9.2 V14.0 build e23c52c7**, choose one:

| Overlay       | What the generated file requests                                                         |
| ------------- | ---------------------------------------------------------------------------------------- |
| `video-hdr30` | **Preferred for dynamic range**: FHD, 30 fps, normal 10-bit HDR requested.               |
| `video-sdr60` | **Preferred for smoother movement**: FHD, fixed 60 fps requested, normal 10-bit HDR off. |

```sh
OUT="$(mktemp -d)"
SOURCE="/path/to/your/original.agc"
for MODE in video-hdr30 video-sdr60; do
  bun run generate --source "$SOURCE" --out "$OUT" --overlay "$MODE"
  bun run validate --source "$SOURCE" --out "$OUT" --overlay "$MODE"
done
```

Each result has a distinct filename ending in `-FHD30-HDR-candidate.agc` or `-FHD60-SDR-candidate.agc`. Full private source metadata remains in these files: don't commit or upload them publicly. The generator without an overlay still returns a byte-identical original. Selecting either video option also keeps the two requested sound switches off.

## Evidence and limits

The [author's V14 release page](https://www.celsoazevedo.com/files/android/google-camera/dev-BigKaka/f/dl80/) identifies the Samsung package. The following mappings were checked in its preference accessors and UI resources, not inferred from similarly named configuration files:

- Normal resolution is a string enum under `pref_video_resolution`; FHD is `RES_1080P`. The source saved `RES_2160P`.
- Normal video selects between the newer `pref_video_fps_p2018_key` path and another FPS accessor based on the runtime flag `fps_video_setting_writeable`; the legacy standard accessor uses `pref_video_fps_key`. Both store named strings. The supplied baseline has `FPS_AUTO` in the newer slot and lacks the legacy one. Write the chosen normal rate to both, so the candidate does not depend on an unverified runtime preference branch. Leave the distinct 4K, cinematic and Video Boost FPS preferences alone. V14 filters its available FPS values and can replace an unsupported choice with a default. A saved `FPS_60` is not proof of a 60 fps output.
- The normal `pref_video_amethyst_key` is the string-backed 10-bit HDR switch (on = `1`; default off). It is absent from v15. The UI resource maps “amethyst” to 10-bit HDR and restricts the option to 30 fps or, in another variant, 24/30. Explicitly write on/off in the normal slot only; don't touch the separate Video Boost slot, feature gates, the camera model, or vendor tags. The [Android HDR capture guide](https://developer.android.com/media/camera/camera2/hdr-video-capture) explains why camera, session and encoder support still matter.
- The current GCam config already enables video stabilization: the exact build interprets its `pref_video_stabilization_key` string `1` as true. OIS settings and HEVC are already enabled in v15. Don't label a redundant switch write as better stabilization. No encoder bitrate, viewfinder FPS, HDRNet, P3, JPEG, noise, color, lens or photo-mode setting was changed. A separate user export made for Ultra HDR stills/P3 had the same video settings; it is not a paired export proving a 60 fps or HDR video mode.

On the supplied private v15, each candidate replaces **two** existing string contents (resolution and newer normal FPS) and inserts **two** strings before the closing map (normal HDR and legacy normal FPS). It removes no preferences. The other 1,326 existing entries, all metadata, ordering, whitespace and both sound opt-outs are preserved. The candidates load no executable or proprietary code, and the generator never forces a device capability.

## Smallest useful S23 test

From the same APK/package, rear main 1×, normal video, and the same lit scene, record one short pan per candidate. Cold-open after each import; note what resolution, FPS and HDR the UI actually shows, then keep the two saved MP4s. Check that both are playable. Use `bun run video:cadence <clip.mp4>` locally to measure presentation cadence, not just the nominal rate. For the HDR candidate look for a 10-bit stream with PQ or HLG and appropriate color signaling. For the motion candidate expect ~16.67 ms intervals and close to 60 distinct frames per second. The cadence tool itself does not count unique decoded image content.

If a candidate falls back, do not change the device mask or all lens settings. Export the effective settings after a single UI change (30→60, or HDR off→on at 30); compare them against the matching before export and recording. Record only the tested lens/mode as supported. If FPS succeeds but walking still looks unstable, compare the same small walking route before changing the stabilization mode. Stock-app parity is not guaranteed.
