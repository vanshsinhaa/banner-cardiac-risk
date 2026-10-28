import unittest
import numpy as np
from lead_verification import LEADS, compare_labels, source_regions


def fixture():
    x = np.linspace(0, 8, 400)
    normalized = np.array([np.sin(x*(i+1))*(i+1) for i in range(4)])
    raw = np.array([100+120*i + row for i, row in enumerate(normalized)])
    canonical = np.full((12, 400), np.nan)
    order = [['I','aVR','V1','V4'], ['II','aVL','V2','V5'], ['III','aVF','V3','V6']]
    for r, row in enumerate(order):
        for c, name in enumerate(row):
            canonical[LEADS.index(name),c*100:(c+1)*100] = normalized[r,c*100:(c+1)*100]
    canonical[1] = normalized[3]  # Actual rhythm assignment overrides short II.
    return raw, normalized, canonical


def evidence(regions):
    return {'coordinate_space': 'input_pixels', 'detections': [
        {'lead': name.upper(), 'confidence': 95, 'height': 12,
         'box': [(r['box'][0]+r['box'][2])/2-6,
                 (r['box'][1]+r['box'][3])/2-6, 12, 12]}
        for name, r in regions.items() if 'box' in r]}


class VerificationTests(unittest.TestCase):
    def setUp(self):
        self.raw, self.normalized, self.canonical = fixture()
        self.regions = source_regions(self.raw,self.normalized,self.canonical,4,(0,400),(600,400))

    def test_correct_spatial_assignments_and_actual_rhythm_source(self):
        self.assertEqual(self.regions['II']['sourceRow'],3)
        self.assertEqual(self.regions['II']['sampleRange'],[0,400])
        self.assertEqual(compare_labels(self.regions,evidence(self.regions),LEADS)['status'],'verified')

    def test_swapped_labels_conflict_despite_same_global_name_set(self):
        ocr=evidence(self.regions)
        first=next(d for d in ocr['detections'] if d['lead']=='V1')
        second=next(d for d in ocr['detections'] if d['lead']=='V2')
        first['lead'],second['lead']=second['lead'],first['lead']
        result=compare_labels(self.regions,ocr,LEADS)
        self.assertEqual(result['status'],'conflict')
        self.assertEqual(result['leads']['V1']['status'],'conflict')
        self.assertEqual(result['leads']['V2']['status'],'conflict')

    def test_missing_low_confidence_small_and_timeout_need_review(self):
        for change in ('missing','low','small','timeout'):
            ocr=evidence(self.regions)
            if change=='missing': ocr['detections'].pop()
            if change=='low': ocr['detections'][0]['confidence']=50
            if change=='small': ocr['detections'][0]['height']=6
            if change=='timeout': ocr['ocr_timed_out']=True
            self.assertEqual(compare_labels(self.regions,ocr,LEADS)['status'],'needs_review')

    def test_duplicates_do_not_increase_evidence_and_ambiguity_is_not_verified(self):
        ocr=evidence(self.regions)
        ocr['detections']*=3
        self.assertEqual(compare_labels(self.regions,ocr,LEADS)['status'],'verified')
        ocr['detections'].append({**ocr['detections'][0],'lead':'V6'})
        self.assertEqual(compare_labels(self.regions,ocr,LEADS)['status'],'needs_review')

    def test_identical_source_traces_are_ambiguous(self):
        self.normalized[1]=self.normalized[0]
        self.canonical[0,:100]=self.normalized[0,:100]
        regions=source_regions(self.raw,self.normalized,self.canonical,4,(0,400),(600,400))
        self.assertEqual(regions['I']['reason'],'ambiguous_source_trace')

    def test_unknown_provenance_cannot_verify(self):
        self.assertEqual(compare_labels({},evidence(self.regions),LEADS)['status'],'needs_review')
        self.assertEqual(compare_labels(self.regions,{},LEADS)['status'],'needs_review')

    def test_horizontal_crop_maps_to_source_pixels(self):
        regions=source_regions(self.raw,self.normalized,self.canonical,4,(40,360),(600,400))
        self.assertAlmostEqual(regions['I']['box'][0],24)

    def test_extractor_and_normalizer_crops_compose(self):
        regions=source_regions(self.raw,self.normalized,self.canonical,4,(40,360),(600,500),source_offset=25)
        self.assertAlmostEqual(regions['I']['box'][0],45)

    def test_flipped_rows_use_rotated_image_coordinates(self):
        flipped=self.normalized[::-1,::-1]
        flipped=np.nanmax(flipped)-flipped
        canonical=np.full((12,400),np.nan);canonical[0,:100]=flipped[0,:100]
        regions=source_regions(self.raw,self.normalized,canonical,4,(0,400),(600,400),True)
        self.assertEqual(regions['I']['sourceRow'],0)
        self.assertLess(regions['I']['box'][1],200)
        self.assertEqual(compare_labels(regions,evidence(regions),['I'])['status'],'verified')

    def test_empty_and_inverted_outputs_do_not_verify(self):
        self.assertEqual(compare_labels({}, {'coordinate_space':'input_pixels'}, [])['status'],'needs_review')
        self.canonical[0]*=-1
        regions=source_regions(self.raw,self.normalized,self.canonical,4,(0,400),(600,400))
        self.assertEqual(regions['I']['reason'],'inverted_lead_requires_review')

    def test_real_model_float32_geometry_is_json_serializable(self):
        import json
        regions = source_regions(self.raw.astype(np.float32),
                                 self.normalized.astype(np.float32),
                                 self.canonical.astype(np.float32),
                                 4, (0, 400), (600, 400))
        result = compare_labels(regions, evidence(regions), LEADS)
        self.assertEqual(json.loads(json.dumps(result))['status'], 'verified')

    def test_small_labels_need_local_consensus_and_swaps_still_conflict(self):
        ocr = evidence(self.regions)
        for d in ocr['detections']:
            d['height'] = 8
        self.assertNotEqual(compare_labels(self.regions, ocr, LEADS)['status'], 'verified')
        for d in ocr['detections']:
            d['local_support'] = 2
        self.assertEqual(compare_labels(self.regions, ocr, LEADS)['status'], 'verified')
        for d in ocr['detections']:
            d['lead'] = {'V1':'V2', 'V2':'V1'}.get(d['lead'], d['lead'])
        self.assertEqual(compare_labels(self.regions, ocr, LEADS)['status'], 'conflict')

    def test_samples_are_not_modified(self):
        before=self.canonical.copy()
        compare_labels(self.regions,evidence(self.regions),LEADS)
        np.testing.assert_array_equal(before,self.canonical)

if __name__=='__main__': unittest.main()
