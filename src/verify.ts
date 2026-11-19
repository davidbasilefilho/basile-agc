import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { Effect } from "effect";
import { unzipSync, strFromU8 } from "fflate";
import { SaxesParser } from "saxes";

type Xml = {
  name: string;
  attrs: Record<string, string>;
  children: Xml[];
  text: string;
};

type Atomic = string | string[];
type Preferences = Map<string, [string, Atomic]>;
const names = [
  "Basile-S23-AGC9.2-V14.agc",
  "Basile-AGC-Camera-photo-look.xmp",
  "Basile-AGC-Camera-profile.zip",
] as const;
const rdf = "{http://www.w3.org/1999/02/22-rdf-syntax-ns#}";
const crs = "{http://ns.adobe.com/camera-raw-settings/1.0/}";
const xmpNs = "{adobe:ns:meta/}";

function check(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}

function xml(input: string) {
  const stack: Xml[] = [];
  let root: Xml | undefined;
  const parser = new SaxesParser({ xmlns: true });
  const q = (uri: string, local: string) => (uri ? `{${uri}}${local}` : local);
  parser.on("doctype", () => {
    throw new Error("DOCTYPE not permitted");
  });
  parser.on("opentag", (tag) => {
    const current: Xml = {
      name: q(tag.uri, tag.local),
      attrs: Object.fromEntries(
        Object.values(tag.attributes).map((attr) => [q(attr.uri, attr.local), attr.value]),
      ),
      children: [],
      text: "",
    };
    if (stack.length) stack.at(-1)!.children.push(current);
    else {
      check(!root, "Multiple roots");
      root = current;
    }
    stack.push(current);
  });
  const text = (s: string) => {
    if (stack.length) stack.at(-1)!.text += s;
  };
  parser.on("text", text);
  parser.on("cdata", text);
  parser.on("closetag", () => {
    stack.pop();
  });
  parser.write(input).close();
  check(root, "Missing XML root");
  return root;
}

function file(path: string) {
  return Effect.tryPromise({
    try: () => readFile(path, "utf8"),
    catch: () => new Error("Unable to read verification input: " + path),
  });
}

function toError(error: unknown) {
  return error instanceof Error ? error : new Error("Artifact check failed");
}

function parsePreferences(input: string) {
  const tree = xml(input);
  check(
    tree.name === "map" && !Object.keys(tree.attrs).length && !tree.text.trim(),
    "Bad AGC root",
  );
  const seen = new Map<string, [string, Atomic]>();
  for (const n of tree.children) {
    const key = n.attrs.name;
    check(key && !seen.has(key), "Missing/duplicate AGC key");
    let value: Atomic;
    if (n.name === "set") {
      check(Object.keys(n.attrs).length === 1 && !n.text.trim(), "Bad set attributes");
      check(
        n.children.every(
          (c) => c.name === "string" && !c.children.length && !Object.keys(c.attrs).length,
        ),
        "Bad string set",
      );
      value = n.children.map((c) => c.text);
    } else {
      check(!n.children.length, "Nested scalar");
      if (n.name === "string") {
        check(Object.keys(n.attrs).length === 1, "Bad string attributes");
        value = n.text;
      } else {
        const scalar = n.attrs.value;
        check(
          ["boolean", "int", "long", "float"].includes(n.name) &&
            Object.keys(n.attrs).length === 2 &&
            typeof scalar === "string" &&
            !n.text.trim(),
          "Bad typed scalar",
        );
        value = scalar;
      }
    }
    seen.set(key, [n.name, value]);
  }
  return seen;
}

function verifyPreferences(
  input: string,
  baseline: Preferences,
  profile: { name: string; jpegQuality: number },
) {
  const seen = parsePreferences(input);
  const canonical: Preferences = new Map();
  for (const [key, [type, value]] of baseline) {
    const photoOverride =
      profile.name !== "Basile" && /^lib_profile_title_key(?:_p0_[0-5])?$/.test(key)
        ? profile.name
        : profile.jpegQuality !== 97 && key === "pref_qjpg_key"
          ? String(profile.jpegQuality)
          : value;
    canonical.set(key, [type, photoOverride]);
  }
  for (const [key, value] of [
    ["pref_camera_sounds_key", "0"],
    ["pref_camera_single_shot_sound_key", "0"],
  ] as const)
    canonical.set(key, ["string", value]);
  check(isDeepStrictEqual([...canonical], [...seen]), "Typed settings or order did not roundtrip");
  return seen.size;
}

/** Independently parse the preference map and standalone profiles and verify all asset digests. */
export function verifyArtifacts(root: string) {
  return Effect.gen(function* () {
    const [baseText, profileText, manifestText, agc, xmp, archive] = yield* Effect.all(
      [
        file(join(root, "data/gcam-92-v14.xml")),
        file(join(root, "data/profile.json")),
        file(join(root, "generated/manifest.json")),
        file(join(root, "generated", names[0])),
        file(join(root, "generated", names[1])),
        Effect.tryPromise({
          try: () => readFile(join(root, "generated", names[2])),
          catch: toError,
        }),
      ],
      { concurrency: "unbounded" },
    );
    return yield* Effect.try({
      try: () => {
        const expected = parsePreferences(baseText);
        const profile = JSON.parse(profileText) as { name: string; jpegQuality: number };
        const report = JSON.parse(manifestText) as {
          schemaVersion: unknown;
          releaseLayout: unknown;
          profile: unknown;
          outputs: {
            file: string;
            sha256: string;
            physicalDeviceVerified: boolean;
            videoRequest?: unknown;
            videoPolicy?: unknown;
          }[];
        };
        check(
          report.schemaVersion === 4 &&
            report.releaseLayout === "photo-first-v1" &&
            isDeepStrictEqual(profile, report.profile),
          "Manifest profile/schema mismatch",
        );
        check(
          Array.isArray(report.outputs) && report.outputs.length === names.length,
          "Wrong output count",
        );
        const entries = [agc, xmp, archive] as const;
        for (const [index, name] of names.entries()) {
          const item = report.outputs.find((r) => r.file === name);
          const bytes = entries[index];
          check(
            item && item.physicalDeviceVerified === false && bytes !== undefined,
            "Unexpected device claim or missing output",
          );
          check(
            item.videoRequest === undefined &&
              item.videoPolicy === (index === 0 ? "preserve-source" : undefined),
            "Video policy mismatch",
          );
          check(
            item.sha256 === createHash("sha256").update(bytes).digest("hex"),
            "Artifact digest mismatch",
          );
        }
        const preferenceCount = verifyPreferences(agc, expected, profile);
        const preset = xml(xmp);
        check(preset.name === xmpNs + "xmpmeta", "Bad XMP root");
        const descend = (node: Xml | undefined, key: string) =>
          node?.children.find((n) => n.name === key);
        const description = descend(descend(preset, rdf + "RDF"), rdf + "Description");
        check(description?.attrs[crs + "WhiteBalance"] === "As Shot", "Unexpected white balance");
        check(
          descend(descend(descend(description, crs + "Name"), rdf + "Alt"), rdf + "li")?.text ===
            profile.name,
          "Wrong preset name",
        );
        check(archive.byteLength < 64 * 1024, "Unexpected native profile archive size");
        let members = 0;
        const unpacked = unzipSync(archive, {
          filter(entry) {
            members++;
            check(
              entry.name === "Basile.json" &&
                members === 1 &&
                entry.originalSize > 0 &&
                entry.originalSize < 64 * 1024,
              "Unrecognized native ZIP member",
            );
            return true;
          },
        });
        const member = unpacked["Basile.json"];
        check(members === 1 && member, "Missing native profile");
        const offsets = {
          pref_saturation_key: 0,
          pref_contrast_strength_key: 0,
          pref_denoise_strength_key: 0,
          pref_exposure_ev_key: 0,
          pref_shadows_key: 0,
          pref_sharpen_strength_key: 0,
        };
        const mode = (photo = false) => ({
          global: photo ? { ...offsets, pref_hdr_mode_key: 1 } : offsets,
          per_lens: {},
          tunable_settings: { global: {}, per_lens: {} },
        });
        check(
          isDeepStrictEqual(JSON.parse(strFromU8(member)) as unknown, {
            format: "GCamAGC-profile",
            _version: 4,
            _name: profile.name,
            photo: mode(true),
            portrait: mode(),
            night: mode(),
          }),
          "Unexpected native profile settings",
        );
        return preferenceCount;
      },
      catch: toError,
    });
  });
}

if (import.meta.main) {
  await Effect.runPromise(
    verifyArtifacts(resolve(import.meta.dir, "..")).pipe(
      Effect.match({
        onFailure: (error) => {
          console.error(error.message);
          process.exitCode = 1;
        },
        onSuccess: (count) =>
          console.log(
            `Independent XML and digest checks passed: ${count} typed preferences in the photo-first config plus photo XMP and native v4 profile ZIP.`,
          ),
      }),
    ),
  );
}
