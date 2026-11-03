# Local Tesseract and digitizer setup — November 2, 2026

**November 3 update:** Vansh authorized merging the development baseline with
remaining work documented in the [team handoff](../docs/team-handoff.md).
Statements about no commit/merge below describe the November 2 work only.

The missing downstream services are now configured and running locally. Existing
capture, privacy, and team integration changes were preserved. No commit, push,
main merge or deployment was performed.

## Installed and changed

- Tesseract 5.4.0.20240606 via verified winget package `UB-Mannheim.TesseractOCR`.
  The installer used `C:/Program Files/Tesseract-OCR/tesseract.exe`, despite the
  requested local directory. `TESSERACT_CMD` selects it without a manual PATH edit.
- Upstream digitizer commit `97a15087d4abcda843da8c58ee74b1d8f47e6f9a` and its
  real pretrained weights in ignored `Open-ECG-Digitizer/`. Verified against LFS:

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `unet_weights_07072025.pt` | 90,464,067 | `17fe7071ef270102631306127262fc08c250d79d4e3aeb572ab1719dd34d320b` |
| `lead_name_unet_weights_07072025.pt` | 23,296,757 | `840bd6bf2433ee6c22db67f57c861d9d427f29e10a32eeb334f0bcf061b175a2` |

- An isolated runtime, preserving the working Paddle environment. The tested
  [CPU profile](../digitizer-service/requirements-cpu.txt) pairs PyTorch 2.5.1+cpu,
  TorchVision 0.20.1+cpu and NumPy 1.26.4. Arrow 20.0.0 avoids the latest wheel's
  runtime-only NumPy 2 requirement. Ray Tune is imported by upstream's utility
  module even during inference; no model training is performed.
- `.env.local` sets `ECG_PYTHON`, `TESSERACT_CMD` and
  `ECG_DIGITIZER_URL=http://127.0.0.1:8000`. The lead OCR adapter supports the
  explicit executable path. The digitizer has loaded-model health and CPU bounds.
- A Windows encoding fix: upstream prints a Unicode arrow inside its rhythm
  assignment try block. cp1252 raises `UnicodeEncodeError`, a `ValueError`
  subclass, and skips assignment. The wrapper configures UTF-8 output before
  loading upstream. The previously failing rhythm regression now passes.

## Start and test

The app is at `http://127.0.0.1:3107`. Restart missing services with:

```powershell
./scripts/start-local.ps1
```

The launcher starts hidden processes, reuses healthy services, disables debug
plots, uses two CPU threads and the existing 2000-pixel inference cap, and writes
logs under ignored `.local-run/`. It never kills unrelated processes or downloads
models. Environments, configuration, caches, logs and weights are not committed.

| Service | Readiness |
| --- | --- |
| Metadata | `http://127.0.0.1:8001/health` |
| Privacy | `http://127.0.0.1:8002/ready` |
| Digitizer | `http://127.0.0.1:8000/health` |
| App | `http://127.0.0.1:3107` |

Manual browser checklist:

1. Choose `ocr/samples/clean_1.jpg`. Move all four corners to the full page edges,
   including its fake identifier header. Confirm the crop.
2. Expect redacted identifiers, an available Save action, a readability result
   and a tentative waveform count. Allow up to two minutes. There should be no
   missing-Tesseract or unconfigured-digitizer message.
3. This is a **one-trace schematic privacy fixture**, not an annotated twelve-lead
   ECG. On the observed run, readability found no lead labels and the model
   returned one tentative lead at 500 Hz with `requiresReview: true`. Do not treat
   that assignment or its measurements as confirmed.
4. Try `very_blurry_1.jpg`: privacy should block it, with no save or forwarding.
   Exercise retry, adjust crop and replacement; old results must not carry over.
5. Other images can still hit the conservative privacy policy. That is distinct
   from a missing runtime/service.

## Actual verification

| Check | Result |
| --- | --- |
| Runtime | `pip check` clean; actual Torch/TorchVision/NumPy imports and Tesseract version call passed. |
| Preprocessing | 34 tests passed, including explicit executable configuration. |
| Digitizer, sampling and pinned upstream tests | 25 tests passed, no skips, including all seven formerly skipped service tests and loaded-runtime health. Neural inference is controlled in those service tests. |
| Actual twelve-lead inference | Generated analytic page produced 12 arrays, each 5000 shared-axis samples, mV, 504.3 Hz, and an honest `needs_review` assignment status. |
| Actual Tesseract on that page | Nine labels confirmed; Roman I/II/III unconfirmed. HTTP 200 and `needs_review`, with no operational error. |
| Real browser | `clean_1.jpg` passed all three HTTP stages. SHA-256 checks verified that numerical requests used the exact privacy-confirmed PNG. No responses were intercepted. |
| Real outage | Stopping our digitizer made Next.js return 503 with no waveforms/images while privacy stayed healthy. The digitizer was restarted afterward. |

The [fixture generator](../scripts/makeFullFlowFixture.py) creates
`public/synthetic-ecgs/standard-12-lead.png` plus a truth JSON. Names, IDs and all
signals are invented. Nominal duration is 10 s; 504.3 Hz corresponds to about
9.915 s, versus nominal 500 Hz. This difference and review flags require evaluation;
they are not an approved measurement threshold or clinical validation.

**Remaining privacy limitation:** that generated twelve-lead page does not pass
the privacy gate. Paddle reads some waveform segments as uncertain text. Both
the original and a thinner/lower-amplitude rendering blocked. No privacy bypass
or threshold reduction was added. Thus the twelve-lead results test numerical
stages **independently**, not end-to-end acceptance of that page. The browser proof
uses the separate one-trace privacy fixture. These scopes must not be conflated.

Evidence: [browser stage summary](../docs/evidence/local-services-2026-11-02/summary.json),
[numerical-stage summary](../docs/evidence/local-services-2026-11-02/isolated-stage-summary.json),
[outage check](../docs/evidence/local-services-2026-11-02/digitizer-outage.json),
[browser screenshot](../docs/evidence/local-services-2026-11-02/complete-flow.png).

## Reproduce

From the integration worktree:

```powershell
Open-ECG-Digitizer/.venv/Scripts/python.exe -m pip install -r digitizer-service/requirements-cpu-dev.txt
$env:TESSERACT_CMD='C:/Program Files/Tesseract-OCR/tesseract.exe'
$env:PYTHONPATH='Open-ECG-Digitizer;digitizer-service;preprocessing'
Open-ECG-Digitizer/.venv/Scripts/python.exe -m unittest discover -s preprocessing -p 'test_*.py' -q
Open-ECG-Digitizer/.venv/Scripts/python.exe -m unittest discover -s digitizer-service -p 'test_*.py' -q
Open-ECG-Digitizer/.venv/Scripts/python.exe scripts/verifyLocalServices.py
node scripts/verifyFullFlow.mjs /path/to/playwright
```

`verifyLocalServices.py` deliberately calls numerical services directly using the
known synthetic fixture. It is not privacy acceptance or a production data path.
`verifyFullFlow.mjs` defaults to the original privacy fixture and uses real services.
`verifyDigitizerOutage.py` runs only while the operator has deliberately stopped
the digitizer; it does not stop services itself.

For a fresh machine, install Tesseract, obtain the exact upstream revision and
LFS weights per [setup](../digitizer-service/README.md), create its `.venv`, and
install `requirements-cpu.txt`. Configure paths before starting. This inference
profile does not replace upstream's full training environment.

## Main-merge status

Local runtime errors are resolved. Broader privacy/input acceptance (including
waveform false positives), independent #60/#65 controls, team review and proper
measurement/assignment acceptance remain. #64, #61 and phone acceptance are
separate deliverables. These setup/connectivity checks do not establish whole-app
accuracy, model-ready admission or clinical readiness. No merge is authorized by
this implementation work.
