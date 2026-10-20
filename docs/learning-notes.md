# Learning notes: CI/CD with GitHub Actions and Docker

This file has two parts on purpose:

- **Part A** records what the coding agent (Claude Code) did and looked up
  while implementing the pipeline on 2026-10-20.
- **Part B** is for you. Only what you personally do, read, and confirm goes
  there. Part A does not count as your learning time.

## Part A: agent implementation record

### Resources consulted during implementation

| Title | URL | Used for |
| --- | --- | --- |
| Workflow syntax for GitHub Actions (GitHub Docs) | https://docs.github.com/en/actions/writing-workflows/workflow-syntax-for-github-actions | `on: push / pull_request`, `permissions`, `defaults.run.working-directory` |
| Using jobs in a workflow (GitHub Docs) | https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-jobs | `needs`: if a needed job fails or is skipped, jobs that need it are skipped |
| actions/checkout README and releases | https://github.com/actions/checkout | Current major `v7`; `persist-credentials` defaults to `true` |
| actions/setup-python README and releases | https://github.com/actions/setup-python | Current major `v7`; `cache: pip` and `cache-dependency-path` |
| FastAPI: Request Files | https://fastapi.tiangolo.com/tutorial/request-files/ | `python-multipart` is required; `UploadFile` is a spooled file |
| Starlette source, `starlette/formparsers.py` (installed package, v1.9.0) | https://github.com/encode/starlette/blob/master/starlette/formparsers.py | Found `MultiPartParser.spool_max_size = 1 MB` |
| Pillow source, `PIL/Image.py` (installed package, v13.0.0) | https://github.com/python-pillow/Pillow/blob/main/src/PIL/Image.py | `MAX_IMAGE_PIXELS`, decompression bomb errors |

### Concepts applied

- **Workflow triggers.** `on: push` and `on: pull_request` with no branch
  filter, so every push on every branch and every PR runs CI.
  `workflow_dispatch` adds a manual "Run workflow" button.
- **Jobs.** Two jobs, `test` and `docker-build`. Each job gets its own fresh
  Ubuntu virtual machine, so each job checks out the code again.
- **Steps.** Steps in a job run in order. `uses:` runs a prebuilt action
  (checkout, setup-python). `run:` runs shell commands.
- **Dependency installation.** `setup-python` installs Python 3.12. `pip
  install -r requirements-dev.txt` installs exact pinned versions, so CI uses
  the same versions as local runs. `cache: pip` reuses downloads between runs.
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

### Problems hit during implementation (observed, not hypothetical)

| Problem | Cause | Fix |
| --- | --- | --- |
| The repo had no API, no Python, no Docker, no workflows. | It is a Next.js front-end prototype. | Added a separate service in `services/upload-api/` instead of changing the Next.js app. |
| Uploads over 1 MB would be written to a temp file on disk, despite the "in memory only" goal. | Starlette's `MultiPartParser.spool_max_size` is 1 MB. Found by reading its source. | Raised `spool_max_size` above the request cap and reject oversize requests from `Content-Length` before parsing. Checked: a 9 MB upload was not rolled to disk. |
| Pytest warning: "Using `httpx` with `starlette.testclient` is deprecated; install `httpx2` instead." | Newer Starlette moved its test client to `httpx2`. | Replaced `httpx` with `httpx2==2.15.1`. Warning gone; 14 passed. |
| A truncated JPEG passed Pillow's `verify()`. | `verify()` checks structure, not the full compressed data. Tested: truncated PNG raised `OSError` in `verify()`, truncated JPEG did not, and `load()` raised "image file is truncated" for both. | The API runs `verify()` and then a full `load()`. Test `test_truncated_jpeg_rejected` covers it. |
| `curl.exe` from Git Bash failed with exit code 26 ("read error") on file uploads. | Windows `curl.exe` could not open the MSYS-style `/c/...` path. | Ran the commands from PowerShell with Windows paths. The README uses PowerShell for that reason. |
| `docker: command not found`. | Docker Desktop is not installed on this machine, and WSL has no distro. | Added a container start + `/health` check to the CI job, so GitHub's runner verifies the image. Locally, simulated the image's contents with a runtime-only venv. |

## Part B: for you to do and record

### Five checks of your own understanding

Do these yourself. Write down what happened in the log below.

1. **Break a test on purpose.** In `tests/test_api.py`, change
   `assert response.status_code == 400` in `test_empty_upload_rejected` to
   `401`. Push to a throwaway branch. Predict first: which job turns red, and
   what happens to `docker-build`? Then check the Actions tab, screenshot it,
   and revert.
2. **Explain the build context.** What would happen to the Docker build if
   `app/` were listed in `.dockerignore`? Try it locally (or reason it out)
   and write the error you expect.
3. **Change a trigger.** Edit the workflow so it runs on push only to `main`
   and `vansh-bannerwork`, but still on every pull request. Which docs page
   tells you the syntax?
4. **Add a test.** Write a test that uploads a valid BMP image (draw it with
   `synthetic_ekg_like_image("BMP")`). What status should it return, and why?
5. **Explain permissions.** Why does this workflow need only
   `contents: read`? What permission would a job need if it pushed an image to
   GitHub Container Registry, and why did we leave that out?

### Learning log (fill in with real activities only)

The assignment asks for 5 to 10 hours of learning. Record only actual time.
Agent work above does not count.

| Date | Activity (what you read, watched, built, or tested) | Resource / link | Time (h) | What you learned or got stuck on |
| --- | --- | --- | --- | --- |
| | | | | |
| | | | | |
| | | | | |
| | | | | |
| | | | | |
| | | | | |
| **Total** | | | | |

### Things you personally confirmed

Tick only what you did yourself.

- [ ] Ran `pytest -v` and saw 14 passed
- [ ] Ran the server and uploaded the synthetic image with `curl.exe`
- [ ] Built and ran the Docker image (needs Docker Desktop)
- [ ] Pushed the branch and watched the Actions run pass
- [ ] Broke a test and saw `docker-build` skipped
- [ ] Read the workflow file line by line and can explain each step
