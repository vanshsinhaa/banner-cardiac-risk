# Team integration handoff - November 3, 2026

Start here for [PR #6](https://github.com/vanshsinhaa/banner-cardiac-risk/pull/6).
Vansh explicitly authorized merging it into `main` on November 3 as a shared
development baseline, carrying forward the remaining work below. The PR records
the final merge status and commit. This is not a deployment or a claim that every
image, lead assignment or measurement is accepted.

## What happened and whose work this builds on

The branches supplied useful pieces, but combining the UI did not create a
working printed-text HTTP backend. An offline script reading saved detections
cannot process each new upload. Missing local Tesseract and digitizer setup then
caused separate downstream errors.

| Contribution | Source and integration outcome |
| --- | --- |
| Vansh's existing work | Four-corner capture/PNG correction, resolution handling, #48 embedded-metadata sanitization and #52 key-provider infrastructure from `vansh/bannerwork`. |
| Faith's existing work | Camera/privacy UI states, preprocessing prototype, OCR comparison, grouping, identifying-text rules and redaction from `faith/deid-connect`, `faith/preprocessing` and `faith/redaction` (PRs #3-#5). |
| Arsen's lead-recognition branch | Readability OCR, coordinate handling and spatial lead-assignment verification from `arsen/lead_recognition`. Taiga uses the team's Talgat assignments; branch names are not task reassignments. |
| Roberto's existing work | Digitizer wrapper, strip/paper-speed sampling calculation, shared-axis samples and optional trace/T-wave plots from `rob-ecg-digitizer` (PR #2). |
| Integration and new Vansh work | Connected those pieces to the current capture screen, reconciled API responses and CI, made dimension advice non-blocking, preserved the selected crop, built the missing HTTP privacy service, provisioned real local runtimes, fixed Windows startup/encoding issues, and added verification/docs. |

The new HTTP service **reuses and hardens Faith's functions**. It does not replace
her contribution or complete all her sprint work. Her existing prototype,
redaction and connectivity ticket wording did not explicitly assign this HTTP
wrapper. Vansh reports adding a separate Sprint 4 service task; its Taiga number
has not been supplied, so no number is invented here.

Source merge commits preserve contributors' history. The older `vansh-bannerwork`
branch (hyphen, PR #1) and `vansh/bannerwork` (slash) are distinct; do not assume
every later commit on the older branch is included. Reviewed source tips and
conflict decisions are in the [historical review](integration-review.md).

## Current processing path

```text
Browser photo + four user-selected corners
  -> corrected full-resolution PNG
  -> Next.js POST /api/deidentify
       -> metadata API :8001 /uploads/sanitize
       -> printed-text API :8002 /deidentify
       -> verified redacted PNG, or blocked with no usable image
  -> Save image / capture callback enabled for confirmed real output
  -> two independent checks on that redacted PNG:
       Next.js /api/analyze -> Python preprocessing + Tesseract
       Next.js /api/ecg/digitize -> digitizer :8000 /digitize
```

The lighting-corrected preview is separate and is not the digitizer input. A
downstream failure remains visible without undoing a successful privacy result.
Retry, crop adjustment, replacement and cancellation clear stale results.
Development mocks cannot authorize saving/downstream processing; production
ignores them.

**Remaining boundary:** the browser enforces this sequence. Downstream API routes
accept directly submitted PNGs without server-verifiable proof that those bytes
passed privacy. Browser digest checks prove observed UI behavior, not protection
against direct callers. Server-side provenance/admission remains necessary
before treating this as a trusted processing boundary.

## Contracts and code

| Stage | Entry point | Output / failure behavior |
| --- | --- | --- |
| Embedded metadata | [upload API](../services/upload-api/app/main.py), `/uploads/sanitize` | Fresh PNG with embedded metadata removed. Does not remove printed names or encrypt image payloads. |
| Printed text | [HTTP app](../services/upload-api/app/deidentify.py), [pipeline](../ocr/pipeline.py), [Paddle adapter](../ocr/runtime.py) | Multipart `file`, sanitized PNG. Success: `status: redacted`, PNG data URL, positive `regions_redacted`. Unknown/uncertain text, no identifying detection or failed verification blocks release. |
| Readability | [analyze bridge](../preprocessing/analyze.py), [lead OCR](../preprocessing/lead_ocr.py) | Label presence and lighting preview. Missing labels mean readability was not established. Label presence does not confirm waveform assignments. No second page warp. |
| Waveforms | [digitizer wrapper](../digitizer-service/server.py) | Keyed `leads`, nullable shared-axis samples, `units`, `samplingRateHz`, `leadVerification`, `requiresReview`. Preserve gaps and review flags. |

Privacy uses fresh upload OCR, validated masks, unchanged-pixel checks outside
masks, residual OCR and final metadata sanitation. Policy `printed-ecg-v1` permits
only a small set of standard ECG text besides recognized identifiers. Unknown or
low-confidence text blocks. One inference request is admitted at a time; busy or
unavailable returns 503, processing timeout 504, and privacy uncertainty 422,
without a candidate image. A timed-out native call retains its slot until it
finishes. `/health` is liveness; `/ready` checks loaded OCR and warm-up.
See the [HTTP record](../project%20docs/http-deidentify-implementation.md) for
deadlines, exact policy, model profile and evidence.

Roberto's `EcgDigitizationResult` is the runtime contract; the
[v0.1 schema](../schemas/README.md) is a legacy reference. Optional T-wave plots
do not supply a complete machine-readable measurement contract. No model-ready
CSV/export or cardiac-risk scoring is enabled.

## Set up on another Windows machine

Run from your checkout root on `main`. Older records refer to
`.integration/team-sync` because that was the working checkout; teammates do not
need a nested worktree. Use Node 22.13+ and Python 3.12. Install Tesseract and
Git LFS first. Tested Windows Tesseract was at
`C:/Program Files/Tesseract-OCR/tesseract.exe`; select your install with
`TESSERACT_CMD`. Runtimes/models are per-machine prerequisites, not Git contents.

Prepare the isolated privacy environment and models:

```powershell
npm ci
python -m venv ocr/.venv
ocr/.venv/Scripts/python.exe -m pip install -r services/upload-api/requirements-deid.txt
ocr/.venv/Scripts/python.exe -m ocr.prepare_models
```

Provisioning explicitly downloads `PP-OCRv5_mobile_det` and
`en_PP-OCRv5_mobile_rec` and writes `ocr/.models/manifest.json`. Requests do not
download models. Compare with the [tested model manifest](evidence/deid-service-2026-11-01/manifest.json)
when investigating differences; matching names alone does not prove equal weights.

Prepare a **separate** CPU digitizer environment to avoid Paddle/Torch conflicts:

```powershell
git clone https://github.com/Ahus-AIM/Open-ECG-Digitizer.git
git -C Open-ECG-Digitizer checkout 97a15087d4abcda843da8c58ee74b1d8f47e6f9a
git -C Open-ECG-Digitizer lfs pull
python -m venv Open-ECG-Digitizer/.venv
Open-ECG-Digitizer/.venv/Scripts/python.exe -m pip install -r digitizer-service/requirements-cpu.txt
Open-ECG-Digitizer/.venv/Scripts/python.exe -m pip check
```

Verify both weight sizes/hashes in the [November 2 record](../project%20docs/local-services-2026-11-02.md).
This is an inference profile, not upstream training. It also contains the Python
packages used by preprocessing. Other platforms have instructions in the
[digitizer README](../digitizer-service/README.md); this Windows test does not
establish identical behavior on every platform.

Create an ignored `.env.local` in your checkout root. Replace the example with
your **absolute** checkout path (forward slashes work on Windows):

```dotenv
UPLOAD_API_URL=http://127.0.0.1:8001
DEID_BACKEND_URL=http://127.0.0.1:8002
ECG_DIGITIZER_URL=http://127.0.0.1:8000
ECG_PYTHON=C:/path/to/banner-cardiac-risk/Open-ECG-Digitizer/.venv/Scripts/python.exe
TESSERACT_CMD=C:/Program Files/Tesseract-OCR/tesseract.exe
```

Keep `DEID_MOCK` unset. Start the prepared services:

```powershell
./scripts/start-local.ps1
```

The launcher uses fixed local ports, starts hidden processes, disables debug
plots, reuses reachable services, and writes logs/PIDs under ignored `.local-run/`.
It does not install prerequisites, download weights or restart existing healthy
processes after code/config changes. Restart the relevant owned process when
changing those; verify its command/path before using an old PID. Restart Next.js
after environment changes.

| Component | URL |
| --- | --- |
| App | <http://127.0.0.1:3107> |
| Metadata health | <http://127.0.0.1:8001/health> |
| Privacy readiness | <http://127.0.0.1:8002/ready> |
| Digitizer loaded-model health | <http://127.0.0.1:8000/health> |

## What everyone should test and expect

Use synthetic images first. Allow up to two minutes for downstream processing.

| Test | Expected result and interpretation |
| --- | --- |
| Upload `ocr/samples/clean_1.jpg`; move all corners to full page edges including the fake identifier header, then confirm | Black masks, Save image available, readability/digitizer run. This is a one-trace schematic. Observed: 0/12 readable labels, one tentative model waveform, `requiresReview: true`. It demonstrates connectivity, not correct twelve-lead digitization. |
| Upload `ocr/samples/very_blurry_1.jpg` | Privacy blocked, no Save/downstream requests; retry, adjust crop and replace available. Moderately blurred images can succeed if text remains sufficiently recognizable. |
| Try a new image or `public/synthetic-ecgs/standard-12-lead.png` | It can block: waveform segments or unfamiliar legitimate text may be read as uncertain text. The generated twelve-lead page currently blocks. Do not bypass privacy and call that end-to-end acceptance. |
| Readability says labels missing | Check crop and glyph clarity. 0/12 on the schematic is expected. A missing-Tesseract/service error is a separate setup problem. Label presence does not verify assignments. |
| Replace/cancel after a result or blocked crop | No previous result should appear as belonging to a replacement. Crop adjustment remains available after privacy failure. |
| Large phone JPEG | Lossless PNG may exceed the unchanged 10 MiB cap. Expect an explicit size error; no silent lossy conversion or downsizing. |

For an unconfigured digitizer, inspect `ECG_DIGITIZER_URL` and restart Next.js.
For missing Tesseract, check `TESSERACT_CMD`, `ECG_PYTHON` and preprocessing
dependencies in that environment. For privacy failure, check `/ready` and
`.local-run/privacy.stderr.log`. Do not add real OCR text, patient images or input
filenames to diagnostic reports.

## Verification and its limits

November 3 pre-publication checks: **64 frontend/API tests, 140 upload/key/metadata/
privacy tests, 34 preprocessing tests, 25 digitizer tests with no skips, and 11
redaction smoke checks passed**. Lint, TypeScript and production build passed.
Hosted CI is recorded on PR #6; local evidence does not replace hosted checks.

The November 1 real OCR run released 14 of 16 synthetic inputs and blocked the
two very-blurry cases. All 56 known identifiers in released outputs were covered;
final metadata and selected waveform pixels were independently checked. Detection
and residual OCR still share an engine and can share blind spots.

The November 2 real browser run used the one-trace fixture and actual services;
SHA-256 matched the privacy output to both numerical request bodies. A separate
direct numerical test on the generated twelve-lead page returned 12 arrays of
5000 samples, mV, 504.3 Hz and review flags; Tesseract confirmed 9 labels. That
page **did not pass privacy**. These separate results are not a twelve-lead
end-to-end success. A real digitizer outage returned 503 without waveforms while
privacy stayed healthy. Evidence is in the [local record](../project%20docs/local-services-2026-11-02.md).

Repeat the automated checks after installing dev dependencies:

```powershell
npm test
npm run lint
npx tsc --noEmit
npm run build
ocr/.venv/Scripts/python.exe -m pip install -r services/upload-api/requirements-dev.txt
ocr/.venv/Scripts/python.exe -m pytest -c services/upload-api/pytest.ini services/upload-api/tests -q
ocr/.venv/Scripts/python.exe ocr/test_redact.py
Open-ECG-Digitizer/.venv/Scripts/python.exe -m pip install -r digitizer-service/requirements-cpu-dev.txt
$env:PYTHONPATH='Open-ECG-Digitizer;digitizer-service;preprocessing'
$env:TESSERACT_CMD='C:/Program Files/Tesseract-OCR/tesseract.exe'
Open-ECG-Digitizer/.venv/Scripts/python.exe -m unittest discover -s preprocessing -p 'test_*.py' -q
Open-ECG-Digitizer/.venv/Scripts/python.exe -m unittest discover -s digitizer-service -p 'test_*.py' -q
```

With real services running, `ocr/.venv/Scripts/python.exe scripts/verifyDeidentify.py --all`
checks the privacy corpus. `node scripts/verifyFullFlow.mjs /path/to/playwright`
uses an existing Playwright installation for the actual browser smoke test.
`verifyLocalServices.py` intentionally checks numerical stages directly using
synthetic input; it is not the application's privacy path.

CI covers frontend/API/build, lightweight Python tests, privacy mechanics with
controlled OCR, and metadata-container build/health. It does not provision neural
runtimes or run the actual three-service browser pipeline. The metadata Docker
image does not package the new OCR service.

## Remaining sprint work and ownership

References/assignments reflect the November 1 Taiga read and the user-reported
new service task. No board status, assignment or comment was changed by this
integration. Coordinate proposed follow-ups with the owners.

| Work | What this integration covers | Next action / owner |
| --- | --- | --- |
| New Sprint 4 HTTP service task, number not supplied | Implementation, runtime provisioning and initial verification. | Vansh: attach PR/evidence to the existing task for normal acceptance; do not create a duplicate. |
| Faith #49/#54/#51 | Existing prototype/redaction/connectivity work forms the base; Closed in the board snapshot. | Faith + Vansh: review the shared pipeline and conservative input policy. This does not complete #60/#61. |
| Faith #60 content-leak checker | Known synthetic output-region checks added; complete reusable checker with deliberate-leak controls absent. | Build independent repeatable content checks with controls proving they detect leaks. |
| Faith #61 safe capture audit | Not implemented. | Add random capture ID, timestamp and safe outcomes, excluding images/OCR/filenames. |
| Vansh #65 de-identification verification | Initial HTTP/metadata/failure checks; full task incomplete. | Extend actual pipeline regression/independent verification, deliberate-leak controls and failure/log matrix. Coordinate with #60. |
| Vansh #64 wave-attribute validation | Existing review gate retained; complete voltage/timing/T-wave acceptance absent. | Agree producer T-wave and calibration/fallback fields with Roberto/model owner, then validate before model admission with clear reasons. |
| Talgat/lead-recognition and Roberto digitizer work | Real runtimes now run; partial labels/uncertain assignments remain review states. | Evaluate annotated layouts, Roman labels, conflicts, waveform fidelity and sampling calibration; setup alone does not close their tasks. |
| Privacy acceptance/direct-route provenance | Narrow policy causes false blocks; no trusted proof for downstream callers. | Faith + Vansh: broaden evidence before policy changes, bind privacy output to downstream bytes, bound/validate upstream response bodies. |
| Image capacity/phone acceptance | 10 MiB caps unchanged; sanitizer/readability pixel limits differ. Physical phone acceptance incomplete. | Team: benchmark stage limits; test camera permission, HEIC failure, corners, retake/cancel and save. See [size follow-up](../project%20docs/task-upload-size-limits.md). |
| #48/#52 and encryption | Existing metadata/key-provider work retained; not newly completed Faith work. | Hosting secret-store integration depends on deployment. Key providers do not implement #50 image-payload encryption. |

No universal PHI-removal, clinical accuracy, complete twelve-lead admission,
deployment security or risk-score readiness follows from this merge. Retain
privacy blocks and review flags while finishing these tasks.

## Continuing from main

Save local work, then fetch and fast-forward a clean local `main`:

```powershell
git fetch origin
git switch main
git pull --ff-only origin main
```

On a feature branch, merge `origin/main` after saving local changes. No force-push
or history rewrite is needed. Source/integration branches are preserved. Original
untracked planning/demo files remain in place; experimental design files are
outside this integration change. If rollback is needed, use a reviewed revert
of the PR merge rather than resetting shared history. No deployment is included.
