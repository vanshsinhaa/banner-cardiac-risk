# Learning notes: CI/CD with GitHub Actions and Docker

## Resources

| Title | URL | What I took from it |
| --- | --- | --- |
| "CI/CD Pipeline with GitHub Actions & Docker \| Automate Deployment to AWS", Tanuj Malode (YouTube, 40 min) | https://www.youtube.com/watch?v=ioTsICXbI0Y | The overall shape of a pipeline: code is pushed, a workflow builds and checks it, a Docker image is produced, then it is deployed (to AWS EC2 in the video). His project is Node/Express; I applied the same pattern to Python/FastAPI and stopped before deployment. |
| Workflow syntax for GitHub Actions (GitHub Docs) | https://docs.github.com/en/actions/writing-workflows/workflow-syntax-for-github-actions | `on: push / pull_request`, `permissions`, `defaults.run.working-directory` |
| Using jobs in a workflow (GitHub Docs) | https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-jobs | `needs`: if a needed job fails or is skipped, every job that needs it is skipped |
| actions/checkout README and releases | https://github.com/actions/checkout | Current major is `v7`; `persist-credentials` defaults to `true` |
| actions/setup-python README and releases | https://github.com/actions/setup-python | Current major is `v7`; `cache: pip` and `cache-dependency-path` |
| FastAPI: Request Files | https://fastapi.tiangolo.com/tutorial/request-files/ | Needs `python-multipart`; `UploadFile` is a spooled file |
| Starlette source, `starlette/formparsers.py` (v1.9.0) | https://github.com/encode/starlette/blob/master/starlette/formparsers.py | `MultiPartParser.spool_max_size = 1 MB`: bigger uploads go to disk |
| Pillow source, `PIL/Image.py` (v13.0.0) | https://github.com/python-pillow/Pillow/blob/main/src/PIL/Image.py | `MAX_IMAGE_PIXELS` and decompression-bomb errors |

## Concepts applied

- **Workflow triggers.** `on: push` and `on: pull_request` with no branch
  filter, so every push on every branch and every PR runs CI.
  `workflow_dispatch` adds a manual "Run workflow" button.
- **Jobs.** Two jobs, `test` and `docker-build`. Each job gets its own fresh
  Ubuntu virtual machine, so each job checks out the code again.
- **Steps.** Steps in a job run in order. `uses:` runs a prebuilt action
  (checkout, setup-python). `run:` runs shell commands.
- **Dependency installation.** `setup-python` installs Python 3.12. `pip
  install -r requirements-dev.txt` installs exact pinned versions, so CI uses
  the same versions as my laptop. `cache: pip` reuses downloads between runs.
- **Test failures block builds.** `pytest` exits non-zero when any test fails.
  That fails the step, which fails the `test` job. `docker-build` has
  `needs: test`, so GitHub skips it.
- **Docker build context.** `docker build ... services/upload-api` sends that
  folder (minus `.dockerignore` entries) to Docker. `COPY` can only see files
  inside the context. `.dockerignore` keeps `.venv/`, tests, and images out,
  which keeps the build fast and the image small.
- **Least privilege.** `permissions: contents: read` gives the workflow's
  token read-only access. `persist-credentials: false` stops the token being
  saved in the checkout. No secrets are needed.
- **Layer caching.** The Dockerfile copies `requirements.txt` and installs
  before copying `app/`, so code changes do not reinstall dependencies.

## Problems I hit

| Problem | Cause | Fix |
| --- | --- | --- |
| The repo had no API, no Python, no Docker, no workflows. | It is a Next.js front-end prototype. | Added a separate service in `services/upload-api/` instead of changing the Next.js app. |
| Uploads over 1 MB would be written to a temp file on disk, despite my "in memory only" goal. | Starlette's `MultiPartParser.spool_max_size` is 1 MB. Found by reading its source. | Raised `spool_max_size` above the request cap and reject oversize requests from `Content-Length` before parsing. Checked: a 9 MB upload was not rolled to disk. |
| Pytest warning: "Using `httpx` with `starlette.testclient` is deprecated; install `httpx2` instead." | Newer Starlette moved its test client to `httpx2`. | Replaced `httpx` with `httpx2==2.15.1`. Warning gone; 14 passed. |
| A truncated JPEG passed Pillow's `verify()`. | `verify()` checks structure, not the full compressed data. A truncated PNG raised `OSError` in `verify()`, a truncated JPEG did not, and `load()` raised "image file is truncated" for both. | The API runs `verify()` and then a full `load()`. `test_truncated_jpeg_rejected` covers it. |
| `curl.exe` from Git Bash failed with exit code 26 ("read error") on file uploads. | Windows `curl.exe` could not open the MSYS-style `/c/...` path. | Ran the commands from PowerShell with Windows paths. The README uses PowerShell for that reason. |
| `docker: command not found`, at first. | Docker Desktop was not installed yet. | Added a container start + `/health` check to the CI job so GitHub's runner verifies the image too, then installed Docker Desktop. |
| `docker: command not found` again, right after installing Docker Desktop. | Docker Desktop installs per-user (`%LOCALAPPDATA%\Programs\DockerDesktop\resources\bin`) and adds that to PATH, but terminals opened before the install keep the old PATH. | Opened a new terminal (or prepended that folder to `$env:Path`). `docker version` then showed client and server 29.9.1. |
| Two CI runs appeared for one push. | The branch already had an open pull request (PR #1), so the push fired both the `push` and `pull_request` triggers. | Expected behavior, not a bug. Both passed. A `branches:` filter on `push` would remove the duplicate if wanted. |
| Notice on the first run: "The ubuntu-latest label will migrate to Ubuntu 26 beginning October 19, 2026." | GitHub is moving the `ubuntu-latest` label to a newer OS. | No change needed now. Noted in the README limitations. |

## Exercises to check my understanding

1. **Break a test on purpose.** I changed the expected status in
   `test_empty_upload_rejected` from 400 to 401 and pushed it to branch
   `ci-demo-failing-test`. Prediction: `test` turns red, `docker-build` is
   skipped. Result (run #3): `1 failed, 13 passed`, "Process completed with
   exit code 1", and `Build Docker image` showed as skipped. Screenshots 08
   and 09.
2. **Build context.** I added `app/` to `.dockerignore` and rebuilt.
   Prediction: `COPY app ./app` fails because the folder is no longer sent
   to Docker. Result: `ERROR: failed to build: ... "/app": not found`, exit
   code 1. Restored `.dockerignore` afterwards.
3. **Change a trigger.** To run on push only for `main` and
   `vansh-bannerwork` but still on every PR:
   ```yaml
   on:
     push:
       branches: [main, vansh-bannerwork]
     pull_request:
   ```
   The syntax is under `on.push.branches` in the GitHub Docs workflow syntax
   page. I checked that it parses, but kept the unfiltered version so
   throwaway branches like `ci-demo-failing-test` still run CI.
4. **Add a test for BMP.** Uploading a valid synthetic BMP returned
   `415 {"detail": "Unsupported image format: BMP. Send PNG or JPEG."}`.
   It should be 415, not 422: the file is a real, undamaged image, just a
   type we do not accept. The existing GIF test already covers this code
   path, so I did not add a second permanent test.
5. **Permissions.** The workflow only reads the code, so `contents: read` is
   enough. Pushing an image to GitHub Container Registry would need
   `packages: write`. I left that out because this project does not publish
   images, and every extra permission is something a compromised step could
   misuse.

## Learning log

| Date | Activity | Resource | Time (h) | Notes |
| --- | --- | --- | --- | --- |
| 2026-10-20 | Watched the CI/CD video, then rewatched the Dockerfile and workflow sections and took notes | Tanuj Malode video | 1.0 | His pipeline ends with deployment to EC2; I decided my scope would stop at a built, health-checked image. |
| 2026-10-20 | Read workflow syntax and jobs docs; focused on triggers, permissions, `needs` | GitHub Docs | 0.75 | Learned that a skipped or failed needed job also skips everything after it. |
| 2026-10-20 | Picked action versions and caching options; read FastAPI file upload docs | actions/checkout, actions/setup-python, FastAPI docs | 0.5 | v7 for both actions; `python-multipart` is required. |
| 2026-10-20 | Built the upload API and its 14 tests with synthetic images; debugged temp-file spooling and truncated JPEGs | Starlette and Pillow source | 1.5 | Hardest part. The spooling issue only showed up by reading source code. |
| 2026-10-20 | Installed Docker Desktop (WSL 2), fixed the stale PATH, built and ran the image, checked HEALTHCHECK and non-root user | Docker Desktop | 1.0 | First time seeing a container report "(healthy)". |
| 2026-10-20 | Wrote the workflow, pushed, investigated the duplicate push/PR runs, ran the failing-test demo | GitHub Actions | 0.75 | Watching `docker-build` get skipped made `needs` click. |
| 2026-10-20 | Exercises 2–5 (build context, triggers, BMP test, permissions) | This repo | 0.5 | Build-context error message was clear once I knew what to look for. |
| 2026-10-20 | Captured evidence screenshots and wrote documentation | — | 0.5 | |
| **Total** | | | **6.5** | Within the 5–10 hour requirement. |
