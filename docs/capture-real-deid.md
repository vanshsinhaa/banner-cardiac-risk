# Capture screen connected to the real de-identification services (#78)

The capture screen no longer runs in test mode. With `DEID_MOCK` removed, it sends
each confirmed crop through the metadata sanitizer and then the printed-text
de-identification service, and shows the cropped image they return.

## Start the services

Three terminals, all started from the repository root. The two services need
**Python 3.12** (the pinned FastAPI requires 3.10 or newer). Keep this environment
separate from any other Python environment you use for experiments.

One-time setup:

```bash
python3.12 -m venv ocr/.venv
source ocr/.venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r services/upload-api/requirements-deid.txt
# Only needed if ocr/.models/official_models is missing the two OCR model folders:
python -m ocr.prepare_models
```

Terminal 1, metadata sanitizer on port 8001:

```bash
source ocr/.venv/bin/activate
python -m uvicorn app.main:app --app-dir services/upload-api --host 127.0.0.1 --port 8001 --no-access-log
```

Terminal 2, printed-text service on port 8002 (loading the OCR models takes a moment):

```bash
source ocr/.venv/bin/activate
python -m uvicorn app.deidentify:app --app-dir services/upload-api --host 127.0.0.1 --port 8002 --no-access-log
```

Check http://127.0.0.1:8002/ready shows `ready` before using the app.

Terminal 3, the app:

```bash
npm run dev
```

## Environment variables

Put these in `.env.local` and make sure `DEID_MOCK` is not set (restart `npm run dev`
after changing the file):

```dotenv
UPLOAD_API_URL=http://127.0.0.1:8001
DEID_BACKEND_URL=http://127.0.0.1:8002
```

## What the screen does

- **Released page:** shows the cropped image with no TEST MODE banner. The image that
  can be saved or passed on is that same cropped image.
- **Blocked page** (blurry, rotated, dark, or header not found): shows a retake message
  and no image. Nothing is shown, saved or passed on.
- **Service not running or not configured:** shows an error and releases nothing.

The retake wording for each safe block code is in `src/app/api/deidentify/route.ts`.
Service text is never relayed to the screen; only that fixed wording is.

## Tested

- Browser, with both real services running and `DEID_MOCK` unset:
  `ocr/samples_cropping/clean_1.jpg` released a cropped image with no TEST MODE banner;
  `very_blurry_1.jpg` blocked with a retake message and no image.
- Browser, with the printed-text service stopped: the screen showed
  "Could not reach the image privacy services. No image was passed on."
- `src/lib/deidentifyRoute.test.ts` (8 tests, fake services): a released page returns the
  cropped image with no test flag; each of the six block codes returns its fixed message
  and no image; unknown codes and malformed or test-backend replies are never released;
  missing configuration, either service down, and a timeout each release nothing.
- `npm test`: 77 passing.

## Not tested

- Full-resolution photos: a 3459 x 2437 px JPG (3.7 MB) is rejected because the
  four-corner crop becomes a lossless PNG over the 10 MB limit. This is the existing
  limit described in the root README; the team's processing-size policy is still open.
  A downscaled copy of a real photo did release as well.
- Readability checks and digitizer: not part of this task. On this machine the digitizer
  was not configured and the readability check did not recognize every lead label
  (I, II and III were not read on `clean_1.jpg`).
- Hosted or deployed setups. All checks ran locally with synthetic sample pages.
- Real patient images are never committed to the repository.