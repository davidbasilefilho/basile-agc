# GCam 9.2 V14: what the crash comparison established

This is about BigKaka's **AGC9.2.14 V14.0 GCam mod** on the base Snapdragon S23, not the standalone AGC Camera profile. The owner reported that the app still closed after the previous candidate's capture-stream changes. Do not treat that candidate or this rollback as a confirmed crash fix.

## Recovery now uses the entire original

The owner reports that the original worked. The shared crash report identifies an Android `Resources.NotFoundException` while resolving string resource ID `0x0`. This is the immediate exception, **not a mapping to any particular preference** or proof of a broken codec. An empty filename or stream field in a log does not prove that a file did not load. No resource-ID substitution or speculative color, frame-rate, buffer, or HDR change is justified.

The previous mistake was using the curated public subset as the recovery baseline. Use the original from the same build, not the subset. The source-preserving generator validates the preference map but does not sort it, filter it or serialize it anew. On the supplied v15, both a plain round-trip and the explicit sound-off overlay were identical to the original, including all 1,328 preferences, XML types, settings order, metadata and formatting. No private source or private generated recovery copy is published. The current GitHub build instead uses a [separate sanitized public reference](public-reference.md), and is a device-test candidate, not a verified crash fix. The standalone profile is unaffected.

## Historical comparison, not a six-key spot check

Both the private v15 XML and the actual 459-key generated candidate were parsed as Android preference maps. All 1,328 names in the source are unique. Comparing key, concrete XML type and value (including string-set members): **459 identical, 869 missing, zero added, zero changed**. Both files parse. The generator emitted a subset, not an equivalent export.

Of the 869 omissions in that failing candidate, 838 were strings, 20 booleans, 8 integers and 3 longs. Of the missing strings, 244 were empty and 207 explicitly said “Off (as in library)”. On an import that merges preferences, absence and an explicit default need not produce the same state. On an import that replaces preferences, an omitted key may revert to the APK default. We have not established which happens on the installed package.

Potentially relevant omissions include mode overrides, motion-photo controls, video/capture-completion flags, YUV/GPU controls, and image-reader buffer limits. A name is not a stack trace: the export does not show whether a crash occurred in capture, processing, encoding or writing. The saved 2160p, mode-specific frame rates, HEVC, stabilization, RAW, photo HDR and retained lens tuning all matched. There was no accidental type conversion in those values. Do not change them on a hunch.

Other omissions serve different purposes. All 37 fixed-address custom patch groups in the original were explicitly disabled; do not assume missing groups are the cause or publish their payloads. History, paths, labels, timestamps and other instance-specific state do not belong in the public fixture. Not every missing preference is private.

## Scope of the historical public rollback

Only the previous six experimental additions are removed: three boolean flags under `camera.pck_{analysis_yuv,large_yuv,reprocessing_yuv}` and three strings under `pref_pckstream_{raw_hdrplus,viewfinder,yuv_analysis}`. Both original sound controls, `pref_camera_sounds_key` and `pref_camera_single_shot_sound_key`, remain strings with value `0`; they do not mute the audio track of a recording.

The historical PR #5 rollback had **453 original preferences, 875 omitted, no inserted or rewritten value** under the default project profile. It equals the pre-experiment 451-key baseline plus the two sound opt-outs. The rollback does not set the six switches to alternate values. If an importer merges, loading the rollback over a previous import might not remove their effective device state. No change was made to the standalone profile, visual tuning, video settings or lens calibration.

## Confirm recovery on the phone

Reload the working original (or a verified byte-identical copy) on the same APK/package and lens. Verify a normal 1× photo and a short recording at the mode that failed, including reopening both saved files in Gallery. Do not retry the partial public preset as a remedy. If you do a controlled diagnostic comparison later, start from equivalent, backed-up settings.

- If the original succeeds and the rollback fails, the subset or the effective import state becomes the next lead. A fresh post-import export from each run can show exactly what the APK applied. Keep both private; share only aggregate or redacted differences.
- If the original fails too, try the same build with defaults after backup. If available, the useful diagnostic is the crash exception and nearby camera/codec lines at the failure time, with personal paths, coordinates and identifiers redacted. Do not upload a whole phone bug report.
- If only video fails, record the exact resolution/fps, stabilization and selected codec; do not change them all at once. If a switch is changed for diagnosis, restore the original and repeat.

Reference: [V14 build/package variants](https://www.celsoazevedo.com/files/android/google-camera/dev-BigKaka/f/dl80/) and [distributor troubleshooting](https://www.celsoazevedo.com/files/android/google-camera/troubleshooting/).
