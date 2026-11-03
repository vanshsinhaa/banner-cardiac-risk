# Integrate capture, privacy service and local ECG pipeline

The combined capture UI previously had no live printed-text HTTP service, and
local readability/digitization lacked Tesseract and model configuration. This
integration connects the four-corner screen to metadata removal, a new fail-closed
OCR/redaction HTTP service built on Faith's functions, and the team's readability
and digitizer services. Source merge commits preserve contributors' history.

Capture retains editable corners and full-resolution PNGs, treats dimension
references as advisory, and preserves the crop through preprocessing. Saving,
callbacks and automatic numerical checks require confirmed real privacy output.
The digitizer preserves shared-axis null samples, sampling-rate calculation,
spatial verification and review flags. Windows setup adds pinned CPU profiles,
model provisioning, Tesseract configuration, health checks and a launcher, plus
a fix for Windows encoding silently skipping upstream rhythm assignment.

Vansh authorized merging this shared development baseline on November 3. Known
remaining work: conservative privacy false positives, #60/#65 independent
verification, #61 audit events, #64 measurement acceptance, trusted privacy proof
for direct API callers, phone testing and image-capacity policy. The generated
twelve-lead fixture still blocks at privacy; successful independent numerical
inference is not full-flow acceptance. No model-ready export, cardiac-risk scoring
or deployment is included.

Validation: 64 frontend/API tests, 140 upload/key/metadata/privacy tests, 34
preprocessing tests, 25 digitizer tests without skips, 11 redaction smoke checks,
lint, TypeScript and production build passed locally. Real OCR released 14/16
synthetic cases, covering all 56 checked identifiers; two uncertain cases blocked.
An actual browser run on the one-trace fixture reached all real services using
the privacy output bytes. A separate numerical twelve-lead check and actual
outage check are documented with their limits. Hosted CI runs on this PR; it does
not install neural models or replace real-image acceptance.

Start with the [team handoff](https://github.com/vanshsinhaa/banner-cardiac-risk/blob/integration/team-sync-2026-10-30/docs/team-handoff.md)
for contribution attribution, setup, contracts, expected test results, ownership
and remaining work. Detailed records are in `project docs/http-deidentify-implementation.md`,
`project docs/local-services-2026-11-02.md`, and `docs/integration-review.md`.
Environments, weights, logs and `.env.local` are ignored; teammates must provision
their own runtimes. Source branches are preserved; none need rewriting.
