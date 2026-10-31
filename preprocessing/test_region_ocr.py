"""Regression tests for glyph evidence, small text, and label-independent reads."""
import unittest
from unittest.mock import patch

import cv2
import numpy as np

from region_ocr import roman_supported, refine_labels


def roman_image(count=1):
    image = np.full((90, 120, 3), 255, np.uint8)
    for index in range(count):
        x = 20 + index * 12
        cv2.rectangle(image, (x, 20), (x+7, 22), (0, 0, 0), -1)
        cv2.rectangle(image, (x+3, 20), (x+4, 39), (0, 0, 0), -1)
        cv2.rectangle(image, (x, 37), (x+7, 39), (0, 0, 0), -1)
    return image


def data(name='', x=20, y=20):
    return {'text': [name], 'conf': [95], 'left': [x*3], 'top': [y*3],
            'width': [18*3], 'height': [8*3]}


class RegionOcrTests(unittest.TestCase):
    def test_roman_count_rejects_ocr_missing_a_bar(self):
        self.assertTrue(roman_supported(roman_image(1), [20,20,8,20], 'I'))
        self.assertTrue(roman_supported(roman_image(2), [20,20,20,20], 'II'))
        self.assertTrue(roman_supported(roman_image(3), [20,20,32,20], 'III'))
        self.assertFalse(roman_supported(roman_image(2), [20,20,8,20], 'I'))
        self.assertFalse(roman_supported(roman_image(3), [20,20,20,20], 'II'))

    def test_waveform_bar_and_clipped_glyph_are_not_I_evidence(self):
        image = np.full((90,120,3), 255, np.uint8)
        image[20:40,20:22] = 0
        self.assertFalse(roman_supported(image, [20,20,2,20], 'I'))
        self.assertFalse(roman_supported(roman_image(), [0,20,8,20], 'I'))

    def test_invalid_roman_proposal_is_removed_without_relabeling(self):
        ocr = {'coordinate_space':'input_pixels', 'rotation_degrees':0,
               'detections':[{'lead':'I','confidence':99,'height':20,'box':[20,20,8,20]}]}
        result = refine_labels(roman_image(2), {}, ocr, budget_seconds=0)
        self.assertEqual(result['detections'], [])
        self.assertEqual(ocr['detections'][0]['lead'], 'I')

    def test_small_label_requires_agreement_at_the_same_location(self):
        image = np.full((90,120,3), 255, np.uint8)
        region = {'box':[0,0,120,90]}
        base = {'coordinate_space':'input_pixels','detections':[]}
        with patch('pytesseract.image_to_data', side_effect=[data('V2'), data('V2')]):
            result = refine_labels(image, {'V6':region}, base)
        # The requested/assigned name never becomes an OCR hint.
        self.assertEqual({d['lead'] for d in result['detections']}, {'V2'})
        self.assertTrue(all(d['local_support'] >= 2 for d in result['detections']))
        self.assertTrue(all(d['height'] == 8 for d in result['detections']))
        with patch('pytesseract.image_to_data', side_effect=[data('V2'), data('V2', x=70)]):
            self.assertEqual(refine_labels(image, {'V6':region}, base)['detections'], [])

    def test_low_confidence_baseline_cannot_supply_small_label_consensus(self):
        image = np.full((90,120,3), 255, np.uint8)
        base = {'coordinate_space':'input_pixels','detections':[
            {'lead':'V2','confidence':35,'height':8,'box':[20,20,18,8]}]}
        with patch('pytesseract.image_to_data', side_effect=[data('V2'), data()]):
            result = refine_labels(image, {'V2':{'box':[0,0,120,90]}}, base)
        self.assertFalse(any(d.get('local_support', 0) >= 2 for d in result['detections']))

    def test_optional_timeout_does_not_invent_or_erase_valid_baseline_evidence(self):
        image = np.full((90,120,3), 255, np.uint8)
        base = {'coordinate_space':'input_pixels','detections':[
            {'lead':'V2','confidence':95,'height':12,'box':[20,20,18,12]}]}
        with patch('pytesseract.image_to_data', side_effect=RuntimeError('Tesseract process timeout')):
            result = refine_labels(image, {'V2':{'box':[0,0,120,90]}}, base)
        self.assertEqual(result['detections'], base['detections'])


if __name__ == '__main__':
    unittest.main()
