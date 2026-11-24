"""
De-identifies an EKG image by CROPPING instead of covering text with black boxes.

The EKG grid is found with a colour-independent test (long vertical lines). Everything above
where the grid starts (the header) is removed, and so is everything below where it ends
(the footer) when that can be found. The pixels that are kept are an exact copy of the
matching rows of the original, so the waveform and grid are unchanged.

Fail-safe rules:
- grid not found, strips disagree, or a cut looks suspicious -> status "failed", NO image
- no header found above the grid                            -> status "nothing_detected"
"""

import math

import numpy as np

PAD = 6                     # extra pixels kept between a cut and identifying text
INK_DELTA = 12              # gray levels away from the paper colour that count as "ink"
WINDOW_FRACTION = 0.04      # test windows are 4% of the image height tall
LINE_COVER = 0.9            # a column is a "vertical line" if 90% of the window's rows are ink there
MIN_LINES_PER_STRIP = 3     # a strip needs at least this many vertical lines to count as grid
STRIPS = 6                  # check the grid edge in 6 vertical strips (catches tilted images)
MIN_AGREEING_STRIPS = 4     # at least this many strips must agree on where the grid starts
MAX_SLANT_FRACTION = 0.015  # strips may differ by at most 1.5% of the height
MIN_CROP_FRACTION = 0.03    # a header smaller than 3% of the height means "no header found"
MAX_CROP_FRACTION = 0.4     # never remove more than 40% of the image from the top
MARGIN_PX = 0               # original pixels kept above the grid (0 = cut right at the grid)


def ink_mask(rgb):
    """True wherever a pixel differs from the paper colour, whatever colour the grid is."""
    gray = np.asarray(rgb.convert("L")).astype(np.int16)
    # paper colour = the most common gray value in the image (the histogram's peak)
    paper = int(np.bincount(gray.ravel(), minlength=256).argmax())
    ink = np.abs(gray - paper) >= INK_DELTA
    # widen every mark by 1 px left and right so slightly tilted lines still look straight
    wide = ink.copy()
    wide[:, 1:] |= ink[:, :-1]
    wide[:, :-1] |= ink[:, 1:]
    return wide


def grid_top_in_strip(ink, window):
    """First row y where the next `window` rows contain at least MIN_LINES_PER_STRIP vertical lines."""
    height = ink.shape[0]
    if height < window:
        return None
    # running totals down each column let us count ink pixels in any window instantly
    csum = np.vstack([np.zeros((1, ink.shape[1]), dtype=np.int32),
                      np.cumsum(ink, axis=0, dtype=np.int32)])
    for y in range(height - window + 1):
        # per column: is (almost) every row of this window inked? True = a vertical line
        covered = (csum[y + window] - csum[y]) >= LINE_COVER * window
        # count separate lines (runs of neighbouring True columns), not individual columns
        n_lines = int((covered[1:] & ~covered[:-1]).sum()) + int(covered[0])
        if n_lines >= MIN_LINES_PER_STRIP:
            return y
    return None


def edge_cut(ink, window):
    """
    How many rows from the TOP edge of `ink` the grid starts, or None if the strips don't agree.
    Pass ink[::-1] (the image upside down) to measure from the BOTTOM edge instead.
    """
    height, width = ink.shape
    tops = []
    for i in range(STRIPS):
        x0, x1 = i * width // STRIPS, (i + 1) * width // STRIPS
        tops.append(grid_top_in_strip(ink[:, x0:x1], window))
    found = sorted(t for t in tops if t is not None)
    if len(found) < MIN_AGREEING_STRIPS:
        return None                           # not enough strips found a grid
    median = found[len(found) // 2]           # the typical grid start across strips
    tolerance = height * MAX_SLANT_FRACTION
    if any(t > median + tolerance for t in found):
        return None                           # a strip far below the rest: refuse rather than guess
    # strips far above the typical start are false alarms (a logo, a box border): ignore them
    agreeing = [t for t in found if abs(t - median) <= tolerance]
    if len(agreeing) < MIN_AGREEING_STRIPS:
        return None
    # the lowest agreeing strip is the safest cut; add back the slack LINE_COVER allows
    return max(agreeing) + math.ceil((1 - LINE_COVER) * window)

def crop_header(img, identifier_bottom=0):
    """
    Cut off everything above where the EKG grid starts (this hospital puts identifiers at the top).
    Returns (new_image_or_none, info):
        status "cropped"          -> info["cut_y"] = rows removed from the top
        status "nothing_detected" -> no header above the grid, copy of the original (flagged)
        status "failed"           -> None: the caller must NOT pass anything on
    identifier_bottom: lowest y of identifying text OCR found in the header; we never cut above it.
    """
    failed = (None, {"status": "failed", "error": "Crop could not be applied.", "cut_y": None})
    try:
        rgb = img.convert("RGB")
        width, height = rgb.size
        window = max(10, int(height * WINDOW_FRACTION))
        grid_top = edge_cut(ink_mask(rgb), window)
        if grid_top is None:
            return failed                     # grid not found reliably -> fail safe
        if grid_top < height * MIN_CROP_FRACTION:
            return img.copy(), {"status": "nothing_detected", "cut_y": 0}
        cut_y = max(grid_top - MARGIN_PX, math.ceil(identifier_bottom) + PAD)
        if cut_y > grid_top or cut_y > height * MAX_CROP_FRACTION:
            return failed                     # identifier touches the grid, or cut is suspiciously large
        return rgb.crop((0, cut_y, width, height)), {"status": "cropped", "cut_y": cut_y}
    except Exception:
        return failed

def cropped_matches_original(original, cropped, cut_y, cut_bottom=None):
    """True only if `cropped` is exactly the original's rows from cut_y down to cut_bottom."""
    a = np.asarray(original.convert("RGB"))
    b = np.asarray(cropped.convert("RGB"))
    bottom = a.shape[0] if cut_bottom is None else cut_bottom
    # the header cut must remove at least one row, and some rows must be left
    if not 0 < cut_y < bottom <= a.shape[0]:
        return False
    kept = a[cut_y:bottom]                    # the rows the crop was supposed to keep
    return kept.shape == b.shape and bool(np.array_equal(kept, b))


def readable(word):
    # count a word as readable if OCR is fairly sure of it and it has 2+ letters/digits
    return word["conf"] >= 0.5 and sum(ch.isalnum() for ch in word["text"]) >= 2