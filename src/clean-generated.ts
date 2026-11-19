import { lstat, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { Effect } from "effect";

const root = fileURLToPath(new URL("../generated/", import.meta.url));
const active = "Basile-S23-AGC9.2-V14-r16.agc";

/** Identify only obsolete generator-owned GCam filenames, never arbitrary output files. */
export function isObsoleteArtifact(name: string): boolean {
  return name !== active && /^Basile-S23-AGC9\.2-V14(?:-FHD60-SDR|-r[0-9]+)?\.agc$/.test(name);
}

/** Clean only regular obsolete files in this checkout's generated directory. */
export function cleanGenerated() {
  return Effect.tryPromise({
    try: async () => {
      for (const name of await readdir(root)) {
        if (!isObsoleteArtifact(name)) continue;
        const path = join(root, name);
        if (!(await lstat(path)).isFile())
          throw new Error("Refusing non-regular obsolete artifact");
        await unlink(path);
      }
    },
    catch: (error) => (error instanceof Error ? error : new Error("Artifact cleanup failed")),
  });
}
if (import.meta.main) await Effect.runPromise(cleanGenerated());
