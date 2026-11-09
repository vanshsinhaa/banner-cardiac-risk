#Task 60: repeatable PHI-leak check

One command that runs synthetic EKG images with known fake identifiers through the team's real de-identification pipeline (`ocr/pipeline.py`) and reports, per image and overall, whether any identifier is still readable. 

## Run it 
From the repo root, with the virtual enviornment active and the OCR models downloaded (`python -m ocr.prepare_models`, one time):
    
    python -m ocr.phi_leak_check

Reports are written to `ocr/leakcheck/report.md` and `ocr/leakcheck/report.json`. Synthetic images only: the report prints text the OCR read from the images.

## how it works
1. Each image in `ocr/amples/` goes through `deidentify_image()`.
2. A released image is judged against `ocr/samples/ground_truth.json` (where each fake identifier really is), independently of the detector. An identifier LEAKED if less tha nhalf of its box is solid black, or a fresh OCR pass reads text inside it. 
3. if the pipeline refuses (`PrivacyError`), no image is released. That is safe and is reported with its reason code, not counted as a leak. 
4. Control set: the same judge runs on the original images with redacton skipped. Every control must be flagged as a leak by the OCR check. If one is not, the checker is broken and the run fails. 

Exit codes: 0 = clean, 1 = a leak or unexpected error, 2 = checker broken (a control did not leak, or the OCR models could not load).

## Latest result (16 synthetic images)
- 14 released, 2 blocked (`very_blurry_1.jpg`, `very_blurry_2.jpg`, reason `uncertain_text `)
- 0 of 56 identifiers in released images leaked.
- 16 of 16 control images were flagged as leaks.
- Known miss: the #49/#54 prototype found 63 of 64 identifiers. The one
  it missed was `DOB: 02/23/1992` in `very_blurry_1.jpg`. The current pipeline
  blocks that image (`uncertain_text`) instead of releasing it, so the
  identifier is never exposed.

## What was tested 
Printed identifying text in the image content on synthetic pages (clean, blurry, very blurry, rotated, low-contrast and noisy, shadowed, small and tiny font), through the real pipeline and pinned OCR models.

## What was NOT tested
- Real patient photos or real EKG pages.
- Handwriting.
- Hidden metadata (EXIF and similar), CSV or other outputs.
- Identifiers OCR cannot see: detection and the check both use the same OCR
  engine, so a shared blind spot would not be caught. The answer key is only as
  good as the synthetic generator.

## Note

The team is changing the de-identification approach to cropping off the top
of the EKG instead of black boxes. The "covered" test in `black_fraction()` and
the coordinates in the answer key will need updating when that lands.