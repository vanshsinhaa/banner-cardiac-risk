"""Builds a synthetic digitizer response for the #64 validator tests and demo.

No image, model weights or patient data are involved. neurokit2 simulates a 12-lead
ECG, which is laid out like a 3x4 printout on the digitizer's shared 5000-sample axis
(each lead has signal only in its 2.5 s column, null elsewhere, plus a full-length
lead II rhythm strip). The real t_wave.py code then measures the T waves, so the
fixture's `tWaves` field is what the service would return for the same samples.

Variants:
  aligned     (default) every lead is one simulated beat train with its own gain, so
              R peaks line up across leads like on a real printout. All 12 T waves are
              measured: the record passes validation.
  multileads  neurokit2's own 12-lead simulation. Its leads' R peaks are offset by
              ~240 ms, more than t_wave.py's 80 ms beat-matching tolerance, so most T
              waves are not found: the record needs review.

    python make_validation_fixture.py ../tests/fixtures/wave-validation/valid-12-lead.json
    python make_validation_fixture.py ../tests/fixtures/wave-validation/t-waves-missing.json multileads

Requires numpy, scipy and neurokit2 (see requirements.txt).
"""
import json
import sys
from pathlib import Path

import neurokit2 as nk
import numpy as np

from signal_result import LEAD_NAMES, NUM_SAMPLES
from t_wave_report import measure_t_waves

SAMPLING_RATE_HZ = 500.0  # 5000 samples over a 10 s strip
COLUMNS = [["I", "II", "III"], ["aVR", "aVL", "aVF"], ["V1", "V2", "V3"], ["V4", "V5", "V6"]]
SEED = 64


# Rough relative QRS/T sizes and signs per lead; aVR is inverted as on a normal ECG.
GAINS = {"I": 0.6, "II": 1.0, "III": 0.45, "aVR": -0.8, "aVL": 0.3, "aVF": 0.7,
         "V1": 0.5, "V2": 0.9, "V3": 1.1, "V4": 1.3, "V5": 1.1, "V6": 0.8}


def simulate(variant: str) -> dict[str, np.ndarray]:
    rate = int(SAMPLING_RATE_HZ)
    if variant == "multileads":
        simulated = nk.ecg_simulate(duration=10, sampling_rate=rate, heart_rate=70, method="multileads", random_state=SEED)
        return {name: simulated[name].to_numpy() for name in LEAD_NAMES}
    base = nk.ecg_simulate(duration=10, sampling_rate=rate, heart_rate=70, method="ecgsyn", random_state=SEED)
    noise = np.random.default_rng(SEED)
    return {name: GAINS[name] * base + noise.normal(0, 0.005, len(base)) for name in LEAD_NAMES}


def synthetic_leads(variant: str = "aligned") -> dict[str, list[float | None]]:
    simulated = simulate(variant)
    column_len = NUM_SAMPLES // 4
    leads: dict[str, list[float | None]] = {}
    for column, names in enumerate(COLUMNS):
        start, end = column * column_len, (column + 1) * column_len
        for name in names:
            values = simulated[name][:NUM_SAMPLES]
            # Lead II also carries the full-length rhythm strip, as on a 3x4 printout.
            keep = np.ones(NUM_SAMPLES, bool) if name == "II" else (np.arange(NUM_SAMPLES) >= start) & (np.arange(NUM_SAMPLES) < end)
            leads[name] = [round(float(v), 4) if k else None for v, k in zip(values, keep)]
    return {name: leads[name] for name in LEAD_NAMES}


def build(variant: str = "aligned") -> dict:
    leads = synthetic_leads(variant)
    _, t_waves = measure_t_waves(leads, SAMPLING_RATE_HZ)
    return {
        "_fixture": f"Synthetic neurokit2 ECG ({variant}, seed {SEED}); T waves measured by t_wave.py. No patient data.",
        "leads": leads,
        "samplingRateHz": SAMPLING_RATE_HZ,
        "units": "mV",
        "modelRecognition": {"status": "success", "leads": list(leads)},
        "leadVerification": {
            "status": "verified",
            "leads": {name: {"status": "verified", "observedLabels": [name]} for name in leads},
        },
        "requiresReview": False,
        "tWaves": t_waves,
    }


if __name__ == "__main__":
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("valid-12-lead.json")
    out.parent.mkdir(parents=True, exist_ok=True)
    fixture = build(sys.argv[2] if len(sys.argv) > 2 else "aligned")
    out.write_text(json.dumps(fixture, separators=(",", ":")) + "\n", encoding="utf-8")
    measured = sum(1 for lead in fixture["tWaves"]["leads"].values() if lead["status"] == "measured")
    print(f"Wrote {out} ({len(fixture['leads'])} leads, T wave measured in {measured}).")
