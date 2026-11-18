# Basile AGC

A reproducible generator for a single, balanced look on the Snapdragon Galaxy S23 (SM-S911B). Two apps by BigKaka share a name, **not** a capture pipeline. For the GCam capture crash, reload your own working v15 original. **Do not import the partial GCam file from GitHub Releases or this repository as the fix.** The original already has both shutter sounds disabled.

| App                             | Generated file                                                           | What works here                                                                                                                                |
| ------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| GCam mod **AGC9.2.14 V14.0**    | Your original v15 or a lossless local build (below)                      | Preserves the full source. The older public 453-key fixture is a historical subset, not a recovery file.                                       |
| Standalone **AGC Camera 1.8.6** | [Basile-AGC-Camera-profile.zip](generated/Basile-AGC-Camera-profile.zip) | Native v4 profile for Ajustes → Perfis. Neutral native adjustments across Photo, Portrait and Night; preserves the source's still-HDR setting. |

**Validation is structural, not a phone test.** The generated native ZIP matches a real export's schema but has not yet been confirmed on the target phone. The public samples do not prove or force device support for HDR video; only the private GCam HDR30 candidate requests the verified switch. Neither HEVC, HDRNet nor the photo Ultra HDR switch establishes 10-bit HDR video. The current GCam video baseline retains the source's 2160p/30 preference values, not a forced 60 fps profile. See the [next-agent handoff and device tests](docs/HANDOFF.md) and [standalone mapping](docs/standalone.md).

## Try it

Back up your working settings first. For the [GCam V14 release](https://www.celsoazevedo.com/files/android/google-camera/dev-BigKaka/f/dl80/), place your own original v15 file (or the lossless result below) in `Download/AGC.9.2/configs/` and use Load Configs. Use the same build/package that worked with the original. This is not a GCam 9.6 or S23 Ultra preset. The [9.2 config index](https://www.celsoazevedo.com/files/android/google-camera/f/configs-bigkaka-07/) documents the directory.

For the [standalone app](https://play.google.com/store/apps/details?id=com.agc.gcam), export and keep your current profile as a backup. Go to **Ajustes → Perfis → ⋮ → Import**, select **Basile-AGC-Camera-profile.zip** without extracting it, then select **Basile**. Applying it replaces profile-managed lens/tuning overrides and LUT selection. The optional XMP is **not** accepted in Perfis. For the old GCam launcher icon, use the app’s desktop-icon setting. If testing HDR video, select a supported HDR mode in the app, reopen it, and inspect the recorded file. See [manual controls and limits](docs/standalone.md). If a supported combination cannot be found, record it as unavailable; do not relabel an SDR recording.

### Generate and verify a faithful GCam file

Use Bun 1.4.4 and run `bun install --frozen-lockfile` once. Pass an original from this GCam build. To preserve it exactly, use no overlay. The sound-only option `--overlay sounds-off` does nothing if both original switches are already disabled. For normal video, the [FHD30 HDR and FHD60 SDR options](docs/gcam-video.md) request verified controls from the target APK, without claiming a phone-verified output. None of these paths uses the curated public baseline or reserializes the XML.

```sh
# Create a new private directory outside the checkout; generation never overwrites.
OUT="$(mktemp -d)"
SOURCE="/path/to/your/original.agc"
bun run generate --target gcam --source "$SOURCE" --out "$OUT"
bun run validate --target gcam --source "$SOURCE" --out "$OUT"
cmp "$SOURCE" "$OUT/Basile-S23-AGC9.2-V14.agc"
```

For a separate muted copy, choose a fresh directory and supply `--overlay sounds-off` to both commands. Never commit the input or output: full-fidelity copies intentionally retain all original metadata. Published sample artifacts remain separate. The supplied v15 matched byte-for-byte with **both** options. This proves file identity, not that photo or video saved on the phone. See the [crash comparison and evidence](docs/gcam-capture.md).

## Generate, modify, verify the public demonstration artifacts

Install Bun 1.4.4. All project code and tests are TypeScript, executed with Bun. Effect handles the generator CLI, independent verification, private video diagnostics, Git release policy and publisher. From the repository root:

```sh
bun install --frozen-lockfile
bun run generate
bun run validate
bun run check
bun run verify
```

Edit [data/profile.json](data/profile.json) to change the display name or GCam JPEG quality. Unknown keys, unsafe names, and invalid quality values are rejected. Resolution, stabilization and per-lens calibration come from [the reviewed, typed baseline](data/gcam-92-v14.json), not a guessed conversion table. Changes to capture settings belong there only with target-build evidence. Outputs are deterministic; [the manifest](generated/manifest.json) includes scope and SHA-256 for each.

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

The generated `.agc` extension is required by the camera app. Its contents are XML preferences, not Apollo Guidance Computer assembly; a narrow [Linguist override](.gitattributes) labels only these generated files as XML without altering their bytes.

Do not contribute private photos, videos, original settings dumps, APKs, libraries or third-party presets. Contribute minimized setting diffs and aggregate measurements instead.

## CI releases

See [release triggers, commit-date naming, assets and ancestry-only pruning](docs/RELEASES.md). PR validation has no publish permissions.
