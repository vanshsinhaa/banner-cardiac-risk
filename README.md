This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Project progress and Sprint 3

The [project tracker](project%20docs/TRACKER.md) records Vansh's work newest first,
with dated decisions, verification, and remaining team handoffs. Sprint 3 details:
[image metadata removal (#48)](project%20docs/task-48-metadata.md),
[key management (#52)](project%20docs/task-52-key-management.md), and
[reproducible instructor demo](project%20docs/verification-2026-10-26.md).
For continuing on another computer, follow the
[device handoff](project%20docs/DEVICE-HANDOFF.md) on branch `vansh/bannerwork`.

## EKG upload API prototype and CI

`services/upload-api/` holds a small Python (FastAPI) service that checks an
uploaded EKG photo is a real PNG or JPEG. It is separate from the Next.js app.
GitHub Actions (`.github/workflows/upload-api-ci.yml`) runs its tests on every
push and pull request, then builds its Docker image only if the tests pass.
It removes embedded metadata from accepted PNG/JPEG uploads before further
processing and can return the sanitized PNG. It does not remove printed patient
text, verify EKG content, or score risk. Setup, commands, and limits:
[services/upload-api/README.md](services/upload-api/README.md).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.


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
