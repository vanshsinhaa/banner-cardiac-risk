"""Real Tesseract regression on one annotated ECG and controlled variants.

Run: python benchmark_lead_ocr.py --baseline /path/to/old_lead_ocr.py --output report.json
This development fixture is not an independent accuracy or clinical benchmark.
Label rectangles were inspected manually, including the repeated rhythm II.
Photograph bounds were annotated on its 2048x932 preview and scaled to source.
The label-erased control retains the grid, waveforms and footer.
"""
import argparse
import hashlib
import sys, os, json, time, importlib.util
from pathlib import Path
from unittest.mock import patch
os.environ['OMP_THREAD_LIMIT'] = '1'
import cv2, numpy as np, pytesseract
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--baseline', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parent
sys.path.insert(0, str(root))
import lead_ocr
spec = importlib.util.spec_from_file_location('baseline', str(args.baseline))
baseline = importlib.util.module_from_spec(spec)
spec.loader.exec_module(baseline)
source = cv2.imread(str(root / 'clean_ecg_used.jpg'))
labels = [(name, (x, y, x + width, y + 22)) for x, names, width in [(68, ['I', 'II', 'III', 'II'], 38), (400, ['AVR', 'AVL', 'AVF'], 42), (733, ['V1', 'V2', 'V3'], 33), (1067, ['V4', 'V5', 'V6'], 33)] for name, y in zip(names, [21, 193, 365, 538])]
cases = []
for deg in (0, 90, 180, 270):
    cases.append((f'clean_{deg}', source, labels, deg))
for tag, xa, xb in [('limb_only', 0, 700), ('chest_only', 700, 1590)]:
    crop = source[:, xa:xb]
    anns = [(n, (a - xa, b, c - xa, d)) for n, (a, b, c, d) in labels if xa <= a and c <= xb]
    cases.append((tag, crop, anns, 0))
negative = source.copy()
for _, (a, b, c, d) in labels:
    negative[b:d, a:c] = 255
cases.append(('labels_removed', negative, [], 0))
cases.append(('blank', np.full_like(source, 255), [], 0))
photo = cv2.imread(str(root / 'clean_ecg.jpg'))
photo_boxes = [('I', (79, 33, 101, 55)), ('II', (91, 238, 123, 264)), ('III', (106, 434, 151, 460)), ('II', (119, 628, 154, 654)), ('AVR', (443, 28, 495, 56)), ('AVL', (450, 243, 501, 268)), ('AVF', (461, 443, 511, 471)), ('V1', (833, 25, 872, 53)), ('V2', (832, 246, 873, 272)), ('V3', (834, 453, 877, 479)), ('V4', (1252, 20, 1293, 48)), ('V5', (1242, 245, 1285, 273)), ('V6', (1234, 461, 1276, 489))]
photo_truth = [(n, tuple((round(v * photo.shape[1 if i % 2 == 0 else 0] / (2048 if i % 2 == 0 else 932)) for i, v in enumerate(b)))) for n, b in photo_boxes]
cases.append(('photographed_reference', photo, photo_truth, 0))
real = pytesseract.image_to_data
results = []

def turn_box(box, w, h, deg):
    a, b, c, d = box
    return {0: (a, b, c, d), 90: (h - d, a, h - b, c), 180: (w - c, h - d, w - a, h - b), 270: (b, w - c, d, w - a)}[deg]
for name, im, anns, rotation in cases:
    im = lead_ocr.rotate(im, rotation)
    h0, w0 = im.shape[:2]
    anns = [(n, turn_box(b, source.shape[1] if name.startswith('clean') else w0, source.shape[0] if name.startswith('clean') else h0, rotation)) for n, b in anns]
    row = {'case': name, 'expected_names': sorted(set((n for n, _ in anns)))}
    for tag, module in [('baseline', baseline), ('candidate', lead_ocr)]:
        calls = []

        def capture(view, **kwargs):
            d = real(view, **kwargs)
            calls.append((view.shape[:2], {k: list(d[k]) for k in ('text', 'conf', 'left', 'top', 'width', 'height')}))
            return d
        start = time.monotonic()
        with patch('pytesseract.image_to_data', side_effect=capture):
            result = module.read_labels(im)
        deg = result['rotation_degrees']
        upright = lead_ocr.rotate(im, deg)
        h, w = upright.shape[:2]
        truth = [(n, turn_box(b, w0, h0, deg)) for n, b in anns]
        matched = set()
        false = []
        for index, (shape, d) in enumerate(calls):
            if index < 4 and (0, 90, 270, 180)[index] != deg:
                continue
            sx = w / shape[1]
            sy = h / shape[0]
            for i, text in enumerate(d['text']):
                n = lead_ocr.token(text)
                if n not in lead_ocr.LEAD_TOKENS or float(d['conf'][i]) < 70 or d['height'][i] * sy < 10:
                    continue
                cx = (d['left'][i] + d['width'][i] / 2) * sx
                cy = (d['top'][i] + d['height'][i] / 2) * sy
                matches = [j for j, (label, (a, b, c, e)) in enumerate(truth) if label == n and a <= cx <= c and (b <= cy <= e)]
                if matches:
                    matched.update(matches)
                else:
                    false.append((n, round(cx), round(cy)))
        detected = sorted({lead_ocr.token(n) for n, c, ht in zip(result['text'], result['conf'], result['height']) if lead_ocr.token(n) in lead_ocr.LEAD_TOKENS and float(c) >= 70 and (ht >= 10)})
        row[tag] = {'matched_labels': len(matched), 'total_labels': len(truth), 'false_detections': sorted(set(false)), 'detected_names': detected, 'rotation': deg, 'seconds': round(time.monotonic() - start, 3), 'timed_out': result['ocr_timed_out']}
    print(json.dumps(row), flush=True)
    results.append(row)
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(json.dumps({'versions': {'tesseract': str(pytesseract.get_tesseract_version()), 'opencv': cv2.__version__, 'numpy': np.__version__, 'baseline_sha256': hashlib.sha256(args.baseline.read_bytes()).hexdigest(), 'candidate_sha256': hashlib.sha256((root / 'lead_ocr.py').read_bytes()).hexdigest()}, 'note': 'Development benchmark: one manually inspected reference ECG, its photograph, rotations and controlled partial/negative variants. Not independent clinical validation. Matches require correct name and center inside annotated label region. Repeated detections deduplicated.', 'results': results}, indent=2) + '\n')

# Fail the comparison gate on lower recall in any case, new false detections,
# or a lack of aggregate improvement. Timings are reported, not asserted.
before = sum(row['baseline']['matched_labels'] for row in results)
after = sum(row['candidate']['matched_labels'] for row in results)
regressed = any(
    row['candidate']['matched_labels'] < row['baseline']['matched_labels']
    or len(row['candidate']['false_detections']) > len(row['baseline']['false_detections'])
    for row in results
)
if regressed or after <= before:
    raise SystemExit('Comparison gate failed; do not replace the baseline.')
print(f'Comparison gate passed: {before} -> {after} correct localized labels.')
