"""In-memory service pipeline; no saved detections, patient artifacts or ground truth.

De-identification crops the identifying header (and footer, when identifying text is found
there) off the image, then checks the result with a second OCR pass. The policy blocks text
that looks identifying and any readable-looking text outside a small ECG allowlist. It is not
a general PHI classifier.
"""

import math
import re
from dataclasses import dataclass, field
from numbers import Real
from typing import Callable

from PIL import Image

from .ocr_compare import area, looks_identifying, merge_rows
from .redact import crop_header, cropped_matches_original

POLICY_VERSION = "printed-ecg-v2"
MIN_CONFIDENCE = 0.5
MAX_DETECTIONS = 5000
# Text with fewer letters/digits than this cannot hold a name, date or ID number, so unsure
# or unlisted text this short (grid marks, lead labels) does not block an image.
MIN_UNKNOWN_CHARS = 4
LEAD = r"(?:I|II|III|aVR|aVL|aVF|V[1-6])"
ECG_TEXT = re.compile(
    rf"(?:12[ -]lead\s+ECG|{LEAD}(?:\s+{LEAD})*|"
    r"(?:Rate|HR)\s*:?\s*\d{1,3}\s*bpm|"
    r"(?:PR|QRS|QT|QTc|QT/QTc)\s*:?\s*\d{1,4}(?:\s*/\s*\d{1,4})?\s*ms|"
    r"(?:25|50)\s*mm/s|(?:5|10|20)\s*mm/mV)", re.IGNORECASE,
)
# a token made of nothing but lead names run together, e.g. "IIaVL" or "i.avl.." once
# punctuation is stripped. OCR often reads the printed lead labels this way.
LEAD_ONLY = re.compile(rf"(?:{LEAD})+", re.IGNORECASE)
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
    top_cut: int = 0       # rows removed from the top (the header)
    bottom_cut: int = 0    # rows removed from the bottom (the footer)


def alnum_count(text: str) -> int:
    # how many letters/digits the text has (spaces and punctuation don't count)
    return sum(ch.isalnum() for ch in text)


def is_lead_label(token: str) -> bool:
    # True if the token is only lead names run together, once punctuation is removed
    squeezed = re.sub(r"[^A-Za-z0-9]", "", token)
    return bool(squeezed) and LEAD_ONLY.fullmatch(squeezed) is not None


def reads_as_text(run_ocr: Ocr, image: Image.Image, box: list) -> bool:
    """
    Take a closer look at one word OCR was unsure about: crop around it, enlarge it and read
    just that piece. True if it can now read 4+ letters/digits confidently, so the word is real
    text. Also True if the closer look fails, which keeps the failure on the safe side.
    """
    try:
        x0, y0, x1, y1 = [int(v) for v in box]
        pad = 12                                          # a little context around the word
        piece = image.crop((max(0, x0 - pad), max(0, y0 - pad),
                            min(image.width, x1 + pad), min(image.height, y1 + pad)))
        # enlarge up to 3x, but keep the longest side under 3500px (OCR resizes anything above 4000)
        scale = max(1, min(3, 3500 // max(piece.size)))
        piece = piece.resize((piece.width * scale, piece.height * scale), Image.LANCZOS)
        # lead labels and allowed ECG text can't carry an identifier, so they don't count
        return any(w["conf"] >= MIN_CONFIDENCE and alnum_count(w["text"]) >= MIN_UNKNOWN_CHARS
                   and not ECG_TEXT.fullmatch(w["text"].strip()) and not is_lead_label(w["text"])
                   for w in run_ocr(piece))
    except Exception:
        return True


def read_words(run_ocr: Ocr, image: Image.Image, strict: bool = True) -> list[dict]:
    """
    Run OCR and check its output. strict=True is for the final check on the cropped image.
    strict=False is only for the first "where is the text?" hint: unsure words are skipped
    instead of blocking, because the final check will still look at the result.
    """
    try:
        words = run_ocr(image.copy())
        if not isinstance(words, list) or len(words) > MAX_DETECTIONS:
            raise ValueError()
        kept = []
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
                # OCR is unsure about this word. If it has 4+ letters/digits, look closer:
                # block only when the closer look reads real text. Shorter or empty marks
                # can't hold an identifier, so they are skipped.
                if (strict and alnum_count(text) >= MIN_UNKNOWN_CHARS
                        and reads_as_text(run_ocr, image, box)):
                    raise PrivacyError("uncertain_text")
                continue
            kept.append(word)
        return kept
    except PrivacyError:
        raise
    except Exception:
        raise PrivacyError("ocr_failed") from None


def has_unknown_text(text: str) -> bool:
    # True if any word in the row has 4+ letters/digits and is neither an allowed ECG term
    # nor just lead labels run together
    return any(alnum_count(token) >= MIN_UNKNOWN_CHARS
               and not ECG_TEXT.fullmatch(token) and not is_lead_label(token)
               for token in text.split())


def identifying_rows(words: list[dict], strict: bool = True) -> list[dict]:
    rows = merge_rows(words)
    for row in rows:
        row["identifying"] = looks_identifying(row["text"])
        text = row["text"].strip()
        if (strict and not row["identifying"] and not ECG_TEXT.fullmatch(text)
                and not is_lead_label(text) and has_unknown_text(text)):
            raise PrivacyError("uncertain_text")
    return rows


RESIDUAL_CHECK_FRACTION = 1.0   # 1.0 = check the whole cropped image. Lower it (e.g. 0.3) ONLY
                                # if the physician confirms the footer holds nothing identifying.

def deidentify_image(image: Image.Image, run_ocr: Ocr) -> RedactedImage:
    """Crop off the header, then release only if the pixels match and no identifying text remains."""
    if "A" in image.getbands() and image.getchannel("A").getextrema() != (255, 255):
        raise PrivacyError("unsupported_pixels")
    if image.mode not in {"RGB", "RGBA", "L"}:
        raise PrivacyError("unsupported_pixels")
    original = image.convert("RGB")

    # First OCR pass is only a hint: how low does the header text reach (top half only)?
    identifier_bottom = 0
    try:
        rows = identifying_rows(read_words(run_ocr, original, strict=False), strict=False)
        identifier_bottom = max((r["box"][3] for r in rows
                                 if r["identifying"] and (r["box"][1] + r["box"][3]) / 2 < original.height / 2),
                                default=0)
    except PrivacyError as error:
        if error.code == "ocr_failed":
            raise

    candidate, info = crop_header(original, identifier_bottom)
    if info["status"] == "nothing_detected":
        raise PrivacyError("nothing_detected")
    if candidate is None or info["status"] != "cropped":
        raise PrivacyError("redaction_failed")

    if not cropped_matches_original(original, candidate, info["cut_y"]):
        raise PrivacyError("verification_failed")

    # Second pass: nothing identifying may remain in what we release
    check = candidate.crop((0, 0, candidate.width, max(1, int(candidate.height * RESIDUAL_CHECK_FRACTION))))
    if any(r["identifying"] for r in identifying_rows(read_words(run_ocr, check, strict=False), strict=False)):
        raise PrivacyError("verification_failed")

    return RedactedImage(candidate, 1, info["cut_y"], 0)