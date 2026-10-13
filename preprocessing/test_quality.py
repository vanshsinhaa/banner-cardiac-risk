import unittest
from unittest.mock import Mock

import cv2
import numpy as np

from quality import LEADS, check_scan_quality


def labels(text=LEADS, confidence=95, height=20):
    return {"text": list(text), "conf": [confidence] * len(text),
            "height": [height] * len(text)}


class QualityTests(unittest.TestCase):
    def setUp(self):
        self.image = np.full((800, 1200, 3), 255, np.uint8)
        cv2.putText(self.image, "ECG", (50, 100), cv2.FONT_HERSHEY_SIMPLEX,
                    2, (0, 0, 0), 3)

    def check(self, data, **kwargs):
        return check_scan_quality(self.image, ocr=lambda _: data, **kwargs)

    def test_all_labels_pass(self):
        self.assertTrue(self.check(labels()).accepted)

    def test_missing_label_rejects(self):
        result = self.check(labels(LEADS[:-1]))
        self.assertFalse(result.accepted)
        self.assertEqual(result.missing_leads, ("V6",))

    def test_low_confidence_and_small_text_reject(self):
        for data in [labels(confidence=69), labels(height=9), labels(())]:
            self.assertFalse(self.check(data).accepted)

    def test_duplicates_cannot_replace_missing_leads(self):
        self.assertFalse(self.check(labels(("II",) * 12)).accepted)

    def test_exact_tokens_only(self):
        self.assertFalse(self.check(labels(("1", "l", "V10", "prefixV1")),
                                    expected_leads=("I", "V1")).accepted)
        self.assertTrue(self.check(labels(("(avr)", "V1:")),
                                   expected_leads=("aVR", "V1")).accepted)

    def test_bad_images_skip_ocr(self):
        ocr = Mock(side_effect=AssertionError("OCR must not run"))
        for image in [None, np.empty((0, 0), np.uint8),
                      np.zeros((800, 1200), np.float32),
                      np.zeros((20, 20), np.uint8),
                      np.full((800, 1200), 255, np.uint8)]:
            self.assertFalse(check_scan_quality(image, ocr=ocr).accepted)
        ocr.assert_not_called()

    def test_ocr_failure_is_not_quality_rejection(self):
        with self.assertRaisesRegex(RuntimeError, "not assessed"):
            check_scan_quality(self.image, ocr=Mock(side_effect=OSError("missing")))

    def test_threshold_configuration(self):
        self.assertTrue(self.check(labels(("II",), confidence=60),
                                   expected_leads=("II",), min_confidence=60).accepted)
        for kwargs in [{"expected_leads": ()}, {"expected_leads": ("X",)},
                       {"min_confidence": 101}, {"min_label_height": 0}]:
            with self.assertRaises(ValueError):
                self.check(labels(), **kwargs)


if __name__ == "__main__":
    unittest.main()
