"""Signal conversion and timing shared by the digitizer and lightweight tests."""
import numpy as np

LEAD_NAMES = ["I", "II", "III", "aVR", "aVL", "aVF", "V1", "V2", "V3", "V4", "V5", "V6"]
NUM_SAMPLES = 5000
MIN_STRIP_S, MAX_STRIP_S = 2.0, 12.0
FALLBACK_STRIP_S = 10.0


def strip_duration_s(got, paper_speed_mm_s, identifier):
    """Measure the traced strip's grid width; preserve Rob's explicit fallback."""
    if not np.isfinite(paper_speed_mm_s) or paper_speed_mm_s <= 0:
        raise ValueError("paper_speed must be finite and positive")
    if "raw_lines" not in got["signal"] or "pixel_spacing_mm" not in got:
        return FALLBACK_STRIP_S
    lines = identifier._merge_nonoverlapping_lines(got["signal"]["raw_lines"].clone())
    values = lines.detach().cpu().numpy()
    valid = np.flatnonzero(np.sum(~np.isnan(values), axis=0) >= identifier.required_valid_samples)
    if not len(valid):
        return FALLBACK_STRIP_S
    duration = (valid[-1] - valid[0] + 1) * float(got["pixel_spacing_mm"]["x"]) / paper_speed_mm_s
    return float(duration) if MIN_STRIP_S <= duration <= MAX_STRIP_S else FALLBACK_STRIP_S


def to_result(canonical, sampling_rate_hz):
    """Keep the shared sample axis and missingness while converting uV to mV."""
    lines = canonical.squeeze().cpu().numpy()
    leads = {}
    for name, samples in zip(LEAD_NAMES, lines):
        if not np.isfinite(samples).any():
            continue
        leads[name] = [float(value) / 1000 if np.isfinite(value) else None for value in samples]
    return {"leads": leads, "samplingRateHz": sampling_rate_hz, "units": "mV"}
