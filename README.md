# Banner cardiac risk: EKG capture integration

This local integration combines Vansh's four-corner capture workflow with Faith's
camera/de-identification work, Arsen's readability and spatial lead checks, and
Roberto's digitizer, sampling-rate calculation, and optional T-wave plots.

**Review status:** the real de-identification HTTP backend is still missing.
The app blocks saving and downstream processing until that backend confirms
redaction. See [integration review](docs/integration-review.md) for merge gates,
test evidence, and the proposed rollout. Nothing has been deployed.

## Run the app

Use Node 22.13+ and Python 3.12. Install Node dependencies, then start Next.js:

```bash
npm ci
npm run dev
```

Open http://localhost:3000. Capture a photo, adjust all four corners, and confirm.
Resolution is checked against the original photo. The corrected crop stays PNG.
Unreadable photos return to the picker with an error.

For a synthetic preview without privacy services, add `DEID_MOCK=success` to
`.env.local` and restart `next dev`. The result is visibly marked TEST MODE;
saving, callbacks, readability analysis, and digitization remain disabled.
`DEID_MOCK=fail`, `nothing`, and `slow` exercise failure, unconfirmed redaction,
and cancellation. Production ignores all development mock modes.

## Service configuration

The intended processing order is:

```text
photo -> four-corner PNG -> embedded-metadata removal -> printed-text redaction
     -> confirmed PNG -> readability/lighting check and digitizer in parallel
```

Use separate ports for the independent services. Example `.env.local`:

```dotenv
UPLOAD_API_URL=http://127.0.0.1:8001
DEID_BACKEND_URL=http://127.0.0.1:8002
ECG_DIGITIZER_URL=http://127.0.0.1:8000
ECG_PYTHON=/absolute/path/to/preprocessing/venv/bin/python
```

On Windows, use the absolute `venv/Scripts/python.exe` path for `ECG_PYTHON`.
If omitted, the app checks `preprocessing/venv`, then the platform Python command.

- **Upload API (#48, #52):** [setup and tests](services/upload-api/README.md).
  Start with `python -m uvicorn app.main:app --port 8001` from
  `services/upload-api`. `/uploads/sanitize` returns a metadata-free PNG;
  it does not redact printed text or encrypt images.
- **Printed-text redaction (#49, #54, #51):** [OCR prototype](ocr/README.md)
  and [redactor](ocr/redact.py). These are offline prototypes, **not a running
  `/deidentify` HTTP server**. `DEID_BACKEND_URL` is a proposed future service;
  setting the URL does not create it. The required contract is in the review doc.
- **Readability/preprocessing:** [setup](preprocessing/README.md).
  Install Tesseract on the host and Python packages with
  `pip install -r preprocessing/requirements.txt`. The lighting-corrected preview
  is separate from the PNG passed to the digitizer, preserving its spatial audit.
- **Digitizer:** [pinned upstream, model weights, setup and verification](digitizer-service/README.md).
  Set `ECG_RESAMPLE_SIZE` only if needed (512–3000, default 2000). Paper speed
  defaults to 25 mm/s; the Python service accepts a `paper_speed` form field.
  Trace/T-wave plots are opt-in with `ECG_SAVE_TRACE_PLOTS=1` for synthetic tests;
  install `neurokit2` in that service environment for T-wave plots.

Both the original upload and each processing payload have a 10 MB limit. A
full-resolution lossless PNG can exceed the limit even when its JPEG source does
not. Such a crop is rejected explicitly; it is never silently resized or converted
to a lossy image. Confirm the team's processing-size policy before merging.
Measurements and proposed stage-specific limits are in
[the image-size follow-up](project%20docs/task-upload-size-limits.md).

The digitizer returns tentative `leads`, `samplingRateHz`, `units`, and a
`requiresReview` gate. Missing/conflicting spatial evidence requires review;
samples are not relabeled. Both raw PNG and Roberto's multipart `image` uploads
are supported by `/api/ecg/digitize`, and both receive waveform JSON.

The [v0.1 output schema](schemas/README.md) remains unchanged. Raw digitizer JSON
is not a schema-compliant model export: calibration/confidence and handling of
null gaps still require a team decision. No model export or risk scoring is enabled.

## Verification

```bash
npm test
npm run lint
npm run build
python -m unittest discover -s preprocessing -p 'test_*.py'
python -m unittest discover -s digitizer-service -p 'test_lead_verification.py'
python -m unittest discover -s digitizer-service -p 'test_signal_result.py'
python ocr/test_redact.py
```

Run the upload API's 112-test suite using its own environment from
`services/upload-api` with `python -m pytest -q`.

Optional browser verification uses an existing Playwright installation:

```bash
npm run build
npm run start -- --hostname 127.0.0.1 --port 3107
node scripts/verifyIntegration.mjs /path/to/playwright chromium
node scripts/verifyIntegration.mjs /path/to/playwright webkit
```

Browser checks stub services and use only generated synthetic images. They verify
workflow behavior, not OCR quality or neural inference. Review screenshots are
written under `.next/integration-verification/`.

## Project history and handoffs

- [Project tracker](project%20docs/TRACKER.md)
- [Four-corner capture design](docs/ekg-capture.md)
- [Metadata removal (#48)](project%20docs/task-48-metadata.md)
- [Key management (#52)](project%20docs/task-52-key-management.md)
- [Prior device handoff](project%20docs/DEVICE-HANDOFF.md)
- [Prior competency evidence](project%20docs/verification-2026-10-26.md)

The digitizer setup targets Open-ECG-Digitizer revision `97a1508`; see its own
README for its license and citation requirements before distribution.
