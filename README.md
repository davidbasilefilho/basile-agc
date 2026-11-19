# Basile AGC

One balanced, photo-first look for the Snapdragon Galaxy S23 (SM-S911B). Two apps by BigKaka share a name, **not** a config format. [**Download the verified r16 build**](https://github.com/davidbasilefilho/basile-agc/releases/tag/pre-20261119T110622Z-d14f51a60a798410d67d8f5e3bd6e70f0ea617bf). Check the release notes: historical previews contain different layouts, including experimental video candidates.

| App                             | Download/build asset                                                                                                                                                                          | What to use it for                                                                     |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| GCam **AGC9.2.14 V14.0**        | [Basile-S23-AGC9.2-V14-r16.agc](https://github.com/davidbasilefilho/basile-agc/releases/download/pre-20261119T110622Z-d14f51a60a798410d67d8f5e3bd6e70f0ea617bf/Basile-S23-AGC9.2-V14-r16.agc) | One photo-first configuration; baseline video controls preserved, camera sounds off.   |
| Standalone **AGC Camera 1.8.6** | [Basile-AGC-Camera-profile.zip](https://github.com/davidbasilefilho/basile-agc/releases/download/pre-20261119T110622Z-d14f51a60a798410d67d8f5e3bd6e70f0ea617bf/Basile-AGC-Camera-profile.zip) | Native v4 profile for Ajustes → Perfis; neutral Photo, Portrait and Night adjustments. |

One complete photo-first GCam preset, with camera sounds off and original video controls preserved. The standalone ZIP and optional XMP remain separate formats. Look for a release marked `photo-first-v1`; older four-file releases are not equivalent.

**Location recording is on.** Future photos may contain GPS when Android permissions allow it. Disable **Save location / Salvar local** in GCam to opt out. No coordinates or location history are bundled.

- [Import, private originals, generation and verification](docs/USAGE.md)
- [Standalone import instructions](docs/standalone.md)
- [Evidence, limitations and next device tests](docs/HANDOFF.md)
- [Release policy](docs/RELEASES.md)

Built with Bun, TypeScript and Effect. CI checks formatting, lint, types, tests and deterministic artifacts. Actual S23 behavior still needs device validation.
