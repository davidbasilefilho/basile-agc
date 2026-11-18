# Basile AGC: what to preserve

Build one everyday look for the base Snapdragon Galaxy S23 (SM-S911B). A photo should still look like the scene, whether it was taken indoors, outside, against a bright window, or at night. Preserve highlight detail and readable shadows, natural skin and neutral whites. Don't hide noise with waxy smoothing, raise shadows until they crawl, or sharpen edges into halos. Check for colored light leaks; don't globally cool a profile to compensate for one warm room.

Aim for comparable color, exposure and texture across main, ultrawide, telephoto and front cameras, in Photo, Portrait, Night and supported video modes. Calibration is lens-specific: matching the pictures matters more than matching slider values. In video, test a moving subject, a pan and a walk: a stabilized frame can still stutter. Prefer HDR video by default **only** for lens/resolution/fps combinations verified to record HDR and retain that setting after relaunch. Still-photo HDR, HDRNet and HEVC alone are not evidence of HDR video. Leave unsupported or unverified combinations explicit.

Successful capture, save and playback come before tuning. Keep the two GCam shutter-sound strings at `"0"`; that is not a request to mute recorded audio. Do not change quality or capture settings speculatively to fix a crash. Compare the entire known reference by preference name, XML type and value, including omissions and explicit defaults. Change one justified factor at a time. Never publish original exports, private media, identifiers, traces, APKs or binary patches.

## Generate and ship

1. Confirm the app and build. The GCam mod AGC9.2.14 V14.0 loads an Android preference-map `.agc`; standalone AGC Camera 1.8.6 imports a native v4 profile ZIP under Ajustes → Perfis. Do not send a photo-look XMP to that importer or copy enums between apps.
2. Edit the public inputs under `data/` or the relevant TypeScript adapter under `src/`. Use Bun, TypeScript and Effect. Keep Oxlint type-aware and JSDoc on public APIs only. Don't hand-edit release assets.
3. With Bun 1.4.4, run the same checks locally:

   ```sh
   bun install --frozen-lockfile
   bun run generate
   bun run check
   bun run validate
   bun run verify
   ```

   Review the typed diff and manifest digests. Commit the source, tests and reproducible `generated/` outputs together on a working branch. Never commit a private source as a test fixture.

4. Open a PR. CI checks the committed files for drift, generates a second copy and validates it. Merge only when authorized and checks pass at the current head. After a default-branch merge, CI regenerates and verifies before publishing the four assets to a dated GitHub prerelease. Confirm the Actions run, target commit, asset names and hashes; share the release link. No manual uploads. Only an authorized existing `v*` tag requests a stable release; never create one for an untested candidate. See [release safeguards](docs/RELEASES.md).
5. Label structural checks separately from physical results. On the S23, verify actual saved stills and playable video after recording stops, then test the [lens, lighting, cadence and HDR matrix](docs/HANDOFF.md). Record what was tested, what failed, and what is unknown. If the original and candidate differ on-device, isolate the difference before tuning.
