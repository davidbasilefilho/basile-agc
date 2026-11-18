import { expect, test } from "bun:test";

import { strFromU8, unzipSync } from "fflate";

import { nativeProfileZip } from "../src/native-profile";

function decode(name = "Basile"): unknown {
  const files = unzipSync(nativeProfileZip(name));
  expect(Object.keys(files)).toEqual(["Basile.json"]);
  const bytes = files["Basile.json"];
  if (!bytes) throw new Error("Missing profile JSON");
  return JSON.parse(strFromU8(bytes));
}

const neutral = {
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

test("native ZIP has a single flat Basile.json and v4 mode envelope", () => {
  expect(decode()).toEqual({
    format: "GCamAGC-profile",
    _version: 4,
    _name: "Basile",
    photo: { ...neutral, global: { ...neutral.global, pref_hdr_mode_key: 1 } },
    portrait: neutral,
    night: neutral,
  });
});

test("native ZIP bytes and DOS header fields are deterministic", () => {
  const first = nativeProfileZip("Basile");
  const second = nativeProfileZip("Basile");
  expect(first).toEqual(second);
  const header = new DataView(first.buffer, first.byteOffset, first.byteLength);
  expect(header.getUint32(0, true)).toBe(0x04034b50);
  expect(header.getUint16(8, true)).toBe(0); // stored, not compressed
  expect(header.getUint16(10, true)).toBe(0); // DOS midnight
  expect(header.getUint16(12, true)).toBe(33); // 1980-01-01
});

test("profile names preserve Unicode without changing ZIP member names", () => {
  const name = "Basile balanced & HDR café";
  expect(decode(name)).toMatchObject({ _name: name });
});

test("profile names reject empty, overlong, control and broken Unicode input", () => {
  for (const name of [
    "",
    "  ",
    "x".repeat(65),
    "Basile\n",
    "Basile\u0000",
    "Basile\u007f",
    "\ud800",
    "\udc00",
    "../Basile",
    "Basile/other",
    " Basile",
    "Basile ",
    'Basile "quoted"',
  ]) {
    expect(() => nativeProfileZip(name)).toThrow();
  }
  expect(() => nativeProfileZip("x".repeat(64))).not.toThrow();
});

test("native ZIP bytes do not depend on the host timezone", () => {
  const source =
    'import {nativeProfileZip} from "./src/native-profile.ts"; console.log(Buffer.from(nativeProfileZip("Basile")).toString("hex"));';
  const outputs = ["UTC", "America/Sao_Paulo", "Asia/Tokyo"].map((timezone) => {
    const processResult = Bun.spawnSync([process.execPath, "-e", source], {
      env: { ...process.env, TZ: timezone },
    });
    expect(processResult.exitCode).toBe(0);
    return processResult.stdout.toString();
  });
  expect(new Set(outputs).size).toBe(1);
});
