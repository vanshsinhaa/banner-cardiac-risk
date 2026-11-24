# De-identification: header cropping (#77)

## What it does
The physician asked for the identifying header to be removed instead of covered with black
boxes. `ocr/pipeline.py -> deidentify_image()` now:

1. Runs OCR once as a hint to find the lowest identifying line in the top half.
2. Finds where the EKG grid starts (`ocr/redact.py -> crop_header`). The detector looks for long
   vertical lines in 6 strips, so it works for any grid colour. It cuts at the grid and never
   above the lowest identifying text OCR found.
3. Checks that the remaining pixels are an exact copy of the matching rows of the original.
4. Runs OCR again on the cropped image. If any identifying text remains, the image is blocked.

If any step fails, nothing is released and the caller gets a safe reason code
(`redaction_failed`, `nothing_detected`, `verification_failed`, ...). The response contract is
unchanged: a cropped page reports `regions_redacted = 1`.

## Scope decision
These pages are designed for one hospital, which prints identifying information at the top.
Only the header is cropped. The physician has not yet confirmed whether the bottom of the page
can stay. Until then, the second OCR check covers the whole cropped image, so a footer line that
looks identifying (for example a device number) blocks the image.

## Settings (`ocr/redact.py`)
`INK_DELTA`, `LINE_COVER`, `MAX_SLANT_FRACTION`, `MAX_CROP_FRACTION`, `MARGIN_PX`. `MARGIN_PX`
keeps original pixels above the grid; it is 0 so the cut is right at the grid. Padding with
new white pixels would break the "remaining pixels identical to the original" rule.

## How it was tested
Run from the repo root with the venv active: `python -m ocr.phi_leak_check`
(writes `ocr/leakcheck/report.md`). It uses 16 synthetic pages (`ocr/samples_cropping/`,
regenerate with `python -m ocr.make_synthetic_cropping_samples`) with fake identifiers and an
answer key.

Result: 16 images, 6 released, 10 blocked, 0 identifiers leaked (24 of 24 fully inside the
removed rows).

| Variant | Outcome |
|---|---|
| clean, small_font, tiny_font | released |
| blurry, very_blurry, rotated, shadow | blocked (`redaction_failed`) |
| lowcontrast_noisy | blocked (`nothing_detected`) |

Blocked pages release nothing, so they cannot leak. This is intentional: the capture screen
asks the user to retake photos that are blurry, dark or tilted, rather than the detector
guessing on bad images.

Control set: the same judge runs on unprocessed originals and must flag them as leaks. It is
counted only for released pages. For the two `very_blurry` originals, OCR cannot read the
identifiers even before processing; both were blocked.

## What was NOT tested
- Real patient photos at scale. The header crop was checked by eye on 2 real photos from the
  physician: the header was removed and the waveform was intact.
- Handwriting.
- Hidden metadata (EXIF and similar) and CSV or other outputs.
- Identifiers the OCR cannot see at all. The answer key is only as good as the synthetic generator.

## Known limits
- Rotated, shadowed, low-contrast and blurry pages are blocked, not cropped.
- Real photos currently still block: the second OCR pass checks the whole cropped image, and
  the footer of the real photos has a row of digits (a device number) that matches the
  identifying rules. Device numbers are on the HIPAA Safe Harbor list. Options: crop the footer
  too, or restrict the second check to the top of the image if the physician confirms the
  footer is not identifying (`RESIDUAL_CHECK_FRACTION` in `pipeline.py`).
- The paper colour is the most common grey value, so strong uneven lighting can fool it.