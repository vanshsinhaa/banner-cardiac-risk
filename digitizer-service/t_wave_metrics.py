"""Measurements built on the T waves found by t_wave.find_t_waves.

Done: t_wave_area. The others return None until their definitions are settled.
Each lead's T-wave result (see t_wave.analyze_lead) has:
    median_beat   one averaged beat in mV
    r_index       index of the R peak in median_beat
    qrs_onset_ms, qrs_end_ms, t_onset_ms, t_peak_ms, t_offset_ms
                  times in ms relative to the R peak (qrs_end_ms is the J-point)
    t_peak_mv, baseline_mv, beats_used
"""

from typing import Any

import numpy as np


# --- Per-lead measurements --------------------------------------------------
def j_point_to_t_end_ms(t_wave: dict[str, Any]) -> float | None:
    """Time from the J-point (end of QRS) to the end of the T wave, in ms.

    TODO: likely t_wave["t_offset_ms"] - t_wave["qrs_end_ms"].
    """
    return None


def qt_ms(t_wave: dict[str, Any]) -> float | None:
    """QT interval (QRS onset to T end) for one lead, in ms.

    TODO: likely t_wave["t_offset_ms"] - t_wave["qrs_onset_ms"].
    """
    return None


def ms_to_index(t_wave: dict[str, Any], ms: float, sampling_rate: float) -> int:
    """Converts a time relative to the R peak back to an index in the median beat."""
    return t_wave["r_index"] + round(ms * sampling_rate / 1000)


def t_wave_area(t_wave: dict[str, Any], sampling_rate: float) -> float | None:
    """Signed area of the T wave above the baseline, in mV*ms.

    - Runs from T onset to T offset as found by t_wave.delineate_t_wave.
    - Measured from the baseline (the flat stretch just before the QRS), not raw zero.
    - Signed: an upright T wave gives a positive area, an inverted one a negative area.

    Returns None if the T-wave boundaries fall outside the median beat.
    """
    beat = np.asarray(t_wave["median_beat"], dtype=float)
    start = ms_to_index(t_wave, t_wave["t_onset_ms"], sampling_rate)
    end = ms_to_index(t_wave, t_wave["t_offset_ms"], sampling_rate)
    if not 0 <= start < end < len(beat):
        return None

    above_baseline = beat[start : end + 1] - t_wave["baseline_mv"]
    return float(np.trapezoid(above_baseline, dx=1000 / sampling_rate))


# --- Whole-ECG measurements -------------------------------------------------
def qtc_ms(qt: float, rr_ms: float) -> float | None:
    """Heart-rate corrected QT, in ms.

    TODO: choose formula: Bazett QT / sqrt(RR s) or Fridericia QT / cbrt(RR s).
    rr_ms is computed inside t_wave.find_t_waves but not returned yet; it needs to
    be exposed before this can be used.
    """
    return None


# Reasons a measurement is None, listed per lead under "missing".
T_WAVE_FINDER_FAILED = "t_wave_finder_failed"  # the finder did not run for this ECG
NO_T_WAVE_FOUND = "no_t_wave_found"            # the lead was digitized but had no T wave
COULD_NOT_CALCULATE = "could_not_calculate"    # the measurement returned None
CALCULATION_ERROR = "calculation_error"        # the measurement raised an error


def measure_lead(t_wave: dict[str, Any], sampling_rate: float) -> dict[str, Any]:
    """Runs every per-lead measurement. A failing measurement is None, never an error."""
    measurements = {
        "j_point_to_t_end_ms": lambda: j_point_to_t_end_ms(t_wave),
        "qt_ms": lambda: qt_ms(t_wave),
        "t_wave_area_mv_ms": lambda: t_wave_area(t_wave, sampling_rate),
    }
    values: dict[str, Any] = {}
    missing: dict[str, str] = {}
    for name, measure in measurements.items():
        try:
            values[name] = measure()
            if values[name] is None:
                missing[name] = COULD_NOT_CALCULATE
        except Exception as e:
            print(f"{name} failed: {e}")
            values[name] = None
            missing[name] = CALCULATION_ERROR
    return {**values, "missing": missing}


def compute_t_wave_metrics(
    t_waves: dict[str, dict[str, Any]] | None, lead_names: list[str], sampling_rate: float
) -> dict[str, Any]:
    """Runs every measurement on every digitized lead.

    Every lead in lead_names appears in the result. A measurement that could not be
    calculated is None (shown as N/A), and "missing" says why.
    t_waves is None when the T-wave finder could not run at all.

    TODO: decide which lead's QT feeds QTc (longest across leads, or lead II / V5).
    """
    per_lead: dict[str, dict[str, Any]] = {}
    for name in lead_names:
        if t_waves is not None and name in t_waves:
            per_lead[name] = measure_lead(t_waves[name], sampling_rate)
            continue
        reason = T_WAVE_FINDER_FAILED if t_waves is None else NO_T_WAVE_FOUND
        empty = {"j_point_to_t_end_ms": None, "qt_ms": None, "t_wave_area_mv_ms": None}
        per_lead[name] = {**empty, "missing": {measurement: reason for measurement in empty}}
    return {"leads": per_lead, "qtc_ms": None}
