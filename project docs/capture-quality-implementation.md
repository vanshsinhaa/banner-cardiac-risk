# Capture-quality implementation — October 31, 2026

Implemented locally on `integration/team-sync-2026-10-30`, based on `533d3fc`.
Vansh authorized the change after reviewing the capture-quality proposal.
No commit, push, merge to main, deployment, or Taiga update is implied.

## Branch verification

Fetched origin before editing. The integration branch matched its remote and
contained the current remote tips of main, Vansh's slash branch, Roberto's
digitizer, Arsen's lead recognition, and Faith's capture-overlay,
capture-prototype, OCR-prototype, redaction, preprocessing, and deid-connect
branches. Each was checked with `git merge-base --is-ancestor`.
The integration worktree was clean. Existing root-checkout discovery documents
and the untracked metadata visual-demo script were left in place.

## Result

| Before | After | Reason |
| --- | --- | --- |
| Below 2376 px disabled crop confirmation | A non-blocking detail advisory; **Use this crop** stays available | The old A4 x 8 px/mm estimate is not a measured extraction requirement. |
| Size above the cutoff reported resolution OK | `unassessed` explicitly requires later processing | Large dimensions alone cannot establish quality. |
| Narrow crops hit another 600 px rejection | Readability still checks actual labels and reports dimension advice separately | A short side alone does not establish text readability. |
| Readability detected and warped the already corrected crop again | Uses the provided crop, optional reading rotation, and lighting correction | Prevent accidental content removal by a second page detector. |
| Privacy failure forced retry or replacement | Also offers **Adjust crop**, preserving corner edits | Let users recover from poor framing without starting over. |
| Replacement reset the workflow immediately | Canceling the file picker retains the current crop/result | Opening a picker is not a decision to discard work. |
| Generic retake advice for uploaded files | Original-file guidance for uploads; retake guidance for live-camera captures | Recovery actions match the source. |

The dimensions helper now returns `status: advisory | unassessed | invalid`,
`measure`, `measured`, `reference`, and `reason`. Invalid dimensions remain a hard
failure; ordinary smaller images may be processed. No new guessed lower cutoff,
automatic enlargement, lossy conversion, or payload-limit increase was added.

The upload API retains legacy `required_long_side_px`/`meets_minimum` fields for
compatibility and adds `advisory_only: true` and `quality_assessed: false`.
These fields do not reject smaller valid uploads or authorize downstream use.

## Contract direction and unchanged boundaries

Roberto's [`EcgDigitizationResult`](../src/lib/ecg-digitizer/types.ts) remains the
runtime response: keyed nullable sample arrays, shared `samplingRateHz`, mV,
and integrated recognition/spatial-verification evidence. There is no conversion
to #42's legacy v0.1 proposal. Schema and setup documentation now say this.

This change prepares capture admission for #64/#65; it does not complete either
task. #64 still needs agreed measurement/provenance fields and analysis-readiness
requirements. Current T-wave code produces median-beat, R-relative measurements
for optional plots, not normal API measurement records. #65 still needs the full
independent text/metadata verification workflow coordinated with Faith's #60.

Privacy confirmation still precedes saving, image callbacks and downstream scan
requests. Failure/no detection, mocks, cancellation and missing configuration
remain blocked. Byte/pixel resource limits, contrast and OCR confidence/glyph
checks, and spatial lead-verification gates remain. The production privacy route
still requires the real HTTP backend, which is absent in this snapshot.

## Executed verification

Local environment: Windows, Node 22.9.0, Next.js 16.3.6, Python 3.12.1. Existing
system NumPy/OpenCV were used with the project's existing pytesseract dependency
installed in ignored `.integration/python-deps` for lightweight tests. OCR calls
are controlled fixtures in these tests; no real OCR inference claim is made.

| Check | Observed result |
| --- | --- |
| Frontend/API `npm test` | 62 tests passed, none skipped. |
| Preprocessing unittest suite | 33 tests passed, including small-crop label evidence and no second warp. |
| Spatial lead verification | 13 tests passed. |
| Signal conversion | 4 tests passed. |
| Upload API/key/metadata pytest suite | 112 tests passed. |
| Existing redaction smoke script | 11 checks passed. |
| ESLint and `npx tsc --noEmit` | Passed. |
| Production `npm run build` | Passed, including Next.js TypeScript and route generation. |
| Chromium and WebKit workflow checks | Passed native 1700 px input, narrow input, canceled replacement, crop-edit preservation, service failure/retry, privacy failure/retry, mocks, cancellation, invalid files and unconfigured production blocking. |
| Chromium and WebKit crop/encoding checks | Passed keyboard/pointer/loupe, viewport changes, advisory, encoding failure recovery and full-photo comparisons. All three representative outputs in each engine retained dimensions with zero differing decoded pixel bytes. |
| Resolution experiment on `ocr/samples` | 16 files decoded, all native 1700 x 1100; each returns advice rather than failure. |

The first browser assertions needed correction for display-coordinate changes
after layout and Next.js's separate empty route-announcer alert. Crop comparison
now uses source coordinates, and error assertions are scoped to the app's main
element. Final browser runs passed. Sandbox worker/browser launch restrictions
required running the relevant checks with approved escalation.

Browser services are simulated replies. These checks prove workflow behavior and
pixel preservation, not independent PHI removal, real model accuracy, clinical
readiness, physical-camera acceptance or hosted CI status. No patient images
were sent to remote services in this work.

Synthetic browser evidence:

- [Native 1700 px crop with enabled action](../docs/evidence/capture-quality-2026-10-31/native-1700-advisory.png).
- [Recoverable readability-service failure](../docs/evidence/capture-quality-2026-10-31/readability-service-unavailable.png).

## Reproduce

From this worktree, use the existing dependency setup described in the README:

```powershell
npm test
npm run lint
npx tsc --noEmit
npm run build
node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3107
```

In another terminal, with an existing Playwright installation:

```powershell
node scripts/verifyIntegration.mjs /path/to/playwright chromium
node scripts/verifyIntegration.mjs /path/to/playwright webkit
$env:CAPTURE_TEST_URL='http://127.0.0.1:3107'
node scripts/verifyCapture.mjs /path/to/playwright chromium
node scripts/verifyCapture.mjs /path/to/playwright webkit
```

Run Python suites using their documented service/preprocessing environments.
The browser tests require the production app without privacy-service environment
configuration for their final unconfigured-service assertion. They intercept
other service calls in their isolated browser contexts.
