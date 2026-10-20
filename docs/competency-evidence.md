# Competency evidence: CI/CD pipeline with GitHub Actions and Docker

Everything below was run and captured on 2026-10-20. Screenshots are in
`docs/evidence/`. Each one shows real command output or a real GitHub page.

## Screenshots

| # | File | Suggested caption |
| --- | --- | --- |
| 1 | `evidence/01-pytest-passing.png` | "All 14 automated tests pass locally. They cover the health check, PNG and JPEG uploads, empty files, fake and damaged images, unsupported formats, and the 10 MB size limit. Every test image is drawn in code." |
| 2 | `evidence/02-docker-build.png` | "A clean Docker build (`--no-cache`) of the service. The image installs only the pinned runtime dependencies and creates a non-root user." |
| 3 | `evidence/03-container-running-healthy.png` | "The container is running and Docker reports it as healthy. `whoami` shows it runs as `appuser`, not root, and `/health` answers." |
| 4 | `evidence/04-api-responses.png` | "The containerized API accepts a synthetic EKG-style PNG (201) and reports its real format and size. It rejects a text file renamed to .png (415), an empty file (400), and an 11 MB file (413)." |
| 5 | `evidence/05-actions-run-success.jpg` | "On push, GitHub Actions runs the tests and then builds the Docker image. Both jobs passed in 49 seconds." |
| 6 | `evidence/06-actions-pytest-log.jpg` | "Inside GitHub Actions, the same 14 tests run on a fresh Ubuntu machine with Python 3.12 and pass." |
| 7 | `evidence/07-actions-docker-health.jpg` | "The CI Docker job starts the built container and confirms `/health` returns ok before marking the build green." |
| 8 | `evidence/08-actions-failing-test-skips-build.jpg` | "A test was broken on purpose. The test job failed, and GitHub skipped the Docker build. Bad code never gets packaged." |
| 9 | `evidence/09-actions-failing-test-log.jpg` | "The failure log shows exactly which test failed and why (`assert 400 == 401`), and the step exits with code 1." |
| 10 | `evidence/10-api-docs-page.jpg` | "FastAPI generates interactive API docs from the code. The description states the prototype's limits." |

Recommended for the report (space is limited): 5 and 8 side by side
(pipeline passing vs. blocked), plus 4 (the application working). Use 1–3 if
there is room.

## GitHub Actions runs

| Run | Trigger | Result | Link |
| --- | --- | --- | --- |
| #1 | push to `vansh-bannerwork` (commit `6f64f05`) | Success: tests 14 passed, Docker build + health check passed | https://github.com/vanshsinhaa/banner-cardiac-risk/actions/runs/39507363998 |
| #2 | pull_request (PR #1, same commit) | Success, same jobs | https://github.com/vanshsinhaa/banner-cardiac-risk/actions/runs/39507365795 |
| #3 | push to `ci-demo-failing-test` (commit `653c09a`, one test broken on purpose) | Failure: 1 failed, 13 passed; Docker build **skipped** | https://github.com/vanshsinhaa/banner-cardiac-risk/actions/runs/39507689009 |

## All verified results

| Check | Where | Result |
| --- | --- | --- |
| Tests | local venv, Windows 11, Python 3.12.1 | 14 passed |
| Tests from pinned files only | fresh local venv | 14 passed |
| Tests | GitHub Actions, Ubuntu, Python 3.12.15 | 14 passed in 0.51 s |
| Docker build | local, Docker 29.9.1, `--no-cache` | Success, image 232 MB |
| Docker build | GitHub Actions | Success |
| Container health | local | `Up 40 seconds (healthy)`, `/health` → `{"status":"ok"}` |
| Container health | GitHub Actions | `Health check passed on attempt 2` |
| Container user | local, `docker exec upload-api whoami` | `appuser` |
| Upload synthetic 1200x600 PNG | container | 201, `detected_format: PNG`, `meets_minimum: false` |
| Text file named `.png` | container | 415 |
| Empty file | container | 400 |
| 11 MB file | container | 413 |
| Logs | container `docker logs` | Only method, path, status. No file names or image data. |
| In-memory handling | local, 9 MB upload | Not written to disk (`_rolled = False`) |
| Failing test blocks build | GitHub Actions run #3 | Test job failed, Docker job skipped |

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
