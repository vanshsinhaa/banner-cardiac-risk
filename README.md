# ECG capture and lead recognition

A Next.js app for cropping ECG scans, checking printed lead labels with Tesseract,
and extracting waveforms through Rob's Open-ECG-Digitizer integration.

## Local setup

Install Node dependencies and Tesseract (macOS):

```bash
npm ci
brew install tesseract
```

Follow [digitizer-service/README.md](digitizer-service/README.md) to install the
pinned digitizer checkout, model weights, and Python dependencies. For the existing
local installation, set these values in `.env.local`, using your absolute path:

```dotenv
ECG_PYTHON=/absolute/path/to/banner-cardiac-risk/Open-ECG-Digitizer/.venv/bin/python
ECG_DIGITIZER_URL=http://127.0.0.1:8000
```

Start the two services in separate terminals from the repository root:

```bash
./digitizer-service/start-local.sh
```

```bash
npm run dev
# Or: npm run build, then npm run start
```

Open http://localhost:3000. Restart Next.js after changing its environment.
The installed local digitizer profile limits input size and GPU memory for an
8 GB Mac. See its README for the performance and accuracy tradeoffs.

For preprocessing alone, create `preprocessing/venv` and install
`preprocessing/requirements.txt`. The analyze route uses `ECG_PYTHON` when set,
otherwise that environment's Python, falling back to `python3`. Tesseract must
be on the server's PATH. Full functionality requires both services; this is a
Node/Python server application, not a static-site or Edge deployment.

## Capture and results

Select an image, adjust the full-image default crop, and choose **Confirm crop &
check**. Two requests run concurrently:

- `/api/analyze` preprocesses the crop and checks label readability using Tesseract.
  It corrects perspective when a boundary is found, selects reading orientation,
  then normalizes lighting. Without a boundary it uses the manual crop.
- `/api/ecg/digitize` extracts waveforms and checks local printed labels against
  their source regions on the digitizer's aligned image.

**Confirmed labels — built-in + Tesseract** counts unique standard lead names
recognized by either system. A label is unconfirmed only when neither supplies
usable evidence. Low-confidence OCR and default/fallback model layouts do not
count; I, II and III remain distinct. All 12 recognized names produce a success
label, while resolution/contrast failures remain separate image-quality errors.

For each waveform, a usable local Tesseract label takes priority over the built-in
recognizer. The API exposes this preference in `recognition.leads`, keyed by the
original waveform names; it does not rename or merge numeric arrays. The stricter
`leadVerification` and `requiresReview` evidence remains available in the API.
Detailed per-waveform feedback is omitted from the web UI.

Label presence does not prove waveform assignment, voltage, timing, or heart
health. The preprocessing-only acceptance criterion still requires all 12 labels
with confidence at least 70, original glyph height at least 10 pixels, and a crop
at least 600 pixels on its short side. Digitizer-local small-label refinement has
additional repeated-evidence and Roman-stroke checks described in the service
README. Historical OCR benchmarks are in [preprocessing/README.md](preprocessing/README.md).

Use **Adjust crop** to retry, **Capture another** for a new image, or the extraction
button to rerun digitization. Save downloads the displayed processed image when
available, otherwise the original crop.

## Limits and generated files

Uploads and generated PNG crops are limited to 10 MB (10 × 1024 × 1024 bytes).
Both routes enforce the limit while streaming uploads, even without Content-Length.
The readability endpoint also limits decoded images to 24 million pixels.

Each browser request, including its response body, times out after 120 seconds
and offers retry. The readability subprocess and digitizer proxy have the same
timeout; API timeouts return HTTP 504. Aborting an HTTP request does not forcibly
stop inference already running in the separate Python service.

The readability endpoint processes images in memory/stdin. The digitizer saves
generated PNG trace plots in `digitizer-service/trace-plots/`; these ignored files
can be removed when no request is active. `.next/` and `*.tsbuildinfo` are generated
build caches. Keep the installed digitizer checkout, weights, and Python environment
for full scans; they are intentionally ignored by Git.

## Validation and source locations

```bash
node --test tests/*.test.mjs
Open-ECG-Digitizer/.venv/bin/python -B -m unittest discover -s preprocessing
# Service tests additionally require httpx in the selected Python environment.
PYTHONPATH=Open-ECG-Digitizer:digitizer-service:preprocessing \
  Open-ECG-Digitizer/.venv/bin/python -B -m unittest discover -s digitizer-service
npm run lint
npm run build
```

Unit tests mock OCR/neural inference where appropriate and do not establish
real-image accuracy. For manual checks, try a full ECG, a crop with missing labels,
a crop below the minimum resolution, and an upload over 10 MB; verify retry and
saved-image behavior.

The page is `src/app/page.tsx`, capture UI is `src/components/EkgCaptureScreen.tsx`,
and combined label counting is `src/lib/combined-lead-labels.ts`. API routes live
under `src/app/api/`; Python processing and verification live in `preprocessing/`
and `digitizer-service/`.
