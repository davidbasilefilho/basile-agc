import { expect, test } from "bun:test";

import { isObsoleteArtifact } from "../src/clean-generated";

test("cleanup only selects known obsolete artifact names", () => {
  for (const name of [
    "Basile-S23-AGC9.2-V14.agc",
    "Basile-S23-AGC9.2-V14-FHD60-SDR.agc",
    "Basile-S23-AGC9.2-V14-r15.agc",
    "Basile-S23-AGC9.2-V14-r16.agc",
  ])
    expect(isObsoleteArtifact(name)).toBe(true);
  for (const name of [
    "Basile-S23-AGC9.2-V14-r17.agc",
    "../Basile-S23-AGC9.2-V14-r15.agc",
    "personal.agc",
    "Basile-AGC-Camera-profile.zip",
    "manifest.json",
  ])
    expect(isObsoleteArtifact(name)).toBe(false);
});
