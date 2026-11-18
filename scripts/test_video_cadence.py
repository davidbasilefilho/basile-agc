"""Run with: python3 -m unittest discover -s scripts -p 'test_*.py'."""

import json
import unittest

from video_cadence import summarize


def fixture(timestamps, **stream):
    return {
        "streams": [{"r_frame_rate": "60/1", "avg_frame_rate": "60/1", **stream}],
        "frames": [{"best_effort_timestamp_time": str(timestamp)} for timestamp in timestamps],
    }


class CadenceTests(unittest.TestCase):
    def test_regular_sixty(self):
        report = summarize(fixture([n / 60 for n in range(120)]))
        self.assertAlmostEqual(report["observed_presentation_fps"], 60)
        self.assertEqual(report["gaps_over_1_5x_median"], 0)
        self.assertAlmostEqual(report["p95_positive_interval_ms"], 1000 / 60)

    def test_gap_and_nominal_difference(self):
        report = summarize(fixture([0, 0.02, 0.04, 0.08, 0.10]))
        self.assertEqual(report["gaps_over_1_5x_median"], 1)
        self.assertAlmostEqual(report["observed_presentation_fps"], 40)
        self.assertEqual(report["nominal_fps"], 60)

    def test_non_increasing_is_not_content_duplicate_claim(self):
        report = summarize(fixture([0, 0.02, 0.02, 0.01]))
        self.assertEqual(report["zero_timestamp_intervals"], 1)
        self.assertEqual(report["backwards_timestamp_intervals"], 1)
        self.assertIsNone(report["observed_presentation_fps"])

    def test_missing_and_invalid_timestamps(self):
        report = summarize(fixture(["N/A", "nan", "inf", 1]))
        self.assertEqual(report["missing_timestamp_count"], 3)
        self.assertIsNone(report["observed_presentation_fps"])
        self.assertIsNone(report["median_positive_interval_ms"])
        json.dumps(report, allow_nan=False)

    def test_pts_fallback(self):
        report = summarize({"streams": [{}], "frames": [{"pts_time": "0"}, {"pts_time": "0.5"}]})
        self.assertEqual(report["observed_presentation_fps"], 2)

    def test_rate_edge_cases_and_single_frame(self):
        report = summarize(fixture([0], r_frame_rate="0/0", avg_frame_rate="N/A"))
        self.assertIsNone(report["nominal_fps"])
        self.assertIsNone(report["container_average_fps"])
        self.assertIsNone(report["observed_presentation_fps"])

    def test_hdr_signaling(self):
        for transfer, expected in [("smpte2084", "PQ"), ("arib-std-b67", "HLG"), ("bt709", "not established")]:
            self.assertIn(expected, summarize(fixture([], color_transfer=transfer))["hdr_signaling"])

    def test_no_private_fields(self):
        probe = fixture([100000, 100001], tags={"location": "PRIVATE-GPS", "make": "PRIVATE-DEVICE"}, filename="PRIVATE-PATH")
        probe["format"] = {"filename": "PRIVATE-PATH", "tags": {"creation_time": "PRIVATE-TIME"}}
        serialized = json.dumps(summarize(probe))
        self.assertNotIn("PRIVATE", serialized)
        self.assertNotIn("100000", serialized)

    def test_no_video(self):
        with self.assertRaises(ValueError):
            summarize({"streams": [], "frames": []})


if __name__ == "__main__":
    unittest.main()
