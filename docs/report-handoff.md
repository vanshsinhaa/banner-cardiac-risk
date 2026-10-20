# Report handoff: CI/CD pipeline with GitHub Actions and Docker

Facts for the two-page report, grouped by the five rubric categories (20
points each). Items marked **[YOU]** are things only you can supply: your
experience, feelings, prior knowledge, and real time spent. Do not fill them
with guesses. Final format: 2 pages, 12 pt, single-spaced, excluding figures,
exported to PDF from the assignment template.

## 1. Skill selection and relevance to capstone and career

Facts:
- Our capstone pipeline is EKG photo capture, de-identification, waveform
  digitizing, T-wave measurement, then (later) risk scoring from
  retrospective data. Several people will change image-handling code over
  months. Automated tests on every push catch regressions before they reach
  shared branches.
- Docker gives one reproducible runtime for a service that will later need
  heavier image libraries (for example OpenCV), regardless of each
  teammate's laptop.
- The repo had no CI at all before this work. The workflow is the team's
  first automated quality gate.
- CI/CD and containers are standard expectations in backend, ML-engineering,
  and health-tech roles.

**[YOU]**
- Why you chose this skill over others you considered.
- Your career direction and how this skill fits it.
- What you knew about CI/CD and Docker before starting.

## 2. Learning process and specific resources

Facts: see `docs/learning-notes.md` Part A for the resources the
implementation relied on (GitHub Docs workflow syntax and jobs pages,
actions/checkout and actions/setup-python READMEs, FastAPI request-files
docs, Starlette and Pillow source).

**[YOU]**
- Which of those you actually read, plus any courses, videos, or docs you
  used yourself. Include titles and links.
- Your learning log totals from `docs/learning-notes.md` Part B.
- **Requirement check:** the assignment requires 5 to 10 hours of learning.
  As of this handoff, **no personal learning time has been recorded.** This
  requirement is currently unmet.
- How you used the AI coding agent, stated plainly (for example: "an AI
  coding agent generated the first version; I reviewed, ran, modified, and
  tested it"). Match whatever your course's AI policy requires.

## 3. Demonstration through an original application

Facts:
- Service: `services/upload-api/` (FastAPI, Python 3.12). `GET /health`,
  `POST /uploads`.
- Upload checks use the file's bytes, not its name or claimed type. Returns
  400 empty, 413 too large (10 MB or 50 MP), 415 not PNG/JPEG, 422 damaged.
- Response includes a resolution check that mirrors the team's Taiga #44
  capture-screen rule (long side at least 2376 px).
- Privacy choices: in-memory only (verified a 9 MB upload was not written to
  disk), no image data in logs, synthetic images only,
  `"ekg_verified": false` in every response.
- 14 pytest tests, all images drawn in code.
- Dockerfile: `python:3.12-slim`, pinned dependencies, non-root user,
  built-in health check.
- Workflow `.github/workflows/upload-api-ci.yml`: runs on push and PR; job
  `test` then job `docker-build` (`needs: test`), which builds the image,
  starts it, and checks `/health`. Read-only permissions, no secrets, no
  deployment.
- Verified: tests pass locally and in GitHub Actions (14/14); local Docker
  build and healthy container running as `appuser`; container API responses
  201/400/413/415; Actions run #1 green; run #3 with a deliberately broken
  test shows the Docker job skipped. Links and screenshots in
  `docs/competency-evidence.md`.

Suggested figures (they do not count toward the 2 pages): see the screenshot
checklist in `docs/competency-evidence.md`. The strongest pair is the green
Actions run and the red-test/skipped-build run.

Scope statement to include: the prototype does not detect EKGs, de-identify
images, extract waveforms, predict risk, or establish HIPAA compliance.

**[YOU]**
- Which parts you changed or extended yourself after the agent's first
  version (for example, the five exercises in the learning notes).

## 4. Challenges and enjoyable aspects

Technical challenges observed during implementation (details in
`docs/learning-notes.md`):
- Starlette silently writes uploads over 1 MB to disk; fixed for privacy.
- Pillow's `verify()` accepts truncated JPEGs; added a full decode.
- Test-client deprecation (`httpx` to `httpx2`).
- Windows quirks: `curl` is a PowerShell alias; Git Bash paths broke
  `curl.exe` uploads.
- Docker Desktop was not installed at first; after installing, the old
  terminal still could not find `docker` (stale PATH).
- One push produced two CI runs because the branch has an open PR.

**[YOU]**
- Which of these you understood, reproduced, or found hardest yourself.
- Any challenges you hit when running it (Docker Desktop setup, first
  Actions run, etc.).
- What you enjoyed. Only real reactions.

## 5. Lifelong learning and future application

Concrete next steps where this skill applies in the capstone:
- Extend the same workflow to run the Next.js tests (`npm test`) and lint.
- Add the de-identification and digitizing services as further jobs, each
  gated on tests.
- Add a regression test set of synthetic EKG images with known T-wave values
  once digitizing exists, so accuracy changes show up in CI.
- Later, if the team approves: publish images to GitHub Container Registry
  with `packages: write`, plus dependency and image vulnerability scanning.

**[YOU]**
- How you plan to keep learning this (courses, certifications, side
  projects).
- Where you expect to use it after graduation.

## Unmet or unsupported requirements (as of 2026-10-20)

- 5 to 10 hours of personal learning: not recorded yet.
- Personal reflection details: marked [YOU] in `docs/report-draft.md`.
- Done: GitHub Actions runs (pass and deliberate fail), Docker build/run,
  all screenshots.
