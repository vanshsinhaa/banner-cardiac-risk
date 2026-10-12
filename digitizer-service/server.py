"""Local HTTP service wrapping Open-ECG-Digitizer.

Run from inside Open-ECG-Digitizer/ (the config's weight paths are relative to it):

    PYTORCH_ENABLE_MPS_FALLBACK=1 .venv/bin/python -m uvicorn server:app \
        --app-dir ../digitizer-service --host 127.0.0.1 --port 8000
"""

import threading
from typing import Any

import numpy as np
import torch
from fastapi import FastAPI, HTTPException, UploadFile
from torchvision.io import decode_image

from src.config.default import get_cfg
from src.utils import import_class_from_path

CONFIG_PATH = "src/config/inference_wrapper.yml"
LAYOUTS_PATH = "src/config/lead_layouts_all.yml"
LEAD_NAMES = ["I", "II", "III", "aVR", "aVL", "aVF", "V1", "V2", "V3", "V4", "V5", "V6"]

#NOTE: If testing with a NVIDIA GPU, change resampling to 3000
RESAMPLE_SIZE = 2000  # override the default resample size for the digitizer, default is 3000
SAMPLING_RATE_HZ = 500  # placeholder: the digitizer always returns 5000 samples per lead


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


# --- Endpoint ---------------------------------------------------------------
@app.post("/digitize")
def digitize(image: UploadFile) -> dict[str, Any]:
    data = image.file.read()

    try:
        tensor = decode_upload(data)
        with model_lock:
            got = wrapper(tensor, layout_should_include_substring=None)
        canonical = got["signal"]["canonical_lines"]
        result = to_result(canonical)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Digitization failed: {e}") from e

    if not result["leads"]:
        raise HTTPException(status_code=422, detail="No leads were found.")
    return result
