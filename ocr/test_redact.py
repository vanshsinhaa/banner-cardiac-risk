"""
Checks for the header/footer cropping in redact.py, using small made-up images.
No OCR needed, so it runs in a second.

Run from the repo root with the venv active:   python -m ocr.test_redact
(pytest also works once installed:             python -m pytest ocr/test_redact.py)
"""

import sys

import numpy as np
from PIL import Image

from .redact import crop_header, cropped_matches_original

WIDTH, HEIGHT = 600, 400
GRID_START = 120    # first row of the grid on the made-up page


def make_page(grid_start=GRID_START, header_marks=True):
    """A white page: dark marks standing in for header text, a grid, and a 'waveform'."""
    page = np.full((HEIGHT, WIDTH, 3), 255, dtype=np.uint8)
    if header_marks:
        for x in range(20, 400, 14):         # two lines of short dark strokes, like printed text
            page[20:30, x:x + 8] = 0
            page[45:55, x:x + 8] = 0
    for x in range(0, WIDTH, 10):            # light-gray vertical grid lines, down to the bottom
        page[grid_start:, x] = 200
    page[250:253, 20:580] = 0                # the 'waveform'
    return page


def test_header_is_cropped_and_kept_pixels_are_identical():
    page = make_page()
    out, info = crop_header(Image.fromarray(page))
    assert info["status"] == "cropped"
    assert GRID_START <= info["cut_y"] <= GRID_START + 5          # cut right at the grid start
    assert out.size == (WIDTH, HEIGHT - info["cut_y"])            # only rows were removed
    assert np.array_equal(np.asarray(out), page[info["cut_y"]:])  # waveform and grid unchanged


def test_identifier_reaching_into_the_grid_is_refused():
    out, info = crop_header(Image.fromarray(make_page()), identifier_bottom=150)
    assert out is None and info["status"] == "failed"


def test_no_grid_fails_safe():
    out, info = crop_header(Image.fromarray(make_page(grid_start=HEIGHT)))   # grid never starts
    assert out is None and info["status"] == "failed"


def test_no_header_is_flagged_not_silently_released():
    page = make_page(grid_start=0, header_marks=False)             # grid starts at the very top
    out, info = crop_header(Image.fromarray(page))
    assert info["status"] == "nothing_detected" and np.array_equal(np.asarray(out), page)


def test_slanted_grid_edge_is_refused():
    page = make_page()
    page[GRID_START:220, 300:] = 255                               # right half of the grid starts lower
    out, info = crop_header(Image.fromarray(page))
    assert out is None and info["status"] == "failed"


def test_one_false_alarm_strip_is_ignored():
    page = make_page()
    for x in range(100, 200, 10):                                  # a logo-like block of lines in one strip
        page[20:GRID_START, x] = 200
    out, info = crop_header(Image.fromarray(page))
    assert info["status"] == "cropped" and GRID_START <= info["cut_y"] <= GRID_START + 5


def test_pixel_check_catches_any_difference():
    img = Image.fromarray(make_page())
    out, info = crop_header(img)
    cut = info["cut_y"]
    assert cropped_matches_original(img, out, cut)                 # the real crop matches
    tampered = np.asarray(out).copy()
    tampered[5, 5] = (1, 2, 3)                                     # change a single pixel
    assert not cropped_matches_original(img, Image.fromarray(tampered), cut)
    assert not cropped_matches_original(img, out, cut + 1)         # wrong cut position
    assert not cropped_matches_original(img, out, 0)               # nothing was cut from the top

def test_bad_input_fails_safe():
    out, info = crop_header(None)
    assert out is None and info["status"] == "failed"


if __name__ == "__main__":
    # a tiny runner so this file works without pytest
    failures = 0
    for name, function in sorted(globals().items()):
        if name.startswith("test_") and callable(function):
            try:
                function()
                print("PASS", name)
            except Exception:
                failures += 1
                print("FAIL", name)
    print("ALL CHECKS PASSED" if not failures else f"{failures} CHECK(S) FAILED")
    sys.exit(1 if failures else 0)