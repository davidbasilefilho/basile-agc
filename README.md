# Basile AGC

A reproducible generator for a single, balanced look on the Snapdragon Galaxy S23 (SM-S911B). Two apps by BigKaka share a name, **not** a capture pipeline. Start with the file for the app you actually use.

| App                             | Generated file                                                                 | What works here                                                                                                                                                            |
| ------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GCam mod **AGC9.2.14 V14.0**    | [Basile-S23-AGC9.2-V14.agc](generated/Basile-S23-AGC9.2-V14.agc)               | Typed Android preference map, curated from the supplied v15 Low Light export. Lens-specific noise, exposure, frame-count and color settings are retained.                  |
| Standalone **AGC Camera 1.8.6** | [Basile-AGC-Camera-photo-look.xmp](generated/Basile-AGC-Camera-photo-look.xmp) | Experimental neutral-color photo preset for the app's documented Lightroom XMP importer. Not a native settings conversion. Does not configure video, lenses, or denoising. |

**Validation is structural, not a phone test.** Neither file has been imported into the target phone here. HDR video is the requested default wherever supported, not a feature these files can prove or force. Neither HEVC, HDRNet nor the photo Ultra HDR switch establishes 10-bit HDR video. The current GCam video baseline retains the source's 2160p/30 preference values, not a forced 60 fps profile. See the [next-agent handoff and device tests](docs/HANDOFF.md) and [standalone mapping](docs/standalone.md).

## Try it

Back up your working settings first. For the [GCam V14 release](https://www.celsoazevedo.com/files/android/google-camera/dev-BigKaka/f/dl80/), put the generated .agc in `Download/AGC.9.2/configs/` and use the app's Load Configs control. The public preset is a curated subset, **not a byte-for-byte restore**. Prefer a clean test installation when possible: the loader's handling of omitted keys has not been confirmed. Do not use it on AGC9.6 or assume it suits the S23 Ultra. The [9.2 config index](https://www.celsoazevedo.com/files/android/google-camera/f/configs-bigkaka-07/) documents the directory.

For the [standalone app](https://play.google.com/store/apps/details?id=com.agc.gcam), use its photo preset/XMP importer rather than its GCam counterpart. For the requested launcher appearance, select the **old GCam icon** in the standalone app’s desktop-icon setting; this is not an XMP field. If testing HDR video, select a supported HDR mode in the app, reopen it, and inspect the recorded file. See [manual controls and limits](docs/standalone.md). If a supported combination cannot be found, record it as unavailable; do not relabel an SDR recording.

## Generate, modify, verify

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
