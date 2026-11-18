#!/usr/bin/env python3
"""Offline, metadata-minimizing video timestamp diagnostics using ffprobe.

Usage: python3 scripts/video_cadence.py /private/path/to/video.mp4
No filename, tags, location, device identifiers, audio, or raw probe output is
included in the report. This does not compare pixel content or measure EIS.
"""

import argparse
from fractions import Fraction
import json
import math
from pathlib import Path
import statistics
import subprocess
import sys


def _number(value):
    try:
        result = float(value)
        return result if math.isfinite(result) else None
    except (TypeError, ValueError, OverflowError):
        return None


def _rate(value):
    try:
        result = float(Fraction(str(value)))
        return result if math.isfinite(result) and result > 0 else None
    except (ValueError, ZeroDivisionError, OverflowError):
        return None


def summarize(probe):
    """Summarize allowed video fields and presentation timestamps without tags."""
    streams = probe.get("streams", [])
    if not streams:
        raise ValueError("No video stream found.")
    stream = streams[0]
    frames = probe.get("frames", [])
    timestamps = []
    for frame in frames:
        timestamp = _number(frame.get("best_effort_timestamp_time"))
        if timestamp is None:
            timestamp = _number(frame.get("pts_time"))
        if timestamp is not None:
            timestamps.append(timestamp)
    deltas = [b - a for a, b in zip(timestamps, timestamps[1:])]
    positive = [delta for delta in deltas if delta > 0]
    median = statistics.median(positive) if positive else None
    monotonic = all(delta > 0 for delta in deltas)
    span = timestamps[-1] - timestamps[0] if len(timestamps) > 1 else None
    observed = (len(timestamps) - 1) / span if span and monotonic else None
    transfer = stream.get("color_transfer")
    hdr_signal = {
        "smpte2084": "PQ transfer signaled; HDR pixels not independently verified",
        "arib-std-b67": "HLG transfer signaled; HDR pixels not independently verified",
    }.get(transfer, "HDR transfer not established by this stream signaling")
    allowed = (
        "codec_name", "profile", "width", "height", "pix_fmt",
        "bits_per_raw_sample", "color_range", "color_space",
        "color_transfer", "color_primaries",
    )
    return {
        "schema_version": 1,
        "video": {key: stream[key] for key in allowed if key in stream},
        "nominal_fps": _rate(stream.get("r_frame_rate")),
        "container_average_fps": _rate(stream.get("avg_frame_rate")),
        "decoded_frame_count": len(frames),
        "timestamped_frame_count": len(timestamps),
        "missing_timestamp_count": len(frames) - len(timestamps),
        "observed_presentation_fps": observed,
        "presentation_span_seconds": span,
        "median_positive_interval_ms": median * 1000 if median else None,
        "p95_positive_interval_ms": sorted(positive)[math.ceil(0.95 * len(positive)) - 1] * 1000 if positive else None,
        "maximum_positive_interval_ms": max(positive) * 1000 if positive else None,
        "zero_timestamp_intervals": sum(delta == 0 for delta in deltas),
        "backwards_timestamp_intervals": sum(delta < 0 for delta in deltas),
        "gaps_over_1_5x_median": sum(delta > median * 1.5 for delta in positive) if median else None,
        "hdr_signaling": hdr_signal,
        "limitations": [
            "Timestamps describe presentation cadence, not sensor capture cadence.",
            "Nominal and container average FPS are declarations, not proof of unique captured frames.",
            "Repeated image content with regular timestamps is not detected; zero intervals are timestamp duplicates, not proof of repeated pixels.",
            "Gaps relative to median are diagnostic only; variable frame rate can be intentional.",
            "Observed FPS uses (timestamped frames minus one)/presentation span, excludes final frame duration, and is withheld for non-increasing timestamps.",
            "HDR transfer signaling is not proof of valid HDR pixels, dynamic metadata, or display rendering; unspecified signaling does not prove SDR.",
            "Stabilization quality, exposure blur, rolling shutter and perceived judder require visual comparison.",
        ],
    }


def inspect_video(path):
    """Run local ffprobe without forwarding filenames, tags, or diagnostics."""
    local_path = Path(path).expanduser().resolve()
    if not local_path.is_file():
        raise ValueError("Input must be an existing local file.")
    # A resolved absolute filename cannot be mistaken for an option or URL.
    # Restrict protocols so playlist-like inputs cannot trigger network access.
    command = [
        "ffprobe", "-v", "error", "-protocol_whitelist", "file,crypto,data",
        "-select_streams", "v:0", "-show_frames", "-show_streams",
        "-show_entries",
        "stream=codec_name,profile,width,height,pix_fmt,bits_per_raw_sample,color_range,color_space,color_transfer,color_primaries,r_frame_rate,avg_frame_rate:frame=best_effort_timestamp_time,pts_time",
        "-of", "json", str(local_path),
    ]
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=300, check=False)
    except FileNotFoundError:
        raise ValueError("ffprobe is not installed.") from None
    except subprocess.TimeoutExpired:
        raise ValueError("Local analysis exceeded five minutes; use a shorter clip.") from None
    if result.returncode:
        raise ValueError("ffprobe could not analyze the local video; raw diagnostics withheld for privacy.")
    try:
        probe = json.loads(result.stdout)
    except json.JSONDecodeError:
        raise ValueError("ffprobe returned invalid JSON.") from None
    return summarize(probe)


def main():
    """Print a metadata-minimized report, or a filename-free error."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("video", help="Local clip, analyzed offline; never uploaded")
    args = parser.parse_args()
    try:
        print(json.dumps(inspect_video(args.video), indent=2, allow_nan=False))
    except (ValueError, OSError):
        # Even OS errors may contain an input path. Do not echo exceptions.
        print("Video analysis failed. Check local input, ffprobe installation and clip length.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
