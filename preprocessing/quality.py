"""Lead-label evidence with conservative acceptance and explicit uncertainty."""

from dataclasses import dataclass

import cv2
import numpy as np


LEADS = ("I", "II", "III", "aVR", "aVL", "aVF", "V1", "V2", "V3", "V4", "V5", "V6")


@dataclass(frozen=True)
class QualityResult:
    accepted: bool
    reasons: tuple[str, ...]
    detected_leads: tuple[str, ...] = ()
    missing_leads: tuple[str, ...] = ()
    uncertain_leads: tuple[str, ...] = ()
    rotation_degrees: int = 0
    ocr_timed_out: bool = False


def _read_labels(image):
    from lead_ocr import read_labels
    return read_labels(image)


def check_scan_quality(
    image, *, expected_leads=LEADS, min_confidence=70.0,
    min_short_side=600, min_label_height=10, ocr=None,
):
    """Check a cropped/rectified ECG before contrast enhancement.

    Input is a uint8 grayscale or OpenCV BGR image. All expected labels must
    appear as exact OCR tokens, with confidence >= min_confidence (0..100)
    and sufficient original pixel height. No ambiguous I/1/l substitutions.
    ``ocr`` optionally accepts an image and returns Tesseract-style data.

    Rejection means label readability was not established, not proof of a bad
    scan. OCR is fallible; this does not verify lead positions or waveform quality.
    Missing/broken OCR raises RuntimeError rather than misreporting poor quality.
    """
    expected_leads = tuple(expected_leads)
    if (not expected_leads or len(set(expected_leads)) != len(expected_leads)
            or any(lead not in LEADS for lead in expected_leads)):
        raise ValueError("expected_leads must be a nonempty unique subset of LEADS")
    if not 0 <= min_confidence <= 100:
        raise ValueError("min_confidence must be in [0, 100]")
    if min_short_side < 1 or min_label_height < 1:
        raise ValueError("Minimum pixel dimensions must be positive")
    if (not isinstance(image, np.ndarray) or image.dtype != np.uint8
            or image.size == 0 or image.ndim not in (2, 3)
            or (image.ndim == 3 and image.shape[2] != 3)):
        return QualityResult(False, ("invalid_image",), missing_leads=expected_leads)
    if min(image.shape[:2]) < min_short_side:
        return QualityResult(False, ("resolution_too_low",), missing_leads=expected_leads)

    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if image.ndim == 3 else image
    if int(gray.max()) - int(gray.min()) < 15:
        return QualityResult(False, ("insufficient_contrast",), missing_leads=expected_leads)
    try:
        data = ocr(gray) if ocr is not None else _read_labels(image)
    except (ImportError, OSError, RuntimeError) as exc:
        raise RuntimeError("Lead-label OCR unavailable or failed; scan was not assessed") from exc

    canonical = {lead.upper(): lead for lead in LEADS}
    detected = set()
    uncertain = set()
    for text, confidence, height in zip(data["text"], data["conf"], data["height"]):
        # Allow surrounding punctuation/case, but never turn arbitrary text into a lead.
        token = text.strip(" \t\r\n:;,.()[]'\"‘’“”").upper()
        lead = canonical.get(token)
        if (lead is not None and float(confidence) >= min_confidence
                and float(height) >= min_label_height):
            detected.add(lead)
        elif lead is not None and float(confidence) >= 35:
            uncertain.add(lead)
    missing = tuple(lead for lead in expected_leads if lead not in detected)
    return QualityResult(
        not missing, ("lead_labels_unreadable_or_missing",) if missing else (),
        tuple(lead for lead in LEADS if lead in detected), missing,
        tuple(lead for lead in LEADS if lead in uncertain and lead not in detected),
        int(data.get("rotation_degrees", 0)), bool(data.get("ocr_timed_out", False)),
    )
