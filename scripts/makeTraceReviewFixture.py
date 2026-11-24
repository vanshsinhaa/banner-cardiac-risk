"""Demo digitizer output for the trace review screen (#75).

Samples the same analytic signals drawn on public/synthetic-ecgs/standard-12-lead.png
(scripts/makeFullFlowFixture.py) into the live EcgDigitizationResult shape, then adds a
few deliberate digitizer mistakes so the review screen has something to correct.
Synthetic engineering data only, not clinical data.
"""

import json
from pathlib import Path

import numpy as np

from makeFullFlowFixture import LAYOUT, voltage

ROOT = Path(__file__).resolve().parents[1]
RATE = 500
COUNT = 5000
COLUMN = COUNT // 4
# The fixture draws each trace from 12 px after the column start to 8 px before its end (8 px/mm, 25 mm/s).
LEAD_IN, LEAD_OUT = int(12 / 200 * RATE), int(8 / 200 * RATE)


def window(start, end, lead, t):
    samples = [None] * COUNT
    values = voltage(t[start:end], lead)
    samples[start:end] = values.tolist()
    return samples


def main():
    rng = np.random.default_rng(75)
    t = np.arange(COUNT) / RATE
    leads = {}
    for row in LAYOUT:
        for column, lead in enumerate(row):
            leads[lead] = window(column * COLUMN + LEAD_IN, (column + 1) * COLUMN - LEAD_OUT, lead, t)
    leads["II"] = window(LEAD_IN, COUNT - LEAD_OUT, "II", t)

    # Deliberate digitizer mistakes for the demo.
    for i in range(2950, 2980):  # V2: grid line picked up as a spike
        leads["V2"][i] = 1.1 - abs(i - 2965) * 0.05
    for i in range(300, 600):  # I: baseline drift
        leads["I"][i] += 0.18
    for i in range(1700, 1760):  # aVF: R wave clipped flat
        leads["aVF"][i] = min(leads["aVF"][i], 0.12)

    for lead, samples in leads.items():
        leads[lead] = [None if v is None else round(float(v) + float(rng.normal(0, 0.004)), 4) for v in samples]

    result = {
        "leads": leads,
        "samplingRateHz": RATE,
        "units": "mV",
        "requiresReview": True,
        "modelRecognition": {"status": "demo", "leads": list(leads)},
    }
    out = ROOT / "src/lib/traceOverlay/fixtures/demo-digitization.json"
    out.write_text(json.dumps(result, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"Wrote {out.relative_to(ROOT)} (synthetic demo only)")


if __name__ == "__main__":
    main()
