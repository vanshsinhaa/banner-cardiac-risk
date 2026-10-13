import unittest
from unittest.mock import patch

import numpy as np

from lead_ocr import read_labels
from quality import check_scan_quality
from analyze import analyze_image


def data(words, confidence=95, height=20):
    return {"text": list(words), "conf": [confidence] * len(words), "height": [height] * len(words)}


class LeadOcrTests(unittest.TestCase):
    def setUp(self):
        self.image = np.full((800, 1200), 255, np.uint8)
        self.image[50:80, 50:100] = 0

    def test_rotations_are_not_combined_to_invent_complete_scan(self):
        responses = [data(('aVR',)), data(('V1','V2','V3')), data(('aVF',)), data(('V6',)), data(('V4',))]
        with patch('pytesseract.image_to_data', side_effect=responses):
            result = read_labels(self.image)
        self.assertEqual(result['rotation_degrees'], 90)
        self.assertEqual(result['text'], ['V1','V2','V3','V4'])
        self.assertNotIn('aVR', result['text'])

    def test_height_is_measured_in_original_pixels(self):
        image = np.zeros((1000,6000),np.uint8)
        with patch('pytesseract.image_to_data', return_value=data(('V1',), height=6)):
            result = read_labels(image)
        self.assertTrue(all(height == 12 for height in result['height']))

    def test_partial_timeout_keeps_evidence_and_reports_incomplete_attempts(self):
        responses = [data(('V1',)), RuntimeError('Tesseract process timeout'), data(()), data(()), data(())]
        with patch('pytesseract.image_to_data', side_effect=responses):
            result = read_labels(self.image)
        self.assertTrue(result['ocr_timed_out'])
        self.assertIn('V1', result['text'])

    def test_total_timeout_is_operational_error(self):
        with patch('pytesseract.image_to_data', side_effect=RuntimeError('Tesseract process timeout')):
            with self.assertRaises(RuntimeError):
                read_labels(self.image)

    def test_low_confidence_label_is_visible_but_cannot_pass(self):
        result = check_scan_quality(self.image, expected_leads=('V1',), ocr=lambda _:data(('V1',),confidence=50))
        self.assertFalse(result.accepted)
        self.assertEqual(result.uncertain_leads, ('V1',))
        self.assertEqual(result.detected_leads, ())

    def test_missing_labels_are_review_not_bad_image(self):
        image = np.repeat(self.image[:,:,None],3,axis=2)
        with patch('analyze.find_boundary', return_value=None), patch('analyze.normalize_lighting', side_effect=lambda value:value):
            result = analyze_image(image, ocr=lambda _:data(('V1',)))
        self.assertEqual(result['status'], 'needs_review')
        self.assertFalse(result['accepted'])

class LightingTests(unittest.TestCase):
    def test_full_resolution_lighting_preserves_shape_and_trace_contrast(self):
        from preprocess import normalize_lighting
        import cv2
        ramp = np.tile(np.linspace(80, 220, 4000, dtype=np.uint8), (3000, 1))
        image = cv2.cvtColor(ramp, cv2.COLOR_GRAY2BGR)
        image[1497:1503, :] = 20
        corrected = normalize_lighting(image)
        self.assertEqual(corrected.shape, image.shape)
        self.assertEqual(corrected.dtype, np.uint8)
        # The dark trace must still be darker than the nearby paper.
        self.assertLess(float(corrected[1500].mean()), float(corrected[1450].mean()))
        before = abs(float(image[1450, 500].mean()) - float(image[1450, 3500].mean()))
        after = abs(float(corrected[1450, 500].mean()) - float(corrected[1450, 3500].mean()))
        self.assertLess(after, before)


if __name__ == '__main__':
    unittest.main()
