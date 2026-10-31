# EKG Image Preprocessing Prototype

Part of Sprint 2, User Story #3 (handling imperfect EKG printouts), task #43.

## What it does
Takes a photo of an EKG (paper or screen) and returns a cleaned-up image:

1. Finds the EKG boundary: looks for the largest four-cornered shape in the photo.
2. Corrects skew and perspectives: applies a perspective transform so an angled photo becomes a flat, top-down rectangle.
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

Inputs are in `samples/`. Generate before/after outputs with the CLI above; `output/` is ignored by Git. The generator creates four additional images.

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

The browser starts with the full photo selected and runs readability and digitization
concurrently. Its confirmed-label display combines confident Tesseract reads with
successful built-in recognition. A label is unconfirmed only when neither system
recognizes it. Image-quality failures and operational errors remain separate.
This visible label-presence result does not change the stricter OCR-only
`check_scan_quality` acceptance result or the spatial assignment audit.

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

The preprocessing unit tests cover acceptance/rejection, pipeline ordering, no-boundary
fallback, rotation isolation, original-pixel height checks, uncertainty and
partial/complete OCR timeouts. OCR pass cases use deterministic mocked evidence.

In the earlier whole-page OCR evaluation on the supplied 50-photo sample, the previous pipeline reported labels in 10
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

### Small-label enlargement follow-up

The selected orientation now receives up to two extra sparse-text OCR passes
on the filtered image enlarged 2x and 3x with linear interpolation. They run
only while the default 12-lead evidence is incomplete, share the existing
28-second deadline and six-second per-pass timeout, and are skipped if the
view would exceed 12 million pixels. Heights are divided by both the initial
resize scale and enlargement factor, so enlargement cannot bypass the original
10-pixel readability requirement. No confidence thresholds or token mappings
were relaxed. High-resolution photos may skip both passes under the pixel cap.

`benchmark_lead_ocr.py` compares a supplied baseline module with the current
implementation using real Tesseract, manually inspected label regions on the
included reference ECG and its photograph, four orientations, two partial-page
crops, a label-erased control, and a blank control. A correct detection must
have the correct name and its center inside the annotated label region.
Duplicate OCR detections at a label count once.

```bash
git show 4be2068:preprocessing/lead_ocr.py > /tmp/baseline_lead_ocr.py
python -B benchmark_lead_ocr.py --baseline /tmp/baseline_lead_ocr.py --output output/small-label-benchmark.json
python -B -m unittest discover -s . -p 'test_*.py' -v
```

On Tesseract 5.5.3, the upright reference improved from 3 to 7 distinct confirmed
lead names. Across all nine cases, correct localized labels improved from
16/78 to 34/78, with zero measured false detections for either version and no
case losing a correct detection. Neither negative control produced a label.
The photograph stayed at 3/13; its enlarged views exceed the pixel cap. The
upright reference took approximately 1.2 seconds before and 2.0 seconds after.
The 24 tests present at that benchmark passed; the suite has since expanded. Results depend on OCR/library versions.

This is a development regression fixture based on one ECG, not independent
validation or evidence that all 12 leads can be recognized reliably. No case
confirmed all 12 names. Do not reinterpret the prior unannotated 50-photo
coverage figures as accuracy. Further evaluation needs independently annotated
photos across devices, layouts, damaged pages, and absent-label controls.

When `read_labels(..., regions=source_regions)` is used by the digitizer service,
`region_ocr.py` adds bounded local glyph reads and Roman-numeral stroke validation.
Small labels need repeated confident evidence at the same location. The original
whole-page readability path without source regions remains unchanged. This
refinement improves assignment-check evidence; it does not infer missing leads
from the expected layout or validate the waveform's voltage/time calibration.
