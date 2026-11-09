"""Tests for the tWaves response field. The T-wave finder is injected, so these run
without neurokit2; the real finder is covered by the neurokit2-gated test at the end."""
import json
import math
import unittest

from t_wave_report import METHOD, TIME_DOMAIN, measure_t_waves

RATE = 500.0
LEADS = {"II": [0.1] * 10, "V2": [0.2] * 10}


def found_ii():
    # 100 ms before the R peak (index 50) and 400 ms after it, at 500 Hz.
    return {
        "median_beat": [0.0] * 251, "r_index": 50, "beats_used": 3,
        "qrs_onset_ms": -40.0, "qrs_end_ms": 48.0, "t_onset_ms": 180.0,
        "t_peak_ms": 262.0, "t_offset_ms": 330.0, "t_peak_mv": -0.21,
    }


class TWaveReportTests(unittest.TestCase):
    def test_measured_and_missing_leads_are_both_reported(self):
        raw, report = measure_t_waves(LEADS, RATE, finder=lambda leads, rate: {"II": found_ii()})
        self.assertEqual(report["status"], "complete")
        self.assertEqual(report["method"], METHOD)
        self.assertEqual(report["timeDomain"], TIME_DOMAIN)
        self.assertEqual(report["leads"]["V2"], {"status": "not_found"})
        ii = report["leads"]["II"]
        self.assertEqual(ii["status"], "measured")
        self.assertEqual(ii["windowStartMs"], -100.0)
        self.assertEqual(ii["windowEndMs"], 400.0)
        self.assertEqual(ii["tPeakMv"], -0.21)  # inverted T waves keep their sign
        self.assertNotIn("median_beat", ii)
        self.assertIn("II", raw)  # raw results still available for the debug plot
        json.dumps(report, allow_nan=False)

    def test_finder_crash_is_unavailable_not_a_failed_request(self):
        def crash(leads, rate):
            raise RuntimeError("boom")
        raw, report = measure_t_waves(LEADS, RATE, finder=crash)
        self.assertEqual(raw, {})
        self.assertEqual(report["status"], "unavailable")
        self.assertEqual(report["reason"], "analysis_failed")
        self.assertEqual(report["leads"], {})

    def test_malformed_lead_result_becomes_not_found(self):
        _, report = measure_t_waves(LEADS, RATE, finder=lambda leads, rate: {"II": {"r_index": 1}})
        self.assertEqual(report["leads"]["II"], {"status": "not_found"})


try:
    import neurokit2  # noqa: F401
    HAS_NK = True
except ImportError:
    HAS_NK = False


@unittest.skipUnless(HAS_NK, "pip install neurokit2 to run the real T-wave finder")
class RealFinderTests(unittest.TestCase):
    def test_synthetic_twelve_lead_is_measured_in_order(self):
        from make_validation_fixture import build
        fixture = build()
        leads = fixture["tWaves"]["leads"]
        self.assertEqual(set(leads), set(fixture["leads"]))
        for name, lead in leads.items():
            self.assertEqual(lead["status"], "measured", name)
            values = [lead[k] for k in ("qrsOnsetMs", "qrsEndMs", "tOnsetMs", "tPeakMs", "tOffsetMs")]
            self.assertTrue(all(math.isfinite(v) for v in values))
            self.assertLessEqual(lead["qrsOnsetMs"], 0)
            self.assertEqual(values, sorted(values), name)


if __name__ == "__main__":
    unittest.main()
