"""In-memory service pipeline; no saved detections, patient artifacts or ground truth.

The initial policy conservatively blocks text outside the prototype's identifying
rules and a small ECG-text allowlist. It is not a general PHI classifier.
"""

import math
import re
from dataclasses import dataclass, field
from numbers import Real
from typing import Callable

import numpy as np
from PIL import Image

from .ocr_compare import area, looks_identifying, merge_rows, overlap
from .redact import outside_unchanged, redact_image

POLICY_VERSION = "printed-ecg-v1"
MIN_CONFIDENCE = 0.5
MAX_DETECTIONS = 5000
LEAD = r"(?:I|II|III|aVR|aVL|aVF|V[1-6])"
ECG_TEXT = re.compile(
    rf"(?:12[ -]lead\s+ECG|{LEAD}(?:\s+{LEAD})*|"
    r"(?:Rate|HR)\s*:?\s*\d{1,3}\s*bpm|"
    r"(?:PR|QRS|QT|QTc|QT/QTc)\s*:?\s*\d{1,4}(?:\s*/\s*\d{1,4})?\s*ms|"
    r"(?:25|50)\s*mm/s|(?:5|10|20)\s*mm/mV)", re.IGNORECASE,
)
Ocr = Callable[[Image.Image], list[dict]]


class PrivacyError(ValueError):
    """A safe, stable reason code; never includes OCR text or exception details."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class RedactedImage:
    image: Image.Image = field(repr=False)
    regions_redacted: int


def read_words(run_ocr: Ocr, image: Image.Image) -> list[dict]:
    try:
        words = run_ocr(image.copy())
        if not isinstance(words, list) or len(words) > MAX_DETECTIONS:
            raise ValueError()
        for word in words:
            text, confidence, box = word["text"], word["conf"], word["box"]
            if not isinstance(text, str) or len(text) > 4096 or len(box) != 4:
                raise ValueError()
            if any(isinstance(v, bool) or not isinstance(v, Real) or not math.isfinite(v)
                   for v in [confidence, *box]):
                raise ValueError()
            if not 0 <= confidence <= 1 or area(box) <= 0:
                raise ValueError()
            if box[2] <= 0 or box[3] <= 0 or box[0] >= image.width or box[1] >= image.height:
                raise ValueError()
            if not text.strip() or confidence < MIN_CONFIDENCE:
                raise PrivacyError("uncertain_text")
        return words
    except PrivacyError:
        raise
    except Exception:
        raise PrivacyError("ocr_failed") from None


def identifying_rows(words: list[dict]) -> list[dict]:
    rows = merge_rows(words)
    for row in rows:
        row["identifying"] = looks_identifying(row["text"])
        if not row["identifying"] and not ECG_TEXT.fullmatch(row["text"].strip()):
            raise PrivacyError("uncertain_text")
    return rows


def deidentify_image(image: Image.Image, run_ocr: Ocr) -> RedactedImage:
    """Release a candidate only after geometry, pixels and a second OCR pass agree."""
    if "A" in image.getbands() and image.getchannel("A").getextrema() != (255, 255):
        raise PrivacyError("unsupported_pixels")
    if image.mode not in {"RGB", "RGBA", "L"}:
        raise PrivacyError("unsupported_pixels")
    original = image.convert("RGB")
    words = read_words(run_ocr, original)
    rows = identifying_rows(words)
    if not any(row["identifying"] for row in rows):
        raise PrivacyError("nothing_detected")
    candidate, info = redact_image(original, rows)
    if candidate is None or info["status"] != "redacted" or not info["boxes"]:
        raise PrivacyError("redaction_failed")
    boxes = info["boxes"]
    if not outside_unchanged(original, candidate, boxes):
        raise PrivacyError("verification_failed")
    before, after = np.asarray(original), np.asarray(candidate)
    for x0, y0, x1, y1 in boxes:
        if not (after[y0:y1, x0:x1] == 0).all() or not (before[y0:y1, x0:x1] != 0).any():
            raise PrivacyError("verification_failed")
    residual = read_words(run_ocr, candidate)
    if any(row["identifying"] for row in identifying_rows(residual)):
        raise PrivacyError("verification_failed")
    if any(any(overlap(word["box"], box) > 0 for box in boxes) for word in residual):
        raise PrivacyError("verification_failed")
    return RedactedImage(candidate, len(boxes))
