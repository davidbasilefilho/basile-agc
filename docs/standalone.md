# Standalone AGC Camera: partial photo baseline

## What this is, and is not

`standaloneXmp(name)` emits a small, deterministic Camera Raw XMP **candidate for
import testing**. It is not a conversion of the GCam `.agc` configuration, not a
complete native settings export, and not a device-validated preset. Syntax tests
cannot establish that the app imports or applies every field.

The target is the separate **AGC Camera 1.8.6**, normally `com.agc.gcam`, not the
AGC9.2.14 V14 GCam mod. Both are by BigKaka. The developer advertises Lightroom
XMP import, but a documented standalone whole-config schema and a supported
GCam-patcher conversion were not found. Renaming `.agc` would be misleading.

## Launcher icon: old GCam, not the default

In the standalone app's settings, find the desktop/app icon selector and choose the **old GCam icon**. This is a built-in option, not the monochrome icon style or an alternate APK. BigKaka [introduced it in 1.8.0](https://www.celsoazevedo.com/files/android/agc-camera/f/dl06/) and [fixed an icon-switching crash in 1.8.5](https://www.celsoazevedo.com/files/android/agc-camera/f/dl07/). The exact translated label and menu nesting were not verified. Check the icon on the home screen after changing it.

The generated manifest records this manual post-import setting. A Lightroom XMP describes photographic adjustments; there is no verified importable launcher-icon mapping. The generator does not set or claim to have changed the phone's icon, modify an APK, or apply this standalone setting to the GCam mod.

## Exact intent

The photographic subset uses Adobe's Camera Raw namespace:

| Properties                                     | Value   | Requested effect                                                     |
| ---------------------------------------------- | ------- | -------------------------------------------------------------------- |
| WhiteBalance                                   | As Shot | Preserve capture white balance rather than forcing indoor correction |
| Saturation                                     | 0       | No additional global saturation                                      |
| RedHue, GreenHue, BlueHue                      | 0       | No primary calibration hue offset                                    |
| RedSaturation, GreenSaturation, BlueSaturation | 0       | No primary calibration saturation offset                             |
| ShadowTint                                     | 0       | No additional shadow tint                                            |
| VignetteAmount                                 | 0       | No added vignette                                                    |

`HasSettings=True` marks settings presence. `PresetType=Normal` and localized
`crs:Name` identify a conventional preset; `dc:title` and `dc:description` identify
the artifact and its limits. Preset recognition must still be checked in the app.
No fictitious Adobe engine version, profile UUID, device calibration, or source
media metadata is embedded.

This is a neutral **color reset subset**, not an identical image rendering.
These zeros are not mapped GCam patcher values. They do not prove that existing
HSL edits, LUTs, curves, or other app settings have been reset. Start with the
app's default processing and no additional creative LUT when evaluating it.
No arbitrary denoising level is forced: a number without sensor and pipeline
validation could produce either grain or plastic texture. No claim of fixing
blue bloom, low-light noise, or HDR range is made.

## Setup and capability matrix

1. Confirm the installed app name, package and version. Back up its settings
   using the app's supported mechanism, if available.
2. Generate the XMP candidate. Use the app's Lightroom/XMP preset import control.
   The developer documents the feature, not a stable menu path; do not import it
   through the GCam `.agc` loader. If there is no such control or import fails,
   record the actual result instead of renaming the file.
3. Check that the preset appears and inspect each available adjustment. Compare
   a default capture and a preset capture of the same neutral scene.
4. Verify Photo, Portrait and Night independently. Keep this neutral look rather
   than creating day/night style presets. Mode availability is not equivalence.
5. Configure capture features separately only where the app/device exposes them.

| Goal                       | XMP coverage            | Required verification                                                                 |
| -------------------------- | ----------------------- | ------------------------------------------------------------------------------------- |
| Neutral color              | Partial candidate above | Import and rendered output                                                            |
| Matched lenses/modes       | None                    | Per-lens neutral target and skin-tone comparisons                                     |
| Ultra HDR photos / P3      | None                    | App toggles plus actual gain map / color-profile inspection                           |
| HDR video by default       | None                    | Available profile at each lens/resolution/fps; verify recorded bit depth and transfer |
| FHD60 / 4K30 / 4K60        | None                    | Actual cadence, dropped/duplicate frames, thermal behavior                            |
| OIS / EIS                  | None                    | Supported modes, crop, walking/panning test                                           |
| Low-light noise/detail     | None                    | Paired texture, moving subject and shadow tests                                       |
| Automatic Night / RAW-only | None                    | Actual UI and saved files, not preset labels                                          |

HDR is the desired video default wherever supported; this XMP does not implement
that policy. Never force an unsupported combination or describe SDR with stronger
contrast as HDR. Any fallback must be visible in the generated report.

## Unblock a real native adapter

Obtain a clean standalone export, if the app offers one, its exact version and
package, then before/after exports with **one setting changed at a time**. Include
Ultra HDR, P3, HDR video, codec, fps, stabilization, lens selection and shared
Photo/Portrait/Night adjustments. Remove account identifiers and locations.

Establish the actual serialization, field types, enum values, defaults, lens
scoping and unsupported combinations from those pairs or verified importer code.
Add fixtures and parse/serialize/parse tests. Import generated output into that
same build, export it again, compare effective settings, and capture test media.
Only then describe the target as a native port. An XMP roundtrip can confirm its
small look subset, never the missing video or device controls.

## Sources checked

- [Developer's AGC Camera listing](https://play.google.com/store/apps/details?id=com.agc.gcam&hl=en): advertises Lightroom XMP preset import and an independent processing pipeline.
- [AGC Camera release index](https://www.celsoazevedo.com/files/android/agc-camera/): standalone application identity.
- [1.8.6 developer changelog via distributor](https://www.celsoazevedo.com/files/android/agc-camera/f/dl08/): Tune/Pipe, Photo/Portrait/Night adjustments, Ultra HDR and P3 additions. This is not an S23 capability certification.
- [1.5.7 developer changelog via distributor](https://www.celsoazevedo.com/files/android/agc-camera/f/dl03/): video stabilization addition.
- [Adobe Camera Raw namespace](https://developer.adobe.com/xmp/docs/xmp-namespaces/crs/): documented photographic fields and values used here; does not specify AGC's accepted subset.
- [Adobe XMP specifications](https://developer.adobe.com/xmp/docs/xmp-specifications/): RDF/XML serialization model.
- [Android HDR video capture](https://developer.android.com/media/camera/camera2/hdr-video-capture): capability negotiation and HDR recording architecture.
- [Android Ultra HDR image format](https://developer.android.com/media/platform/hdr-image-format): validating actual gain-map content, not just a toggle.

Sources were checked on 2026-11-18. No APK, processing library, LUT or third-party
preset is redistributed. Device import and photographic behavior remain untested.
