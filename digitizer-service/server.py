"""Local HTTP service wrapping Open-ECG-Digitizer.

Run from inside Open-ECG-Digitizer/ (the config's weight paths are relative to it):

    PYTORCH_ENABLE_MPS_FALLBACK=1 .venv/bin/python -m uvicorn server:app \
        --app-dir ../digitizer-service --host 127.0.0.1 --port 8000
"""

import re
import threading
from datetime import datetime
from pathlib import Path
from typing import Any

import matplotlib

matplotlib.use("Agg")  # draw plots to files only; must be set before pyplot is imported

import numpy as np
import torch
from fastapi import FastAPI, Form, HTTPException, UploadFile
from torchvision.io import decode_image

from src.config.default import get_cfg
from src.digitize import save_png_plot
from src.utils import import_class_from_path
from t_wave import find_t_waves, save_t_wave_plot

CONFIG_PATH = "src/config/inference_wrapper.yml"
LAYOUTS_PATH = "src/config/lead_layouts_all.yml"
LEAD_NAMES = ["I", "II", "III", "aVR", "aVL", "aVF", "V1", "V2", "V3", "V4", "V5", "V6"]

#NOTE: If testing with a NVIDIA GPU, change resampling to 3000
RESAMPLE_SIZE = 2000  # override the default resample size for the digitizer, default is 3000
NUM_SAMPLES = 5000  # the digitizer stretches every strip to this many samples per lead

# The digitizer measures the grid (mm per pixel) and the strip's width in pixels, but not
# how fast the paper ran. 25 mm/s is the standard speed; some printouts use 50 mm/s, which
# can be passed in the request's paper_speed field. The strip's duration, and so the
# sampling rate, follows from width in mm / paper speed.
DEFAULT_PAPER_SPEED_MM_S = 25.0
# A derived duration outside this range means the grid was measured wrong; fall back to
# a standard 10 s strip.
MIN_STRIP_S, MAX_STRIP_S = 2.0, 12.0
FALLBACK_STRIP_S = 10.0

# Trace plots: one PNG per digitized image, to compare the digitized traces with the original,
# plus a second PNG showing the T wave found in each lead's median beat.
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


def strip_duration_s(got: dict[str, Any], paper_speed_mm_s: float) -> float:
    """Returns how many seconds of ECG the digitized strip covers.

    The digitizer crops its traced lines to the columns where at least a few lines have
    signal and stretches that span to NUM_SAMPLES. Measuring the same span here and
    converting it to mm with the grid size gives the strip's real width.
    """
    identifier = wrapper.identifier
    lines = identifier._merge_nonoverlapping_lines(got["signal"]["raw_lines"].clone())
    lines_per_column = torch.sum(~torch.isnan(lines), dim=0).numpy()
    valid = np.flatnonzero(lines_per_column >= identifier.required_valid_samples)
    if len(valid) == 0:
        return FALLBACK_STRIP_S

    width_px = valid[-1] - valid[0] + 1
    width_mm = width_px * float(got["pixel_spacing_mm"]["x"])
    duration = width_mm / paper_speed_mm_s
    if not MIN_STRIP_S <= duration <= MAX_STRIP_S:
        print(f"Strip duration {duration:.2f} s looks wrong; assuming {FALLBACK_STRIP_S} s")
        return FALLBACK_STRIP_S
    return duration


def to_result(canonical: torch.Tensor, sampling_rate_hz: float) -> dict[str, Any]:
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

    return {"leads": leads, "samplingRateHz": sampling_rate_hz, "units": "mV"}


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


# --- Endpoint ---------------------------------------------------------------
@app.post("/digitize")
def digitize(image: UploadFile, paper_speed: float = Form(DEFAULT_PAPER_SPEED_MM_S)) -> dict[str, Any]:
    data = image.file.read()
    if paper_speed <= 0:
        raise HTTPException(status_code=422, detail="paper_speed must be positive (mm/s).")

    try:
        tensor = decode_upload(data)
        with model_lock:
            got = wrapper(tensor, layout_should_include_substring=None)
        canonical = got["signal"]["canonical_lines"]
        duration = strip_duration_s(got, paper_speed)
        sampling_rate = round(NUM_SAMPLES / duration, 1)
        print(f"Strip: {duration:.2f} s at {paper_speed:g} mm/s -> {sampling_rate} Hz")
        result = to_result(canonical, sampling_rate)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Digitization failed: {e}") from e

    if not result["leads"]:
        raise HTTPException(status_code=422, detail="No leads were found.")

    # The plots are only a visual check, so a failure to draw them must not fail the request.
    if SAVE_TRACE_PLOTS:
        basepath = plot_basepath(image.filename)
        try:
            plot_path = save_trace_plot(got, basepath)
            print(f"Saved trace plot: {plot_path}")
        except Exception as e:
            print(f"Could not save trace plot: {e}")

        try:
            t_waves = find_t_waves(result["leads"], result["samplingRateHz"])
            t_wave_path = basepath.with_name(basepath.name + "_t-waves.png")
            with plot_lock:
                save_t_wave_plot(t_waves, result["samplingRateHz"], t_wave_path)
            print(f"Saved T-wave plot: {t_wave_path} ({len(t_waves)} of {len(result['leads'])} leads)")
        except Exception as e:
            print(f"Could not save T-wave plot: {e}")

    return result
