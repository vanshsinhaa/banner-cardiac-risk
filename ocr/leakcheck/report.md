# PHI-leak check report

Result: **PASS** (exit code 0)

- Images checked: 16 (released 14, blocked 2, errors 0)
- Known fake identifiers in released images: 56
- Identifiers leaked (uncovered or still readable): 0
- Identifiers in blocked images (no image released): 8
- Control images (redaction skipped) not flagged as leaks: 0 of 16

## Leaks, by image and line

- none

## Blocked images (safe, but no usable output)

- `very_blurry_1.jpg` (very_blurry): uncertain_text
- `very_blurry_2.jpg` (very_blurry): uncertain_text

## Known miss from the earlier #49/#54 results

- `very_blurry_1.jpg`: "DOB: 02/23/1992" was not found by the earlier prototype (63 of 64). In this run the image's outcome is: blocked (uncertain_text).

## What was tested

- Printed identifying text in image content, on synthetic EKG pages with fake identifiers (clean, blurry, rotated, low-contrast and similar variants), through the real pipeline (ocr/pipeline.py) with the pinned OCR models.
- Control: the same checks on unredacted originals must report leaks.

## What was NOT tested

- Real patient photos or real EKG pages.
- Handwriting.
- Hidden metadata (EXIF and similar) and CSV or other outputs.
- Identifiers the OCR cannot see at all; the answer key is only as good as the synthetic generator.
