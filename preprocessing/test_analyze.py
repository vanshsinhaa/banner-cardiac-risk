import base64
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

    def test_manual_crop_is_checked_then_normalized_without_a_second_warp(self):
        events = []

        def ocr(image):
            events.append("ocr")
            np.testing.assert_array_equal(image, cv2.cvtColor(self.image, cv2.COLOR_BGR2GRAY))
            return self.labels(image)

        def normalize(image):
            events.append("lighting")
            return image

        with patch("preprocess.find_boundary", side_effect=AssertionError("Already cropped")), patch("preprocess.warp", side_effect=AssertionError("Already warped")), patch("analyze.normalize_lighting", side_effect=normalize):
            result = analyze_image(self.image, ocr=ocr)
        self.assertTrue(result["accepted"])
        self.assertFalse(result["boundary_found"])
        self.assertEqual(events, ["ocr", "lighting"])
        self.assertTrue(result["processed_image"].startswith("data:image/png;base64,"))

    def test_small_manual_crop_keeps_its_pixels_and_only_advises_on_dimensions(self):
        small = self.image[:400, :500]
        with patch("analyze.normalize_lighting", side_effect=lambda image: image):
            result = analyze_image(small, ocr=self.labels)
        self.assertFalse(result["boundary_found"])
        self.assertTrue(result["accepted"])
        self.assertEqual(result["advisories"], ("limited_image_dimensions",))
        self.assertEqual((result["width"], result["height"]), (500, 400))
        output = cv2.imdecode(np.frombuffer(base64.b64decode(result["processed_image"].split(",")[1]), np.uint8), cv2.IMREAD_COLOR)
        np.testing.assert_array_equal(output, small)

    def test_ocr_failure_does_not_become_rejection(self):
        def broken_ocr(image):
            raise OSError("OCR not installed")
        with self.assertRaises(RuntimeError):
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
