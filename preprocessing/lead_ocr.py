"""Bounded, local Tesseract passes for small labels among ECG grid lines."""

import time

import cv2
import numpy as np

LEAD_TOKENS = {"I", "II", "III", "AVR", "AVL", "AVF", "V1", "V2", "V3", "V4", "V5", "V6"}


def token(text):
    return text.strip(" \t\r\n:;,.()[]'\"‘’“”").upper()


def foreground(image):
    """Suppress light grid/background; retain text-sized dark components."""
    channel = image[:, :, 2] if image.ndim == 3 else image
    background = cv2.GaussianBlur(channel, (0, 0), 15)
    flat = cv2.divide(channel, background, scale=255)
    mask = (flat < 110).astype(np.uint8) * 255
    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask)
    keep = np.zeros(count, np.uint8)
    for index, (_, _, width, height, area) in enumerate(stats[1:], 1):
        if 8 <= height <= 90 and 2 <= width <= 250 and area > 12 and .07 < area / (width * height) < .95:
            keep[index] = 255
    return 255 - keep[labels]


def blue_foreground(image):
    """An additional view for blue labels; never replaces grayscale evidence."""
    if image.ndim != 3:
        return None
    blue, green, red = cv2.split(image.astype(np.int16))
    mask = ((blue - red > 8) & (blue - green > 4) & (red < 80)).astype(np.uint8) * 255
    if np.count_nonzero(mask) < 100:
        return None
    # Remove long separators while retaining nearby glyphs for a second pass.
    for width, height in [(1, 100), (100, 1)]:
        close = np.ones((9 if height > 1 else 1, 9 if width > 1 else 1), np.uint8)
        lines = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, close)
        lines = cv2.morphologyEx(lines, cv2.MORPH_OPEN, np.ones((height, width), np.uint8))
        mask = cv2.subtract(mask, lines)
    return 255 - mask

    
def rotate(image, degrees):
    return np.ascontiguousarray(np.rot90(image, -(degrees // 90)))


def read_labels(image, *, budget_seconds=28, regions=None):
    import pytesseract

    deadline = time.monotonic() + budget_seconds
    scale = min(1.0, 3000 / max(image.shape[:2]))
    working = cv2.resize(image, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA) if scale < 1 else image
    filtered = foreground(working)
    attempts = []
    detections = []
    timed_out = False

    def read(view, degrees, psm, enlargement=1.0):
        nonlocal timed_out
        remaining = deadline - time.monotonic()
        if remaining < .2:
            timed_out = True
            return None
        try:
            data = pytesseract.image_to_data(
                view, config=f"--psm {psm} -c load_system_dawg=0 -c load_freq_dawg=0",
                output_type=pytesseract.Output.DICT, timeout=min(6, remaining),
            )
        except RuntimeError as exc:
            if "timeout" not in str(exc).lower():
                raise
            timed_out = True
            return None
        data = dict(data)
        # Preserve localized evidence in the caller's original image frame.
        factor = scale * enlargement
        for i, word in enumerate(data["text"]):
            name = token(word)
            if name not in LEAD_TOKENS or float(data["conf"][i]) < 35:
                continue
            if not all(key in data for key in ("left", "top", "width", "height")):
                continue
            x, y, w, h = [float(data[key][i]) / factor
                          for key in ("left", "top", "width", "height")]
            ih, iw = image.shape[:2]
            box = {0: [x, y, w, h], 90: [y, ih-x-w, h, w],
                   180: [iw-x-w, ih-y-h, w, h],
                   270: [iw-y-h, x, h, w]}[degrees]
            detections.append((degrees, {"lead": name, "confidence": float(data["conf"][i]),
                                         "height": h, "box": box}))
        data["height"] = [float(height) / (scale * enlargement) for height in data["height"]]
        attempts.append((degrees, data))
        return data

    def score(data):
        # Distinct, multi-character labels provide stronger orientation evidence
        # than an isolated I, which may also be a waveform or grid fragment.
        found = {}
        for word, confidence in zip(data["text"], data["conf"]):
            name = token(word)
            if name in LEAD_TOKENS and float(confidence) >= 35:
                found[name] = max(found.get(name, 0), float(confidence))
        return sum((1 if name == "I" else 3) + confidence / 100 for name, confidence in found.items())

    # Check each orientation independently; never combine labels across rotations.
    orientations = []
    for degrees in (0, 90, 270, 180):
        data = read(rotate(filtered, degrees), degrees, 11)
        if data is not None:
            orientations.append((score(data), degrees))
    if not orientations:
        raise RuntimeError("OCR timed out before an orientation could be assessed")
    _, degrees = max(orientations, key=lambda pair: pair[0])
    upright = rotate(working, degrees)
    blue = blue_foreground(upright)
    if blue is not None:
        read(blue, degrees, 11)
        read(blue, degrees, 6)
    gray = cv2.cvtColor(upright, cv2.COLOR_BGR2GRAY) if upright.ndim == 3 else upright
    read(gray, degrees, 11)
    # Small printed glyphs are often legible but below Tesseract's useful
    # character size. Enlarge the same evidence; do not lower confidence or
    # infer labels. Keep the input and height checks in original pixels.
    selected = rotate(filtered, degrees)
    for enlargement in (2, 3):
        confirmed = {
            token(word)
            for angle, data in attempts if angle == degrees
            for word, confidence, height in zip(data["text"], data["conf"], data["height"])
            if float(confidence) >= 70 and height >= 10
        }
        if LEAD_TOKENS <= confirmed:
            break
        if deadline - time.monotonic() < .2:
            timed_out = True
            break
        # Bound memory and runtime on high-resolution phone photographs.
        if selected.size * enlargement ** 2 > 12_000_000:
            break
        enlarged = cv2.resize(selected, None, fx=enlargement, fy=enlargement,
                              interpolation=cv2.INTER_LINEAR)
        read(enlarged, degrees, 11, enlargement)
    merged = {"text": [], "conf": [], "height": [], "rotation_degrees": degrees, "ocr_timed_out": timed_out}
    for angle, data in attempts:
        if angle == degrees:
            for key in ("text", "conf", "height"):
                merged[key].extend(data[key])
    merged["detections"] = [item for angle, item in detections if angle == degrees]
    merged["coordinate_space"] = "input_pixels"
    if regions is not None:
        from region_ocr import refine_labels
        merged = refine_labels(image, regions, merged,
                               budget_seconds=max(0, min(20, deadline-time.monotonic())))
    return merged
