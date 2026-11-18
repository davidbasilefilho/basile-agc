import { Effect } from "effect";

import { inspectVideo } from "./cadence";

const args = process.argv.slice(2);
if (args.length !== 1 || args[0] === "--help") {
  console.log("Usage: bun src/video/cli.ts <local-video-file>");
  console.log(
    "Offline ffprobe cadence/HDR-signaling report. No media uploaded; filenames and tags omitted.",
  );
  process.exitCode = args[0] === "--help" ? 0 : 1;
} else {
  await Effect.runPromise(
    inspectVideo(args[0]!).pipe(
      Effect.match({
        onFailure: (error) => {
          console.error(error.message);
          process.exitCode = 1;
        },
        onSuccess: (report) => console.log(JSON.stringify(report, null, 2)),
      }),
    ),
  );
}
