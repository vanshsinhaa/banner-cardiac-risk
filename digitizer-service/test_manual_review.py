import copy
import time
import unittest
import numpy as np
from manual_review import ReviewError, ReviewStore, Session, apply_corrections, box


def fixture():
    result = {'leads': {'I': [1, 2], 'V1': [3, 4], 'V2': [5, 6]}, 'units': 'mV', 'samplingRateHz': 500,
              'leadVerification': {'status': 'conflict', 'leads': {'I': {'status': 'verified'},
                                   'V1': {'status': 'unverified'}, 'V2': {'status': 'conflict'}}}}
    return Session(result, np.full((200, 400, 3), 255, np.uint8), np.ones((200, 400), np.float32),
                   10, (0, 400), time.monotonic() + 120)


def correction(source='V1', label='V1'):
    return {'source': source, 'label': label, 'labelBox': [10, 10, 30, 30], 'waveformBox': [100, 50, 300, 120]}


def extract(mask, region):
    # Exact analytical trace with a deliberate missing segment.
    assert np.count_nonzero(mask[:50]) == 0
    assert np.count_nonzero(mask[:, :100]) == 0
    row = 80 + 10 * np.sin(np.linspace(0, 4*np.pi, 200))
    row[80:90] = np.nan
    return row[None], 100


class ManualReviewTests(unittest.TestCase):
    def test_selected_region_reextracts_values_preserves_axis_and_other_leads(self):
        session = fixture()
        original = copy.deepcopy(session.result)
        result = apply_corrections(session, [correction()], extract)
        self.assertEqual(session.result, original)  # commit belongs to endpoint
        self.assertEqual(result['leads']['I'], [1, 2])
        self.assertEqual(result['leads']['V2'], [5, 6])
        samples = result['leads']['V1']
        self.assertEqual(len(samples), 5000)
        self.assertTrue(all(v is None for v in samples[:1200]))
        self.assertTrue(any(v is None for v in samples[2250:2350]))
        self.assertAlmostEqual(max(v for v in samples if v is not None), .1, delta=.01)
        self.assertEqual(result['samplingRateHz'], 500)
        self.assertEqual(result['leadVerification']['leads']['V1']['status'], 'human_corrected')
        self.assertEqual(result['machineEvidence']['leadVerification'], original['leadVerification'])
        self.assertTrue(result['requiresReview'])

    def test_swap_is_atomic_and_does_not_overwrite(self):
        result = apply_corrections(fixture(), [correction('V1', 'V2'), correction('V2', 'V1')], extract)
        self.assertEqual(set(result['leads']), {'I', 'V1', 'V2'})
        self.assertEqual(len(result['manualCorrections']), 2)

    def test_missing_lead_can_be_added(self):
        result = apply_corrections(fixture(), [correction(None, 'v3')], extract)
        self.assertIn('V3', result['leads'])
        self.assertEqual(result['leads']['V1'], [3, 4])

    def test_invalid_batches_rejected_before_extraction(self):
        for corrections in ([correction('I')], [correction('unknown')], [correction(label='foo')],
                            [correction(label='V2')], [correction(), correction()],
                            [correction(None, 'I')], [], [None], [dict(correction(), labelBox=[0, 0, 401, 20])]):
            with self.subTest(corrections=corrections), self.assertRaises(ReviewError):
                apply_corrections(fixture(), corrections, lambda *_: self.fail('should not extract'))

    def test_ambiguous_or_empty_regions_fail_without_mutation(self):
        session = fixture()
        before = copy.deepcopy(session.result)
        for rows in (np.empty((0, 400)), np.ones((2, 400)), np.full((1, 400), np.nan)):
            with self.assertRaises(ReviewError):
                apply_corrections(session, [correction()], lambda *_: (rows, 0))
        self.assertEqual(session.result, before)

    def test_nonfinite_and_reversed_boxes_rejected(self):
        for value in ([0, 0, float('nan'), 30], [True, 0, 20, 30], [30, 0, 20, 30], [0, -1, 20, 30], None):
            with self.assertRaises(ReviewError): box(value, 400, 200)

    def test_sessions_expire_and_capacity_is_bounded(self):
        store = ReviewStore(ttl=60, capacity=1)
        sample = fixture()
        def add():
            return store.create(sample.result, sample.image, sample.signal, 10, (0, 400))
        first = add(); second = add()
        self.assertNotEqual(first['token'], second['token'])
        with self.assertRaises(ReviewError): store.get(first['token'])
        store.get(second['token']).expires = 0
        with self.assertRaises(ReviewError): store.get(second['token'])
        with self.assertRaises(ReviewError): store.get('unknown')

    def test_graph_mode_edits_verified_lead_without_changing_its_label(self):
        session = fixture()
        value = correction('I', 'I')
        value.pop('labelBox')  # Graph editing does not require another label crop.
        result = apply_corrections(session, [value], extract, mode='waveform_regions')
        self.assertEqual(set(result['leads']), set(session.result['leads']))
        self.assertEqual(result['leads']['V1'], session.result['leads']['V1'])
        self.assertEqual(result['leads']['V2'], session.result['leads']['V2'])
        self.assertNotEqual(result['leads']['I'], session.result['leads']['I'])
        self.assertEqual(result['leadVerification']['leads']['I']['reason'], 'user_waveform_region')
        self.assertEqual(result['machineEvidence']['leadVerification']['leads']['I']['status'], 'verified')
        self.assertEqual(result['manualCorrections'][0]['mode'], 'waveform_regions')
        self.assertNotIn('labelBox', result['manualCorrections'][0])
        self.assertTrue(result['requiresReview'])

    def test_graph_mode_cannot_rename_or_add_leads(self):
        for value in (correction('I', 'V3'), correction(None, 'V3')):
            with self.assertRaises(ReviewError):
                apply_corrections(fixture(), [value], extract, mode='waveform_regions')
        with self.assertRaises(ReviewError):
            apply_corrections(fixture(), [correction()], extract, mode='unexpected')

    def test_graph_mode_preserves_server_label_box(self):
        session = fixture()
        session.result['leadVerification']['leads']['I']['box'] = [10, 5, 20, 25]
        result = apply_corrections(session, [correction('I', 'I')], extract, mode='waveform_regions')
        self.assertEqual(result['leadVerification']['leads']['I']['box'], [10, 5, 20, 25])
        self.assertEqual(result['manualCorrections'][0]['labelBox'], [10, 5, 20, 25])

    def test_testing_marker_survives_corrections(self):
        session = fixture()
        session.result['privacyStatus'] = 'testing_bypass'
        result = apply_corrections(session, [correction()], extract)
        self.assertEqual(result['privacyStatus'], 'testing_bypass')

if __name__ == '__main__':
    unittest.main()
