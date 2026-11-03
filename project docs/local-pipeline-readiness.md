# Local processing readiness — October 31, 2026

**Historical investigation:** the missing services below were subsequently
implemented/provisioned. Use the [November 3 team handoff](../docs/team-handoff.md)
for current setup, evidence, merge decision and remaining work.

Read-only investigation of the Windows integration worktree after a real upload
reported that de-identification was not configured. This investigation did not
install models, configure services, start processing backends, or change app code.

## Observed evidence

| Check executed | Observed result | Interpretation |
| --- | --- | --- |
| Actual `POST http://127.0.0.1:3107/api/deidentify` with a repository synthetic JPEG | HTTP 503; `De-identification is not configured. No image was passed on.`; no returned image | The real privacy route short-circuits before calling processing services. |
| Actual `POST /api/ecg/digitize` | HTTP 503; `The digitizer service is not configured.` | The digitizer route also lacks a configured backend. |
| TCP and HTTP checks on 8000, 8001, 8002 | None reachable | Nothing is serving the documented digitizer, metadata and redaction ports. |
| `.env*` files in the integration worktree | None found | The documented service URL configuration has not been created there. |
| Current shell configuration | `UPLOAD_API_URL`, `DEID_BACKEND_URL`, `ECG_DIGITIZER_URL`, `ECG_PYTHON`, `DEID_MOCK` absent | No corresponding settings are available from the diagnostic shell. This alone does not inspect another process's environment; the live route responses provide that evidence. |
| Real metadata API via FastAPI TestClient and tagged synthetic input | HTTP 200; PNG with only IHDR/IDAT/IEND; metadata empty and synthetic marker absent | Metadata removal is implemented and runnable; it needs an HTTP process and configuration. |
| `ocr/` source | Detection factories, pixel-redaction function and file-based experiment CLIs; no `/deidentify` HTTP handler | A real service adapter is missing, independently of configuration. |
| Current Python OCR packages | PaddleOCR/EasyOCR absent; pytesseract absent from normal environment, present only in ignored test dependency folder | Real OCR runtime setup is missing from the selected local environment. |
| Tesseract executable | Not on PATH and not at the standard `C:/Program Files/Tesseract-OCR/tesseract.exe` path | The documented lead-OCR executable is unavailable through the checked configuration; no whole-disk absence claim. |
| Expected `Open-ECG-Digitizer` checkout in this worktree | Absent | Python wrapper's upstream code/config/weight paths cannot be satisfied by the documented setup. |
| Actual PyTorch/TorchVision imports | Passed: 2.5.1+cpu / 0.20.1+cpu; CUDA unavailable | CPU libraries exist, but dependency compatibility and actual model inference remain unverified. |
| Pinned-upstream digitizer service tests | All seven skipped: upstream checkout missing; no service tests ran | Lightweight or skipped tests cannot establish real inference readiness. |

The expected ports come from repository setup examples. An external backend
could use a different address; no such configured address or external service
has been supplied or observed in this setup.

Code references:

- [Privacy route configuration guard](../src/app/api/deidentify/route.ts).
- [Digitizer route configuration guard](../src/app/api/ecg/digitize/route.ts).
- [Working metadata API](../services/upload-api/app/main.py).
- [Offline detection](../ocr/ocr_compare.py) and [redaction](../ocr/redact.py).
- [Digitizer startup/configuration](../digitizer-service/server.py) and
  [upstream-dependent tests](../digitizer-service/test_service.py).

## Required work, in dependency order

1. **Start metadata removal.** Use the existing upload API with its pinned
   environment on port 8001. Verify `/health` and submit a synthetic tagged image
   to `/uploads/sanitize`. Do not rebuild this component.
2. **Make real printed-text de-identification callable.** Install/pin Faith's
   selected OCR engine and model dependencies (her experiment recommends
   PaddleOCR). Refactor/reuse the existing detection/redaction functions behind
   the proposed multipart `/deidentify` endpoint on 8002. The file-oriented
   experiment runner is not an upload service: process the current image with
   actual OCR, preserve in-memory handling, redact real detected regions, verify
   output pixels/text/metadata, and return an image only on confirmed success.
   Replaying saved detections or painting a fixed header is not this step.
3. **Provision the existing digitizer.** Obtain the pinned Open-ECG-Digitizer
   revision and its pretrained model files, prepare an isolated Python 3.12
   environment with compatible dependencies and Tesseract, then run the existing
   Roberto/Arsen wrapper on 8000. Run upstream-dependent tests without skips,
   followed by actual weight-loaded inference. No new model training is needed
   to attempt the supplied pretrained inference pipeline.
4. **Configure and restart the app.** Set `UPLOAD_API_URL`, `DEID_BACKEND_URL`,
   `ECG_DIGITIZER_URL`, and an appropriate absolute `ECG_PYTHON` path in local
   configuration, pointing to the now-running services. Keep demo mocks off.
   Environment variables point to services; they do not create them.
5. **Verify the real HTTP flow.** Upload known synthetic inputs through the normal
   application route, without browser request interception or the demo proxy.
   Independently inspect outputs and prove expected failures remain blocked.

Use the runtime shape already produced by Roberto; these setup steps do not
require conversion to #42's legacy JSON schema. Structured T-wave measurement
fields/readiness rules for #64 and the complete independent #65/#60 test workflow
remain work beyond merely bringing up waveform inference. NeuroKit2 is currently
an optional T-wave plotting dependency, not a prerequisite for ordinary waveform
responses in the integrated wrapper.

## Where the upstream pieces come from

The team pins Open-ECG-Digitizer to
`97a15087d4abcda843da8c58ee74b1d8f47e6f9a`. Its official
[installation instructions at that revision](https://github.com/Ahus-AIM/Open-ECG-Digitizer/tree/97a15087d4abcda843da8c58ee74b1d8f47e6f9a)
require Python 3.12+, dependencies and Git LFS for pretrained weights. The pinned
[inference configuration](https://github.com/Ahus-AIM/Open-ECG-Digitizer/blob/97a15087d4abcda843da8c58ee74b1d8f47e6f9a/src/config/inference_wrapper.yml)
names `unet_weights_07072025.pt` and `lead_name_unet_weights_07072025.pt`.

Verify the exact checkout revision and actual weight content/checksums against
that revision's LFS records, rather than accepting small LFS pointer text files
as downloaded models. The upstream documents Linux testing; validate Windows
installation/inference explicitly before claiming it works on this machine.
Do not assume a successful PyTorch import establishes all dependency compatibility.

## Evidence required to call the whole pipeline connected

- Synthetic identifiers and metadata exist in the input and are absent from a
  successfully released output under independent text/pixel/metadata checks.
- A deliberately leaked identifier and reinserted metadata are detected by the
  checker; an unreadable or failed check cannot become an automatic privacy pass.
- A supported ECG fixture produces real model output with versioned model/config
  evidence; output samples change appropriately when the input changes. Validate
  against known/annotated traces, not merely the fact that a response differs.
- The digitizer receives the actual privacy-confirmed output bytes. Stop the
  privacy service and verify no later processing or unconfirmed image save occurs.
- Stop OCR or the digitizer and verify accurate, recoverable service errors rather
  than hardcoded successful labels/signals. Verify retry after services return.
- Run from the ordinary app with no local demo proxy, no `DEID_MOCK`, and no
  Playwright/network response fixtures. Retain safe synthetic case IDs and actual
  results for review.

## Reproduce the currently observed route failures

From the integration worktree while the app is running on 3107:

```powershell
curl.exe -i -F "file=@ocr/samples/clean_1.jpg" http://127.0.0.1:3107/api/deidentify
curl.exe -i -F "image=@ocr/samples/clean_1.jpg" http://127.0.0.1:3107/api/ecg/digitize
```

Both returned 503 during this investigation. These are configuration diagnostics;
the OCR fixture is not intended as a successful twelve-lead inference fixture.
