"""Service tests with real pinned assignment code and mocked neural inference.

Run with Open-ECG-Digitizer on PYTHONPATH; no weights are needed for these tests.
"""
import importlib
import sys
import types
import unittest
from unittest.mock import patch
import cv2
import numpy as np

try:
    import torch
    from src.model.lead_identifier import LeadIdentifier
    from src.model.signal_extractor import SignalExtractor
    from fastapi.testclient import TestClient
    UPSTREAM = True
except ImportError:
    UPSTREAM = False

from lead_verification import source_regions
from test_lead_verification import fixture, evidence


@unittest.skipUnless(UPSTREAM, 'Put the pinned upstream checkout on PYTHONPATH')
class ServiceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        layout = {'layout': {'rows':3,'cols':4}, 'leads':[
            ['I','aVR','V1','V4'],['II','aVL','V2','V5'],['III','aVF','V3','V6']]}
        class FakeWrapper:
            def __init__(self, **kwargs):
                self.identifier=LeadIdentifier(layouts={'standard':layout},unet=torch.nn.Identity(),device='cpu')
                self.signal_extractor=SignalExtractor()
                self.apply_dewarping=False
            def __call__(self, image, **kwargs):
                raw, normalized, _ = fixture()
                self.identifier.raw_pixels=raw[:3]
                self.identifier.crop=(0,400)
                self.signal_extractor.source_offset=0
                canonical=self.identifier._canonicalize_lines(torch.from_numpy(normalized[:3]), {'layout':'standard','cost':0.1})
                return {'signal':{'canonical_lines':canonical},'aligned':{'image':torch.ones((1,3,600,400))}}
        config=types.ModuleType('src.config.default')
        config.get_cfg=lambda _: types.SimpleNamespace(merge_from_list=lambda _:None,MODEL=types.SimpleNamespace(class_path='fake',KWARGS={}))
        utils=types.ModuleType('src.utils');utils.import_class_from_path=lambda _:FakeWrapper
        digitize=types.ModuleType('src.digitize');digitize.save_png_plot=lambda *args:None
        with patch.dict(sys.modules, {'src.config.default':config,'src.utils':utils,'src.digitize':digitize}):
            cls.server=importlib.import_module('server')
        cls.server.SAVE_TRACE_PLOTS=False
        cls.client=TestClient(cls.server.app)
        cls.png=cv2.imencode('.png',np.full((600,400,3),255,np.uint8))[1].tobytes()

    def local_ocr(self, image, **kwargs):
        p=self.server.wrapper.identifier.provenance
        regions=source_regions(**{k:p[k] for k in ('raw','normalized','canonical','columns','crop','flipped')},shape=image.shape[:2])
        return evidence(regions)

    def post(self, ocr=None):
        with patch.object(self.server,'read_labels',side_effect=ocr or self.local_ocr):
            return self.client.post('/digitize', files={'image':('scan.png',self.png,'image/png')})

    def test_actual_upstream_assignment_reaches_verified_api_response(self):
        response=self.post()
        self.assertEqual(response.status_code,200)
        result=response.json()
        self.assertFalse(result['requiresReview'])
        self.assertEqual(result['units'],'mV')
        self.assertEqual(result['modelRecognition']['status'], 'success')
        self.assertEqual(set(result['modelRecognition']['leads']), set(result['leads']))
        self.assertEqual(result['leadVerification']['status'],'verified')
        self.assertIsNone(result['leads']['I'][-1])
        self.assertAlmostEqual(result['leads']['I'][1],fixture()[1][0,1]/1000)

    def test_service_reports_swapped_names_and_preserves_samples(self):
        baseline=self.post().json()['leads']
        def swapped(image, **kwargs):
            data=self.local_ocr(image)
            for d in data['detections']:
                d['lead']={'V1':'V2','V2':'V1'}.get(d['lead'],d['lead'])
            return data
        result=self.post(swapped).json()
        self.assertTrue(result['requiresReview'])
        self.assertEqual(result['leadVerification']['status'],'conflict')
        self.assertEqual(result['leads'],baseline)

    def test_missing_ocr_and_dewarping_do_not_verify(self):
        def unavailable(_, **kwargs): raise RuntimeError('OCR missing')
        self.assertTrue(self.post(unavailable).json()['requiresReview'])
        self.server.wrapper.apply_dewarping=True
        try:
            result=self.post().json()
            self.assertEqual(result['leadVerification']['reason'],'dewarped_coordinates_unsupported')
        finally: self.server.wrapper.apply_dewarping=False

    def test_timeout_and_default_layout_need_review(self):
        def timeout(image, **kwargs):
            data=self.local_ocr(image)
            data['ocr_timed_out']=True
            return data
        self.assertTrue(self.post(timeout).json()['requiresReview'])
        identifier=self.server.wrapper.identifier
        original=identifier._canonicalize_lines
        def fallback(lines, match):
            result=original(lines, match)
            identifier.provenance['matched']=False
            return result
        with patch.object(identifier, '_canonicalize_lines', side_effect=fallback):
            result=self.post().json()
        self.assertEqual(result['leadVerification']['reason'],'layout_not_matched')
        self.assertEqual(result['modelRecognition'], {'status':'failed', 'leads':[]})
        self.assertTrue(result['requiresReview'])

    def test_invalid_image_rejected(self):
        response=self.client.post('/digitize',files={'image':('bad.png',b'invalid','image/png')})
        self.assertEqual(response.status_code,422)

    def test_extractor_crop_and_identifier_normalization_are_recorded(self):
        extractor=self.server.wrapper.signal_extractor
        raw,_,_=fixture()
        padded=np.pad(raw,((0,0),(25,30)),constant_values=np.nan)
        trimmed=extractor.preprocess_lines(torch.from_numpy(padded))
        self.assertEqual(extractor.source_offset,25)
        self.assertEqual(trimmed.shape[1],400)
        identifier=self.server.wrapper.identifier
        normalized=identifier.normalize(trimmed,5,0.1)
        self.assertEqual(identifier.crop,(0,400))
        np.testing.assert_array_equal(identifier.raw_pixels,raw)
        self.assertEqual(normalized.shape[1],5000)

    def test_actual_rhythm_reassignment_is_located_from_returned_samples(self):
        raw,normal,_=fixture()
        # Make rhythm waveform close to lead II, testing actual upstream matching.
        normal[3]=normal[1] + 0.001*np.cos(np.arange(400))
        identifier=self.server.wrapper.identifier
        layout=identifier.layouts['standard']
        layout['rhythm_leads']=['II']
        identifier.raw_pixels=raw;identifier.crop=(0,400)
        try:
            canonical=identifier._canonicalize_lines(torch.from_numpy(normal),{'layout':'standard','cost':0.1})
            p=identifier.provenance
            regions=source_regions(**{k:p[k] for k in ('raw','normalized','canonical','columns','crop','flipped')},shape=(600,400))
            # Follow the actual assignment, even when it differs from the
            # template rhythm label. Never assume the output was lead II.
            assigned = [i for i in range(12) if torch.isfinite(canonical[i]).all()]
            self.assertEqual(len(assigned), 1)
            name = identifier.LEAD_CHANNEL_ORDER[assigned[0]]
            self.assertEqual(regions[name]['sourceRow'], 3)
            self.assertEqual(regions[name]['sampleRange'], [0, 400])
        finally: layout.pop('rhythm_leads')

if __name__=='__main__': unittest.main()
