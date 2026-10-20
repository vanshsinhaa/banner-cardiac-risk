# Growing Competency Report: CI/CD Pipeline with GitHub Actions & Docker

> DRAFT. Paste into the assignment template, 12 pt, single-spaced, 2 pages
> of text (figures do not count). Everything here matches what was built and
> run. Replace every **[YOU: ...]** with your own facts before submitting, or
> delete the sentence. Do not submit with brackets left in. About 1,050 words
> now, so keep additions short.

## 1. Skill Selection and Relevance

I chose CI/CD with GitHub Actions and Docker from the Growing Competencies
list. Our capstone with Banner Health turns photographed EKG printouts into
data for cardiac risk research: capture the image, remove identifying
information, digitize the waveform, measure T-waves, and later score risk
from retrospective data. Several teammates change the image-handling code
every sprint, and until now our repository had no automated checks at all.
A pipeline that tests every push catches mistakes before they reach a shared
branch. Docker matters for the same reason: our later processing steps will
need heavier image libraries, and a container gives every teammate and every
server the same runtime. **[YOU: one sentence on your career goal and why
this skill supports it, e.g. backend or health-tech roles.]** **[YOU: what
you knew about CI/CD and Docker before this, honestly, e.g. "I had used Git
but never written a workflow or a Dockerfile."]**

## 2. Learning Process and Resources

The course list pairs this competency with a video on CI/CD with GitHub
Actions and Docker (https://www.youtube.com/watch?v=ioTsICXbI0Y). **[YOU:
only if you watched it, one or two specific things you took from it.]** The
implementation followed the official documentation: GitHub's "Workflow syntax for GitHub Actions" and "Using jobs
in a workflow" pages, which define triggers, permissions, and how `needs`
makes a job wait for (and be skipped by) another job; the READMEs for
`actions/checkout` and `actions/setup-python` to pick current versions
(v7) and pip caching; and FastAPI's "Request Files" page, which explains that
uploads use a spooled temporary file. That last point sent me into the
Starlette source code, where I found uploads over 1 MB are written to disk.

I used an AI coding assistant (Claude Code) to write the service, tests,
Dockerfile, and workflow, and to run the tests, Docker build, and pipeline
under my direction. I set the requirements, installed Docker Desktop, and
approved the pushes. **[YOU: what you reviewed, changed, or re-ran yourself;
match your course's AI policy.]** I tracked my time in a learning log: **[YOU: total hours, and the
main activities, e.g. "6 hours: 1.5 h video and docs, 1 h installing and
learning Docker Desktop, 2 h running and breaking the pipeline, 1.5 h
writing up". The assignment requires 5 to 10 hours. Use real numbers only.]**

## 3. Demonstration: an EKG Upload API with an Automated Pipeline

I built a small service that will become the server-side entry point of our
capture flow. It is a Python FastAPI app with two endpoints. `GET /health`
reports that the service is up. `POST /uploads` accepts one image and returns
an upload ID, the detected format, width, height, and size. It reads the
format from the file's bytes, not from the file name or the client's claimed
type, so a text file renamed to `.png` is rejected. Empty files return 400,
non-PNG/JPEG files 415, damaged images 422, and anything over 10 MB or 50
megapixels 413. The response also applies our team's existing resolution rule
from Taiga #44 (the photo's long side must be at least 2,376 pixels, 297 mm
× 8 pixels per mm), so the API and our capture screen agree.

Because this is medical imaging, privacy shaped the design. Images are never
stored or logged, all test images are synthetic EKG-style pictures drawn in
code, and every response says `"ekg_verified": false`. The prototype does
not detect EKGs, remove identifying information, extract waveforms, predict
risk, or establish HIPAA compliance.

Fourteen pytest tests cover these cases. The Dockerfile uses
`python:3.12-slim`, installs pinned dependencies, and runs as a non-root
user with a built-in health check. The GitHub Actions workflow runs on every
push and pull request with read-only permissions and no secrets. Job one
installs Python 3.12 and the dependencies and runs the tests. Job two has
`needs: test`, so it only runs if every test passed; it builds the Docker
image, starts the container, and confirms `/health` answers.

To prove the gate works, I pushed a branch with one test broken on purpose.
The test job failed (`assert 400 == 401`, 1 failed, 13 passed) and GitHub
skipped the Docker build. On the main work branch, both jobs passed in 49
seconds (Figures 1–2).

*Figure 1: Actions run with both jobs green (evidence/05).*
*Figure 2: Run with a broken test; Docker build skipped (evidence/08).*
*Figure 3: Container API responses 201/415/400/413 (evidence/04).*

## 4. Challenges and Enjoyable Aspects

The most useful problem was invisible: FastAPI's underlying framework
quietly writes uploads larger than 1 MB to a temporary file on disk. For
patient images that is a real privacy concern, so I raised that threshold and
rejected oversized requests before reading them, then confirmed a 9 MB upload
stayed in memory. A second surprise was that Pillow's quick `verify()` check
accepted a half-truncated JPEG; a full decode caught it, and a test now
guards that case. Environment issues took time too: after installing Docker
Desktop, my open terminal still could not find `docker` until I opened a new
one, and one push produced two CI runs because the branch also had an open
pull request, which triggered both `push` and `pull_request`. **[YOU: which
of these was hardest for you, and anything else you got stuck on.]**
**[YOU: what you enjoyed, in your own words, e.g. seeing the Docker job turn
grey and "skipped" after breaking a test.]**

## 5. Lifelong Learning and Future Application

The next step in our capstone is to extend this workflow to the Next.js app
(`npm test` and lint), then add each new processing service (de-identification,
digitizing) as its own tested job. Once digitizing exists, a set of synthetic
EKGs with known T-wave values could run in CI so accuracy regressions show up
on every push. Publishing images to a registry and adding vulnerability
scanning are later steps that need team approval. **[YOU: how you will keep
learning this, e.g. a course, certification, or side project, and where you
expect to use it after graduation.]**
