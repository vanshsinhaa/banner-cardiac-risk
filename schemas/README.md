# Digitized EKG schema

Taiga task #42, user story #26.

`ekg_digitized.schema.json` describes the JSON file that holds one
digitized EKG. Trace extraction (#39), signal conversion (#40), grid
calibration, wave boundary detection, and feature extraction all read or
write this shape. It is plain JSON Schema (draft 2020-12), so it works
from TypeScript and from Python.

Current version: **0.1.0**

## Units and conventions

- Time is in **milliseconds (ms)**, counted from the start of the strip.
- Amplitude is in **millivolts (mV)**. Positive points up. 0 is the baseline.
- No time array is stored. The time of sample `i` in a lead is
  `start_ms + i * 1000 / sample_rate_hz`.
- Derived intervals (PR, QT, T peak-to-end, and so on) are **not** stored.
  Feature extraction computes them from the wave boundaries.
- Extra fields are not allowed. A typo in a field name fails validation.

## Fields

### Top level (all required)

| Field | Type | Unit | Meaning |
| --- | --- | --- | --- |
| `schema_version` | string | none | Must equal the schema's version, `"0.1.0"`. |
| `image_id` | string | none | ID of the source photo. No patient information. |
| `calibration` | object | | See below. |
| `sample_rate_hz` | number > 0 | Hz | Samples per second, same for every lead. |
| `leads` | array, at least 1 | | See below. |
| `quality` | object | | See below. |

### `calibration` (all required)

| Field | Type | Unit | Meaning |
| --- | --- | --- | --- |
| `mm_per_s` | number > 0 | mm/s | Paper speed. Standard is 25. |
| `mm_per_mv` | number > 0 | mm/mV | Gain. Standard is 10. |
| `px_per_mm` | number > 0 | px/mm | Image pixels per millimeter of grid. |
| `source` | `default`, `detected`, or `manual` | none | Where the values came from. |

### Each item in `leads` (all required)

| Field | Type | Unit | Meaning |
| --- | --- | --- | --- |
| `name` | one of `I II III aVR aVL aVF V1 V2 V3 V4 V5 V6` | none | Lead name. |
| `start_ms` | number >= 0 | ms | Time of the first sample. |
| `amplitude_mv` | array of numbers, at least 1 | mV | The signal, one number per sample. |
| `confidence` | number 0 to 1 | none | Confidence in this lead. |
| `beats` | array | | Heartbeats in time order. May be empty. |

Any of the 12 leads may be present. None is required on its own.

### Each item in `beats` (all three keys required)

| Field | Type | Meaning |
| --- | --- | --- |
| `p` | wave or `null` | P wave. `null` when there is no P wave. |
| `qrs` | wave | QRS complex. Its peak is the R peak. Never `null`. |
| `t` | wave or `null` | T wave. `null` when no T wave was found. |

### Each wave (all required)

| Field | Type | Unit | Meaning |
| --- | --- | --- | --- |
| `onset_ms` | number >= 0 | ms | Where the wave starts. |
| `peak_ms` | number >= 0 | ms | Where the wave is furthest from the baseline. |
| `offset_ms` | number >= 0 | ms | Where the wave ends. |
| `amplitude_mv` | number | mV | Signal value at the peak. Negative if the wave points down. |

### `quality` (all required)

| Field | Type | Unit | Meaning |
| --- | --- | --- | --- |
| `overall_confidence` | number 0 to 1 | none | Confidence in the whole result. |
| `flags` | array of `glare`, `skew`, `low_resolution`, `crease` | none | Problems found. Empty when none. No repeats. |

## The time order helper

JSON Schema checks one field at a time. It cannot say "onset comes before
peak". The helper `checkWaveOrder` in `src/lib/checkWaveOrder.ts` checks
that.

```ts
import { checkWaveOrder } from "./src/lib/checkWaveOrder.ts";

const problems = checkWaveOrder(ekg); // list of strings, empty = fine
```

For each lead it checks:

1. Inside a wave: `onset_ms <= peak_ms <= offset_ms`.
2. Each wave starts at or after the end of the wave before it. That
   covers P, then QRS, then T inside a beat, and the last wave of one beat
   before the first wave of the next. `null` waves are skipped.

Run the schema check first. The helper assumes the shape is already valid.
`validateEkg` in `src/lib/validateEkg.ts` does both steps in that order.

The helper does **not** check that two leads have different names, or
that boundaries fall inside the sampled signal.

## Examples

All examples are made up. None is patient data.

| File | Expected result |
| --- | --- |
| `examples/valid_lead_ii.json` | Valid. Two beats of lead II at 75 beats per minute. |
| `examples/invalid_missing_required.json` | Fails: `sample_rate_hz` is missing. |
| `examples/invalid_wrong_type.json` | Fails: `sample_rate_hz` is the text `"100 Hz"`, not a number. |
| `examples/invalid_confidence_above_1.json` | Fails: lead `confidence` is 1.2. |

The valid example uses 100 Hz and 1.6 seconds so the file stays short
enough to read. Real output will have a higher rate and more samples.

## Validating a file

```
npm run validate:ekg -- path/to/file.json
```

This runs the schema check, then the time order helper, and prints every
problem it finds. It needs Node 22.6 or newer and uses ajv version 8.

To run the tests:

```
npm test
```

From Python, the `jsonschema` package can validate against the same
schema file (use `Draft202012Validator`). The time order helper exists
only in TypeScript for now.

## Versioning rule

- The version lives in one place: the `const` value of `schema_version`
  in the schema file.
- **Any** field change means a new version: adding, removing, renaming,
  or changing a type, unit, limit, or enum value.
- When you bump it, update the example files and this README in the same
  commit.
- A file written for another version fails validation. That is on
  purpose, so nobody reads old data with new rules without noticing.
