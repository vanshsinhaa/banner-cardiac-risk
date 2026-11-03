"""Known, synthetic 12-lead page for local privacy/readability/inference checks.

All names, IDs and signals are invented. No patient source image or external
dataset. These analytic signals are an engineering fixture, not clinical data.
"""

import hashlib
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
WIDTH, HEIGHT = 2400, 1600
PX_PER_MM = 8
SPEED = 25
GAIN = 10
TRACE_SCALE = .6
GRID_LEFT, GRID_TOP = 160, 340
STRIP_WIDTH = 2000
LAYOUT = [["I", "aVR", "V1", "V4"], ["II", "aVL", "V2", "V5"], ["III", "aVF", "V3", "V6"]]
AMPLITUDES = {"I": .85, "II": 1.0, "III": .65, "aVR": -.7, "aVL": .55, "aVF": .8,
              "V1": .6, "V2": .9, "V3": 1.1, "V4": 1.25, "V5": 1.0, "V6": .85}


def voltage(t, lead):
    # Signed P/Q/R/S/T Gaussian components, repeated every 0.8 s (75 bpm).
    phase = ((np.asarray(t) - .4 + .4) % .8) - .4
    def bump(center, width, amplitude):
        return amplitude * np.exp(-.5 * ((phase - center) / width) ** 2)
    return TRACE_SCALE * AMPLITUDES[lead] * (bump(-.18, .025, .12) + bump(-.035, .009, -.14)
                               + bump(0, .012, 1.0) + bump(.04, .013, -.25) + bump(.24, .055, .3))


def main():
    directory = ROOT / "public/synthetic-ecgs"
    directory.mkdir(parents=True, exist_ok=True)
    font_path = Path("C:/Windows/Fonts/arial.ttf")
    if not font_path.is_file():
        import matplotlib
        font_path = Path(matplotlib.get_data_path()) / "fonts/ttf/DejaVuSans.ttf"
    font = ImageFont.truetype(str(font_path), 34)
    label_font = ImageFont.truetype(str(font_path), 38)
    image = Image.new("RGB", (WIDTH, HEIGHT), "white")
    draw = ImageDraw.Draw(image)
    identifiers = []
    for index, text in enumerate(["Patient: Jane Testcase", "MRN: 123456789", "DOB: 01/01/1970", "Date: 11/02/2026"]):
        position = (160, 35 + index * 52)
        identifiers.append({"box": list(draw.textbbox(position, text, font=font)), "text": text})
        draw.text(position, text, fill="black", font=font)
    draw.text((160, 265), "25 mm/s", fill="black", font=font)
    for x in range(GRID_LEFT, GRID_LEFT + STRIP_WIDTH + 1, PX_PER_MM):
        major = (x - GRID_LEFT) % (5 * PX_PER_MM) == 0
        draw.line([(x, GRID_TOP), (x, 1500)], fill=(235, 160, 160) if major else (250, 215, 215), width=1)
    for y in range(GRID_TOP, 1501, PX_PER_MM):
        major = (y - GRID_TOP) % (5 * PX_PER_MM) == 0
        draw.line([(GRID_LEFT, y), (GRID_LEFT + STRIP_WIDTH, y)], fill=(235, 160, 160) if major else (250, 215, 215), width=1)
    traces = {}

    def trace(lead, left, right, baseline, start_s):
        xs = np.arange(left + 12, right - 8, .5)
        ts = start_s + (xs - left) / (PX_PER_MM * SPEED)
        values = voltage(ts, lead)
        ys = baseline - values * PX_PER_MM * GAIN
        draw.line(list(zip(xs.tolist(), ys.tolist())), fill=(15, 15, 15), width=2)
        draw.text((left + 15, baseline - 112), lead, fill="black", font=label_font,
                  stroke_width=0)
        # Calibration pulse: 1 mV high and 0.2 s wide, before each row's traces.
        traces.setdefault(lead, []).append({"left_px": float(xs[0]), "right_px": float(xs[-1]),
                                           "baseline_y": baseline, "start_s": start_s,
                                           "amplitude_factor": TRACE_SCALE * AMPLITUDES[lead]})

    for row, leads in enumerate(LAYOUT):
        baseline = 540 + row * 260
        for column, lead in enumerate(leads):
            trace(lead, GRID_LEFT + column * 500, GRID_LEFT + (column + 1) * 500, baseline, column * 2.5)
        draw.line([(92, baseline), (100, baseline), (100, baseline - 80), (140, baseline - 80),
                   (140, baseline), (150, baseline)], fill="black", width=3)
    trace("II", GRID_LEFT, GRID_LEFT + STRIP_WIDTH, 1320, 0)
    image_path = directory / "standard-12-lead.png"
    image.save(image_path, "PNG")
    truth = {"synthetic": True, "width": WIDTH, "height": HEIGHT,
             "paper_speed_mm_s": SPEED, "gain_mm_mv": GAIN, "pixels_per_mm": PX_PER_MM,
             "rate_bpm": 75, "nominal_duration_s": 10, "phi": identifiers,
             "layout": LAYOUT, "rhythm_lead": "II", "traces": traces,
             "generator": "scripts/makeFullFlowFixture.py", "font_sha256": hashlib.sha256(font_path.read_bytes()).hexdigest()}
    (directory / "standard-12-lead.truth.json").write_text(json.dumps(truth, indent=2) + "\n", encoding="utf-8")
    print("Generated public/synthetic-ecgs/standard-12-lead.png (synthetic only)")


if __name__ == "__main__":
    main()
