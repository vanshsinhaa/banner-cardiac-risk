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


def compute_t_wave_metrics(
    t_waves: dict[str, dict[str, Any]], sampling_rate: float
) -> dict[str, Any]:
    """Runs every measurement on every lead with a T wave.

    TODO: decide which lead's QT feeds QTc (longest across leads, or lead II / V5).
    """
    per_lead = {
        name: {
            "j_point_to_t_end_ms": j_point_to_t_end_ms(t_wave),
            "qt_ms": qt_ms(t_wave),
            "t_wave_area_mv_ms": t_wave_area(t_wave, sampling_rate),
        }
        for name, t_wave in t_waves.items()
    }
    return {"leads": per_lead, "qtc_ms": None}
