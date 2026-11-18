import { strToU8, zipSync } from "fflate";

function validateName(name: string): void {
  // Keep the same display-name contract as parseProfile in generator.ts.
  if (!/^[\p{L}\p{N}][\p{L}\p{N} ._&()+-]{0,63}$/u.test(name) || name !== name.trim()) {
    throw new Error("Invalid display name");
  }
}

function neutralMode() {
  return {
    global: {
      pref_saturation_key: 0,
      pref_contrast_strength_key: 0,
      pref_denoise_strength_key: 0,
      pref_exposure_ev_key: 0,
      pref_shadows_key: 0,
      pref_sharpen_strength_key: 0,
    },
    per_lens: {},
    tunable_settings: { global: {}, per_lens: {} },
  };
}

function nativeProfile(name: string) {
  validateName(name);
  return {
    format: "GCamAGC-profile",
    _version: 4,
    _name: name,
    photo: {
      ...neutralMode(),
      global: { ...neutralMode().global, pref_hdr_mode_key: 1 },
    },
    portrait: neutralMode(),
    night: neutralMode(),
  };
}

/**
 * Serialize an AGC Camera 1.8.6 native v4 profile as a deterministic ZIP.
 * The six verified native adjustment offsets are zero in all three modes.
 * Retains the device-exported photo HDR enum (1), not a video HDR control.
 * Other modes inherit their native HDR behavior; no creative LUT is bundled.
 * This is a neutral single-look baseline, not a numeric GCam configuration port.
 * Only Basile.json is included; there are no LUTs or third-party binaries.
 * This format serialization does not establish device-level image quality.
 */
export function nativeProfileZip(name: string): Uint8Array {
  const json = `${JSON.stringify(nativeProfile(name), null, 2)}\n`;
  return zipSync({
    "Basile.json": [
      strToU8(json),
      {
        level: 0,
        // ZIP stores local DOS fields, not an epoch or timezone. Construct the
        // same local components on every host so bytes do not depend on TZ.
        mtime: new Date(1980, 0, 1, 0, 0, 0),
      },
    ],
  });
}
