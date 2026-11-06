"""Local HTTP service wrapping Open-ECG-Digitizer.

Run from inside Open-ECG-Digitizer/ (the config's weight paths are relative to it):

    PYTORCH_ENABLE_MPS_FALLBACK=1 .venv/bin/python -m uvicorn server:app \
        --app-dir ../digitizer-service --host 127.0.0.1 --port 8000
"""

import base64
import re
import os
import sys
import math
import threading
from datetime import datetime
from pathlib import Path
from typing import Any

# Upstream emits Unicode arrows inside its rhythm-assignment try block. On a
# Windows cp1252 stdout, UnicodeEncodeError is caught as ValueError and silently
# skips assignment. Keep numerical behavior independent of console encoding.
if sys.platform == "win32":
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")

import matplotlib

matplotlib.use("Agg")  # draw plots to files only; must be set before pyplot is imported

import cv2
import numpy as np
import torch
from fastapi import FastAPI, Form, HTTPException, UploadFile
from torchvision.io import decode_image

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "preprocessing"))
from lead_ocr import read_labels
from lead_verification import source_regions, compare_labels, review
from tracked_identifier import TrackedLeadIdentifier
from tracked_extractor import TrackedSignalExtractor

from signal_result import NUM_SAMPLES, strip_duration_s, to_result
from src.config.default import get_cfg
from src.digitize import save_png_plot
from src.utils import import_class_from_path

CONFIG_PATH = "src/config/inference_wrapper.yml"
LAYOUTS_PATH = "src/config/lead_layouts_all.yml"

#NOTE: If testing with a NVIDIA GPU, change resampling to 3000
RESAMPLE_SIZE = int(os.environ.get("ECG_RESAMPLE_SIZE", "2000"))
if not 512 <= RESAMPLE_SIZE <= 3000:
    raise ValueError("ECG_RESAMPLE_SIZE must be between 512 and 3000")

# The digitizer measures the grid (mm per pixel) and the strip's width in pixels, but not
# how fast the paper ran. 25 mm/s is the standard speed; some printouts use 50 mm/s, which
# can be passed in the request's paper_speed field. The strip's duration, and so the
# sampling rate, follows from width in mm / paper speed.
DEFAULT_PAPER_SPEED_MM_S = 25.0

# Trace plots: one PNG per digitized image, to compare the digitized traces with the original,
# plus a second PNG showing the T wave found in each lead's median beat.
# Debug plots contain image pixels. Enable explicitly for synthetic fixtures only.
SAVE_TRACE_PLOTS = os.environ.get("ECG_SAVE_TRACE_PLOTS") == "1"
TRACE_PLOTS_DIR = Path(__file__).resolve().parent / "trace-plots"


# --- Startup: load the model once -------------------------------------------

if torch.cuda.is_available():
    device = "cuda"  # NVIDIA GPU
elif torch.backends.mps.is_available():
    device = "mps"  # Apple Silicon GPU
else:
    device = "cpu" #Any other CPU

if device == "cpu":
    cpu_threads = int(os.environ.get("ECG_CPU_THREADS", "2"))
    if not 1 <= cpu_threads <= 8:
        raise ValueError("ECG_CPU_THREADS must be between 1 and 8")
    torch.set_num_threads(cpu_threads)

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


@app.get("/health")
def health():
    # This module completes model loading before uvicorn serves requests.
    return {"status": "ready", "device": device, "resample_size": RESAMPLE_SIZE}


# --- Helpers ----------------------------------------------------------------
def decode_upload(data: bytes) -> torch.Tensor:
    """Turns uploaded image bytes into a 1x3xHxW uint8 tensor."""
    tensor = torch.frombuffer(bytearray(data), dtype=torch.uint8) # create a tensor from the uploaded image bytes 
    tensor = decode_image(tensor, mode="RGB") 
    return tensor.unsqueeze(0)


def plot_basepath(upload_name: str | None) -> Path:
    """Returns the path (without extension) the plots for one request are saved under."""
    TRACE_PLOTS_DIR.mkdir(exist_ok=True)

    # File name: time of the request plus the upload's name, limited to safe characters.
    stem = re.sub(r"[^A-Za-z0-9_-]", "_", Path(upload_name or "ecg").stem)
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S-%f")
    return TRACE_PLOTS_DIR / f"{timestamp}_{stem}"


def save_trace_plot(got: dict[str, Any], basepath: Path) -> Path:
    """Saves the digitizer's four-panel comparison plot for one image and returns its path."""
    # save_png_plot shifts the lines it is given so the leads do not overlap in the
    # picture. Hand it a copy so the real signal values are left untouched.
    canonical = got["signal"]["canonical_lines"]
    canonical_copy = canonical.clone() if canonical is not None else None

    with plot_lock:
        save_png_plot(got, canonical_copy, str(basepath))  # writes <basepath>.png
    return basepath.with_suffix(".png")


def verify_assignment(got, provenance, source_offset, names):
    previews = {}
    try:
        if wrapper.apply_dewarping:
            return review("dewarped_coordinates_unsupported", names), previews
        if not provenance or not provenance["matched"]:
            return review("layout_not_matched", names), previews
        aligned = got["aligned"]["image"][0].permute(1, 2, 0).cpu().numpy()
        aligned = cv2.cvtColor(np.clip(aligned * 255, 0, 255).astype(np.uint8), cv2.COLOR_RGB2BGR)
        if provenance["flipped"]:
            aligned = np.ascontiguousarray(aligned[::-1, ::-1])
        regions = source_regions(
            **{k: provenance[k] for k in ("raw", "normalized", "canonical", "columns", "crop", "flipped")},
            shape=aligned.shape[:2], source_offset=source_offset)
        for name, region in regions.items():
            if "waveformBox" not in region:
                continue
            x1, y1, x2, y2 = map(int, region["waveformBox"])
            crop = aligned[y1:y2, x1:x2]
            if crop.size:
                if crop.shape[1] > 900:
                    crop = cv2.resize(crop, (900, max(1, round(crop.shape[0]*900/crop.shape[1]))))
                ok, png = cv2.imencode(".png", crop)
                if ok:
                    previews[name] = "data:image/png;base64," + base64.b64encode(png).decode("ascii")
        return compare_labels(regions, read_labels(aligned, regions=regions), names), previews
    except Exception:
        return review("verification_unavailable", names), previews


# --- Endpoint ---------------------------------------------------------------
@app.post("/digitize")
def digitize(image: UploadFile, paper_speed: float = Form(DEFAULT_PAPER_SPEED_MM_S)) -> dict[str, Any]:
    data = image.file.read(64 * 1024 * 1024 + 1)
    if not data or len(data) > 64 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Send an image up to 64 MB.")
    if not math.isfinite(paper_speed) or paper_speed <= 0:
        raise HTTPException(status_code=422, detail="paper_speed must be positive (mm/s).")

    try:
        tensor = decode_upload(data)
        with model_lock:
            wrapper.identifier.reset()
            wrapper.signal_extractor.source_offset = None
            got = wrapper(tensor, layout_should_include_substring=None)
            provenance = wrapper.identifier.provenance
            match_inputs = wrapper.identifier.match_inputs
            source_offset = wrapper.signal_extractor.source_offset
            duration = strip_duration_s(got, paper_speed, wrapper.identifier)
        canonical = got["signal"]["canonical_lines"]
        sampling_rate = round(NUM_SAMPLES / duration, 1)
        print(f"Strip: {duration:.2f} s at {paper_speed:g} mm/s -> {sampling_rate} Hz")
        result = to_result(canonical, sampling_rate)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Digitization failed: {e}") from e

    if not result["leads"]:
        raise HTTPException(status_code=422, detail="No leads were found.")

    names = list(result["leads"])
    verification, previews = verify_assignment(got, provenance, source_offset, names)
    recheck = {"attempted": False, "status": "not_needed"}
    if verification["status"] == "conflict":
        recheck = {"attempted": True, "status": "unavailable",
                   "initialVerification": verification}
        # Restore request-local state under the lock: another request may have
        # used the shared identifier while OCR was running.
        try:
            with model_lock:
                identifier = wrapper.identifier
                identifier.provenance = provenance
                identifier.match_inputs = match_inputs
                identifier.raw_pixels = provenance["raw"]
                identifier.crop = provenance["crop"]
                candidate = identifier.recheck()
                candidate_provenance = identifier.provenance
            if candidate is not None:
                candidate_result = to_result(candidate, sampling_rate)
                candidate_names = list(candidate_result["leads"])
                checks, candidate_previews = verify_assignment(
                    got, candidate_provenance, source_offset, candidate_names)
                # A recheck must not silently drop extracted leads or turn
                # missing OCR into agreement. Retain the original for review
                # unless the alternative is completely verified.
                accepted = set(candidate_names) == set(names) and checks["status"] == "verified"
                recheck.update(status="accepted" if accepted else "needs_review",
                               verification=checks)
                if accepted:
                    result, names = candidate_result, candidate_names
                    provenance, verification, previews = candidate_provenance, checks, candidate_previews
                    got["signal"]["canonical_lines"] = candidate
        except Exception:
            recheck["status"] = "failed"
    result["layoutRecheck"] = recheck
    result["leadPreviews"] = previews
    # A successful extraction is not sufficient: the built-in recognizer must
    # have matched a layout rather than returned its default fallback.
    result["modelRecognition"] = {
        "status": "success" if provenance and provenance["matched"] else "failed",
        "leads": names if provenance and provenance["matched"] else [],
    }
    result["leadVerification"] = verification
    result["requiresReview"] = verification["status"] != "verified"

    # The plots are only a visual check, so a failure to draw them must not fail the request.
    if SAVE_TRACE_PLOTS:
        basepath = plot_basepath(image.filename)
        try:
            plot_path = save_trace_plot(got, basepath)
            print(f"Saved trace plot: {plot_path}")
        except Exception as e:
            print(f"Could not save trace plot: {e}")

        try:
            from t_wave import find_t_waves, save_t_wave_plot
            t_waves = find_t_waves(result["leads"], result["samplingRateHz"])
            t_wave_path = basepath.with_name(basepath.name + "_t-waves.png")
            with plot_lock:
                save_t_wave_plot(t_waves, result["samplingRateHz"], t_wave_path)
            print(f"Saved T-wave plot: {t_wave_path} ({len(t_waves)} of {len(result['leads'])} leads)")
        except Exception as e:
            print(f"Could not save T-wave plot: {e}")

    return result
