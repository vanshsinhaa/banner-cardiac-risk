# Project tracker

Owner: Vansh (`vanshsinhaa`). Dates use America/Phoenix. Add new entries at the
top of the work log; keep the oldest entries at the bottom.

This records work and evidence, not estimated or invented hours. Historical
entries below were reconstructed from Git and existing documents on October 26,
2026; they are not contemporaneous time logs. AI-assisted implementation is
reviewed through code, reproducible checks, and the explanations linked here.

## Current state — October 26, 2026

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
