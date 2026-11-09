# Task #64: Wave-attribute validation

Taiga: [#64 Implement Wave-Attribute Validation](https://tree.taiga.io/project/gshale-sprint-0-backlog/task/64),
story #20 ("flag or reject incomplete or inconsistent wave-attribute records at the
point of capture"). Owner: Vansh. Branch: `vansh/task-64-wave-validation` from
`origin/main` at `84c0e9b`. Design background: the Sprint 4 discovery and the
capture-quality contract decision on `vansh/bannerwork`.

## Decisions taken for this implementation

| Question | Decision |
| --- | --- |
| Which contract is validated | Roberto's live digitizer response (keyed nullable leads on one sample axis), not the v0.1 #42 schema. `validateEkg` is unchanged. |
| Where T-wave data comes from | Additive `tWaves` field in `server.py`, produced by Rob's `t_wave.py` on every request. No existing key changed. |
| Eligibility profile | `twelve-lead-t-wave/1`: all 12 leads, every assignment verified, a T wave measured in every lead, no long interior gaps. |
| Where it runs | TypeScript, server-side in `/api/ecg/digitize` (report attached as `validation`), plus `/api/ecg/validate` and `admitForAnalysis()` for later consumers. The browser only displays it. |

These were confirmed with Vansh before development. Roberto (#58/#63) and Talgat
(#59/#62) have not yet reviewed the rule list; see "Coordination" below.

## What was built

| Piece | File |
| --- | --- |
| Validator, rule catalog, profile, admission gate | `src/lib/waveValidation.ts` |
| T-wave report in the digitizer response | `digitizer-service/t_wave_report.py`, `server.py` (3 lines) |
| Server enforcement on every scan | `src/app/api/ecg/digitize/route.ts` |
| Standalone re-validation endpoint | `src/app/api/ecg/validate/route.ts` |
| Capture result feedback | `src/components/WaveValidationSummary.tsx` in `EkgCaptureScreen.tsx` |
| Development demo page (404 in production) | `/wave-validation`, `src/components/WaveValidationDemo.tsx` |
| CLI | `npm run validate:waves -- file.json [--json]` |
| Synthetic fixtures (no patient data) | `tests/fixtures/wave-validation/*.json`, built by `digitizer-service/make_validation_fixture.py` |
| Tests | `src/lib/waveValidation.test.ts`, `tests/validate-route.test.mjs`, `tests/digitize-route.test.mjs`, `digitizer-service/test_t_wave_report.py` |

## Report contract

```json
{
  "version": "wave-validation/1",
  "profile": "twelve-lead-t-wave/1",
  "status": "needs_review",
  "analysisEligible": false,
  "issues": [
    {"code": "T_WAVE_MISSING", "severity": "review", "path": "/tWaves/leads/V2",
     "lead": "V2", "message": "T-wave measurement unavailable for V2."}
  ],
  "leads": {"V2": {"status": "needs_review", "codes": ["T_WAVE_MISSING"],
                   "signal": {"leadingNulls": 2500, "trailingNulls": 1250, "interiorGapSamples": 0, "...": "..."}}},
  "counts": {"errors": 0, "reviews": 1, "leadsPresent": 12, "leadsReady": 11}
}
```

- `counts` also gives `waveformsUsable`, `tWavesMeasured` and `labelsConfirmed` (out of
  the extracted leads), so the screen can show what worked when leads are not ready.
- `status`: `invalid` if any `error`; else `needs_review` if any `review`; else `valid`.
- `analysisEligible` is true only for `valid`.
- `path` is a JSON Pointer into the checked record. `code` is the stable API;
  message wording may change. Messages never contain sample values or OCR text.
- Errors are listed first. The record itself is never modified.

## Rule catalog

| Code | Severity | Attribute | Meaning |
| --- | --- | --- | --- |
| `RECORD_NOT_OBJECT` | error | shape | Result is not a JSON object. |
| `SAMPLING_RATE_INVALID` | error | timing | `samplingRateHz` missing, non-finite or ≤ 0. |
| `UNITS_UNSUPPORTED` | error | amplitude | `units` is not `mV`. |
| `LEADS_INVALID` | error | labels | `leads` missing, not an object, or empty. |
| `LEAD_NAME_UNKNOWN` | error | labels | Key is not one of the 12 standard lead names. |
| `SAMPLES_NOT_ARRAY` | error | shape | Lead has no sample array. |
| `SAMPLE_NOT_FINITE` | error | amplitude | A sample is neither a finite number nor `null` (path names the index). |
| `SIGNAL_EMPTY` | error | amplitude | Lead has only `null` samples. |
| `SAMPLE_AXIS_MISMATCH` | error | timing | Leads have different lengths, so they cannot share one axis. |
| `LEAD_MISSING` | review | labels | A lead required by the profile was not extracted. |
| `LEAD_TOO_SHORT` | review | timing | First-to-last measured sample spans < 2 s. |
| `SIGNAL_GAP` | review | timing | An interior `null` run is longer than 150 ms. |
| `SIGNAL_FLAT` | review | amplitude | Whole trace stays within 0.05 mV: probably not traced. |
| `AMPLITUDE_OUT_OF_RANGE` | review | amplitude | A sample beyond ±10 mV: likely a tracing artifact. |
| `LEAD_VERIFICATION_MISSING` | review | labels | No `leadVerification` evidence. |
| `LEAD_UNVERIFIED` | review | labels | Printed label could not confirm this lead's assignment. |
| `LEAD_CONFLICT` | review | labels | Printed label near this trace names a different lead. |
| `T_WAVE_REPORT_MISSING` | review | T wave | Older digitizer without `tWaves`. |
| `T_WAVE_REPORT_INVALID` | error | T wave | `tWaves` malformed, wrong time domain, or unknown lead status. |
| `T_WAVE_UNAVAILABLE` | review | T wave | Finder did not run (dependency missing or crashed). |
| `T_WAVE_LEAD_UNKNOWN` | error | T wave | T-wave result for a lead not in `leads`. |
| `T_WAVE_MISSING` | review | T wave | Lead has a waveform but no T-wave measurement. |
| `T_WAVE_VALUE_INVALID` | error | T wave | A timing/amplitude field is non-finite, or `beatsUsed` < 1. |
| `T_WAVE_ORDER_INVALID` | error | T wave | Not QRS onset ≤ R (0 ms) ≤ QRS end ≤ T onset ≤ T peak ≤ T end. |
| `T_WAVE_OUTSIDE_BEAT` | error | T wave | Times fall outside the median beat's window. |
| `T_WAVE_AMPLITUDE_OUT_OF_RANGE` | review | T wave | T peak beyond ±10 mV. |

What is deliberately **not** a failure:

- Leading/trailing `null` padding (a 3x4 lead only spans its 2.5 s column).
- Interior gaps up to 150 ms (the same limit `t_wave.py` bridges).
- Zero samples, negative amplitudes and inverted T waves.
- Values outside clinical "normal" ranges. The numeric limits above are about
  digitization artifacts on standard paper (10 mm/mV), not physiology.

## Server enforcement

`/api/ecg/digitize` derives the report after its existing review gate, deleting any
`validation` the Python service might send. `admitForAnalysis(record)` re-runs the
validator and throws `AnalysisAdmissionError` unless eligible; `/api/ecg/validate`
does the same over HTTP and returns the report. Neither trusts a posted
`analysisEligible`. There is no dataset/model consumer yet; when one is added it
must call `admitForAnalysis` (or the endpoint) on the record it receives.

## How to test and demo

No digitizer weights, OCR or privacy service are needed for steps 1–4.

1. **Automated tests**: `npm test` (86 tests), `npx tsc --noEmit`, `npm run lint`.
   Python: `python -m unittest digitizer-service/test_t_wave_report.py -v`
   (the real-finder case runs only where `neurokit2` is installed).
2. **CLI**:
   ```bash
   npm run validate:waves -- tests/fixtures/wave-validation/valid-12-lead.json \
     tests/fixtures/wave-validation/t-waves-missing.json
   ```
   The first is READY FOR ANALYSIS; the second NEEDS REVIEW with ten
   `T_WAVE_MISSING` items (exit code 1).
3. **Demo page**: `npm run dev`, open <http://localhost:3000/wave-validation>, choose
   `tests/fixtures/wave-validation/valid-12-lead.json`, press **Validate** (ready,
   12 green leads). Tick "T wave not found in V2", "Printed label conflicts with
   lead V4" and "Trace lost for 300 ms in V1" (needs review, affected leads amber
   with messages). Add "T-wave onset after its peak in II" (cannot be used; II red).
4. **Endpoint**:
   ```bash
   curl -s -X POST -H "Content-Type: application/json" \
     --data-binary @tests/fixtures/wave-validation/t-waves-missing.json \
     http://localhost:3000/api/ecg/validate
   ```
5. **Real digitizer output on dataset photos**: load any file in
   `tests/fixtures/wave-validation/real-digitizer/` on the demo page:
   `doogee-22-labels-partly-confirmed.json` (8/12 ready; 12/12 waveforms and
   T-waves; labels I, II, III, V1 unconfirmed), `samsung-82-label-conflicts.json`
   (two label conflicts) and `bent-17-trace-gaps.json` (crumpled paper: 5 trace gaps,
   3 T-waves missing). These are real outputs of the local digitizer for Arsen's
   PMcardio photos, sent straight to `/api/ecg/digitize` for testing (privacy skipped).
6. **Full capture flow** (needs the local services from
   `local-services-2026-11-02.md`): capture and crop an ECG; after "Identifying
   information removed" and waveform extraction, the **Measurement checks** panel
   shows the 12-lead grid, issue messages and the next step.

## Fixture notes

`make_validation_fixture.py` simulates an ECG with neurokit2 0.2.12 (seed 64), lays
it out like a 3x4 printout on 5000 samples at 500 Hz, and measures T waves with the
real `t_wave.py`:

- `aligned` (default, `valid-12-lead.json`): all leads from one beat train with
  per-lead gain; all 12 T waves measured.
- `multileads` (`t-waves-missing.json`): neurokit2's own 12-lead model. Its leads'
  R peaks are ~240 ms apart, beyond `t_wave.py`'s 80 ms beat-matching tolerance,
  so only II and aVF are measured. This is a real behavior of the finder worth
  reviewing with Roberto: a photo with leads shifted against the rhythm strip
  could lose T waves the same way. The validator correctly blocks such records.

## Why the live app cannot show a ready 12-lead result yet (not #64)

Tested on 2026-11-09 with the real local services:

| Blocker | Evidence | Owner |
| --- | --- | --- |
| Privacy step blocks full 12-lead pages | Paddle reads the traces as text (`"MnMnMnMa"`), which fails the allowlist (`uncertain_text`). Pages without a detectable identifier also fail (`nothing_detected`). None of the dataset photos tried passed. `clean_1.jpg` passes because it has one short trace. | #66 privacy service (Vansh) with Faith; privacy-rule change needs review |
| Phone photos exceed 10 MiB as PNG | Browser shows the size error before privacy runs. | Upload size proposal (`task-upload-size-limits.md`), team agreement |
| Printed labels often unconfirmed | Real photos: 0–8 of 12 labels confirmed; Roman I/II/III miss most often. Waveforms and T-waves were found in 12/12 leads on 5 of 6 images. | Lead verification (#59/#62, Talgat/Arsen) |

#64 behaves correctly in each case: it reports these leads as needing review and why.

## Known gaps and coordination

- **Roberto (#58/#63):** please review the rule catalog as the shared list rather than
  adding a second validator. `t_wave.py` interpolates gaps ≤ 150 ms internally and
  does not report which samples it repaired; the validator measures gaps from the
  raw samples instead. Exposing repairs, and any explicit cleanup step, would be a
  producer change followed by re-validation with the same rules.
- **Calibration provenance:** the 10-second strip fallback (exactly 500 Hz) cannot be
  distinguished from a measured duration. Once the service reports it, add a
  review rule.
- **Talgat (#59/#62):** label evidence is read from `leadVerification` only; the
  combined recognition label never clears a conflict.
- **Thresholds** (2 s, 150 ms, ±10 mV, 0.05 mV) are engineering limits for the
  current digitizer and need clinical/model-owner confirmation.
- `server.py` change was syntax-checked and its helper is unit-tested; the full
  service test (`test_service.py`) needs the pinned upstream checkout and was not
  run here. Real-image digitizer runs were not repeated for this task.
- No Taiga status was changed.
