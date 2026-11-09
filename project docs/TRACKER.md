# Project tracker

Owner: Vansh (`vanshsinhaa`). Dates use America/Phoenix. Add new entries at the
top of the work log; keep the oldest entries at the bottom.

This records work and evidence, not estimated or invented hours. Historical
entries below were reconstructed from Git and existing documents on October 26,
2026; they are not contemporaneous time logs. AI-assisted implementation is
reviewed through code, reproducible checks, and the explanations linked here.

## Current state - November 3, 2026

Vansh authorized merging the integration into `main` as a development baseline.
[PR #6](https://github.com/vanshsinhaa/banner-cardiac-risk/pull/6) records final
status; the [team handoff](../docs/team-handoff.md) describes contribution history,
setup, verification and unfinished tasks. The real privacy service and downstream
runtimes now work on the tested local fixtures. Privacy acceptance, #60/#65,
#61, #64, phone testing and other listed limits remain. No deployment or Taiga
status/assignment change is included.

## Historical state - October 26, 2026

| Area | Verified state | Remaining work |
| --- | --- | --- |
| Working branch | `vansh/bannerwork`; local Git author/committer is `vanshsinhaa` | School handoff target is `origin/vansh/bannerwork` (slash). The older `origin/vansh-bannerwork` (hyphen) is separate. |
| Repository update | Fetched origin and merged `origin/main` at `379b14d`, merge `d8e518e` | Teammates' unmerged branches remain separate. |
| #48: embedded metadata | Implemented and tested for accepted static PNG/JPEG uploads; sanitized PNG available through the API | #51 connects the capture/de-identification flow. DICOM ingestion is explicitly unsupported. |
| #52: key management | Versioned provider, local injection adapter, secret-store refresh adapter, enforced lifecycle, rotation tests, policy and demo | Hosting-specific secret-store SDK, workload identity, permissions, and restore exercise require deployment selection. #50 owns application payload encryption. |
| Capture screen | Existing capture work saved in its own commit; 31 frontend tests, lint, type check, and build passed on this state | Physical-device acceptance and #51 integration remain separate. |
| Verification | 112 Python tests pass; executable synthetic demo passes | Local Docker daemon unavailable; no new container execution or hosted CI result claimed. |
| Taiga | Public read access works; #48 and #52 were both **New**, assigned to `vanshsinhaa` | No Taiga status, comment, or assignment was changed. |

Board: [Sprint 3](https://tree.taiga.io/project/gshale-sprint-0-backlog/taskboard/sprint-3-12589).
Detailed scope and evidence:
[metadata removal](task-48-metadata.md), [key management](task-52-key-management.md),
[verification and instructor demo](verification-2026-10-26.md).
For setup on another computer, use [the device handoff](DEVICE-HANDOFF.md).

## Work log — newest first

### 2026-11-09 — Implement #64 wave-attribute validation

Branch `vansh/task-64-wave-validation` from `origin/main` (`84c0e9b`). Decisions
confirmed with Vansh first: validate Roberto's live response, add an additive
`tWaves` field from `t_wave.py`, strict `twelve-lead-t-wave/1` profile, server-side
TypeScript enforcement. Details, rule catalog and demo steps:
[task-64-wave-validation.md](task-64-wave-validation.md).

Evidence: `npm test` 84 pass; `tsc` and `eslint` clean; `next build` passes with
`/wave-validation` returning 404 in production; digitizer service tests 28 pass
(1 skipped: neurokit2 absent from the provisioned venv) against the pinned upstream
checkout; the real `t_wave.py` measured 12/12 leads on the synthetic fixture in a
separate neurokit2 0.2.12 environment. Demo page checked in headless Chromium at
760 px and 375 px. Not done: real-image digitizer run with neurokit2 installed,
Roberto/Talgat review of rules, Taiga status update.

Live run: `clean_1.jpg` passed privacy, digitizer and validation end to end
(1 lead, T wave measured, correctly "needs review"). Six full 12-lead images sent
straight to the digitizer showed waves/T-waves extracted but labels often
unconfirmed; full 12-lead pages are blocked by the privacy step (traces read as
text) and phone PNGs by the 10 MiB limit. Those blockers belong to #66, the upload
size proposal and #59/#62. Panel now shows waveform, T-wave and label counts
separately; three real digitizer outputs saved as demo fixtures. 86 tests pass.

### 2026-11-03 - Document and publish the development baseline

**Scope:** Explicit user authorization to merge into main, with known limits
carried forward. Added a team-facing handoff covering attribution, architecture,
setup, expected test outcomes and owner-specific follow-ups; updated the README,
historical-status notices and PR description. Preserve source histories and
unrelated local files; no deployment is included.

**Validation:** 64 frontend/API tests, 140 upload/key/metadata/privacy tests,
34 preprocessing tests, 25 digitizer tests without skips, and 11 redaction smoke
checks passed. Lint, TypeScript and production build passed. Real-service
evidence remains dated November 1-2 and its limits are explicit in the handoff.
Hosted checks and final merge commit are recorded on PR #6.

### 2026-11-02 — Provision Tesseract and the real CPU digitizer

**Result:** Installed Tesseract, downloaded the pinned upstream checkout and both
LFS models with matching hashes, prepared a separate CPU environment, configured
readability/digitizer URLs and paths, and added a hidden-process launcher.
Fixed Windows stdout encoding so an upstream Unicode log cannot interrupt rhythm
assignment. Added loaded-runtime health and CPU thread bounds.

**Evidence:** 34 preprocessing and 25 digitizer tests passed with no skips;
the seven formerly skipped upstream service tests now run. Actual twelve-lead
inference returned 12 x 5000-sample arrays at 504.3 Hz with review required.
Actual Tesseract confirmed nine labels on that synthetic page. The browser ran
all stages on the original one-trace privacy fixture with exact PNG digest
checks. A real digitizer outage returned 503/no waveforms; the service was restored.

**Limits:** The generated twelve-lead page is still blocked by conservative
privacy checks that treat some waveform detections as uncertain text. Its
numerical-stage test is separate from the browser privacy acceptance test.
Broader privacy policy, independent controls and assignment/measurement acceptance
remain merge gates. See [setup, evidence and manual tests](local-services-2026-11-02.md).
No main merge, commit, push, deployment or Taiga update was performed.

### 2026-11-01 — Implement the separate HTTP de-identification service task

**Scope:** Vansh added a separate Sprint 4 service task after clarifying that
Faith's earlier tickets did not explicitly assign an HTTP backend. Implemented
the local service on the integration branch, preserving prior capture-quality
changes. Faith's #60/#61 and Vansh's full #64/#65 remain separate deliverables.

**Result:** Actual uploaded PNG pixels now go through shared OCR grouping/rules,
validated masking, verification and final metadata sanitization. Added readiness,
bounded admission/deadlines, safe errors, pinned CPU OCR/model provisioning,
service/adapter regressions, and real HTTP/browser checks. Next.js displays fixed
safe messages for recognized blocked outcomes.

**Evidence:** 140 Python tests, 64 frontend/API tests, 11 existing redaction checks,
lint, TypeScript and production build passed. Real OCR across all 16 synthetic corpus images
released 14 outputs with all 56 known identifiers fully covered and blocked the
two very-blurry cases. Actual Chromium upload/crop/save and failure behavior
passed without response interception. See
[implementation and evidence](http-deidentify-implementation.md).

**Remaining:** Real downstream digitizer/readability provisioning, measurement
contract/#64, independent full #60/#65 controls, #61 audit sink/events, direct-route
privacy provenance, capacity policy and broader real-layout/privacy acceptance.
No commit, push, main merge, deployment or Taiga change was performed by this work.

### 2026-10-31 — Implement capture-quality advice on the integration branch

**Authorized change:** After discovery, Vansh approved implementation on
`integration/team-sync-2026-10-30`. Fetched origin and verified that the branch
contains all current remote team feature tips and matches its remote baseline.

**What changed:** Replaced the provisional 2376 px early rejection with advice
and **Use this crop**. Made the downstream 600 px check advisory while retaining
label/contrast checks. Removed the second warp of browser-corrected crops. Added
source-appropriate replacement guidance, preserved crop edits after privacy
failure, and retained results when the replacement picker is canceled. Documented
Roberto's response as the runtime contract; v0.1 remains a legacy reference.

**Evidence:** 62 frontend/API tests, 33 preprocessing, 13 spatial verification,
4 signal conversion and 112 upload/key/metadata tests passed, plus 11 existing
redaction checks. Lint, standalone TypeScript and production build passed.
Chromium/WebKit workflow and pixel-preservation checks passed, including native
1700 px inputs and failure/retry paths. Browser services/OCR are fixtures; real
privacy/model acceptance is not claimed. See
[implementation and verification](capture-quality-implementation.md).

**Remaining:** Real de-identification backend, agreed T-wave/provenance contract
for #64, independent full privacy workflow for #65/#60, processing-size policy,
model-quality benchmarks and phone acceptance. No Taiga changes, commit, push,
main merge or deployment is implied by this local implementation.

### 2026-10-31 — Review combined UI and document upload-size policy

**What changed:** Prepared the combined workflow on
`integration/team-sync-2026-10-30`, preserving the latest four-corner screen and
the histories of Faith's, Roberto's and Arsen's branches. Vansh reviewed the
local combined UI demo and approved moving forward with draft PR publication.
Backend replies in that demo are simulated, not real OCR/model acceptance.

**Size finding:** Documented the 10 MiB limits, their resource purpose, and three
repository JPEGs expanding to approximately 23 MiB as full-resolution PNGs.
Proposed separate 32 MiB original and 64 MiB processed caps for benchmarking,
aligned pixel/memory budgets, lossless compression assessment and clearer errors.
**Runtime limits remain unchanged.** See [image size limits](task-upload-size-limits.md).

**Evidence and remaining work:** The integration records 224 passing automated
tests, 11 redaction checks, lint/build, and Chromium/WebKit workflow/pixel checks.
Seven pinned-upstream service tests were skipped. Real de-identification,
model/OCR checks, size policy, schema mapping and phone acceptance remain
pre-merge decisions. See [integration review](../docs/integration-review.md).
Main merge, deployment, closing existing PRs and teammate branch rewrites are
outside this draft-publication step.

### 2026-10-26 — Save complete working state for school

**What changed:** Saved the previously uncommitted capture/crop implementation,
its CSS, worker/PNG encoder, geometry tests, optional browser verification script,
and capture notes in a dedicated commit. Saved the revised competency DOCX/PDF
and alternate report PDF, plus the generated synthetic manual-upload PNG.
The PNG was checked against its generator and contains no patient data.
Added `DEVICE-HANDOFF.md` with fresh-checkout commands, environment setup,
both local servers, test commands, and the correct slash branch name.

**Repository state:** Fetched origin again; no newer main commits were missing.
The complete state is prepared for `origin/vansh/bannerwork` under the user's
GitHub identity. The older hyphen branch and teammates' branches are unchanged.
Build dependencies, local environment files, virtual environments, and generated
build/browser artifacts stay outside Git and are recreated on the next device.

**After standup:** Record the team's DICOM scope decision, Faith's #51 integration
contract, and the #52/#50 encryption/secret-store handoff. Existing local tests
passed as recorded below; no additional feature work or completed integration is
implied by this save. Hosted CI results are separate from local verification.

### 2026-10-26 — Sprint 3 implementation and verification

**What changed:** Built task #48 in `services/upload-api/app/sanitize.py` and
integrated it into both upload endpoints. Built task #52 in
`services/upload-api/app/key_management.py`. Added tests and a synthetic
`scripts/sprint3_demo.py` that an instructor can run without patient images,
saved keys, cloud credentials, or an external service.

**How it works:** The image stage verifies and decodes allowed image formats,
applies EXIF orientation, copies only pixels into a fresh image, and encodes a
PNG. Every later upload check receives the sanitized result. The binary endpoint
gives #51 the actual bytes to send to OCR/redaction. The key provider selects one
active write key and exact historical read versions. It prevents plaintext
fallback, enforces a maximum 90-day write window, and refreshes an injected
secret-store snapshot on use at least every five minutes.

**Engineering decisions:** Lossless PNG avoids another lossy JPEG pass. Printed
names remain for #49/#54, and the response says so. Unsupported DICOM files are
rejected rather than declared sanitized. The key lifecycle is independent of a
cloud vendor or web/native UI; the running Python service contains the reference
implementation. The local environment adapter is restricted to development/test.
There is no database encryption claim because there is no database.

**Evidence:** 112 Python tests, 31 frontend tests, lint, TypeScript, production
build, and the demo pass locally. The tests compare decoded pixels, inspect PNG
chunks, check all EXIF orientations, and demonstrate old-data decryption after
rotation and denial after revocation. See the linked verification record for
commands, limitations, and reproducible steps. Implementation commits:
`35fd0d8` (#48), `0b5a309` (#52), and `9fa6190` (upload-header hardening).
The final review added non-ASCII and oversized-integer length cases so bad input
cannot become an unhandled integer parsing exception. All three commits use
`vanshsinhaa` as author and committer, with no AI co-author trailer.

**Open handoffs:** Faith's #51 integration and #49/#54 OCR/redaction; Talgat's
#50 encryption consumer; deployment owner chooses and configures the real secret
store. These are not recorded as completed by Vansh. Implementation is ready for
review within the documented scope; no arbitrary completion percentage or hours
are asserted.

### 2026-10-26 — Repository audit and safe update

**What changed:** Confirmed both tasks and their descriptions through Taiga's
public API. Fetched remote branch updates, inspected the three commits missing
from this branch, and merged main. Those commits updated sample ECG images and
removed old directories; the merge affected sample image files in this branch.
GitHub authentication resolves to `vanshsinhaa` (account ID `54222353`). Updated
the repository-local Git name and matching GitHub noreply address; global Git
settings were not changed. Renamed the existing local `vansh-bannerwork` branch
to the requested `vansh/bannerwork` spelling, preserving its history.

**What was preserved:** Modified competency DOCX/PDF files; the extra competency
PDF; the capture screen component/CSS, crop geometry, worker, PNG encoder,
capture tests, capture verification script, and capture documentation already
existed locally before this session. They remain outside the new Sprint 3
implementation commits. Their original development dates are not inferred from
today's filesystem state.

**Team integration:** Remote branches include Faith's capture overlay and
preprocessing prototypes, Arsen's lead recognition, and Roberto's digitizer
work. They were inspected, not merged. Taiga lists Faith's #49 as Closed, #51 as
In progress, and #54 as Ready for test; those board states do not prove their code
is already on main. A team integration pass is still needed.

### 2026-10-20 — Upload API, CI/CD evidence, and competency report

Reconstructed from `6f64f05`, `619c080`, `26dac4b`, and `4212c7a`.
Vansh added the separate FastAPI upload prototype, synthetic tests, Docker image,
and GitHub Actions pipeline. The pipeline tests first and builds/checks the
container only after tests pass. Evidence screenshots, learning notes, and
competency reports explain the process. These are historical results; the new
metadata/key work has its own verification record.

References: [upload service](../services/upload-api/README.md),
[competency evidence](../docs/competency-evidence.md),
[learning notes](../docs/learning-notes.md).

### 2026-10-10 — Whole-photo resolution check and development hosts

Reconstructed from `637e47c`, `a26a95a`, and merge `7f61ce4`.
Vansh changed #44 to check the original photo's long side rather than crop width,
so a user's crop does not incorrectly invalidate a sufficiently detailed photo.
Added configurable development hostnames for remote/local device access.

Reference: [task #44 decisions](../docs/task-44-low-resolution.md).

### 2026-10-06 — Digitized EKG schema and validation (#42)

Reconstructed from `c65d74f`. Added the versioned JSON schema and validators for
structured digitized ECG output, including time-order checks for waves/beats.
This gives downstream code a shared contract rather than unrelated output shapes.

Reference: [schema documentation](../schemas/README.md).

### 2026-10-03 — Initial low-resolution gate (#44)

Reconstructed from `93140dd`. Added the first capture resolution check and
guidance to retake an image when the available detail is too low. The later
October 10 change refined which dimensions it checks.

### 2026-09-27 — Application scaffold and capture screen

Reconstructed from `8ee2c3f`. Created the Next.js application and initial EKG
capture screen. This is the foundation for the later crop/perspective work.
