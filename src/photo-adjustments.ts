import { readFileSync } from "node:fs";

/** Apply the approved color coefficients and one named tele-slot shadow control without rewriting unrelated XML. */
export function adjustPhotoPreferences(source: Uint8Array): Uint8Array {
  const changes: unknown = JSON.parse(
    readFileSync(new URL("../data/photo-adjustments.json", import.meta.url), "utf8"),
  );
  if (!changes || typeof changes !== "object" || Array.isArray(changes))
    throw new Error("Invalid photo adjustments");
  const entries = Object.entries(changes);
  const originals = ["1.05", "1.0", "1.05", "1.0", "0.95", "1.05"];
  if (entries.length !== originals.length + 1) throw new Error("Incomplete photo adjustments");
  let xml = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(source);
  for (const [key, value] of entries) {
    if (key === "lib_shadow_compensation_key_p0_2") {
      const original = '<string name="' + key + '">3.50</string>';
      if (value !== "3.60" || xml.split(original).length !== 2)
        throw new Error("Unexpected tele-slot shadow baseline");
      xml = xml.replace(original, '<string name="' + key + '">3.60</string>');
      continue;
    }

    if (
      !/^pref_satcct_key_[0-5]$/.test(key) ||
      typeof value !== "string" ||
      !/^1\.[01][05]$/.test(value)
    )
      throw new Error("Unapproved photo adjustment");
    const slot = Number(key.slice(-1));
    const before = originals[slot];
    if (before === undefined || Math.abs(Number(value) - Number(before) - 0.05) > 0.000001)
      throw new Error("Unexpected color increment");
    const original = '<string name="' + key + '">' + before + "</string>";
    if (xml.split(original).length !== 2) throw new Error("Photo adjustment baseline mismatch");
    xml = xml.replace(original, '<string name="' + key + '">' + value + "</string>");
  }
  return new TextEncoder().encode(xml);
}
