# HTTP de-identification service implementation

**November 3 update:** use the [team handoff](../docs/team-handoff.md) for current
setup, task ownership, merge decision and remaining work. No-publication and
missing-downstream-runtime statements below describe the original snapshot;
Tesseract and the digitizer were provisioned on November 2.

November 1, 2026. Implemented locally on `integration/team-sync-2026-10-30`,
preserving the existing capture-quality changes. The user reports adding the new
Sprint 4 service task; its Taiga reference has not been supplied. No commit,
publication, main merge or deployment is implied.

## Plan and implemented boundaries

November 2 setup follow-up: the previously missing Tesseract/digitizer runtimes
are now installed. See [current startup, evidence and remaining privacy limits](local-services-2026-11-02.md).
The verification below records the November 1 privacy-service snapshot.

1. Extract a callable, in-memory pipeline around Faith's grouping, identifying-text
   patterns and masking operations. Validate mask coordinates and verify before
   release. Never read saved detections to process a current upload.
2. Add a separate FastAPI app sharing the existing upload reader and #48 metadata
   sanitizer. Keep the established browser/Next.js response contract compatible.
3. Test deterministic mechanics, provision pinned CPU OCR, and exercise actual
   HTTP inference with independently checked synthetic identifiers/metadata.
4. Configure local service URLs and verify the normal browser flow without mocks
   or intercepted service responses.

These four steps are implemented. Known safe backend block codes are translated
to fixed user-facing messages by Next.js; arbitrary backend text is not relayed.
The full #60/#65 verification workflows, #61
audit events, #64 measurements, digitizer provisioning and server-side downstream
privacy provenance remain separate work.

Key files:

- [Shared pipeline](../ocr/pipeline.py), [Paddle adapter](../ocr/runtime.py),
  [model provisioning](../ocr/prepare_models.py).
- [HTTP app](../services/upload-api/app/deidentify.py),
  [service requirements](../services/upload-api/requirements-deid.txt).
- [HTTP/pipeline regressions](../services/upload-api/tests/test_deidentify.py),
  [adapter regressions](../services/upload-api/tests/test_deid_runtime.py).
- [Real HTTP check](../scripts/verifyDeidentify.py),
  [real browser check](../scripts/verifyLiveDeidentify.mjs).

## Contract and failure behavior

`POST /deidentify` accepts multipart `file` containing a PNG. It uses the existing
sanitizer defensively before OCR and on the final encoded artifact. It returns
HTTP 200 only after masking and verification:

```json
{"status":"redacted","image":"data:image/png;base64,...","regions_redacted":4}
```

No detection, uncertain text, unsupported pixels or failed verification returns
422 without an image. Unavailable OCR/busy service returns 503; expired processing
returns 504; existing upload errors retain their safe 400/411/413/415/422 statuses.
All service replies carry `no-store` and `nosniff`. `GET /health` establishes
liveness; `GET /ready` returns 503 until models and a blank-image warm-up succeed.
Restart after repairing an unavailable runtime/configuration.

The service uses one inference thread and admits one request at a time, rejecting
additional requests rather than building an unbounded queue. Upload reading has
a five-second timeout and processing a 45-second timeout. A timed-out native call
keeps its slot until it actually finishes; no candidate is published after timeout.
This bounds outstanding work but does not forcibly kill native OCR. Restart a
stuck service if necessary. The app's existing 55/60-second privacy deadlines and
10 MiB image caps remain. Decoded input is capped by the existing 50-million-pixel
sanitizer. Native inference and final encoding stay off the ASGI event loop.

Image handling is in memory; no candidate image, OCR text or input filename is
persisted/logged by the service. Multipart spooling follows the existing bounded
upload reader. Third-party model caches contain provisioned models; this is not a
guarantee of secure process-memory erasure or OS paging controls.

## Initial input policy and limitations

Policy `printed-ecg-v1` uses the prototype identifying-text patterns and a small,
explicit ECG-text allowlist: standard leads, 12-lead ECG title, rate, PR/QRS/QT/QTc,
paper speed and gain. Unknown or low-confidence text blocks release rather than
being called clean. This additional conservative policy needs Faith's review and
broader layout/corpus evaluation. Real clinical pages with other legitimate text
can therefore be blocked. Expanding the allowlist requires tests so names/IDs do
not become permitted accidentally. Lead/calibration preservation is checked
against the decoded RGB working image.

The service accepts opaque RGB/RGBA or grayscale working images and preserves
dimensions. It blocks partially transparent and high-precision unsupported modes;
it does not warp the already rectified crop. OCR's internal detection scaling is
mapped back by Paddle to the original supplied coordinates. Missing recognition
results or malformed polygons fail the adapter rather than disappearing silently.

Detection and residual verification use the same OCR engine. This is conservative
prototype behavior, not independent proof against shared OCR blind spots. The
synthetic HTTP check independently inspects all known identifier regions and
final PNG chunks/metadata, but does not complete #60's deliberate-leak checker
controls or #65's broader metadata/log/failure matrix. Unsupported handwriting,
barcodes, arbitrary identifier categories and real-world privacy/clinical approval
remain unverified. No universal PHI removal or compliance claim is made.

Faith's original offline CLI remains an experiment: it still reads saved
detections and writes candidate images before its own checks. The new service
does not invoke that CLI. The shared masker now rejects reversed, zero-area,
non-finite and fully outside coordinates, uses outward rounding for coverage,
and returns fixed safe errors instead of exception text.

## Reproduce on Windows

Run all commands from the **integration worktree**, `.integration/team-sync`.
Use Python 3.12. The isolated environment and models are ignored by Git:

```powershell
python -m venv ocr/.venv
ocr/.venv/Scripts/python.exe -m pip install -r services/upload-api/requirements-deid.txt
ocr/.venv/Scripts/python.exe -m ocr.prepare_models
```

Provisioning explicitly downloads `PP-OCRv5_mobile_det` and
`en_PP-OCRv5_mobile_rec`, then records file sizes/SHA-256 values in
`ocr/.models/manifest.json`. The service uses these local models, not request-time
downloads. Optional `DEID_DETECTION_MODEL_DIR` and `DEID_RECOGNITION_MODEL_DIR`
override their paths. CPU, two threads, disabled MKL-DNN and disabled document
orientation/unwarping are explicit. Packages are PaddleOCR 3.7.0, PaddlePaddle
3.3.1, PaddleX 3.7.2, NumPy 1.26.4, with the existing pinned HTTP dependencies.
This is a new tested profile, not Faith's historical Mac comparison profile.

Start each service in its own terminal:

```powershell
ocr/.venv/Scripts/python.exe -m uvicorn app.main:app --app-dir services/upload-api --host 127.0.0.1 --port 8001 --no-access-log
```

```powershell
ocr/.venv/Scripts/python.exe -m uvicorn app.deidentify:app --app-dir services/upload-api --host 127.0.0.1 --port 8002 --no-access-log
```

Check `http://127.0.0.1:8002/ready`. Put only these nonsecret URLs in `.env.local`
in the integration worktree, keeping `DEID_MOCK` unset:

```dotenv
UPLOAD_API_URL=http://127.0.0.1:8001
DEID_BACKEND_URL=http://127.0.0.1:8002
```

```powershell
node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3107
```

Open `http://127.0.0.1:3107`. Choose `ocr/samples/clean_1.jpg`; **move all four crop
corners to the full page edges**, including the synthetic identifier header. The
default inset crop can clip the header and appropriately block as uncertain.
Confirm the crop. Expect black identifier masks, preserved waveform/grid, and
an available **Save image** action. OCR took approximately 9–13 seconds per
released corpus image here; allow the full request deadline rather than assuming
that timing is guaranteed.

Repeat with `very_blurry_1.jpg`. Expect a blocked privacy state, retry/adjust-crop
actions, and no save or downstream requests. Separate readability/digitizer errors
are expected on this machine: their runtimes/models were not provisioned in this
task. Privacy success is not measurement validation or a complete scan result.

## Verification performed

| Check | Observed result |
| --- | --- |
| Upload/key/metadata/new service tests | **140 passed** in the isolated environment; controlled OCR in service/adapter tests. |
| Existing redaction smoke | **11 checks passed**. |
| Frontend/API regressions | **64 tests passed**, no skips. |
| ESLint, TypeScript and production build | Passed. |
| Real direct HTTP, original 16 synthetic fixtures | **14 verified outputs, 2 uncertain blocks**, no checked released leaks; all **56 identifiers** in released images fully covered. |
| Independent output assertions | Same dimensions, fresh PNG chunk allowlist/no marker/trailing data, all known identifier rectangles black, checked lower waveform area unchanged. Ground truth is never sent to runtime detection. |
| Actual Chromium workflow | Passed upload, four-corner confirmation, actual service output, synthetic PNG download, and blurred-input blocking with zero downstream requests. No service response interception. |
| Real Next.js privacy route | Clear input verified; blurred input blocked with the safe `uncertain_text` code. |

The two blocked cases are `very_blurry_1.jpg` and `very_blurry_2.jpg`. Designated
clean cases must succeed; the HTTP smoke script cannot pass by blocking everything.
Full-corpus timing, model hashes and synthetic screenshots are under
[evidence](../docs/evidence/deid-service-2026-11-01/http-direct.json).
Images: [verified capture](../docs/evidence/deid-service-2026-11-01/live-privacy-success.png),
[blocked capture](../docs/evidence/deid-service-2026-11-01/live-privacy-blocked.png).

The separate metadata/printed-text services and Next.js dev server were started
locally for this verification. This is not hosted CI or a deployed service.
Installed environments, local URLs and runtime/model caches are not committed.

### Repeat checks

```powershell
ocr/.venv/Scripts/python.exe -m pip install -r services/upload-api/requirements-dev.txt
ocr/.venv/Scripts/python.exe -m pytest -c services/upload-api/pytest.ini services/upload-api/tests -q
ocr/.venv/Scripts/python.exe ocr/test_redact.py
ocr/.venv/Scripts/python.exe scripts/verifyDeidentify.py --all
ocr/.venv/Scripts/python.exe scripts/verifyDeidentify.py --privacy-url http://127.0.0.1:3107/api/deidentify
node scripts/verifyLiveDeidentify.mjs /path/to/playwright
```

Deterministic service tests run in the existing upload CI job because its
requirements and Python paths include the shared OCR package; neural libraries
are optional for those tests. The metadata Docker build is unchanged and does
not package the new OCR service. Actual OCR/model/browser checks above are local
acceptance evidence, not an existing required hosted inference job.
