# What CI builds, and what stays private

CI reads the versioned `data/gcam-92-v14.xml`, applies the explicit sound-off and location-on defaults, and independently validates the resulting Android preference maps and hashes before publishing. It never downloads a personal export, embeds a signed link, or needs anyone’s phone. The original private export is **not** in Git. Public builds are candidates for the base Snapdragon S23 on AGC9.2 V14.0, not a claim that the phone can record every requested combination.

## Full-reference audit

The complete source had 1,328 uniquely named preferences. During the private audit, each key, Android type, value and set member was classified. After sanitization, the public reference contains **1,318**:

- **10 omitted:** the exact firmware build fingerprint; original export filename, nickname, description and catalog ID; five application-specific sharing preferences. No account name, credential, private path, or raw diagnostic is needed for a public build.
- **130 values changed:** 37 disabled custom-library slots each had three fields (title, address, payload) reset to the editor’s empty defaults. All 37 enable switches remain off with their original string type, and all seven slot counts remain intact. Of 27 UI-history entries examined, 17 counters, timestamps or flags needed resetting to zero and 10 were already neutral. A customized recording filename prefix was restored to the APK default; the location-tagging opt-in was explicitly turned off. This does not mute recorded sound or alter lens selection.
- **1,188 existing elements byte-identical:** their order, type, attributes, value and serialization were compared to the original. All 244 original empty strings and 207 explicit “Off (as in library)” entries were kept. The extra 111 empty strings are the cleared, inactive patch fields. Generic model/board descriptors, lens ID sets, capture-stream switches, image-reader limits, encoders, per-lens color/noise tuning, mode defaults and sound switches were not scrubbed. The generic download directory and date-format pattern contain no personal path or capture date and remain intact.

The reviewed baseline SHA-256 is `e35f89ad9dc2c5597b28170b805fd4182c5fc1564d9d0bb2790e1f8783f14b4d`. The regression suite checks the exact reference, checks explicit privacy defaults and verifies all patch slots are inert. A baseline change requires a new review; do not update the pinned hash just to make a changed export pass. This audit is specific to this input, not a general-purpose sanitizer for arbitrary exports.

## What the release overlays add

The photo-first asset preserves all 1,318 reviewed source preferences, including baseline video controls and the two disabled shutter sounds. No HDR/FPS preferences are inserted. Public location recording is explicitly enabled by the generator; a private `--source` copy preserves the owner's existing choice. r17 additionally applies seven explicit photo adjustments from data/photo-adjustments.json: six accepted color coefficients and the slot-2 shadow value. The baseline file and audit digest remain unchanged; see USAGE.md for the exact values and scope limitations.

Use the [source-preserving private generator](USAGE.md) for an exact rollback to your own export, or [GitHub Releases](https://github.com/davidbasilefilho/basile-agc/releases) for this reviewed public build.

The immutable reference keeps location recording off. The current public generator explicitly overlays only the verified location-recording string to "1", as requested; it does not restore any coordinates or history. Future photos may contain GPS when permissions allow.
