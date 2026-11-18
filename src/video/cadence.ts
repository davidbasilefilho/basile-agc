import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";

import { Data, Effect } from "effect";

/** A privacy-safe diagnostic failure, without paths or raw probe output. */
export class VideoDiagnosticError extends Data.TaggedError("VideoDiagnosticError")<{
  readonly message: string;
}> {}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function number(value: unknown): number | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  if (typeof value === "string" && value.trim() === "") return undefined;
  const result = Number(value);
  return Number.isFinite(result) ? result : undefined;
}

function rate(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const parts = value.split("/");
  if (parts.length > 2) return null;
  const numerator = number(parts[0]);
  const denominator = parts.length === 1 ? 1 : number(parts[1]);
  if (numerator === undefined || denominator === undefined || denominator === 0) return null;
  const result = numerator / denominator;
  return Number.isFinite(result) && result > 0 ? result : null;
}

function summarize(raw: unknown) {
  const probe = record(raw);
  const streams = Array.isArray(probe.streams) ? probe.streams : [];
  if (streams.length === 0) throw new Error("No video stream found");
  const stream = record(streams[0]);
  const frames: unknown[] = Array.isArray(probe.frames) ? probe.frames : [];
  const timestamps = frames.flatMap((rawFrame) => {
    const frame = record(rawFrame);
    const timestamp = number(frame.best_effort_timestamp_time) ?? number(frame.pts_time);
    return timestamp === undefined ? [] : [timestamp];
  });
  const deltas = timestamps.slice(1).map((timestamp, index) => timestamp - timestamps[index]!);
  const positive = deltas.filter((delta) => delta > 0).sort((a, b) => a - b);
  const middle = Math.floor(positive.length / 2);
  const median =
    positive.length === 0
      ? null
      : positive.length % 2 === 1
        ? positive[middle]!
        : (positive[middle - 1]! + positive[middle]!) / 2;
  const span = timestamps.length > 1 ? timestamps.at(-1)! - timestamps[0]! : null;
  const observed =
    span && deltas.every((delta) => delta > 0) ? (timestamps.length - 1) / span : null;
  const transfer = stream.color_transfer;
  const hdrSignaling =
    transfer === "smpte2084"
      ? "PQ transfer signaled; HDR pixels not independently verified"
      : transfer === "arib-std-b67"
        ? "HLG transfer signaled; HDR pixels not independently verified"
        : "HDR transfer not established by this stream signaling";
  const video: Record<string, string | number> = {};
  for (const key of [
    "codec_name",
    "profile",
    "width",
    "height",
    "pix_fmt",
    "bits_per_raw_sample",
    "color_range",
    "color_space",
    "color_transfer",
    "color_primaries",
  ]) {
    const value = stream[key];
    if (typeof value === "string" || (typeof value === "number" && Number.isFinite(value)))
      video[key] = value;
  }
  return {
    schemaVersion: 1,
    video,
    nominalFps: rate(stream.r_frame_rate),
    containerAverageFps: rate(stream.avg_frame_rate),
    decodedFrameCount: frames.length,
    timestampedFrameCount: timestamps.length,
    missingTimestampCount: frames.length - timestamps.length,
    observedPresentationFps: observed,
    presentationSpanSeconds: span,
    medianPositiveIntervalMs: median === null ? null : median * 1000,
    maximumPositiveIntervalMs: positive.length ? positive.at(-1)! * 1000 : null,
    zeroTimestampIntervals: deltas.filter((delta) => delta === 0).length,
    backwardsTimestampIntervals: deltas.filter((delta) => delta < 0).length,
    gapsOverOnePointFiveMedian:
      median === null ? null : positive.filter((delta) => delta > median * 1.5).length,
    hdrSignaling,
    limitations: [
      "Timestamps describe presentation cadence, not sensor capture cadence.",
      "Nominal and container average FPS are declarations, not proof of unique captured frames.",
      "Repeated image content with regular timestamps is not detected; zero intervals are timestamp duplicates, not proof of repeated pixels.",
      "Gaps relative to median are diagnostic only; variable frame rate can be intentional.",
      "Observed FPS uses (timestamped frames minus one)/presentation span, excludes final frame duration, and is withheld for non-increasing timestamps.",
      "HDR signaling is not proof of valid HDR pixels, dynamic metadata, or display rendering; unspecified signaling does not prove SDR.",
      "Stabilization, exposure blur, rolling shutter and perceived judder require visual comparison.",
    ],
  };
}

/** Summarize allowlisted technical fields and relative presentation timing. */
export const summarizeVideo = (probe: unknown) =>
  Effect.try({
    try: () => summarize(probe),
    catch: () => new VideoDiagnosticError({ message: "Invalid probe data or no video stream." }),
  });

/** Analyze a local clip without network protocols, raw tags or paths in output. */
export const inspectVideo = (path: string) =>
  Effect.gen(function* () {
    const localPath = resolve(path);
    const file = yield* Effect.tryPromise({
      try: () => stat(localPath),
      catch: () => new VideoDiagnosticError({ message: "Input must be an existing local file." }),
    });
    if (!file.isFile())
      return yield* Effect.fail(
        new VideoDiagnosticError({ message: "Input must be an existing local file." }),
      );
    const output = yield* Effect.tryPromise({
      try: (signal) =>
        new Promise<string>((accept, reject) => {
          execFile(
            "ffprobe",
            [
              "-v",
              "error",
              "-protocol_whitelist",
              "file",
              "-select_streams",
              "v:0",
              "-show_frames",
              "-show_streams",
              "-show_entries",
              "stream=codec_name,profile,width,height,pix_fmt,bits_per_raw_sample,color_range,color_space,color_transfer,color_primaries,r_frame_rate,avg_frame_rate:frame=best_effort_timestamp_time,pts_time",
              "-of",
              "json",
              localPath,
            ],
            { signal, timeout: 300_000, maxBuffer: 32 * 1024 * 1024, encoding: "utf8" },
            (error, stdout) => {
              if (error) reject(new Error("Probe failure"));
              else accept(stdout);
            },
          );
        }),
      catch: () =>
        new VideoDiagnosticError({
          message: "Local ffprobe analysis failed. Check installation, clip length and format.",
        }),
    });
    const probe: unknown = yield* Effect.try({
      try: (): unknown => JSON.parse(output),
      catch: () => new VideoDiagnosticError({ message: "ffprobe returned invalid JSON." }),
    });
    return yield* summarizeVideo(probe);
  });
