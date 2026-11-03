import unittest
from types import SimpleNamespace
import numpy as np
from signal_result import strip_duration_s, to_result


class Tensor:
    """Only the array boundary is stubbed; timing and conversion are real."""
    def __init__(self, values): self.values = np.asarray(values)
    def clone(self): return Tensor(self.values.copy())
    def detach(self): return self
    def cpu(self): return self
    def numpy(self): return self.values
    def squeeze(self): return self


class SignalResultTests(unittest.TestCase):
    def test_paper_speed_changes_sampling_time_without_changing_samples(self):
        # 1000 traced columns at 0.25 mm/px = 250 mm = 10 s at 25 mm/s.
        got = {"signal": {"raw_lines": Tensor(np.zeros((3, 1000)))}, "pixel_spacing_mm": {"x": .25}}
        identifier = SimpleNamespace(required_valid_samples=3, _merge_nonoverlapping_lines=lambda lines: lines)
        self.assertEqual(strip_duration_s(got, 25, identifier), 10)
        self.assertEqual(strip_duration_s(got, 50, identifier), 5)

    def test_missing_geometry_uses_the_existing_ten_second_fallback(self):
        self.assertEqual(strip_duration_s({"signal": {}}, 25, None), 10)

    def test_invalid_paper_speed_is_rejected(self):
        for speed in [0, -25, float("nan"), float("inf")]:
            with self.assertRaises(ValueError): strip_duration_s({"signal": {}}, speed, None)

    def test_shared_time_axis_and_null_gaps_survive_conversion(self):
        samples = np.full((12, 4), np.nan)
        samples[0] = [1000, np.nan, -500, 0]
        samples[1] = [np.nan, 2000, 3000, np.nan]
        result = to_result(Tensor(samples), 250)
        self.assertEqual(result["leads"], {"I": [1, None, -.5, 0], "II": [None, 2, 3, None]})
        self.assertEqual(result["samplingRateHz"], 250)
        self.assertEqual(result["units"], "mV")


if __name__ == "__main__": unittest.main()
