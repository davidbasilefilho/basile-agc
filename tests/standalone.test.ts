import { expect, test } from "bun:test";

import { standaloneXmp } from "../src/standalone.ts";

test("standalone baseline is deterministic and limited to neutral color", () => {
  const xmp = standaloneXmp("Basile Neutral");
  expect(xmp).toBe(standaloneXmp("Basile Neutral"));
  expect(xmp).toContain('crs:WhiteBalance="As Shot"');
  expect(xmp).toContain('crs:Saturation="0"');
  expect(xmp).not.toMatch(
    /crs:(?:Exposure|Contrast|Sharpness|LuminanceSmoothing|ColorNoiseReduction|Temperature|Tint|ToneCurve|ProcessVersion|CameraProfile)/,
  );
  expect(xmp).not.toMatch(/(?:pref_|lib_|hdrgm:|exif:|GPS|VideoHDR)/);
});

test("preset names cannot inject markup", () => {
  const xmp = standaloneXmp('A&B <x> "quoted" 😺');
  expect(xmp).toContain('A&amp;B &lt;x&gt; "quoted" 😺');
  expect(xmp).not.toContain("<x>");
});

test("invalid XML text and invalid names fail closed", () => {
  for (const name of ["", "  ", "a".repeat(161), "a\u0000", "a\ud800", "a\ufffe"]) {
    expect(() => standaloneXmp(name)).toThrow();
  }
});
