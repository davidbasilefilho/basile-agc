function xmlText(value: string): string {
  for (const character of value) {
    const point = character.codePointAt(0)!;
    if (
      !(
        point === 9 ||
        point === 10 ||
        point === 13 ||
        (point >= 0x20 && point <= 0xd7ff) ||
        (point >= 0xe000 && point <= 0xfffd) ||
        (point >= 0x10000 && point <= 0x10ffff)
      )
    ) {
      throw new Error("Preset name contains a character forbidden by XML 1.0");
    }
  }
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/**
 * Create an experimental neutral photo-only XMP, not a native AGC configuration port.
 * Import acceptance and interpretation require verification in AGC Camera 1.8.6.
 * The preset deliberately leaves exposure, tone curves, denoising and video untouched.
 */
export function standaloneXmp(name: string): string {
  if (name.trim().length === 0 || name.length > 160) {
    throw new Error("Preset name must contain 1–160 characters and not be blank");
  }
  const title = xmlText(name);
  return `<?xml version="1.0" encoding="UTF-8"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
      xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"
      xmlns:dc="http://purl.org/dc/elements/1.1/"
      crs:PresetType="Normal"
      crs:HasSettings="True"
      crs:WhiteBalance="As Shot"
      crs:Saturation="0"
      crs:RedHue="0" crs:RedSaturation="0"
      crs:GreenHue="0" crs:GreenSaturation="0"
      crs:BlueHue="0" crs:BlueSaturation="0"
      crs:ShadowTint="0"
      crs:VignetteAmount="0">
      <crs:Name><rdf:Alt><rdf:li xml:lang="x-default">${title}</rdf:li></rdf:Alt></crs:Name>
      <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${title}</rdf:li></rdf:Alt></dc:title>
      <dc:description><rdf:Alt><rdf:li xml:lang="x-default">Experimental neutral color baseline only; not a native config port. No HDR, video, lens, exposure, sharpening or denoising settings.</rdf:li></rdf:Alt></dc:description>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
`;
}
