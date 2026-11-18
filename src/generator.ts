import { createHash } from "node:crypto";

import baseline from "../data/gcam-92-v14.json";
import { standaloneXmp } from "./standalone";

/** Options shared by the two output adapters. JPEG quality applies only to GCam. */
export interface Profile {
  name: string;
  jpegQuality: number;
  videoHdr: "prefer-where-supported";
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
  if (videoHdr !== "prefer-where-supported")
    throw new Error("Expected prefer-where-supported as videoHdr policy");
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

function renderGcam(profile: Profile) {
  const lines: [string, string][] = [];
  const seen = new Set<string>();
  function append(key: string, line: string) {
    if (!/^[a-zA-Z0-9_.]+$/.test(key) || seen.has(key))
      throw new Error("Invalid or duplicate preference: " + key);
    seen.add(key);
    lines.push([key, line]);
  }
  for (const [key, value] of Object.entries(baseline.string)) {
    let val = value;
    if (/^lib_profile_title_key(?:_p0_[0-5])?$/.test(key)) val = profile.name;
    if (key === "pref_qjpg_key") val = String(profile.jpegQuality);
    append(key, `  <string name="${key}">${escapeXml(val)}</string>`);
  }
  for (const [type, values] of [
    ["boolean", baseline.boolean],
    ["int", baseline.int],
  ] as const) {
    for (const [key, value] of Object.entries(values)) {
      if (!(type === "boolean" ? /^(true|false)$/ : /^-?\d+$/).test(value))
        throw new Error("Bad scalar: " + key);
      append(key, `  <${type} name="${key}" value="${value}" />`);
    }
  }
  for (const [key, members] of Object.entries(baseline.set)) {
    if (new Set(members).size !== members.length || !members.length)
      throw new Error("Invalid string set: " + key);
    append(
      key,
      `  <set name="${key}">\n${members.map((v) => `    <string>${escapeXml(v)}</string>`).join("\n")}\n  </set>`,
    );
  }
  lines.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return (
    '<?xml version="1.0" encoding="utf-8"?>\n<map>\n' +
    lines.map(([, line]) => line).join("\n") +
    "\n</map>\n"
  );
}

/** Build artifacts in memory; no device metadata, time or network participates in rendering. */
export function generate(profile: Profile, target: Target = "all"): ReadonlyMap<string, string> {
  const selected = parseProfile(profile);
  const files = new Map<string, string>();
  if (target === "gcam" || target === "all")
    files.set("Basile-S23-AGC9.2-V14.agc", renderGcam(selected));
  if (target === "standalone" || target === "all")
    files.set("Basile-AGC-Camera-photo-look.xmp", standaloneXmp(selected.name));
  if (!files.size) throw new Error("Unknown adapter");
  files.set(
    "manifest.json",
    JSON.stringify(
      {
        schemaVersion: 1,
        device: "Samsung Galaxy S23 Snapdragon (SM-S911B)",
        profile: selected,
        outputs: Array.from(files, ([file, bytes]) => ({
          file,
          sha256: createHash("sha256").update(bytes).digest("hex"),
          scope: file.endsWith(".agc")
            ? "AGC9.2 V14.0 curated camera preferences"
            : "AGC Camera 1.8.6 experimental photo-look subset",
          ...(file.endsWith(".xmp")
            ? {
                launcherIcon: {
                  preferred: "old GCam",
                  application:
                    "manual in standalone AGC Camera (since 1.8.0); not controlled by XMP",
                },
              }
            : {}),
          physicalDeviceVerified: false,
          videoHdrDefault:
            "not encoded: no verified HDR video preference or device mode combination",
        })),
      },
      null,
      2,
    ) + "\n",
  );
  return files;
}
