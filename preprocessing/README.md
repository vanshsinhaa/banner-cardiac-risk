# EKG Image Preprocessing Prototype

Part of Sprint 2, User Story #3 (handling imperfect EKG printouts), task #43. 

##What it does
Takes a photo of an EKG (paper or screen) and returns a cleaned-up image: 

1. Finds the EKG boundary: looks for the largest four-cornered shape in the photo. 
2. Corrects skew and perspectives: applies a perpsective transform so an angled photo becomes a flat, top-down rectangle. 
3. Normalizes lighting: flattens shadows and boosts local contrast so the trace stays visible. 

The `preprocess.py` CLI fixes images. The browser app calls `analyze.py`, which combines the preprocessing functions with the `quality.py` lead-label check after each confirmed crop.

## Setup
Requires Python 3. From inside the preprocessing folder: 

```bash
python3 -m venv venv
source venv/bin/activate
python -m pip install -r requirements.txt
```

## Usage
```bash
python3 preprocess.py <input_image> <output_image>
```

Example: 
```bash
python3 preprocess.py samples/angled_mild.jpg output/angled_mild_clean.jpg
```

The script prints "boundary_found=True" or "boundary_found=False":
- True: a boundary was found, and the output is flattened, lighting-corrected image. 
- False: no usable boundary was found. The output is the original image, unchanged, so a later step can handle it. 

In code, "preprocess(img)" returns "(image, boundary_found)".

To run every image in samples/
```bash
for f in samples/*.jpg; do python3 preprocess.py "$f" "output/$(basename "$f" .jpg)_clean.jpg"; done
```

## Testing
Tested on 8 images. These are variations of one non-patient sample EKG shown on laptop screen and photographed with a phone. "make_test_images.py" generates additional angled and shadowed versions from a source image. 

Before/after examples are in "sample/" (inputs) and "output/" (results).

## Known limitations 
- Test images come from a single EKG, so results may differ on other paper types, glare, or creases. 
- Cluttered scenes with several nested rectangles (toolbars, bezels, etc.) can lead to the wrong boundary being picked. 
- Very dark one-sided shadows can hide an edge, which returns "boundary_found=False".
- thin strips of border (such as a screen bezel) can remain at the image edges. 
- The script can't yet check whether a "found" boundary is the real page, so a wrong crop is possible. 
- Glare and low-resolution handling are not covered here. 
- The Next.js capture screen now calls the local Python pipeline through `/api/analyze`. See the repository README for server setup.

## ECG lead-label quality check

The original ZIP used one grayscale Tesseract pass. `lead_ocr.py` now tries
four orientations on a view that suppresses light grid lines and large waveform
components, then combines additional grayscale/blue-label passes from the best
orientation only. OCR views can be reduced to a 3000-pixel longest side, while
label heights are evaluated in the original input coordinates. No missing label
is inferred from its expected position, and ambiguous I/1/l substitutions are
not made. Internal filtering does not modify the displayed waveform image.

Install the Python requirements and Tesseract as described in the repository
README. No additional OCR engine or downloaded model is required.

`check_scan_quality(image)` returns acceptance, reasons, confirmed and uncertain
labels, a clockwise rotation in degrees, and whether any OCR attempt timed out.
Only exact tokens with confidence at least 70 and original height at least 10
pixels count toward a pass. Exact tokens with confidence of at least 35 that do
not meet the pass criteria are reported separately as uncertain. All 12 labels
are required by default. The original resolution and contrast checks remain.

The browser starts with the full photo selected. It distinguishes **Passed**,
**Failed — image quality check**, **Needs review — OCR incomplete**, and an
operational **Check unavailable** error. Needs review is not acceptance and does
not call the downstream capture callback. Partial ECG pages and readable labels
that OCR misses both require review; the app cannot distinguish those cases.

Each OCR attempt is capped at 6 seconds, with a 28-second total OCR budget.
Successful evidence is retained if another attempt times out, and the app shows
that the list may be incomplete. If every orientation attempt fails, processing
returns an operational error rather than a scan-quality rejection.

The processed preview is rotated to the selected reading orientation and then
lighting-corrected. No boundary means the manual crop is used. The standalone
`preprocess.py` CLI retains its original no-boundary behavior (unchanged output).

### Validation

```bash
python -B -m unittest discover -s . -p 'test_*.py' -v
python -B evaluate_photos.py /path/to/photos --output output/ocr-report.json --workers 3
```

The 20 unit tests cover acceptance/rejection, pipeline ordering, no-boundary
fallback, rotation isolation, original-pixel height checks, uncertainty and
partial/complete OCR timeouts. OCR pass cases use deterministic mocked evidence.

On the supplied 50-photo sample, the previous pipeline reported labels in 10
images (13 total reported labels; four operational errors). The revised pipeline
reported labels in 39 images (143 total; zero operational errors). Four revised
checks contained a timed-out individual attempt but retained other evidence.
**Neither version confirmed all 12 labels on any of these 50 images.** These are
coverage counts, not accuracy: the batch has no annotated ground truth, includes
partial pages, and was used during development. Independent validation is needed.

Lighting correction estimates the smooth background on a copy capped at 512
pixels on its longest side, then applies it at original resolution. This avoids
the previous very large blur kernel on full-resolution phone photos. A 12 MP
regression test checks shape, trace contrast, and reduction of lighting variation.
