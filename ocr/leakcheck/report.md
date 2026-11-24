# PHI-leak check report

Result: **PASS** (exit code 0)

- Images checked: 16 (released 2, blocked 14, errors 0)
- Known fake identifiers in released images: 8
- Of those, fully inside the removed rows: 8
- Identifiers leaked (still readable in the released image): 0
- Identifiers in blocked images (no image released): 56
- Controls of released images not flagged as leaks: 0 of 2
- Controls OCR cannot read even before processing (all blocked, none released): 2

0 of 16

## Leaks, by image and line

- none

## Blocked images (safe, but no usable output)

- `blurry_1.jpg` (blurry): redaction_failed
- `blurry_2.jpg` (blurry): redaction_failed
- `lowcontrast_noisy_1.jpg` (lowcontrast_noisy): nothing_detected
- `lowcontrast_noisy_2.jpg` (lowcontrast_noisy): nothing_detected
- `rotated_1.jpg` (rotated): redaction_failed
- `rotated_2.jpg` (rotated): redaction_failed
- `shadow_1.jpg` (shadow): redaction_failed
- `shadow_2.jpg` (shadow): redaction_failed
- `small_font_1.jpg` (small_font): uncertain_text
- `small_font_2.jpg` (small_font): uncertain_text
- `tiny_font_1.jpg` (tiny_font): uncertain_text
- `tiny_font_2.jpg` (tiny_font): uncertain_text
- `very_blurry_1.jpg` (very_blurry): redaction_failed
- `very_blurry_2.jpg` (very_blurry): redaction_failed

Blocked by reason: redaction_failed x8, nothing_detected x2, uncertain_text x4

## What was tested

- Printed identifying text in image content, on synthetic EKG pages with fake identifiers (clean, blurry, rotated, low-contrast and similar variants), through the real pipeline (ocr/pipeline.py) with the pinned OCR models. The pipeline crops the header (footer is out of scope for now) off the image.
- Each known identifier must lie fully inside the removed rows, or have no readable text left in the released image.
- Pages the crop cannot be applied to are blocked: no image is released. They are listed above with their reason code.
- Control: the same checks on unredacted originals must report leaks.

## What was NOT tested

- Real patient photos or real EKG pages (this script has no answer key for them).
- Handwriting.
- Hidden metadata (EXIF and similar) and CSV or other outputs.
- Footer cropping (the synthetic pages have no footer; it is covered by unit tests).
- Identifiers the OCR cannot see at all; the answer key is only as good as the synthetic generator.
