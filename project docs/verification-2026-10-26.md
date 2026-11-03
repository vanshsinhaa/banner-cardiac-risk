# Verification and instructor demonstration — October 26, 2026

Local environment: Windows PowerShell, Python 3.12.1 in the upload service's
existing `.venv`, Node 22.9.0, Next.js 16.3.6, Pillow 13.0.0.
All new privacy tests/demonstrations use generated synthetic images and ephemeral
random keys. No real patient data or live deployment keys were used.

## Executed checks

| Check | Observed result |
| --- | --- |
| `npm test` at repository root | 31 tests passed; includes existing crop/perspective tests already present locally. |
| `npm run lint` | Passed, no ESLint findings. |
| `npx tsc --noEmit` | Passed. |
| `npm run build` | Passed; home page and not-found page generated. |
| `.venv/Scripts/python.exe -m pytest -q --tb=short` in `services/upload-api` | 112 tests passed in about 1.2 seconds. The original suite had 14 tests; parametrized cases are included in the count. |
| `.venv/Scripts/python.exe scripts/sprint3_demo.py` | Passed; summary below. |
| `git diff --check` | Passed; only Git's Windows LF/CRLF notices appeared. |
| Docker runtime check | Docker CLI exists, but the Docker Desktop Linux daemon was not running. No new container run/build result claimed. |

The build reported a non-blocking warning about `C:/Users/Vansh/package-lock.json`
being outside this Git repository. Node reported its existing experimental type
stripping/module-detection warnings. Neither prevented the checks from passing.

The initial implementation test run caught a missing-field response regression
and a Windows pytest parameter-name/path-length problem. The request content-type
guard restored the existing 422 response; explicit short case IDs fixed the
test runner issue. Final review also added cases for non-ASCII and enormous
integer length headers, with fixed client errors rather than parse exceptions.
The final suite above passes. This is local evidence; no new
hosted CI run, browser automation session, or physical-device session is claimed.

## Demonstrate the work

From the repository root in PowerShell:

```powershell
Set-Location services/upload-api
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m pytest -q --tb=short
.\.venv\Scripts\python.exe scripts/sprint3_demo.py
```

If setting up a fresh machine, create the venv first with
`py -3.12 -m venv .venv`. On Linux/macOS use `.venv/bin/python` instead.

The demo calls the actual FastAPI sanitized-image endpoint in-process. It makes
a PNG with a fake identifying tag and orientation, then proves metadata removal
and the expected pixel result. It uses the real key-provider module with the
Cryptography library to encrypt synthetic data, rotate keys, decrypt an old
package, deny a revoked version, and reject modified ciphertext. It writes no
images, key files, or payloads to disk. `cryptography==50.0.2` is a **development
dependency** for this handoff test/demo; no encryption library was added to the
runtime image for task #50 in advance of that task's implementation.

Observed output:

```json
{
  "task_48": {
    "embedded_metadata_removed": true,
    "orientation_and_pixels_preserved": true,
    "response_not_cacheable": true,
    "printed_identifiers_redacted": false
  },
  "task_52": {
    "aes_256_gcm_handoff": "passed",
    "rotation_preserves_old_decryption": true,
    "revocation_denied": true,
    "tampering_rejected": true
  },
  "keys_written_or_printed": false,
  "real_patient_data_used": false
}
```

## Explain the engineering simply

- A photo has visible pixels and hidden fields. The first task builds a new
  picture from only the pixels, so hidden fields are not copied. Orientation is
  applied first so a phone photo does not turn sideways.
- Removing hidden fields does not erase a printed name. The separate OCR and
  redaction tasks handle the visible text.
- A key ID tells the app which secret version encrypted a package; it is not
  the secret. New data uses the current version, while retained data can still
  use an older permitted version for decryption.
- Rotation changes the secret, not just its name. Revocation denies app access
  to a compromised version. Missing keys or failed authentication stop the
  operation rather than producing plaintext output.
- Tests demonstrate those behaviors and their failure cases. They do not prove
  clinical accuracy, full de-identification, compliance, or production readiness.

## Follow-up evidence still needed

Team review of PNG/JPEG scope; #51 end-to-end capture integration; #50 package
encryption integration; actual secret-store authorization/rotation/recovery;
container/hosted CI execution for these changes; physical camera-device checks.
Record each when it happens rather than backfilling results or hours.
