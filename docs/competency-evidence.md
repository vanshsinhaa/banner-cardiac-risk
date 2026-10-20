# Competency evidence: CI/CD pipeline with GitHub Actions and Docker

Status key: **Verified** = run and observed on 2026-10-20. **Pending** = not
run yet; you must run it and capture it yourself.

## Screenshot checklist

| # | Capture | Status | Suggested caption |
| --- | --- | --- | --- |
| 1 | PowerShell window showing `pytest -v` with `14 passed` | Verified locally; screenshot pending | "All 14 automated tests pass locally. They cover the health check, PNG and JPEG uploads, empty files, fake and damaged images, unsupported formats, and the 10 MB size limit. Every test image is drawn in code." |
| 2 | PowerShell window showing `curl.exe` upload returning `201` with `upload_id`, `detected_format`, `width`, `height`, `ekg_verified: false` | Verified locally; screenshot pending | "The running API accepts a synthetic EKG-style PNG and reports its real format and size. It states that it did not check for an EKG." |
| 3 | Same window showing a rejected upload (`415` for a text file named `.png`) | Verified locally; screenshot pending | "The API reads the file's bytes, not its name. A text file renamed to .png is rejected with 415." |
| 4 | `docker build` finishing, then `docker ps` showing the container `(healthy)`, or the CI `docker-build` job log | **Pending**: Docker is not installed on the dev machine | "The service builds into a Docker image and runs as a non-root user. The container passes its own health check." |
| 5 | GitHub Actions run page: both jobs green, `docker-build` after `test` | **Pending**: no push yet | "On push, GitHub Actions runs the tests first. The Docker build runs only after the tests pass." |
| 6 (optional, strong) | A run where a test was broken on purpose: `test` red, `docker-build` grey "skipped" | **Pending** | "A failing test blocks the Docker build. The pipeline stops bad code before it is packaged." |
| 7 (optional) | `/docs` page in the browser | Pending | "FastAPI generates interactive API docs from the code." |

Tips: use a large terminal font, crop to the relevant part, and keep the
command and its result in the same shot. Do not include tokens, emails, or
anything from real patient images.

## Results verified so far (2026-10-20, Windows 11, Python 3.12.1)

| Check | Command | Result |
| --- | --- | --- |
| Tests (dev venv) | `pytest -v` in `services/upload-api` | 14 passed, 0 warnings |
| Tests (fresh venv from pinned files only, like CI) | `pip install -r requirements-dev.txt`, then `pytest` | 14 passed |
| Live health | `curl.exe http://127.0.0.1:8765/health` | `200 {"status":"ok"}` |
| Live valid upload (1200x600 synthetic PNG) | `curl.exe -F "file=@synthetic_ekg.png;type=image/png" .../uploads` | `201`, `detected_format: PNG`, `width: 1200`, `height: 600`, `meets_minimum: false` |
| Live text file named `.png` | same, `fake.png` | `415 File is not a recognized image.` |
| Live empty file | same, `empty.png` | `400 The uploaded file is empty.` |
| Live 11 MB file | same, `big.png` | `413 File is larger than the 10 MB limit.` |
| Server log content | uvicorn output | Only method, path, status. No file names or image data. |
| In-memory handling | 9 MB upload with a spy on the upload's temp file | `_rolled = False` (never written to disk) |
| Runtime deps only (what the image installs) | fresh venv with `requirements.txt`, run uvicorn, run the Dockerfile's HEALTHCHECK command | `/health` returned 200 |
| Workflow file parses | load YAML with PyYAML | triggers `push`, `pull_request`, `workflow_dispatch`; jobs `test`, `docker-build`; `needs: test` |

**Not verified:** `docker build`, `docker run`, and any GitHub Actions run.
The workflow existing in the repo does not prove it passes on GitHub.

## Relevant files

- `services/upload-api/app/main.py`: API code
- `services/upload-api/tests/test_api.py`, `tests/synthetic.py`: tests and synthetic images
- `services/upload-api/Dockerfile`, `.dockerignore`: container
- `.github/workflows/upload-api-ci.yml`: pipeline
- `services/upload-api/README.md`: how to run everything

## Why this is specific to our capstone, not a tutorial copy

- It is the server-side entry point of our own pipeline: EKG photo capture,
  then (later) de-identification, waveform digitizing, and T-wave
  measurement. This piece only covers the first gate.
- The resolution check reuses our team's Taiga #44 rule (photo long side at
  least 2376 px = 297 mm x 8 px/mm from `src/config/resolution.ts`), so the API
  and the capture screen apply the same minimum.
- Privacy-driven choices from our clinical context: no storage, no image data
  in logs, synthetic test images only, and an explicit `ekg_verified: false`
  so nobody mistakes "accepted" for "clinically valid".
- It handles a problem found while building it: Starlette writes uploads over
  1 MB to a temp file on disk. For medical images that matters, so the code
  raises that threshold and rejects oversize requests before parsing.
- Tests check attacker-style inputs a tutorial skips: wrong file extension,
  truncated JPEGs that pass Pillow's `verify()`, GIFs, and pixel bombs.
