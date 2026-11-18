import { describe, expect, test } from "bun:test";

import { Effect, Result } from "effect";

import { inspectVideo, summarizeVideo } from "../src/video/cadence";

function fixture(timestamps: unknown[], stream: Record<string, unknown> = {}) {
  return {
    streams: [{ r_frame_rate: "60/1", avg_frame_rate: "60/1", ...stream }],
    frames: timestamps.map((timestamp) => ({ best_effort_timestamp_time: String(timestamp) })),
  };
}

describe("offline video diagnostics", () => {
  test("regular sixty fps", () => {
    const report = Effect.runSync(
      summarizeVideo(fixture(Array.from({ length: 120 }, (_, i) => i / 60))),
    );
    expect(report.observedPresentationFps).toBeCloseTo(60);
    expect(report.gapsOverOnePointFiveMedian).toBe(0);
  });
  test("gaps differ from nominal rate", () => {
    const report = Effect.runSync(summarizeVideo(fixture([0, 0.02, 0.04, 0.08, 0.1])));
    expect(report.gapsOverOnePointFiveMedian).toBe(1);
    expect(report.observedPresentationFps).toBeCloseTo(40);
    expect(report.nominalFps).toBe(60);
  });
  test("non-increasing timing is not proof of duplicate pixels", () => {
    const report = Effect.runSync(summarizeVideo(fixture([0, 0.02, 0.02, 0.01])));
    expect(report.zeroTimestampIntervals).toBe(1);
    expect(report.backwardsTimestampIntervals).toBe(1);
    expect(report.observedPresentationFps).toBeNull();
  });
  test("invalid and missing timestamps", () => {
    const report = Effect.runSync(summarizeVideo(fixture(["N/A", "NaN", "Infinity", "", 1])));
    expect(report.missingTimestampCount).toBe(4);
    expect(report.observedPresentationFps).toBeNull();
  });
  test("PTS fallback", () => {
    const report = Effect.runSync(
      summarizeVideo({ streams: [{}], frames: [{ pts_time: "0" }, { pts_time: "0.5" }] }),
    );
    expect(report.observedPresentationFps).toBe(2);
  });
  test("malformed rates and single-frame input", () => {
    const report = Effect.runSync(
      summarizeVideo(fixture([0], { r_frame_rate: "0/0", avg_frame_rate: "N/A" })),
    );
    expect(report.nominalFps).toBeNull();
    expect(report.containerAverageFps).toBeNull();
    expect(report.observedPresentationFps).toBeNull();
  });
  test("HDR signaling is explicitly limited", () => {
    for (const [transfer, expected] of [
      ["smpte2084", "PQ"],
      ["arib-std-b67", "HLG"],
      ["bt709", "not established"],
    ]) {
      expect(
        Effect.runSync(summarizeVideo(fixture([], { color_transfer: transfer }))).hdrSignaling,
      ).toContain(expected!);
    }
  });
  test("private fields and absolute timestamps omitted", () => {
    const probe = {
      ...fixture([100000, 100001], { tags: { location: "PRIVATE-GPS" }, filename: "PRIVATE-PATH" }),
      format: { tags: { creation_time: "PRIVATE-TIME" } },
    };
    const serialized = JSON.stringify(Effect.runSync(summarizeVideo(probe)));
    expect(serialized).not.toContain("PRIVATE");
    expect(serialized).not.toContain("100000");
  });
  test("no video is a typed failure", () => {
    const result = Effect.runSync(Effect.result(summarizeVideo({ streams: [] })));
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) expect(result.failure._tag).toBe("VideoDiagnosticError");
  });
  test("file errors never leak filename", async () => {
    const result = await Effect.runPromise(
      Effect.result(inspectVideo("/tmp/PRIVATE-NONEXISTENT-AGC-VIDEO.mp4")),
    );
    expect(Result.isFailure(result)).toBe(true);
    expect(JSON.stringify(result)).not.toContain("PRIVATE");
  });
});
