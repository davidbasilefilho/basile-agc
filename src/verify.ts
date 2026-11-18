import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { Effect } from "effect";
import { SaxesParser } from "saxes";

type Xml = {
  name: string;
  attrs: Record<string, string>;
  children: Xml[];
  text: string;
};

type Atomic = string | string[];
type Baseline = Record<string, Record<string, Atomic>>;
const names = ["Basile-S23-AGC9.2-V14.agc", "Basile-AGC-Camera-photo-look.xmp"] as const;
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

/** Independently parse published XML, roundtrip typed preferences and verify both SHA-256 digests. */
export function verifyArtifacts(root: string) {
  return Effect.gen(function* () {
    const [baseText, profileText, manifestText, agc, xmp] = yield* Effect.all(
      [
        file(join(root, "data/gcam-92-v14.json")),
        file(join(root, "data/profile.json")),
        file(join(root, "generated/manifest.json")),
        file(join(root, "generated", names[0])),
        file(join(root, "generated", names[1])),
      ],
      { concurrency: "unbounded" },
    );
    return yield* Effect.try({
      try: () => {
        const expected = JSON.parse(baseText) as Baseline;
        const profile = JSON.parse(profileText) as { name: string; jpegQuality: number };
        const report = JSON.parse(manifestText) as {
          profile: unknown;
          outputs: { file: string; sha256: string; physicalDeviceVerified: boolean }[];
        };
        check(isDeepStrictEqual(profile, report.profile), "Profile mismatch");
        check(Array.isArray(report.outputs) && report.outputs.length === 2, "Wrong output count");
        for (const [index, name] of names.entries()) {
          const item = report.outputs.find((r) => r.file === name);
          check(
            item && item.physicalDeviceVerified === false,
            "Unexpected device claim or missing output",
          );
          check(
            item.sha256 ===
              createHash("sha256")
                .update(index === 0 ? agc : xmp)
                .digest("hex"),
            "Artifact digest mismatch",
          );
        }
        const tree = xml(agc);
        check(tree.name === "map", "Bad AGC root");
        const seen = new Map<string, [string, Atomic]>();
        for (const n of tree.children) {
          const key = n.attrs.name;
          check(key && !seen.has(key), "Missing/duplicate AGC key");
          check(Object.hasOwn(expected, n.name), "Unsupported preference type");
          let value: Atomic;
          if (n.name === "set") {
            check(
              n.children.every(
                (c) => c.name === "string" && !c.children.length && !Object.keys(c.attrs).length,
              ),
              "Bad string set",
            );
            value = n.children.map((c) => c.text);
          } else {
            check(!n.children.length, "Nested scalar");
            value = n.name === "string" ? n.text : n.attrs.value!;
            check(typeof value === "string", "Scalar value missing");
          }
          seen.set(key, [n.name, value]);
        }
        const canonical = new Map<string, [string, Atomic]>();
        for (const [t, group] of Object.entries(expected))
          for (const [k, v] of Object.entries(group)) {
            check(!canonical.has(k), "Duplicate authoring key");
            canonical.set(k, [
              t,
              k.startsWith("lib_profile_title_key")
                ? profile.name
                : k === "pref_qjpg_key"
                  ? String(profile.jpegQuality)
                  : v,
            ]);
          }
        check(isDeepStrictEqual(canonical, seen), "Typed settings did not roundtrip");
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
        return seen.size;
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
            `Independent XML and digest checks passed: ${count} typed preferences and one photo XMP.`,
          ),
      }),
    ),
  );
}
