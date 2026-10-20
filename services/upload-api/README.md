# EKG Upload API (prototype)

A small FastAPI service that accepts one EKG photo upload and checks that it is
a real PNG or JPEG. It exists to demonstrate a CI/CD pipeline (GitHub Actions +
Docker) around a piece of our capstone's image-capture flow.

## What it does

- `GET /health` returns `{"status": "ok"}`.
- `POST /uploads` takes one image in a multipart form field named `file` and
  returns a generated upload ID, the detected format, width, height, size, and
  a resolution check.
- The format is read from the file's bytes. The file name and the
  client-supplied Content-Type are ignored, because both are easy to fake.
- The resolution check uses the same minimum as the capture screen
  (`src/config/resolution.ts`, Taiga #44): the photo's long side must be at
  least 2376 px (297 mm page x 8 px/mm).
- Images are processed in memory and dropped after the response. Nothing is
  written to disk or a database. Logs contain only method, path, status, and
  never image bytes or file names.

## What it does NOT do

- It does **not** check that the image shows an EKG. Any valid PNG or JPEG is
  accepted. The response says so (`"ekg_verified": false`).
- It does **not** remove identifying information (no de-identification).
- It does **not** extract waveforms, measure T-waves, or produce a risk score.
- It is **not** HIPAA-compliant and has no authentication. Use synthetic
  images only. Never upload real patient images to it.

## Responses

| Case | Status |
| --- | --- |
| Valid PNG or JPEG | `201 Created` |
| Empty file | `400 Bad Request` |
| Not an image, or an image type other than PNG/JPEG (GIF, BMP, ...) | `415 Unsupported Media Type` |
| PNG/JPEG that is cut off or damaged | `422 Unprocessable Content` |
| Missing `file` field | `422 Unprocessable Content` |
| File over 10 MB, or more than 50 megapixels | `413 Content Too Large` |
| No `Content-Length` header | `411 Length Required` |

Size limit: **10 MB** per file (`MAX_UPLOAD_BYTES` in `app/main.py`). Requests
are rejected from their `Content-Length` header before the body is parsed if
they are clearly too big.

Example success body:

```json
{
  "upload_id": "9cc1803a-bac8-4000-82ea-84758f16409e",
  "detected_format": "PNG",
  "media_type": "image/png",
  "width": 1200,
  "height": 600,
  "size_bytes": 9395,
  "resolution_check": {"long_side_px": 1200, "required_long_side_px": 2376, "meets_minimum": false},
  "stored": false,
  "ekg_verified": false,
  "note": "Image format was checked. Content was not checked for an EKG."
}
```

## Files

| Path | Job |
| --- | --- |
| `app/main.py` | The API: routes, size limits, image checks. |
| `tests/test_api.py` | 14 pytest tests. |
| `tests/synthetic.py` | Draws fake EKG-style images in code for tests. |
| `scripts/make_synthetic_image.py` | Writes a synthetic image for manual testing. |
| `requirements.txt` | Runtime dependencies (pinned). |
| `requirements-dev.txt` | Runtime + test dependencies. |
| `Dockerfile`, `.dockerignore` | Container image. |
| `../../.github/workflows/upload-api-ci.yml` | The CI workflow. |

## Setup and run (Windows PowerShell)

Needs Python 3.12 (`py -3.12 --version`). From the repository root:

```powershell
cd services\upload-api
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements-dev.txt
```

If `Activate.ps1` is blocked, run this once, then activate again:
`Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`

Run the tests:

```powershell
pytest -v
```

Run the server (Ctrl+C to stop):

```powershell
uvicorn app.main:app --port 8000
```

Interactive API docs are then at http://127.0.0.1:8000/docs.

## Try an upload

In a second PowerShell window, from `services\upload-api` with the venv active:

```powershell
python scripts\make_synthetic_image.py synthetic_ekg.png
curl.exe http://127.0.0.1:8000/health
curl.exe -F "file=@synthetic_ekg.png;type=image/png" http://127.0.0.1:8000/uploads
```

Use `curl.exe`, not `curl`. In Windows PowerShell 5.1, `curl` is an alias for
`Invoke-WebRequest`, which takes different arguments.

Try a rejected upload:

```powershell
"not an image" | Out-File fake.png
curl.exe -w "`nHTTP %{http_code}`n" -F "file=@fake.png" http://127.0.0.1:8000/uploads
```

Same upload from Python:

```python
import httpx2  # installed by requirements-dev.txt
with open("synthetic_ekg.png", "rb") as f:
    r = httpx2.post("http://127.0.0.1:8000/uploads", files={"file": ("synthetic_ekg.png", f, "image/png")})
print(r.status_code, r.json())
```

## Docker

Needs Docker Desktop running. From `services\upload-api`:

```powershell
docker build -t ekg-upload-api:local .
docker run --rm -d --name upload-api -p 8000:8000 ekg-upload-api:local
curl.exe http://127.0.0.1:8000/health
docker ps            # STATUS should show "(healthy)" after ~30 s
docker stop upload-api
```

The image is based on `python:3.12-slim`, installs only `requirements.txt`,
copies only `app/`, and runs as a non-root user (`appuser`, uid 10001).

## CI workflow

File: `.github/workflows/upload-api-ci.yml` (at the repository root, because
GitHub only reads workflows from there).

**Triggers:** every push to any branch, every pull request, and a manual
"Run workflow" button (`workflow_dispatch`).

**Permissions:** `contents: read` only. No secrets are used.

**Job 1, `test`:**
1. Check out the code.
2. Install Python 3.12 (`actions/setup-python`), with pip download caching.
3. `pip install -r requirements-dev.txt`.
4. `pytest -v`. If any test fails, this step fails, and the job fails.

**Job 2, `docker-build`:** has `needs: test`, so it is skipped unless job 1
passed.
1. Check out the code.
2. `docker build` with `services/upload-api` as the build context.
3. Start the container and call `/health` until it answers (up to 15 tries).
   Print container logs and fail if it never answers.
4. Remove the container (always runs, even after a failure).

Nothing is pushed to a registry and nothing is deployed.

## Known limitations

- No EKG detection. Any PNG or JPEG passes.
- No authentication, rate limiting, or HTTPS. Local/demo use only.
- Upload IDs are not saved anywhere; they cannot be looked up later.
- The resolution minimum is copied from `src/config/resolution.ts`. If one
  changes, the other must be changed by hand.
- Uploads must send a `Content-Length` header (curl, browsers, and httpx do).
- The in-memory guarantee relies on raising Starlette's
  `MultiPartParser.spool_max_size`. A Starlette upgrade could change that.
- The Docker build and container health check were written without a local
  Docker install. Their first real run is the GitHub Actions `docker-build`
  job (or your own `docker build`).
