"""Local app bridge: PNG on stdin, a JSON assessment on stdout."""

import base64
from dataclasses import asdict
import json
import struct
import sys

import cv2
import numpy as np

from preprocess import find_boundary, normalize_lighting, warp
from quality import check_scan_quality

MAX_BYTES = 48 * 1024 * 1024
MAX_PIXELS = 24_000_000


def decode_crop(raw):
    # The browser sends canvas PNGs. Check dimensions before OpenCV allocates.
    if (len(raw) < 33 or len(raw) > MAX_BYTES
            or raw[:8] != b"\x89PNG\r\n\x1a\n" or raw[12:16] != b"IHDR"):
        raise ValueError("Send a valid PNG crop no larger than 48 MB.")
    width, height = struct.unpack(">II", raw[16:24])
    if not width or not height or width * height > MAX_PIXELS:
        raise ValueError("The crop must contain between 1 and 24 million pixels.")
    image = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("The cropped image could not be decoded.")
    return image


def analyze_image(image, *, ocr=None):
    points = find_boundary(image)
    rectified = warp(image, points) if points is not None else image
    # Preserve the original contrast for the readability decision.
    quality = check_scan_quality(rectified, ocr=ocr)
    # With no page boundary, use the user's manual crop for lighting correction.
    from lead_ocr import rotate
    rectified = rotate(rectified, quality.rotation_degrees)
    processed = normalize_lighting(rectified)
    ok, encoded = cv2.imencode(".png", processed)
    if not ok:
        raise RuntimeError("Could not encode the processed image.")
    return {
        **asdict(quality),
        "status": "passed" if quality.accepted else (
            "needs_review" if quality.reasons == ("lead_labels_unreadable_or_missing",) else "failed"
        ),
        "boundary_found": points is not None,
        "width": int(rectified.shape[1]),
        "height": int(rectified.shape[0]),
        "processed_image": "data:image/png;base64," + base64.b64encode(encoded).decode("ascii"),
    }


def main():
    try:
        result = analyze_image(decode_crop(sys.stdin.buffer.read(MAX_BYTES + 1)))
    except ValueError as exc:
        result = {"error": str(exc), "kind": "invalid_image"}
    except RuntimeError:
        result = {"error": "The image check could not complete. Check that Tesseract is installed and try again.", "kind": "processing_error"}
    except Exception:
        result = {"error": "Image processing failed. Try another crop or check the server setup.", "kind": "processing_error"}
    print(json.dumps(result))


if __name__ == "__main__":
    main()
