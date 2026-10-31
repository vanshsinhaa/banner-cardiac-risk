# Task #49: OCR prototype for printed patient information 

Compares Tesseract, EasyOCR, and PaddleOCR on how well they find printed, patient-identyfying text on EKG pages. Only synthetic images with fake identifiers were used. No real patient data.

## How to run 
python make_synthetic_samples.py # creates samples/ (fake pages + ground truth)
python ocr_compare.py # runs all engines; results in results/

## test set 
16 synthetic JPEG pages, 2 per condition, 4 fake identifiers per page (patient name, MRN, date of birth, exam date), 64 identifiers per engine in total. Conditions: clean, rotated (6 degrees), blurry (Gaussian blur 3), very blurry (blur 6), low contrast + noise, uneven shadow, small font (18 px), tiny font (12 px). Each page also has non-identifying text (heart rate, intervals) that should not be flagged. 

## results ([N] images, [N] fake identifiers per engine)
engine       recall  precision  text sim  sec/img
tesseract      0.70       1.00      0.99     0.19
easyocr        0.86       0.96      0.97     1.80
paddleocr      0.98       1.00      0.99     5.98

Timing was measured on a Macbook Pro CPU (Python 3.9), excluding model loading. Per-image detections are in results/<engine>_detections.json, and annotated images are in results/annotated/<engine>/ (green = where the fake identifier really is, red = text flagged as identifying, blue = other text).

## How scoring works 
- Recall: an identifier counts as found if a flagged text row covers at least half of its true box. 
- Precision: a flagged row counts as correct if it covers at least half of the smaller of the two boxes when comapred with a true identifer.
- Flagging is rule-based: labels (Patient, MRN, DoB,...), dates, phone numbers, and long digit strings. 

## Licenses (all free)
- Tesseract: Apache 2.0 (uses Leptonica, BSD 2-clause)
- EasyOCR: Apache 2.0 License 2.0
- PaddleOCR: Apache 2.0 License 2.0

## Recommendation: PaddleOCR
It found 63 of 64 fake identifiers with no false alarms, the best result of the three. In this application a missed identifier (a possible leak) is worse than a false alarm, so recall decides it. Its cost is speed: about 6 seconds per image on CPU, roughly 3x slower than EasyOCR and 30x slower than Tesseract. That should be acceptable when processing one captured photo at a time. 

## failure cases
- Heavy blur (blur 6): Tesseract and EasyOCR found nothing (0/8); PaddleOCR found 7/8. Its misreads on these images ("Alex Mocon" for a name, a date missing its slash) still located the text correctly 
- Low contrast + noise: Tesseract found nothing (0/8); EasyOCR and PaddleOCR 8/8.
- Rotation (6 degrees): Tesseract 5/8, EasyOCR 7/8, paddleOCR 8/8.
- Small text (12 to 18 px) and uneven shadow: no engine failed on these images. 
- No engine is perfect, so redaction should not rely on OCR alone. If any image is blurry or OCR confidence is low, the app should ask for a retake or send the image for manual review instead of assuming it is clean. 

## Limitations 
- Synthetic, computer-rendered text is easier than real phone photos of paper or screens. Real-world accuracy will likely be lower.
- The test set is small (64 identifiers per engine), so a difference of one miss is not meaningful.
- Flagging is rule-based: an unlabeled name on a page would be missed, and a random long number would be flagged. 
- Only English and printed text were tested (no handwriting).

