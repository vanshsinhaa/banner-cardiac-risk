import struct
import unittest
from unittest.mock import patch

import cv2
import numpy as np

from analyze import analyze_image, decode_crop
from preprocess import find_boundary
from quality import LEADS


class AnalyzeTests(unittest.TestCase):
    def setUp(self):
        self.image = np.full((800, 1200, 3), 255, np.uint8)
        cv2.putText(self.image, "ECG", (30, 100), cv2.FONT_HERSHEY_SIMPLEX,
                    2, (0, 0, 0), 3)

    def labels(self, image):
        return {"text": list(LEADS), "conf": [95] * 12, "height": [20] * 12}

    def test_no_boundary_still_checks_manual_crop_then_normalizes(self):
        events = []

        def ocr(image):
            events.append("ocr")
            np.testing.assert_array_equal(image, cv2.cvtColor(self.image, cv2.COLOR_BGR2GRAY))
            return self.labels(image)

        def normalize(image):
            events.append("lighting")
            return image

        with patch("analyze.find_boundary", return_value=None), patch("analyze.normalize_lighting", side_effect=normalize):
            result = analyze_image(self.image, ocr=ocr)
        self.assertTrue(result["accepted"])
        self.assertFalse(result["boundary_found"])
        self.assertEqual(events, ["ocr", "lighting"])
        self.assertTrue(result["processed_image"].startswith("data:image/png;base64,"))

    def test_warped_dimensions_are_checked_without_upscaling(self):
        with patch("analyze.find_boundary", return_value=np.zeros((4, 2))), patch("analyze.warp", return_value=self.image[:400, :400]):
            result = analyze_image(self.image, ocr=self.labels)
        self.assertTrue(result["boundary_found"])
        self.assertFalse(result["accepted"])
        self.assertEqual(result["reasons"], ("resolution_too_low",))
        self.assertEqual((result["width"], result["height"]), (400, 400))

    def test_ocr_failure_does_not_become_rejection(self):
        def broken_ocr(image):
            raise OSError("OCR not installed")
        with patch("analyze.find_boundary", return_value=None), self.assertRaises(RuntimeError):
            analyze_image(self.image, ocr=broken_ocr)

    def test_invalid_and_oversized_png(self):
        _, png = cv2.imencode(".png", self.image)
        np.testing.assert_array_equal(decode_crop(png.tobytes()), self.image)
        huge = png.tobytes()[:16] + struct.pack(">II", 100000, 100000) + png.tobytes()[24:]
        for raw in [b"", b"not an image", huge]:
            with self.assertRaises(ValueError):
                decode_crop(raw)

    def test_boundary_detection_tries_next_threshold(self):
        rectangle = np.array([[[10, 10]], [[1100, 10]], [[1100, 700]], [[10, 700]]], dtype=np.int32)
        with patch("preprocess.cv2.findContours", side_effect=[([], None), ([rectangle], None)]) as contours:
            self.assertIsNotNone(find_boundary(self.image))
        self.assertEqual(contours.call_count, 2)


if __name__ == "__main__":
    unittest.main()
