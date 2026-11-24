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

    def test_conflict_retries_once_and_second_ocr_can_accept(self):
        calls = []
        def first_conflict(image, **kwargs):
            data = self.local_ocr(image)
            calls.append(1)
            if len(calls) == 1:
                for d in data['detections']:
                    d['lead'] = {'V1': 'V2', 'V2': 'V1'}.get(d['lead'], d['lead'])
            return data
        def retry():
            return torch.from_numpy(self.server.wrapper.identifier.provenance['canonical'])
        with patch.object(self.server.wrapper.identifier, 'recheck', side_effect=retry) as recheck:
            result = self.post(first_conflict).json()
        self.assertEqual(recheck.call_count, 1)
        self.assertEqual(len(calls), 2)
        self.assertEqual(result['layoutRecheck']['status'], 'accepted')
        self.assertFalse(result['requiresReview'])
        self.assertTrue(result['leadPreviews']['V1'].startswith('data:image/png;base64,'))

    def test_unverified_retry_keeps_original_samples_and_conflicts(self):
        baseline = self.post().json()['leads']
        count = 0
        def ocr(image, **kwargs):
            nonlocal count
            count += 1
            data = self.local_ocr(image)
            if count == 1:
                for d in data['detections']:
                    d['lead'] = {'V1': 'V2'}.get(d['lead'], d['lead'])
            else:
                data['ocr_timed_out'] = True
            return data
        with patch.object(self.server.wrapper.identifier, 'recheck', side_effect=lambda:
                          torch.from_numpy(self.server.wrapper.identifier.provenance['canonical'])):
            result = self.post(ocr).json()
        self.assertEqual(result['layoutRecheck']['status'], 'needs_review')
        self.assertTrue(result['requiresReview'])
        self.assertEqual(result['leads'], baseline)

    def test_recheck_excludes_rejected_layout_from_model_matcher(self):
        identifier = self.server.wrapper.identifier
        self.post()
        layout = identifier.layouts['standard']
        identifier.match_inputs = ([('II', 0, 1), ('V1', 1, 0), ('V2', 1, 1)], 3,
                                   {'standard': layout, 'alternative': layout}, False)
        with patch.object(LeadIdentifier, '_match_layout', return_value={'layout': 'alternative', 'cost': .2}) as match:
            result = identifier.recheck()
        self.assertIsNotNone(result)
        self.assertEqual(set(match.call_args.args[2]), {'alternative'})
        self.assertEqual(identifier.provenance['layout'], 'alternative')

    def test_health_describes_loaded_runtime(self):
        response = self.client.get('/health')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['status'], 'ready')
        self.assertEqual(response.json()['device'], self.server.device)
        self.assertEqual(response.json()['resample_size'], self.server.RESAMPLE_SIZE)

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

    def test_manual_review_http_reextracts_real_signal_map_and_rejects_stale_revision(self):
        from manual_review import ReviewStore
        image = np.full((200, 400, 3), 255, np.uint8)
        signal = np.zeros((200, 400), np.float32)
        for x in range(50, 350):
            y = round(90 + 12 * np.sin(x / 13))
            signal[y-1:y+2, x] = 1
        result = {'leads': {'V1': [0.0] * 5000, 'I': [1.0] * 5000}, 'units': 'mV', 'samplingRateHz': 500,
                  'leadVerification': {'status': 'needs_review', 'leads': {'V1': {'status': 'unverified'}, 'I': {'status': 'verified'}}}}
        self.server.review_store = ReviewStore()
        session = self.server.review_store.create(result, image, signal, 10, (0, 400))
        body = {'token': session['token'], 'revision': 0, 'corrections': [{'source': 'V1', 'label': 'V2',
                'labelBox': [10, 10, 30, 30], 'waveformBox': [45, 60, 355, 120]}]}
        response = self.client.post('/review-leads', json=body)
        self.assertEqual(response.status_code, 200, response.text)
        output = response.json()
        self.assertNotIn('V1', output['leads'])
        self.assertEqual(output['leads']['I'], result['leads']['I'])
        self.assertEqual(len(output['leads']['V2']), 5000)
        self.assertTrue(any(v and abs(v) > .05 for v in output['leads']['V2']))
        self.assertEqual(output['manualReview']['revision'], 1)
        self.assertEqual(output['leadVerification']['leads']['V2']['status'], 'human_corrected')
        self.assertEqual(self.client.post('/review-leads', json=body).status_code, 409)
        self.assertEqual(self.client.post('/review-leads', json={**body, 'token': 'expired'}).status_code, 410)
        self.assertEqual(self.client.post('/review-leads', content='x' * 33000).status_code, 413)
        self.assertEqual(self.client.post('/review-leads', content='{').status_code, 422)

    def test_manual_review_resegments_small_crop_when_cached_map_is_empty(self):
        from manual_review import ReviewStore
        image = np.full((200, 400, 3), 255, np.uint8)
        for x in range(50, 350):
            y = round(90 + 12 * np.sin(x / 13))
            image[y-1:y+2, x] = 0
        empty_signal = np.zeros((200, 400), np.float32)
        result = {'leads': {'V1': [0.0] * 5000}, 'units': 'mV', 'samplingRateHz': 500,
                  'leadVerification': {'status': 'needs_review', 'leads': {'V1': {'status': 'unverified'}}}}
        self.server.review_store = ReviewStore()
        session = self.server.review_store.create(result, image, empty_signal, 10, (0, 400))
        body = {'token': session['token'], 'revision': 0, 'corrections': [{'source': 'V1', 'label': 'V1',
                'labelBox': [10, 10, 30, 30], 'waveformBox': [45, 60, 355, 120]}]}
        shapes = []
        def segmentation(tensor):
            shapes.append(tuple(tensor.shape[-2:]))
            signal = 1 - tensor.mean(dim=1, keepdim=True)
            return signal, signal, signal
        with patch.object(self.server.wrapper, 'min_max_normalize', side_effect=lambda t: t/255, create=True), \
             patch.object(self.server.wrapper, '_get_feature_maps', side_effect=segmentation, create=True):
            response = self.client.post('/review-leads', json=body)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(len(shapes), 1)
        self.assertGreaterEqual(min(shapes[0]), 512)
        samples = response.json()['leads']['V1']
        self.assertTrue(all(v is None for v in samples[:500]))
        self.assertAlmostEqual(max(v for v in samples if v is not None), .12, delta=.03)

    def test_graph_mode_http_edits_verified_lead_and_reads_latest_revision(self):
        from manual_review import ReviewStore
        image = np.full((200, 400, 3), 255, np.uint8)
        signal = np.zeros((200, 400), np.float32)
        for x in range(50, 350):
            y = round(90 + 12 * np.sin(x / 13))
            signal[y-1:y+2, x] = 1
        result = {'leads': {'I': [1.0] * 5000}, 'units': 'mV', 'samplingRateHz': 500,
                  'leadVerification': {'status': 'verified', 'leads': {'I': {'status': 'verified'}}}}
        self.server.review_store = ReviewStore()
        session = self.server.review_store.create(result, image, signal, 10, (0, 400))
        body = {'token': session['token'], 'revision': 0, 'mode': 'waveform_regions',
                'corrections': [{'source': 'I', 'label': 'I', 'waveformBox': [45, 60, 355, 120]}]}
        response = self.client.post('/review-leads', json=body)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['leadVerification']['leads']['I']['status'], 'human_corrected')
        self.assertEqual(self.client.post('/review-leads', json=body).status_code, 409)
        latest = self.client.post('/review-leads', json={'token': session['token'], 'action': 'read'})
        self.assertEqual(latest.status_code, 200)
        self.assertEqual(latest.json()['leads'], response.json()['leads'])
        self.assertEqual(latest.json()['manualReview']['revision'], 1)
        self.assertEqual(self.client.post('/review-leads', json={'token': 'expired', 'action': 'read'}).status_code, 410)

    def test_testing_bypass_is_explicitly_marked_on_digitization(self):
        with patch.object(self.server, 'read_labels', side_effect=self.local_ocr):
            response = self.client.post('/digitize', files={'image': ('scan.png', self.png, 'image/png')},
                                        data={'testing_bypass': 'true'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['privacyStatus'], 'testing_bypass')
        self.assertNotIn('privacyStatus', self.post().json())

if __name__=='__main__': unittest.main()
