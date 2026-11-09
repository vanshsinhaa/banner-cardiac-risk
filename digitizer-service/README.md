# Digitization with spatial lead-label verification

This combines Rob's digitizer with Arsen's spatial lead checks. The integrated
four-corner screen calls `POST /api/ecg/digitize` only after metadata sanitization
and confirmed printed-text redaction. Readability and digitization run concurrently
on that redacted PNG; **Run scan checks again** repeats them. The lighting preview
is not reused as spatial evidence: OCR runs on the digitizer's aligned image.

Rob's strip-width/paper-speed calculation supplies the sampling rate (25 mm/s by
default, `paper_speed` form field at the Python endpoint). An unavailable/implausible
duration retains the existing 10-second fallback. Null gaps stay on the shared axis.

Debug trace and T-wave plots are disabled by default. Set `ECG_SAVE_TRACE_PLOTS=1`
only for synthetic verification. T-wave *measurements* now run on every request
(see `tWaves` below) and need `neurokit2` (pinned in `requirements.txt`). If it is
missing, the service still starts and answers; `tWaves.status` is `unavailable`
and the Next.js validator keeps the record out of analysis.

## Setup

The Windows CPU environment, exact weight checks, startup script, actual inference
results and remaining privacy/assignment limitations are recorded in
[November 2 local setup](../project%20docs/local-services-2026-11-02.md).
Use `requirements-cpu.txt` for that tested inference profile. `GET /health` reports
the loaded device and resampling setting. `ECG_CPU_THREADS` bounds CPU threads
(default 2). The wrapper also sets UTF-8 console output on Windows to prevent an
upstream Unicode log message from interrupting rhythm assignment.

Use the Open-ECG-Digitizer revision already specified by Rob's branch (`97a1508`).
The adapters depend on its normalization, source cropping and canonicalization
behavior. Do not upgrade the upstream checkout without rerunning the integration
tests and reviewing those coordinate transformations.

From the repository root:

```bash
git clone https://github.com/Ahus-AIM/Open-ECG-Digitizer.git
cd Open-ECG-Digitizer
git checkout 97a1508
git lfs pull
python3.12 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/pip install -r ../digitizer-service/requirements.txt
PYTORCH_ENABLE_MPS_FALLBACK=1 .venv/bin/python -m uvicorn server:app \
  --app-dir ../digitizer-service --host 127.0.0.1 --port 8000
```

Install Tesseract on the host as for the existing preprocessing pipeline. Keep the
metadata API on a separate port (8001 in the integration setup). Set
`ECG_DIGITIZER_URL=http://127.0.0.1:8000` in `.env.local`, restart Next.js, and use
the capture screen. The OCR Python dependencies must be installed in the
**digitizer's** environment as well as the preprocessing environment.

## What is checked

1. `TrackedSignalExtractor` records the horizontal source crop. This matters
   because raw extracted traces no longer span the full aligned image width.
2. `TrackedLeadIdentifier` records merged pixel traces before normalization,
   the normalization crop, and the actual canonical waveform output. It delegates
   extraction and assignment to upstream code without changing sample values.
3. Exact sample-and-missingness comparison identifies a unique source row and
   segment for each returned lead, including a rhythm strip that replaced a short
   lead. Identical traces or unsupported composite assignments remain unverified.
4. Source trace position defines a bounded label-search region above its row and
   near the start of its segment. OCR returns boxes in that same image frame,
   undoing its own rotations and scaling. Layout flips are applied to both the
   verification image and the trace geometry.
5. A local exact label with confidence >=70 and original glyph height >=10 must
   agree. Different confident labels produce a conflict; missing, ambiguous,
   overlapping-region, low-confidence or timed-out evidence requires review.

A global list of matching names is never enough. A V1/V2 swap is a conflict even
when both names appear elsewhere on the page. Names are not silently corrected.

The API retains `leads`, `units`, and `samplingRateHz`, and adds:

```json
{
  "requiresReview": true,
  "leadVerification": {
    "status": "conflict",
    "leads": {
      "V1": {"status": "conflict", "reason": "local_label_disagrees", "observedLabels": ["V2"]}
    }
  }
}
```

Global status is `verified`, `conflict`, or `needs_review`; per-lead status is
`verified`, `conflict`, or `unverified`. `requiresReview` is false only when every
returned lead is verified. This is not a claim that all 12 leads were extracted.
Waveforms remain available as tentative data for review. Consumers must enforce
`requiresReview` before treating assignments as confirmed. The capture screen
shows the combined label-presence count; detailed per-waveform feedback is omitted.
It does not export or forward numeric samples automatically.

The service also returns `modelRecognition`, which counts model labels only after
a successful layout match. The Next.js route adds `recognition.leads`: a usable
local Tesseract label takes priority, followed by the successful built-in result.
These preferred labels are keyed by the original waveform names; numeric arrays
are not renamed or merged. The visible count unions recognized names from both
systems. It does not replace the stricter `leadVerification` audit above.

Older services without verification metadata are explicitly treated as needing
review by the Next.js route. Operational OCR failures also require review.
The service never promotes a default/fallback layout without a finite match.

### T-wave measurements (`tWaves`) and validation (Taiga #64)

`t_wave_report.py` runs Rob's `t_wave.py` once per request and adds:

```json
{
  "tWaves": {
    "status": "complete",
    "method": "median-beat-v1",
    "timeDomain": "median_beat_r_relative_ms",
    "leads": {
      "II": {"status": "measured", "beatsUsed": 3, "windowStartMs": -200.0, "windowEndMs": 650.0,
             "qrsOnsetMs": -40.0, "qrsEndMs": 48.0, "tOnsetMs": 180.0, "tPeakMs": 262.0,
             "tOffsetMs": 330.0, "tPeakMv": 0.31},
      "V2": {"status": "not_found"}
    }
  }
}
```

Times are milliseconds relative to the R peak of that lead's **median beat**, not
positions on the strip; they must never be mapped onto the 5000-sample axis. Every
returned lead has a status. `status: "unavailable"` (with `reason`
`dependency_missing` or `analysis_failed`) means the finder did not run.

The Next.js route then adds `validation`, the wave-attribute report described in
[task-64-wave-validation.md](../project%20docs/task-64-wave-validation.md). It is
computed server-side; any `validation` field sent by this service is discarded.

## Limits

This is a conservative, heuristic spatial cross-check, not a validated clinical
assignment classifier. The search regions assume labels near the left start of
a row segment; unconventional label placement, overlapping rows and incomplete
crops can remain unverified. OCR can still be wrong. Experimental nonlinear
dewarping changes trace coordinates without changing the aligned image, so it
is deliberately unverified; keep upstream's `apply_dewarping: false` default.
Inverted leads (such as -aVR) and ambiguous source traces require review.
The adapters target the pinned revision, not arbitrary digitizer versions.

The check does not validate voltages, signal fidelity, timing, or electrode
placement. Rob's strip-width/paper-speed sampling calculation is retained, along
with its 10-second fallback; calibration and fallback evidence need further
validation. Trace-plot generation is retained behind the opt-in
`ECG_SAVE_TRACE_PLOTS=1` flag.

## Tests

```bash
python -B -m unittest discover -s preprocessing -p 'test_*.py' -v
python -B -m unittest discover -s digitizer-service -p 'test_lead_verification.py' -v
# Use the digitizer environment and the pinned checkout for service tests.
# These mock neural inference and OCR, not upstream assignment/cropping code.
PYTHONPATH=Open-ECG-Digitizer:digitizer-service:preprocessing \
  Open-ECG-Digitizer/.venv/bin/python -B -m unittest discover \
  -s digitizer-service -p 'test_*.py' -v
python -B -m unittest digitizer-service/test_t_wave_report.py -v   # real-finder case needs neurokit2
npm test   # includes the #64 validator, route and fixture tests
npx tsc --noEmit
npm run lint
```

Service tests additionally need `httpx`. They cover spatial swaps, actual rhythm
assignment, cropping, missing/ambiguous OCR, failures, and unchanged samples.
Full neural inference with model weights and independent annotated scans is a
separate validation step; these tests do not establish real-world accuracy.

## Installed local profile and real-image validation

The following describes Arsen's prior Mac environment. Windows provisioning and
real inference were subsequently tested on November 2; see the linked local
setup record above. Keep the two platform profiles distinct.

On the tested 8 GB Mac, start the installed environment and weights with:

```bash
./digitizer-service/start-local.sh
```

This script explicitly selects a 1200-pixel input cap and bounds the MPS GPU
allocation budget. It also limits CPU threading. The service's direct-start
code default remains 2000; override the script with `ECG_RESAMPLE_SIZE=2000`
only when the machine can accommodate the memory/runtime cost. Lower resolution
is a performance tradeoff, not an accuracy improvement: smaller labels can cause
layout identification or OCR verification to remain unconfirmed.

The installed upstream revision is `97a15087d4abcda843da8c58ee74b1d8f47e6f9a`.
Both model files were downloaded and verified against that commit's LFS SHA-256
and byte-size records. The local `.env.local` points Next.js to port 8000.
Restart Next.js after changing its environment. Trained weights, the nested
checkout, Python environment, and generated trace plots are ignored by Git.

Real inference exposed NumPy float32 geometry in responses; source-region box
coordinates are now converted to Python floats and covered by a regression test.

## Local label refinement

The verifier now supplies its source-region boxes to `read_labels`. A bounded
second stage reads gentler grid-suppressed views and tightly cropped glyph groups.
It never supplies the expected lead name to OCR. New detections need two reads
at confidence 70 or above that agree at the same image location. This permits
6–9 pixel glyphs without lowering the confidence threshold or counting repeated
names at different positions as evidence. These reads share image pixels; their
agreement is a heuristic, not a calibrated probability of correctness.

Roman numerals additionally require compatible visible stroke counts. A proposed
I with a neighboring omitted stroke, a clipped glyph, or an isolated thin vertical
line is discarded. Unsupported Roman labels remain unverified; the algorithm
does not guess II from the layout or silently rename a waveform. This is
conservative for sans-serif I and labels touching grid or waveform lines.

The existing global OCR timeout still requires review. Optional local refinement
uses the remaining budget (at most 20 seconds); incomplete optional refinement
retains valid evidence already found and records `local_refinement_truncated`.
No layout matching, waveform samples, units, or sampling-rate behavior changes.

For fair OCR comparisons, reuse saved aligned images and trace provenance. The
pinned upstream perspective detector uses random subsampling and the signal
extractor adds random tie-breaking noise, so independently rerunning neural
inference can change geometry and returned assignments. Report those full-pipeline
results separately from comparisons that hold the digitizer outputs fixed.
