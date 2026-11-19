# Usage, generation and verification

The photo-first layout contains these files, the optional Adobe XMP and a manifest marked `photo-first-v1`. It is not the older partial four-file layout. CI builds GCam from the [privacy-reviewed v15 reference](../data/gcam-92-v14.xml), preserving **1,318 typed preferences**, lens/photo tuning and baseline video controls. It no longer forces FHD30 HDR or FHD60 SDR. Dedicated video recording is outside this profile's tuning scope. Structural checks do not establish phone capture quality or HDR support. See [what was sanitized](public-reference.md); keep your own original for an exact rollback.

## Try it

Back up your working settings first. For the [GCam V14 release](https://www.celsoazevedo.com/files/android/google-camera/dev-BigKaka/f/dl80/), place the chosen GCam build in `Download/AGC.9.2/configs/` and use Load Configs. Use the same build/package that worked with the original. This is not a GCam 9.6 or S23 Ultra preset. The [9.2 config index](https://www.celsoazevedo.com/files/android/google-camera/f/configs-bigkaka-07/) documents the directory.

For the [standalone app](https://play.google.com/store/apps/details?id=com.agc.gcam), export and keep your current profile as a backup. Go to **Ajustes → Perfis → ⋮ → Import**, select **Basile-AGC-Camera-profile.zip** without extracting it, then select **Basile**. Applying it replaces profile-managed lens/tuning overrides and LUT selection. The optional XMP is **not** accepted in Perfis. For the old GCam launcher icon, use the app’s desktop-icon setting. If testing HDR video, select a supported HDR mode in the app, reopen it, and inspect the recorded file. See [manual controls and limits](standalone.md). If a supported combination cannot be found, record it as unavailable; do not relabel an SDR recording.

### Generate and verify a faithful GCam file

Use Bun 1.4.4 and run `bun install --frozen-lockfile` once. Pass an original from this GCam build. To preserve it exactly, use no overlay. The sound-only option `--overlay sounds-off` does nothing if both original switches are already disabled. Private-source mode uses only the original you pass. It does not reserialize unrelated XML.

```sh
# Create a new private directory outside the checkout; generation never overwrites.
OUT="$(mktemp -d)"
SOURCE="/path/to/your/original.agc"
bun run generate --target gcam --source "$SOURCE" --out "$OUT"
bun run validate --target gcam --source "$SOURCE" --out "$OUT"
cmp "$SOURCE" "$OUT/Basile-S23-AGC9.2-V14.agc"
```

For a separate muted copy, choose a fresh directory and supply `--overlay sounds-off` to both commands. Never commit the input or output: full-fidelity copies intentionally retain all original metadata. The CI-built photo-first config use the separately audited public reference. The supplied v15 matched byte-for-byte with **both** options. This proves file identity, not that photo or video saved on the phone. See the [crash comparison and evidence](gcam-capture.md).

### Night Sight and per-shot control

Automatic low-light assistance should remain optional for each shot. The source's `camera.promote_night_sight=true` is preserved, but a Night Sight recommendation is not proof that this V14 build automatically activates it on the S23. This release does not force Night Sight mode or add an unverified activation flag. Use the app's visible Night Sight/Photo controls to choose the mode; an automatic per-shot override still needs confirmation in the exact installed build. Preserve the working photo tuning while checking that behavior.

### Location recording is enabled by default

**The generated GCam config enables Save location. Future photos can contain GPS coordinates when Android location permission and device location services allow it. Sharing original photos may expose where they were taken.** To disable recording, turn off **Save location / Salvar local** in GCam settings, or revoke the app's Android location permission. Importing a config cannot grant Android permissions or backfill old photos.

The generator changes only the verified string `pref_camera_recordlocation_key` from `"0"` to `"1"` relative to the immutable, privacy-reviewed reference. No coordinates, location history or private exports are bundled. Photo/video tuning and the existing privacy sanitization are unchanged.

The private `--source` workflow preserves your own choice byte-for-byte; `--overlay sounds-off` changes only shutter-sound values. Keep original and generated private files outside this checkout.

## Generate, modify, verify the public release artifacts

Install Bun 1.4.4. All project code and tests are TypeScript, executed with Bun. Effect handles the generator CLI, independent verification, private video diagnostics, Git release policy and publisher. From the repository root:

```sh
bun install --frozen-lockfile
bun run generate
bun run validate
bun run check
bun run verify
```

Edit [data/profile.json](../data/profile.json) to change the display name or GCam JPEG quality. Unknown keys, unsafe names, and invalid quality values are rejected. Resolution, stabilization and per-lens calibration come from [the reviewed, typed baseline](../data/gcam-92-v14.xml), not a guessed conversion table. Changes to capture settings belong there only with target-build evidence. Outputs are deterministic; [the manifest](../generated/manifest.json) includes scope and SHA-256 for each.

```sh
bun run generate --target gcam --profile data/profile.json --out /tmp/basile-gcam
bun run validate --target gcam --profile data/profile.json --out /tmp/basile-gcam
bun run generate --target standalone --out /tmp/basile-standalone
```

Use a dedicated output directory per target. The CLI does not delete unrelated/stale files. For private recordings, run `bun run video:cadence /path/to/local.mp4` (requires ffprobe). No upload is required.

## Repository

- `src/`: Bun/TypeScript serializer, profile validation, target adapters and CLI
- `data/`: public authoring inputs; `generated/`: reproducible outputs ready for testing
- `src/verify.ts`, `src/video/`, `src/release/`: independent XML verification, offline cadence diagnostics, release policy and publication, all in TypeScript with Effect
- `tests/`: generator, XMP and lint-policy regression tests
- CI checks a frozen install, Oxfmt, type-aware Oxlint/tsgolint, exported-only JSDoc, TypeScript, Bun tests and generated drift

The generated `.agc` extension is required by the camera app. Its contents are XML preferences, not Apollo Guidance Computer assembly; a narrow [Linguist override](../.gitattributes) labels only these generated files as XML without altering their bytes.

Do not contribute private photos, videos, original settings dumps, APKs, libraries or third-party presets. Contribute minimized setting diffs and aggregate measurements instead.

## CI releases

See [release triggers, commit-date naming, assets and ancestry-only pruning](RELEASES.md). PR validation has no publish permissions.

## Revision and stale artifacts

The public GCam filename includes deterministic revision r17, also recorded in the manifest. Bump this revision for a changed published camera profile so downloads/imports do not overwrite an older revision. Private-source recovery retains its original stable output filename.

CI removes only regular generator-owned obsolete GCam filenames inside this checkout’s generated directory, then requires a clean Git diff there. A committed stale artifact therefore fails CI and must be removed in the PR, rather than being hidden by regeneration. Arbitrary output directories, private originals, standalone formats and historical GitHub releases are never deleted by this cleanup.

Bump `configRevision` in `src/config-revision.ts`, regenerate, remove the obsolete tracked output, update concrete fixture assertions, and run all checks. Generator, verifier, cleanup and publisher derive the current AGC filename from that one constant. Previously published revisioned layouts that are no longer recognized are retained by pruning (fail closed), not guessed or deleted. Historical unsuffixed schema definitions must remain unchanged.

## r17 photo adjustment

The audited input XML remains unchanged. `data/photo-adjustments.json` applies the accepted +0.05 change to six existing color coefficients and changes only `lib_shadow_compensation_key_p0_2` from string `3.50` to `3.60`. The original configuration labels slot 2 as telephoto. That label is not proof of physical-camera routing or of the direction/magnitude of the resulting shadow change.

The slot-2 adjustment is deliberately small and reversible; verify darker interiors first, then repeat the outdoor scene. Check foliage separation, noise, stone/cloud detail and haloing. No claim of extra captured dynamic range or guaranteed brighter shadows is made. Global/main brightness, shadow compensation, exposure, highlight controls, capture/HDR/P3 preferences, Night Sight and video preferences remain unchanged. Existing color and shadow processing may be shared across modes, so unchanged mode flags do not prove unchanged rendering in every mode.

The 2× crop may share the main-camera slot with 1×. No verified independent zoom-conditioned control is available, so r17 does not change the good 1× reference to compensate for 2×. For a matched comparison, (1) select 1× and meter/lock on the same subject if the app offers exposure lock; (2) select 2× without changing that lock, capture and compare. If lock is reset by zoom, re-meter the same subject; this is a comparison procedure, not a saved automatic correction.

P3 and existing HDR-related preferences are preserved; a dedicated Ultra HDR output switch and gain-map output were not established. Gallery selection remains the original value, sharing buttons stay disabled, geotagging enabled, and sounds off. Import r16 to revert both the new color coefficients and slot-2 shadow adjustment, or the previously accepted color configuration to revert only the slot-2 change.
