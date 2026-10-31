"""
Creates FAKE EKG-style printouts with FAKE patient info, 
plus ground-truth file that says exactly where each piece of fake patient info is on page.
Nothing here is real patient data. Every name/number is random.

Run: python make_synthetic_samples.py
Out: samples/*.jpg and samples/ground_truth.json
"""

import json
import math
import random 
from pathlib import Path 

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT_DIR = Path("samples")

#page size in pixels 
W, H = 1700, 1100
#how many different fake pages per "condition"
PAGES_PER_VARIANT = 2

#seeds make "random" data identical every run, so results are repeatable
random.seed(49)
np.random.seed(49)

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
    """draw one clean fake page. returns (image, list of ground-truth items)."""
    img = Image.new("RGB", (W, H), "white")
    draw = ImageDraw.Draw(img)
    font = load_font(font_size)
    line_gap = font_size + 18

    # fake identifying info (what OCR should find) 
    name = f"{random.choice(FIRST)} {random.choice(LAST)}"
    phi_lines = [
        f"Patient: {name}",
        f"MRN: {random.randint(1000000,9999999)}",
        f"DOB: {random.randint(1,12):02d}/{random.randint(1,28):02d}/{random.randint(1940,2005)}",
        f"Date: 10/{random.randint(1, 28):02d}/2026",
    ]
    truth = []
    y = 40
    for text in phi_lines:
        box = draw.textbbox((60, y), text, font=font) 
        draw.text((60, y), text, fill="black", font=font)
        truth.append({"text": text, "box": [float(v) for v in box]})
        y += line_gap
    
    #2 normal non-identifying text (OCR should not flag these)
    y += 20
    for text in ["12-lead ECG", "Rate: 72 bpm", "PR: 160 ms", "QRS: 90 ms", "QT/QTc: 380/410 ms"]:
        draw.text((60, y), text, fill="black", font=font)
        y += line_gap

    #3 grid and fake waveform so it looks like an EKG
    top, bottom = min(y + 20, H - 300), H - 40
    for gx in range(60, W- 59, 25):
        draw.line([(gx, top), (gx, bottom)], fill=(255, 200, 200), width=1)
    for gy in range(top, bottom, 25):
        draw.line([(60, gy), (W - 60, gy)], fill = (255, 200, 200), width=1)
    mid = (top + bottom) // 2
    points = []
    for x in range(60, W - 60, 5):
        phase = (x - 60) % 170
        dy = 0
        if 60 < phase < 70:
            dy = -120 # tall spike 
        elif 70 <= phase < 80:
            dy = 40
        points.append((x, mid + dy))
    draw.line(points, fill="black", width=2)
    return img, truth 

def rotate_with_boxes(img, truth, angle):
    """Rotate image and move ground-truth boxes with it."""
    rotated = img.rotate(angle, resample=Image.BICUBIC, fillcolor="white")
    cx, cy = W / 2, H / 2
    t = math.radians(angle)
    new_truth = []
    for item in truth: 
        x0, y0, x1, y1 = item["box"]
        xs, ys = [], []
        for (px, py) in [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]:
            dx, dy = px - cx, py-cy
            # PIL rotates counter-clockwise; image y axis points down 
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
        arr = arr * 0.3 + 150   #washed-out look
        arr += np.random.normal(0, 22, arr.shape)   #camera noise
        return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8)), truth
    if variant == "shadow":
        arr = np.asarray(img).astype(np.float32)
        gradient = np.linspace(1.0, 0.2, W)[None, :, None]  #darker toward right 
        return Image.fromarray((arr * gradient).astype(np.uint8)), truth
    if variant == "very_blurry":
        return img.filter(ImageFilter.GaussianBlur(6)), truth
    return img, truth

def main():
    OUT_DIR.mkdir(exist_ok=True)
    variants = ["clean", "rotated", "blurry", "lowcontrast_noisy", "shadow", "small_font", "very_blurry", "tiny_font"]
    ground_truth = {}
    for variant in variants:
        for n in range(1, PAGES_PER_VARIANT + 1):
            font_size = 18 if variant == "small_font" else 12 if variant == "tiny_font" else 40
            img, truth = make_page(font_size)
            img, truth = apply_variant(img, truth, variant)
            filename = f"{variant}_{n}.jpg"
            img.save(OUT_DIR / filename, quality = 90)  #JPEG like capture screen
            ground_truth[filename] = {"variant": variant, "phi":truth}
    with open(OUT_DIR / "ground_truth.json", "w") as f:
        json.dump(ground_truth, f, indent=2)
    print(f"Wrote {len(ground_truth)} images to {OUT_DIR}/")

if __name__ == "__main__":
    main()
