import unittest
import numpy as np
from t_wave_metrics import (
    CALCULATION_ERROR, COULD_NOT_CALCULATE, NO_T_WAVE_FOUND, T_WAVE_FINDER_FAILED,
    compute_t_wave_metrics, t_wave_area,
)

SAMPLING_RATE = 500  # Hz, so one sample = 2 ms


def make_t_wave(amplitude_mv, baseline_mv=0.0, onset_ms=150, offset_ms=350):
    """A median beat whose T wave is a half sine from onset_ms to offset_ms after the R peak.

    A half sine of height A over D ms has an exact area of 2 * A * D / pi.
    """
    r_index = 100
    beat = np.full(400, baseline_mv)
    start = r_index + onset_ms * SAMPLING_RATE // 1000
    end = r_index + offset_ms * SAMPLING_RATE // 1000
    beat[start : end + 1] += amplitude_mv * np.sin(np.linspace(0, np.pi, end - start + 1))
    return {
        "median_beat": beat.tolist(), "r_index": r_index, "baseline_mv": baseline_mv,
        "t_onset_ms": onset_ms, "t_offset_ms": offset_ms,
    }


class TWaveAreaTests(unittest.TestCase):
    def test_upright_t_wave_matches_the_exact_area(self):
        expected = 2 * 0.4 * 200 / np.pi  # 0.4 mV over 200 ms, about 50.9 mV*ms
        self.assertAlmostEqual(t_wave_area(make_t_wave(0.4), SAMPLING_RATE), expected, places=1)

    def test_inverted_t_wave_gives_negative_area(self):
        upright = t_wave_area(make_t_wave(0.4), SAMPLING_RATE)
        inverted = t_wave_area(make_t_wave(-0.4), SAMPLING_RATE)
        self.assertAlmostEqual(inverted, -upright)

    def test_area_is_measured_from_the_baseline_not_zero(self):
        on_zero = t_wave_area(make_t_wave(0.4), SAMPLING_RATE)
        shifted = t_wave_area(make_t_wave(0.4, baseline_mv=0.15), SAMPLING_RATE)
        self.assertAlmostEqual(shifted, on_zero)

    def test_area_does_not_depend_on_sampling_rate_units(self):
        # The same T wave sampled at 1000 Hz must give the same area in mV*ms.
        wave = make_t_wave(0.4)
        beat = np.asarray(wave["median_beat"])
        upsampled = dict(wave, median_beat=np.interp(np.arange(0, 400, 0.5), np.arange(400), beat).tolist(),
                         r_index=wave["r_index"] * 2)
        self.assertAlmostEqual(t_wave_area(upsampled, 1000), t_wave_area(wave, SAMPLING_RATE), places=1)

    def test_boundaries_outside_the_beat_give_none(self):
        past_the_end = dict(make_t_wave(0.4), t_offset_ms=900)  # beat only runs to 598 ms
        self.assertIsNone(t_wave_area(past_the_end, SAMPLING_RATE))


class MissingMeasurementTests(unittest.TestCase):
    def test_every_digitized_lead_appears_with_a_reason_when_missing(self):
        metrics = compute_t_wave_metrics({"II": make_t_wave(0.4)}, ["I", "II"], SAMPLING_RATE)
        self.assertEqual(set(metrics["leads"]), {"I", "II"})
        self.assertIsNotNone(metrics["leads"]["II"]["t_wave_area_mv_ms"])
        self.assertNotIn("t_wave_area_mv_ms", metrics["leads"]["II"]["missing"])
        self.assertIsNone(metrics["leads"]["I"]["t_wave_area_mv_ms"])
        self.assertEqual(metrics["leads"]["I"]["missing"]["t_wave_area_mv_ms"], NO_T_WAVE_FOUND)

    def test_finder_failure_still_lists_every_lead(self):
        metrics = compute_t_wave_metrics(None, ["I", "II"], SAMPLING_RATE)
        for lead in metrics["leads"].values():
            self.assertIsNone(lead["t_wave_area_mv_ms"])
            self.assertEqual(lead["missing"]["t_wave_area_mv_ms"], T_WAVE_FINDER_FAILED)

    def test_area_out_of_range_is_marked_could_not_calculate(self):
        past_the_end = dict(make_t_wave(0.4), t_offset_ms=900)
        lead = compute_t_wave_metrics({"I": past_the_end}, ["I"], SAMPLING_RATE)["leads"]["I"]
        self.assertIsNone(lead["t_wave_area_mv_ms"])
        self.assertEqual(lead["missing"]["t_wave_area_mv_ms"], COULD_NOT_CALCULATE)

    def test_one_broken_lead_does_not_stop_the_others(self):
        broken = {"median_beat": [], "r_index": 0}  # missing fields make the area raise
        metrics = compute_t_wave_metrics({"I": broken, "II": make_t_wave(0.4)}, ["I", "II"], SAMPLING_RATE)
        self.assertEqual(metrics["leads"]["I"]["missing"]["t_wave_area_mv_ms"], CALCULATION_ERROR)
        self.assertIsNotNone(metrics["leads"]["II"]["t_wave_area_mv_ms"])


if __name__ == "__main__": unittest.main()
