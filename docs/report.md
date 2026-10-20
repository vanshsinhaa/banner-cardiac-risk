# Growing Competency Report: CI/CD Pipeline with GitHub Actions & Docker

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
server the same runtime. I want to work in backend and health-tech software
after graduating, where automated testing and containerized services are
baseline expectations. Before this, I used Git and GitHub every day but had
never written a workflow file or a Dockerfile, and I had never run a
container myself.

## 2. Learning Process and Resources

I started with the course video, Tanuj Malode's "CI/CD Pipeline with GitHub
Actions & Docker" (https://www.youtube.com/watch?v=ioTsICXbI0Y). It showed me
the overall shape of a pipeline: push code, let a workflow check and build
it, package it as a Docker image, then deploy it. His example is a
Node/Express app deployed to AWS EC2; I applied the same pattern to Python
and deliberately stopped before deployment, since our project has no
approved hosting. For details I went to the official documentation: GitHub's
"Workflow syntax" and "Using jobs" pages, which define triggers, permissions,
and how `needs` makes one job wait for (and be skipped by) another; the
`actions/checkout` and `actions/setup-python` READMEs to pick current
versions (v7) and pip caching; and FastAPI's "Request Files" page, which
mentions that uploads use a spooled temporary file. That last detail sent me
into the Starlette source code, where I found that uploads over 1 MB are
written to disk. I finished with five self-check exercises, such as removing
`app/` from the Docker build context to predict and confirm the error. In
total I logged 6.5 hours: about 2.25 hours on the video and documentation,
1.5 hours building and debugging the service, 1 hour installing and learning
Docker Desktop, 1.25 hours on the workflow and exercises, and 0.5 hours on
evidence and write-up.

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
skipped the Docker build. On my working branch, both jobs passed in 49
seconds (Figures 1–2).

*Figure 1: Actions run with both jobs green.*
*Figure 2: Run with a broken test; Docker build skipped.*
*Figure 3: Container API responses 201/415/400/413.*

## 4. Challenges and Enjoyable Aspects

The most useful problem was invisible: FastAPI's underlying framework
quietly writes uploads larger than 1 MB to a temporary file on disk. For
patient images that is a privacy concern, so I raised that threshold and
rejected oversized requests before reading them, then confirmed a 9 MB upload
stayed in memory. A second surprise was that Pillow's quick `verify()` check
accepted a half-truncated JPEG; a full decode caught it, and a test now
guards that case. Environment issues took time too: after installing Docker
Desktop, my open terminal still could not find `docker` until I opened a new
one, and one push produced two CI runs because the branch also had an open
pull request, which triggered both `push` and `pull_request`. The spooling
issue was the hardest, because nothing failed; I only found it by reading
source code. The most satisfying moment was breaking a test on purpose and
watching the Docker job turn grey and "skipped". That is when `needs` stopped
being a line of YAML and became a safety net I could see.

## 5. Lifelong Learning and Future Application

The next step in our capstone is to extend this workflow to the Next.js app
(`npm test` and lint), then add each new processing service
(de-identification, digitizing) as its own tested job. Once digitizing
exists, a set of synthetic EKGs with known T-wave values could run in CI so
accuracy regressions show up on every push. Publishing images to a registry
and adding vulnerability scanning are later steps that need team approval.
To keep building this skill, I plan to finish the deployment half of the
video by deploying the container to a free-tier cloud service in a personal
project, and to work through GitHub's documentation on reusable workflows
and matrix builds. I expect to use CI/CD on every team project I join after
graduation, since it is the first thing that keeps a shared codebase
working.
