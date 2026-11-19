# GCam video scope

The current release ships one photo-first GCam configuration. Experimental `video-hdr30` / `video-sdr60` overlays and the separate FHD60-SDR asset have been retired. These names may still appear in historical releases and release-policy tests; do not delete those historical records manually.

Generation preserves the reviewed source's video controls, including resolution, frame-rate choices and stabilization. It does not force HDR, SDR or 60 fps. Still-photo HDR, HDRNet, HEVC, and a visible HDR toggle are not proof of a playable 10-bit HDR video file. Baseline preservation is not a claim of device verification.

Use a dedicated video app for independently validated video combinations. Existing private recordings can still be analyzed locally with `bun run video:cadence /path/to/local.mp4` and ffprobe. Keep recordings and reports private; never commit media or GPS metadata.

For exact personal settings, use `--source` without overlay, or the sound-only overlay. There is no video overlay supported by the current CLI.
