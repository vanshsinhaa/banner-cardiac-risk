"""Local HTTP service wrapping Open-ECG-Digitizer.

Run from inside Open-ECG-Digitizer/ (the config's weight paths are relative to it):

    PYTORCH_ENABLE_MPS_FALLBACK=1 .venv/bin/python -m uvicorn server:app \
        --app-dir ../digitizer-service --host 127.0.0.1 --port 8000
"""

import sys
import os
import re
import threading
from datetime import datetime
from pathlib import Path
from typing import Any

import matplotlib

matplotlib.use("Agg")  # draw plots to files only; must be set before pyplot is imported

import cv2
import numpy as np
import torch
from fastapi import FastAPI, HTTPException, UploadFile
from torchvision.io import decode_image

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "preprocessing"))
from lead_ocr import read_labels
from lead_verification import source_regions, compare_labels, review
from tracked_identifier import TrackedLeadIdentifier
from tracked_extractor import TrackedSignalExtractor

from src.config.default import get_cfg
from src.digitize import save_png_plot
from src.utils import import_class_from_path

CONFIG_PATH = "src/config/inference_wrapper.yml"
LAYOUTS_PATH = "src/config/lead_layouts_all.yml"
LEAD_NAMES = ["I", "II", "III", "aVR", "aVL", "aVF", "V1", "V2", "V3", "V4", "V5", "V6"]

#NOTE: If testing with a NVIDIA GPU, change resampling to 3000
RESAMPLE_SIZE = int(os.environ.get("ECG_RESAMPLE_SIZE", "2000"))
if not 512 <= RESAMPLE_SIZE <= 3000:
    raise ValueError("ECG_RESAMPLE_SIZE must be between 512 and 3000")
SAMPLING_RATE_HZ = 500  # placeholder: the digitizer always returns 5000 samples per lead

# Trace plots: one PNG per digitized image, to compare the digitized traces with the original.
SAVE_TRACE_PLOTS = True  # set to False to skip drawing (saves a few seconds per request)
TRACE_PLOTS_DIR = Path(__file__).resolve().parent / "trace-plots"


# --- Startup: load the model once -------------------------------------------

if torch.cuda.is_available():
    device = "cuda"  # NVIDIA GPU
elif torch.backends.mps.is_available():
    device = "mps"  # Apple Silicon GPU
else:
    device = "cpu" #Any other CPU

cfg = get_cfg(CONFIG_PATH)
cfg.merge_from_list(
    [
        "MODEL.KWARGS.device", device,
        "MODEL.KWARGS.config.LAYOUT_IDENTIFIER.KWARGS.device", device,
        "MODEL.KWARGS.config.LAYOUT_IDENTIFIER.config_path", LAYOUTS_PATH,
        "MODEL.KWARGS.resample_size", RESAMPLE_SIZE,
    ]
)

wrapper = import_class_from_path(cfg.MODEL.class_path)(**cfg.MODEL.KWARGS)
wrapper.identifier = TrackedLeadIdentifier.wrap(wrapper.identifier)
wrapper.signal_extractor = TrackedSignalExtractor.wrap(wrapper.signal_extractor)

# mutual exclusion for the model wrapper
model_lock = threading.Lock()
# matplotlib's pyplot is not safe to use from several threads at once
plot_lock = threading.Lock()
app = FastAPI()
print(f"Digitizer loaded on {device}")


# --- Helpers ----------------------------------------------------------------
def decode_upload(data: bytes) -> torch.Tensor:
    """Turns uploaded image bytes into a 1x3xHxW uint8 tensor."""
    tensor = torch.frombuffer(bytearray(data), dtype=torch.uint8) # create a tensor from the uploaded image bytes
    tensor = decode_image(tensor, mode="RGB")
    return tensor.unsqueeze(0)


def to_result(canonical: torch.Tensor) -> dict[str, Any]:
    """Converts the digitizer's 12x5000 microvolt tensor into the app's EcgDigitizationResult shape."""
    lines = canonical.squeeze().cpu().numpy()  # (12, 5000), NaN where there is no signal
    leads: dict[str, list[float | None]] = {}

    for name, samples in zip(LEAD_NAMES, lines):
        if np.isnan(samples).all():  # lead is not on the page
            continue

        # Same layout as the digitizer's own output: every lead stays on the shared
        # 5000-sample time axis, and samples with no signal are left empty rather than
        # filled in. JSON cannot represent NaN, so those samples are sent as null.
        millivolts = samples / 1000  # convert microvolts to millivolts
        leads[name] = [None if np.isnan(value) else float(value) for value in millivolts]

    return {"leads": leads, "samplingRateHz": SAMPLING_RATE_HZ, "units": "mV"}


def save_trace_plot(got: dict[str, Any], upload_name: str | None) -> Path:
    """Saves the digitizer's four-panel comparison plot for one image and returns its path."""
    TRACE_PLOTS_DIR.mkdir(exist_ok=True)

    # File name: time of the request plus the upload's name, limited to safe characters.
    stem = re.sub(r"[^A-Za-z0-9_-]", "_", Path(upload_name or "ecg").stem)
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S-%f")
    basepath = TRACE_PLOTS_DIR / f"{timestamp}_{stem}"

    # save_png_plot shifts the lines it is given so the leads do not overlap in the
    # picture. Hand it a copy so the real signal values are left untouched.
    canonical = got["signal"]["canonical_lines"]
    canonical_copy = canonical.clone() if canonical is not None else None

    with plot_lock:
        save_png_plot(got, canonical_copy, str(basepath))  # writes <basepath>.png
    return basepath.with_suffix(".png")


# --- Endpoint ---------------------------------------------------------------
@app.post("/digitize")
def digitize(image: UploadFile) -> dict[str, Any]:
    data = image.file.read(10 * 1024 * 1024 + 1)
    if not data or len(data) > 10 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Send an image up to 10 MB.")

    try:
        tensor = decode_upload(data)
        with model_lock:
            wrapper.identifier.reset()
            wrapper.signal_extractor.source_offset = None
            got = wrapper(tensor, layout_should_include_substring=None)
            provenance = wrapper.identifier.provenance
            source_offset = wrapper.signal_extractor.source_offset
        canonical = got["signal"]["canonical_lines"]
        result = to_result(canonical)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Digitization failed: {e}") from e

    if not result["leads"]:
        raise HTTPException(status_code=422, detail="No leads were found.")

    names = list(result["leads"])
    verification = review("source_geometry_unavailable", names)
    try:
        if wrapper.apply_dewarping:
            verification = review("dewarped_coordinates_unsupported", names)
        elif provenance and provenance["matched"]:
            # OCR and source traces must share the exact perspective-corrected
            # image frame; do not compare with the separately processed preview.
            aligned = got["aligned"]["image"][0].permute(1, 2, 0).numpy()
            aligned = np.clip(aligned * 255, 0, 255).astype(np.uint8)
            aligned = cv2.cvtColor(aligned, cv2.COLOR_RGB2BGR)
            if provenance["flipped"]:
                aligned = np.ascontiguousarray(aligned[::-1, ::-1])
            regions = source_regions(
                **{k: provenance[k] for k in ("raw", "normalized", "canonical", "columns", "crop", "flipped")},
                shape=aligned.shape[:2], source_offset=source_offset,
            )
            verification = compare_labels(regions, read_labels(aligned, regions=regions), names)
        else:
            verification = review("layout_not_matched", names)
    except Exception:
        # Missing OCR, unsupported provenance or malformed coordinates must not
        # turn an unchecked assignment into a verified result.
        verification = review("verification_unavailable", names)
    # A successful extraction is not sufficient: the built-in recognizer must
    # have matched a layout rather than returned its default fallback.
    result["modelRecognition"] = {
        "status": "success" if provenance and provenance["matched"] else "failed",
        "leads": names if provenance and provenance["matched"] else [],
    }
    result["leadVerification"] = verification
    result["requiresReview"] = verification["status"] != "verified"

    # The plot is only a visual check, so a failure to draw it must not fail the request.
    if SAVE_TRACE_PLOTS:
        try:
            plot_path = save_trace_plot(got, image.filename)
            print(f"Saved trace plot: {plot_path}")
        except Exception as e:
            print(f"Could not save trace plot: {e}")

    return result
