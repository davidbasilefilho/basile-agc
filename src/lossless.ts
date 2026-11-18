import { lstat, open, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import { Effect } from "effect";
import { SaxesParser } from "saxes";

type Edit = { value: string; allowed: readonly string[]; missing?: "insert" };
const toggle = ["0", "1"];
const soundEdits: ReadonlyMap<string, Edit> = new Map([
  ["pref_camera_sounds_key", { value: "0", allowed: toggle }],
  ["pref_camera_single_shot_sound_key", { value: "0", allowed: toggle }],
]);
function editsFor(overlay: OriginalOverlay) {
  if (overlay === "none") return new Map<string, Edit>();
  const edits = new Map(soundEdits);
  if (overlay === "sounds-off") return edits;
  if (overlay !== "video-hdr30" && overlay !== "video-sdr60") fail();
  // The HDR setting is a string-backed normal-video control; the V14
  // default is off. Write the selection explicitly for both candidates so
  // applying one after the other cannot retain the preceding HDR selection.
  const hdr = overlay === "video-hdr30";
  edits.set("pref_video_amethyst_key", {
    value: hdr ? "1" : "0",
    allowed: toggle,
    missing: "insert",
  });
  edits.set("pref_video_resolution", {
    value: "RES_1080P",
    allowed: ["RES_1080P", "RES_2160P", "RES_4320P"],
  });
  const requested = hdr ? "FPS_30" : "FPS_60";
  const rates = ["FPS_AUTO", "FPS_24", "FPS_30", "FPS_60"];
  // V14 chooses the normal video FPS accessor at runtime. Do not change
  // the distinct 4K, Video Boost or Cinematic preferences or any capabilities.
  edits.set("pref_video_fps_p2018_key", { value: requested, allowed: rates });
  edits.set("pref_video_fps_key", { value: requested, allowed: rates, missing: "insert" });
  return edits;
}
const maxBytes = 8 * 1024 * 1024;
const name = "Basile-S23-AGC9.2-V14.agc";

/** Private recovery options: preserve the original or request only the named sound and video settings. */
export type OriginalOverlay = "none" | "sounds-off" | "video-hdr30" | "video-sdr60";

function fail(): never {
  throw new Error("Unsupported, ambiguous, or invalid Android preference map; no output written.");
}

/** Validate the original XML without serializing it; splice only the explicitly selected, allowlisted preference changes. */
export function fromOriginal(bytes: Uint8Array, overlay: OriginalOverlay = "none"): Uint8Array {
  if (!bytes.length || bytes.length > maxBytes) fail();
  const edits = editsFor(overlay);
  const video = overlay === "video-hdr30" || overlay === "video-sdr60";
  const build = new Map<string, string>();
  let mapEnd = -1;
  const source = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  const parser = new SaxesParser();
  const seen = new Set<string>();
  const patches: { start: number; end: number; value: string }[] = [];
  let depth = 0,
    kind = "",
    key = "",
    start = 0,
    text = "",
    roots = 0;
  parser.on("error", fail);
  parser.on("doctype", fail);
  parser.on("xmldecl", (d) => {
    if (d.encoding && !/^utf-8$/i.test(d.encoding)) fail();
  });
  parser.on("opentag", (t) => {
    depth++;
    const attrs = Object.keys(t.attributes);
    if (depth === 1) {
      if (++roots !== 1 || t.name !== "map" || attrs.length) fail();
    } else if (depth === 2) {
      kind = t.name;
      key = t.attributes.name ?? "";
      if (!key || seen.has(key)) fail();
      seen.add(key);
      const scalar = ["boolean", "int", "long", "float"].includes(kind);
      if (
        scalar
          ? attrs.length !== 2 || !attrs.includes("value")
          : !["string", "set"].includes(kind) || attrs.length !== 1
      )
        fail();
      if (edits.has(key) && (kind !== "string" || t.isSelfClosing)) fail();
      start = parser.position;
      text = "";
    } else if (depth !== 3 || kind !== "set" || t.name !== "string" || attrs.length) fail();
  });
  const content = (value: string) => {
    if (depth === 2 && kind === "string") text += value;
    else if (!(depth === 3 && kind === "set") && value.trim()) fail();
  };
  parser.on("text", content);
  parser.on("cdata", content);
  parser.on("closetag", () => {
    if (
      depth === 2 &&
      kind === "string" &&
      video &&
      (key === "info_version_key" || key === "info_model_key")
    )
      build.set(key, text);
    const edit = depth === 2 ? edits.get(key) : undefined;
    if (edit) {
      if (!edit.allowed.includes(text)) fail();
      if (text !== edit.value) {
        const end = source.lastIndexOf("</", parser.position - 1);
        if (source.slice(start, end) !== text) fail();
        patches.push({ start, end, value: edit.value });
      }
    }
    if (depth === 1) mapEnd = source.lastIndexOf("</", parser.position - 1);
    depth--;
  });
  parser.write(source).close();
  if (roots !== 1 || !seen.size || mapEnd < 0) fail();
  if (
    video &&
    (build.get("info_model_key") !== "SM-S911B" ||
      !/^AGC9\.2 V14\.0 \(e23c52c7\)(?: |$)/.test(build.get("info_version_key") ?? ""))
  )
    fail();
  const additions: string[] = [];
  for (const [k, edit] of edits) {
    if (seen.has(k)) continue;
    if (!edit.missing) fail();
    if (edit.missing === "insert")
      additions.push('<string name="' + k + '">' + edit.value + "</string>");
  }
  if (additions.length) {
    const nl = source.includes("\r\n") ? "\r\n" : "\n";
    patches.push({
      start: mapEnd,
      end: mapEnd,
      value: additions.map((line) => "    " + line + nl).join(""),
    });
  }
  if (!patches.length) return bytes;
  let result = source;
  for (const { start, end, value } of patches.reverse())
    result = result.slice(0, start) + value + result.slice(end);
  return new TextEncoder().encode(result);
}

async function boundedFile(path: string) {
  if (!(await lstat(path)).isFile()) throw new Error("Expected a regular file.");
  const handle = await open(path, "r");
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size < 1 || metadata.size > maxBytes) fail();
    const contents = Buffer.alloc(metadata.size);
    let offset = 0;
    while (offset < contents.length) {
      const { bytesRead } = await handle.read(contents, offset, contents.length - offset, offset);
      if (bytesRead === 0) fail();
      offset += bytesRead;
    }
    if ((await handle.stat()).size !== contents.length) fail();
    return contents;
  } finally {
    await handle.close();
  }
}

/** Run the private-source path: never overwrite or emit personal preferences into the public checkout. */
export function useOriginal(
  command: "generate" | "validate",
  source: string,
  out: string,
  overlay: OriginalOverlay,
) {
  return Effect.tryPromise({
    try: async () => {
      const root = await realpath(resolve(import.meta.dir, ".."));
      const dir = await realpath(out);
      const away = relative(root, dir);
      if (
        !(away === ".." || away.startsWith(".." + sep) || isAbsolute(away)) ||
        !(await stat(dir)).isDirectory()
      )
        throw new Error("Choose an existing private output directory outside the checkout.");
      const destName =
        overlay === "video-hdr30"
          ? name.replace(".agc", "-FHD30-HDR-candidate.agc")
          : overlay === "video-sdr60"
            ? name.replace(".agc", "-FHD60-SDR-candidate.agc")
            : name;
      const destination = join(dir, destName);
      if ((await realpath(source)) === destination)
        throw new Error("Never overwrite or validate the input against itself.");
      const original = await boundedFile(source);
      const candidate = fromOriginal(original, overlay);
      if (command === "generate") {
        const handle = await open(destination, "wx", 0o600);
        try {
          await handle.writeFile(candidate);
        } finally {
          await handle.close();
        }
      } else if (!Buffer.from(candidate).equals(await boundedFile(destination))) {
        throw new Error("Output does not match the original plus the authorized overlay.");
      }
      return { identical: Buffer.from(candidate).equals(original) };
    },
    catch: () =>
      new Error(
        "Private original processing failed. Check the XML, explicit overlay, and a distinct existing output directory outside the checkout; generation never overwrites a file.",
      ),
  });
}
