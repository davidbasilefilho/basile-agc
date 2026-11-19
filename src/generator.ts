import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { SaxesParser } from "saxes";

import { configRevision, gcamArtifactName } from "./config-revision";
import { fromOriginal } from "./lossless";
import { nativeProfileZip } from "./native-profile";
import { adjustPhotoPreferences } from "./photo-adjustments";
import { standaloneXmp } from "./standalone";

/** Options shared by the two output adapters. JPEG quality applies only to GCam. */
export interface Profile {
  name: string;
  jpegQuality: number;
  videoHdr: "preserve-source";
}

/** Verified serializer targets; a standalone photo look is not a whole-camera configuration. */
export type Target = "all" | "gcam" | "standalone";

/** Read a strict project profile, rejecting typos rather than silently generating defaults. */
export function parseProfile(raw: unknown): Profile {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("Expected a profile object");
  const values = Object.fromEntries(Object.entries(raw)) as Record<string, unknown>;
  if (Object.keys(values).some((k) => !["name", "jpegQuality", "videoHdr"].includes(k)))
    throw new Error("Unknown profile property");
  const { name, jpegQuality, videoHdr } = values;
  if (
    typeof name !== "string" ||
    !/^[\p{L}\p{N}][\p{L}\p{N} ._&()+-]{0,63}$/u.test(name) ||
    name !== name.trim()
  )
    throw new Error("Invalid display name");
  if (
    typeof jpegQuality !== "number" ||
    !Number.isInteger(jpegQuality) ||
    jpegQuality < 1 ||
    jpegQuality > 100
  )
    throw new Error("JPEG quality must be an integer 1 to 100");
  if (videoHdr !== "preserve-source")
    throw new Error("Expected preserve-source as videoHdr policy");
  return { name, jpegQuality, videoHdr };
}

function escapeXml(text: string) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function loadGcam(profile: Profile) {
  const source = adjustPhotoPreferences(
    readFileSync(new URL("../data/gcam-92-v14.xml", import.meta.url)),
  );
  const changeName = profile.name !== "Basile";
  const changeQuality = profile.jpegQuality !== 97;
  if (!changeName && !changeQuality) return source;
  const xml = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
    fromOriginal(source),
  );
  const parser = new SaxesParser();
  let depth = 0,
    start = 0,
    replacement: string | undefined;
  const patches: { start: number; end: number; replacement: string }[] = [];
  parser.on("opentag", (tag) => {
    if (++depth !== 2 || tag.name !== "string" || tag.isSelfClosing) return;
    const key = tag.attributes.name ?? "";
    if (changeName && /^lib_profile_title_key(?:_p0_[0-5])?$/.test(key))
      replacement = escapeXml(profile.name);
    if (changeQuality && key === "pref_qjpg_key") replacement = String(profile.jpegQuality);
    start = parser.position;
  });
  parser.on("closetag", () => {
    if (depth-- !== 2 || replacement === undefined) return;
    const end = xml.lastIndexOf("</", parser.position - 1);
    if (end < start) throw new Error("Could not scope public photo option");
    patches.push({ start, end, replacement });
    replacement = undefined;
  });
  parser.write(xml).close();
  let next = xml;
  for (const patch of patches.reverse())
    next = next.slice(0, patch.start) + patch.replacement + next.slice(patch.end);
  return new TextEncoder().encode(next);
}

/** Build artifacts in memory; no device metadata, time or network participates in rendering. */
export function generate(
  profile: Profile,
  target: Target = "all",
): ReadonlyMap<string, string | Uint8Array> {
  const selected = parseProfile(profile);
  const files = new Map<string, string | Uint8Array>();
  if (target === "gcam" || target === "all") {
    const source = loadGcam(selected);
    const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
    files.set(gcamArtifactName, decoder.decode(fromOriginal(source, "sounds-off-geotag")));
  }
  if (target === "standalone" || target === "all") {
    files.set("Basile-AGC-Camera-profile.zip", nativeProfileZip(selected.name));
    files.set("Basile-AGC-Camera-photo-look.xmp", standaloneXmp(selected.name));
  }
  if (!files.size) throw new Error("Unknown adapter");
  files.set(
    "manifest.json",
    JSON.stringify(
      {
        schemaVersion: 4,
        releaseLayout: "photo-first-v1",
        configRevision,
        device: "Samsung Galaxy S23 Snapdragon (SM-S911B)",
        profile: selected,
        outputs: Array.from(files, ([file, bytes]) => ({
          file,
          sha256: createHash("sha256").update(bytes).digest("hex"),
          scope: file.endsWith(".agc")
            ? "AGC9.2 V14.0 privacy-reviewed camera preferences; capture candidate"
            : file.endsWith(".zip")
              ? "AGC Camera 1.8.6 native Profiles v4; neutral photo/portrait/night adjustments"
              : "Optional Adobe photo-look XMP; not accepted in AGC Camera Profiles",
          ...(file.endsWith(".zip")
            ? {
                importControl: "Adjustments → Profiles → Import; keep the ZIP intact",
                application:
                  "Back up current profiles. Applying replaces profile-managed adjustments, lens overrides, LUT selections and tunables. Video and launcher settings are not part of the format.",
              }
            : {}),
          ...(!file.endsWith(".agc")
            ? {
                launcherIcon: {
                  preferred: "old GCam",
                  application:
                    "manual in standalone AGC Camera (since 1.8.0); not controlled by either preset format",
                },
              }
            : {}),
          physicalDeviceVerified: false,
          ...(file.endsWith(".agc")
            ? {
                videoPolicy: "preserve-source",
                verification: "photo-first baseline; physical capture remains device-dependent",
              }
            : { videoHdrDefault: "not part of the standalone profile format" }),
        })),
      },
      null,
      2,
    ) + "\n",
  );
  return files;
}
