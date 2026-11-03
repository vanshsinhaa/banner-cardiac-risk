# Team integration review — 2026-10-30

**Current status - November 3:** Vansh explicitly authorized merging PR #6 as a
shared development baseline, accepting the documented remaining work. See the
[current team handoff](team-handoff.md) for setup, ownership and verification.
PR #6 records final merge status. No deployment is included.

The review below is a **dated October 30 snapshot**, with subsequent follow-ups.
Its original draft-only authorization and pre-merge checklist are historical;
they do not describe the November 3 decision. The original reviewed demo used
simulated responses; later actual-service evidence is linked below.

**October 31 follow-up:** Vansh authorized implementation on this integration
branch. The original-photo resolution gate is now advisory, the readability
bridge preserves the provided crop, and Roberto's response is the runtime
contract. The review below records the earlier snapshot. Current changes and
verification are in [capture quality](../project%20docs/capture-quality-implementation.md).

## Branches included

**November 2 follow-up:** Tesseract and the real pinned CPU digitizer are installed
and running; all seven previously skipped service tests pass. A real browser run
on the schematic privacy fixture reaches all three services. The generated
twelve-lead page tests numerical stages independently because its waveform
detections still trigger privacy blocking. See [current evidence and limits](../project%20docs/local-services-2026-11-02.md).
Broader privacy/assignment acceptance remains unfinished and is carried forward
under the November 3 development-baseline merge decision.

**November 1 follow-up:** the separate Sprint 4 HTTP-service task now has a real
local implementation and weight-loaded OCR verification. The historical missing
backend gate below is superseded by [service implementation and evidence](../project%20docs/http-deidentify-implementation.md).
At that snapshot the real digitizer was still missing; its November 2 setup is
described above. Full #60/#65 verification, downstream privacy provenance,
capacity policy and phone acceptance remain follow-ups.

Local branch: `integration/team-sync-2026-10-30`.
Worktree: `.integration/team-sync` in the original repository.

| Source | Reviewed tip | Contribution |
| --- | --- | --- |
| `origin/main` | `379b14d` | Existing shared baseline, already in Vansh's branch |
| `vansh/bannerwork` | `f675800` | Four-corner capture, schema/resolution, metadata, key providers; includes old PR #1 |
| `faith/redaction` (#3) | `33f8b9c` | Offline OCR comparison and redaction prototypes |
| `faith/preprocessing` (#4) | `29cca5c` | Perspective/lighting prototype |
| `arsen/lead_recognition` (no PR) | `0e62c53` | Readability, OCR coordinates, spatial verification, service/API tests |
| `rob-ecg-digitizer` (#2) | `4852cff` | Python digitizer, real strip-based sampling calculation, optional T-wave plots |
| `faith/deid-connect` (#5) | `8296629` | Camera guide, capture errors, fail-closed de-identification states |

Merge commits preserve each source branch's history. The latest capture screen is
the UI baseline; the old rectangular crop screens are not restored. Original
untracked `services/upload-api/scripts/metadata_visual_demo.py` is untouched.

## Resolutions and behavior changes

- Keep independent corners, magnifier, worker-based warp, original-photo resolution
  gate, full-resolution PNG, and `onCapture(dataUrl, details)` signature.
- Port Faith's camera guide, invalid-image handling, retry/cancel/blocked states
  into that screen. Request a higher camera resolution so it can meet #44.
- Insert metadata sanitization before the proposed OCR/redaction HTTP backend.
  Only `redacted` plus a PNG and a positive region count allows saving/callbacks.
  `nothing_detected`, missing configuration, timeout and malformed replies block.
- Development mock images are previews only; they cannot be saved or forwarded.
  Production ignores `DEID_MOCK`.
- Run Arsen's readability and Roberto's digitizer only on the confirmed redacted
  PNG. Keep readability and digitizer failures independent and visible.
- Keep Arsen's source-coordinate/provenance audit and review gate alongside
  Roberto's paper-speed calculation, null sample gaps, and optional T-wave work.
  The API returns waveform data instead of the mismatched success-only message.
  Preserve both binary PNG and multipart `image` request contracts.
- Union ignore rules and consolidate overlapping README instructions. Debug plots
  containing source pixels are opt-in rather than written for every request.
- Add frontend/route and lightweight Python jobs to CI. Neural-model integration
  remains a separate manual check, not a fake passing CI job.

## Verification

Local environment: Windows, Node 22.9.0, Python 3.12.1. CI uses the latest Node 22
patch (the dependency tree recommends 22.13+). Tests/build/lint below passed:

- Frontend, schema, perspective, privacy, route and compatibility: **63 tests**.
- Upload API and key/metadata regressions: **112 tests**.
- Preprocessing: **32 tests**, with OCR responses stubbed where appropriate.
- Spatial lead verification: **13 tests**.
- Sampling conversion, paper speed, and missing samples: **4 tests**.
- Faith's redaction smoke script: **11 checks**.
- `npm run lint` and `npm run build`, including Next.js TypeScript checks.
- Chromium and WebKit synthetic browser walkthroughs passed: four-corner UI,
  confirmed-redaction-only downstream requests, scan results, fail/retry,
  nothing-detected, mock isolation, cancellation, resolution and production
  fail-closed behavior. Backend replies are fixtures, not real OCR output.
- Seven pinned-upstream service tests were **skipped** because the external
  Open-ECG-Digitizer checkout is absent; this is an explicit pre-merge gate.
- Existing geometry checks passed in both engines: pointer/keyboard, magnifier,
  resolution/cancel/encoding-failure recovery, and all three full-photo pixel
  comparisons. The 4624×3468 and 4160×3120 outputs retained their dimensions and
  had **zero differing bytes** against decoded-source pixels. Worker event loops
  continued running. Chromium also exercised emulated touch.

Synthetic review images: [four-corner editor](evidence/integration-2026-10-30/crop-chromium.png),
[combined result in Chromium](evidence/integration-2026-10-30/result-chromium.png),
[combined result in WebKit](evidence/integration-2026-10-30/result-webkit.png),
and [blocked privacy check](evidence/integration-2026-10-30/blocked-chromium.png).

No live patient image was sent to a remote service. No real OCR engine, model
weights, or de-identification HTTP backend was provisioned during preparation.

## Original pre-merge checklist (October 30 snapshot)

The missing HTTP backend and local-runtime items were subsequently implemented.
Remaining acceptance items are carried forward explicitly in the current handoff.

1. **Faith:** review the ported camera/de-identification behavior and proposed
   `/deidentify` contract below. Implement or identify the real HTTP backend.
   Offline redaction scripts are not that backend. Confirm `nothing_detected`
   remains blocked and the real service performs the prototype's verification.
2. **Roberto + Arsen:** run the combined pinned digitizer with real weights and
   Tesseract. Check sampling rate, trace/null alignment, spatial assignments,
   conflict/missing-label review states, and optional T-wave plotting. Lightweight
   tests do not substitute for this check.
3. **Vansh + team:** confirm 10 MB processing payloads are intended. Full-resolution
   PNGs can be larger than their JPEG inputs. Current behavior blocks explicitly
   without loss, downscaling, or forwarding the oversized image. Measurements
   and provisional 32 MiB original / 64 MiB processed targets are in
   [the size-policy follow-up](../project%20docs/task-upload-size-limits.md);
   no limits have been changed.
4. **Model owner + Roberto + Vansh:** extend the existing digitizer response with
   explicit T-wave measurements and calibration/fallback evidence. Preserve null
   gaps and their time axis. The v0.1 schema is a legacy reference; no conversion
   to it is required, and no model-ready export is emitted.
5. Review the mobile preview and run the real backend flow on a phone, including
   camera permission denial, HEIC decode failure, save behavior, retake, and cancel.
6. Run GitHub CI on the published draft, re-fetch `main` and all source tips, and
   incorporate any changes made after this snapshot before merge approval.

## Proposed backend contract

`DEID_BACKEND_URL/deidentify` receives multipart field `file` containing a
metadata-free PNG from `UPLOAD_API_URL/uploads/sanitize`. The filename is fixed.
The backend must return a verified, same-resolution PNG:

```json
{
  "status": "redacted",
  "image": "data:image/png;base64,...",
  "regions_redacted": 1
}
```

The service must not claim redaction for an unchanged/no-detection image. Failures
must return no usable image. A single 55-second Next.js service deadline and a
60-second browser deadline cover privacy processing. Each payload is capped at
10 MB, including the PNG returned by metadata sanitization. This contract is a
proposal requiring Faith's confirmation, not an assertion that a service exists.

## Original publication authorization (superseded November 3)

Vansh authorized pushing **only** the new integration branch and opening a
**draft** PR targeting `main`, using [the prepared description](integration-pr.md).
Leave PRs #1–#5 and all teammate branches alone. Do not request reviewers or send
messages without authorization. Publication is not approval to merge `main`.

After team checks and separate explicit approval, merge the reviewed integration
PR with a regular merge commit so source history is retained. Then reconcile the
older PR statuses, and update local `main` with `git pull --ff-only`. Teammates
with ongoing branches can merge the updated `main` into their own branches without
force-pushing. Preserve local edits before switching or updating any checkout.

No shared branch has changed, so reverting this local preparation does not require
undoing anyone else's work. Keep the source branches as recovery points.
