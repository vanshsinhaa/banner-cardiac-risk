"""Finds the T wave in each lead of a digitized ECG.

Takes the leads in the same shape server.py's to_result returns (lead name -> list of
mV samples on the shared time axis, None where there is no signal) and, for every lead,
builds one typical (median) beat and marks where its T wave starts, peaks and ends.

This step only locates the T waves. Judging their shape (inverted, peaked, flat, ...)
and reading them by lead group is a later step that builds on this output.

Needs neurokit2 in the Open-ECG-Digitizer environment:

    .venv/bin/pip install neurokit2
"""

from typing import Any

import neurokit2 as nk
import numpy as np

# Window cut around each R peak to build the median beat. 250 ms before the R peak
# covers the P wave and QRS start; 450 ms after covers the T wave at normal heart rates.
BEAT_BEFORE_R_MS = 250
BEAT_AFTER_R_MS = 450

# A lead needs at least this many full beats to build a median beat from.
MIN_BEATS = 2


# --- Steps (one per lead) ---------------------------------------------------
def extract_signal_run(samples: list[float | None]) -> tuple[int, np.ndarray]:
    """Returns (start index, samples) for the part of the lead that has signal.

    On a 3x4 printout a lead only has values for its 2.5 s column and None elsewhere.
    The filters in later steps cannot handle None/NaN, so cut out the values first.
    The start index is kept so R peaks and T-wave positions can be mapped back onto
    the shared 5000-sample time axis.

    If there are several runs of values (gaps from the digitizer), keep the longest.
    """
    raise NotImplementedError("extract_signal_run is not implemented yet.")


def clean_signal(signal: np.ndarray, sampling_rate: int) -> np.ndarray:
    """Removes baseline wander and high-frequency noise from one lead's signal.

    neurokit2: nk.ecg_clean(signal, sampling_rate=sampling_rate)
    """
    raise NotImplementedError("clean_signal is not implemented yet.")


def find_r_peaks(signal: np.ndarray, sampling_rate: int) -> np.ndarray:
    """Returns the sample indices of the R peaks in a cleaned signal.

    neurokit2: nk.ecg_peaks(signal, sampling_rate=sampling_rate) returns a tuple;
    the indices are in its second item, under the key "ECG_R_Peaks".
    """
    raise NotImplementedError("find_r_peaks is not implemented yet.")


def build_median_beat(
    signal: np.ndarray, r_peaks: np.ndarray, sampling_rate: int
) -> tuple[np.ndarray, int, int]:
    """Lines up every full beat on its R peak and takes the median at each sample.

    Cut BEAT_BEFORE_R_MS before and BEAT_AFTER_R_MS after each R peak (convert ms to
    samples with sampling_rate), skip beats whose window runs past either end of the
    signal, and take np.median across the beats.

    Returns (median beat, index of the R peak inside it, number of beats used).
    """
    raise NotImplementedError("build_median_beat is not implemented yet.")


def delineate_t_wave(
    median_beat: np.ndarray, r_index: int, sampling_rate: int
) -> dict[str, int] | None:
    """Finds the T wave's onset, peak and offset in the median beat.

    neurokit2: nk.ecg_delineate(median_beat, [r_index], sampling_rate=sampling_rate,
    method="dwt") returns a tuple; its second item has the keys "ECG_T_Onsets",
    "ECG_T_Peaks" and "ECG_T_Offsets", each a list with one index per beat (NaN when
    it could not find that point).

    Returns {"onset": i, "peak": i, "offset": i} as indices into median_beat, or None
    if any of the three was not found.
    """
    raise NotImplementedError("delineate_t_wave is not implemented yet.")


# --- Putting it together ----------------------------------------------------
def analyze_lead(samples: list[float | None], sampling_rate: int) -> dict[str, Any] | None:
    """Runs the steps above on one lead. Returns None if no T wave could be found."""
    start, signal = extract_signal_run(samples)
    cleaned = clean_signal(signal, sampling_rate)
    r_peaks = find_r_peaks(cleaned, sampling_rate)
    median_beat, r_index, beats_used = build_median_beat(cleaned, r_peaks, sampling_rate)
    if beats_used < MIN_BEATS:
        return None

    t_wave = delineate_t_wave(median_beat, r_index, sampling_rate)
    if t_wave is None:
        return None

    def ms_from_r(index: int) -> float:
        """Converts an index in the median beat to milliseconds after the R peak."""
        return (index - r_index) * 1000 / sampling_rate

    return {
        "median_beat": median_beat.tolist(),
        "r_index": r_index,
        "t_onset_ms": ms_from_r(t_wave["onset"]),
        "t_peak_ms": ms_from_r(t_wave["peak"]),
        "t_offset_ms": ms_from_r(t_wave["offset"]),
        "t_peak_mv": float(median_beat[t_wave["peak"]]),
        "beats_used": beats_used,
    }


def find_t_waves(leads: dict[str, list[float | None]], sampling_rate: int) -> dict[str, dict[str, Any]]:
    """Finds the T wave in every lead. Leads where none was found are left out."""
    results: dict[str, dict[str, Any]] = {}
    for name, samples in leads.items():
        result = analyze_lead(samples, sampling_rate)
        if result is not None:
            results[name] = result
    return results
