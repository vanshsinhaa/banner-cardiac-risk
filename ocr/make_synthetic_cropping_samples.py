"""
Creates FAKE EKG-style printouts for testing the header/footer CROPPING (#77), plus a
ground-truth file that says exactly where each piece of fake identifying info is on the page.
Nothing here is real patient data. Every name/number is random.

These pages are laid out like the real photos we tested on:
  - a header band with fake identifying lines (about a quarter of the page), then the grid
  - a 12-lead layout on the grid: 3 rows of 4 leads plus a rhythm strip, with lead labels
  - NO footer: this hospital puts all identifying info at the top, so only the header is tested (for now, need to double check this)

Run (from the repo root, with the venv active):   python -m ocr.make_synthetic_cropping_samples
Out: ocr/samples_cropping/*.jpg and ocr/samples_cropping/ground_truth.json
"""

import json
import math
import random
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

# write next to this file, so the command works from anywhere
OUT_DIR = Path(__file__).resolve().parent / "samples_cropping"

# page size in pixels (same as the original generator and the real photos' proportions)
W, H = 1700, 1100
# how many different fake pages per "condition"
PAGES_PER_VARIANT = 2

# seeds make the "random" data identical every run, so results are repeatable
random.seed(77)
np.random.seed(77)

FIRST = ["Jane", "John", "Maria", "Alex", "Sam", "Priya"]
LAST = ["Testcase", "Samplesmith", "Mockwell", "Dummyfield", "Fakerton"]


def load_font(size):
    for path in [
        "/System/Library/Fonts/Helvetica.ttc",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default(size)


def make_page(font_size):
    """Draw one clean fake page. Returns (image, list of ground-truth items)."""
    img = Image.new("RGB", (W, H), "white")
    draw = ImageDraw.Draw(img)
    font = load_font(font_size)
    line_gap = font_size + 18

    # ---- 1. header band: fake identifying info (what the crop must remove) ----
    name = f"{random.choice(FIRST)} {random.choice(LAST)}"
    phi_lines = [
        f"Patient: {name}",
        f"MRN: {random.randint(1000000, 9999999)}",
        f"DOB: {random.randint(1, 12):02d}/{random.randint(1, 28):02d}/{random.randint(1940, 2005)}",
        f"Date: 10/{random.randint(1, 28):02d}/2026",
    ]
    truth = []
    y = 40
    for text in phi_lines:
        box = draw.textbbox((60, y), text, font=font)
        draw.text((60, y), text, fill="black", font=font)
        truth.append({"text": text, "box": [float(v) for v in box]})
        y += line_gap

    # normal non-identifying text goes in a second column BESIDE the identifying lines,
    # so it adds no height to the header
    ecg_y = 40
    for text in ["12-lead ECG", "Rate: 72 bpm", "PR: 160 ms", "QRS: 90 ms"]:
        draw.text((900, ecg_y), text, fill="black", font=font)
        ecg_y += line_gap

    # the grid starts 40 px below the last header line (about 28% down the page at font size 40)
    top = y + 40

    # ---- 2. the grid, which runs all the way to the bottom edge like the real photos ----
    grid = (255, 200, 200)
    for gx in range(60, W - 59, 25):
        draw.line([(gx, top), (gx, H - 1)], fill=grid, width=1)
    for gy in range(top, H, 25):
        draw.line([(60, gy), (W - 60, gy)], fill=grid, width=1)

    # ---- 3. footer line printed ON the grid, with a fake device number ----
    foot_y = H - 40

    # ---- 4. a 12-lead layout below the header ----
    # rows: I/aVR/V1/V4, II/aVL/V2/V5, III/aVF/V3/V6, and a rhythm strip (II)
    labels = [["I", "aVR", "V1", "V4"], ["II", "aVL", "V2", "V5"],
              ["III", "aVF", "V3", "V6"], ["II"]]
    label_font = load_font(22)
    wave_top, wave_bottom = top + 30, foot_y - 30
    row_h = (wave_bottom - wave_top) / 4
    col_w = (W - 120) / 4
    for r in range(4):
        mid = int(wave_top + row_h * (r + 0.5))     # the baseline of this row
        points = []
        for x in range(60, W - 60, 5):
            phase = (x - 60) % 170                  # one beat every 170 px
            dy = 0
            if 60 < phase < 70:
                dy = -50                            # a spike, loosely like a QRS peak
            elif 70 <= phase < 80:
                dy = 16
            points.append((x, mid + dy))
        draw.line(points, fill="black", width=2)
        for c, label in enumerate(labels[r]):
            # labels sit above the spikes so the trace does not run through them
            draw.text((60 + c * col_w + 8, mid - 85), label, fill="black", font=label_font)
    return img, truth


def rotate_with_boxes(img, truth, angle):
    """Rotate the image and move the ground-truth boxes with it."""
    rotated = img.rotate(angle, resample=Image.BICUBIC, fillcolor="white")
    cx, cy = W / 2, H / 2
    t = math.radians(angle)
    new_truth = []
    for item in truth:
        x0, y0, x1, y1 = item["box"]
        xs, ys = [], []
        for (px, py) in [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]:
            dx, dy = px - cx, py - cy
            # PIL rotates counter-clockwise; the image y axis points down
            xs.append(cx + dx * math.cos(t) + dy * math.sin(t))
            ys.append(cy - dx * math.sin(t) + dy * math.cos(t))
        new_truth.append({"text": item["text"], "box": [min(xs), min(ys), max(xs), max(ys)]})
    return rotated, new_truth


def apply_variant(img, truth, variant):
    """Make the page harder in a way that mimics real phone photos."""
    if variant == "rotated":
        return rotate_with_boxes(img, truth, 6)
    if variant == "blurry":
        return img.filter(ImageFilter.GaussianBlur(3)), truth
    if variant == "lowcontrast_noisy":
        arr = np.asarray(img).astype(np.float32)
        arr = arr * 0.3 + 150                       # washed-out look
        arr += np.random.normal(0, 22, arr.shape)   # camera noise
        return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8)), truth
    if variant == "shadow":
        arr = np.asarray(img).astype(np.float32)
        gradient = np.linspace(1.0, 0.2, W)[None, :, None]      # darker toward the right
        return Image.fromarray((arr * gradient).astype(np.uint8)), truth
    if variant == "very_blurry":
        return img.filter(ImageFilter.GaussianBlur(6)), truth
    return img, truth


def main():
    OUT_DIR.mkdir(exist_ok=True)
    variants = ["clean", "rotated", "blurry", "lowcontrast_noisy", "shadow",
                "small_font", "very_blurry", "tiny_font"]
    ground_truth = {}
    for variant in variants:
        for n in range(1, PAGES_PER_VARIANT + 1):
            font_size = 18 if variant == "small_font" else 12 if variant == "tiny_font" else 40
            img, truth = make_page(font_size)
            img, truth = apply_variant(img, truth, variant)
            filename = f"{variant}_{n}.jpg"
            img.save(OUT_DIR / filename, quality=90)    # JPEG, like the capture screen
            ground_truth[filename] = {"variant": variant, "phi": truth}
    with open(OUT_DIR / "ground_truth.json", "w") as f:
        json.dump(ground_truth, f, indent=2)
    print(f"Wrote {len(ground_truth)} images to {OUT_DIR}/")


if __name__ == "__main__":
    main()