"""Finds the T wave in each lead of a digitized ECG.

Takes the leads in the same shape server.py's to_result returns (lead name -> list of
mV samples on the shared time axis, None where there is no signal) and, for every lead,
builds one typical (median) beat and marks where its T wave starts, peaks and ends.

This step only locates the T waves. Judging their shape (inverted, peaked, flat, ...)
and reading them by lead group is a later step that builds on this output.

Needs neurokit2 in the Open-ECG-Digitizer environment:

    .venv/bin/pip install neurokit2
"""

from pathlib import Path
from typing import Any

import matplotlib.pyplot as plt
import neurokit2 as nk
import numpy as np
import scipy.signal

# Window cut around each R peak to build the median beat. 200 ms before the R peak
# covers the P wave and QRS start. After the R peak the window runs to BEAT_END_BEFORE_NEXT_R_MS
# before the next beat's R peak, so it holds the whole T wave but not the next P wave,
# kept within the limits below (a long QT at a slow heart rate needs the 700 ms).
# The RR interval is measured across all leads together, since the heart rate is the same
# in every lead and a short lead or a miscounted one alone would give the wrong window.
BEAT_BEFORE_R_MS = 200
BEAT_END_BEFORE_NEXT_R_MS = 150
MIN_BEAT_AFTER_R_MS = 350
MAX_BEAT_AFTER_R_MS = 700

# The detector sometimes counts a tall T wave as an extra beat. Since all leads share one
# time axis, the beat times are taken from the lead with the most regular rhythm (on a 3x4
# printout usually the rhythm strip), and every lead keeps only its R peaks within
# R_MATCH_MS of one of those times. Leads on a photo can be shifted a little against
# each other, which the tolerance allows for.
R_MATCH_MS = 80

# A lead needs at least this many full beats to build a median beat from. A 2.5 s lead on
# a 3x4 printout often holds only one beat whose window is not cut off at either end, so
# a single beat is accepted; the plot shows how many beats each median was built from.
MIN_BEATS = 1

# Gaps where the digitizer lost the trace for up to this long are filled with a straight
# line. Longer gaps split the lead, and only its longest gap-free part is used.
MAX_GAP_MS = 150

# The QRS starts and ends where the beat's slope drops below this fraction of the
# steepest slope in the QRS and stays there for QRS_QUIET_MS.
QRS_SLOPE_FRACTION = 0.15
QRS_QUIET_MS = 20
# How far from the R peak the QRS edges are looked for. A bundle branch block widens the
# QRS to 200 ms or more, so this is generous.
QRS_MAX_HALF_WIDTH_MS = 160

# The T wave is searched for from this long after the end of the QRS to the end of the
# median beat, which skips the start of the ST segment.
T_SEARCH_AFTER_QRS_MS = 40

# The T wave starts and ends where its distance from the baseline drops below this
# fraction of its peak's distance from the baseline.
T_EDGE_FRACTION = 0.3


# --- Steps (one per lead) ---------------------------------------------------
def extract_signal_run(samples: list[float | None]) -> tuple[int, np.ndarray]:
    """Returns (start index, samples) for the part of the lead that has signal.

    On a 3x4 printout a lead only has values for its 2.5 s column and None elsewhere.
    The filters in later steps cannot handle None/NaN, so cut out the values first.
    The start index is kept so R peaks and T-wave positions can be mapped back onto
    the shared 5000-sample time axis.

    Keeps everything from the first to the last non-None value. A None gap in the
    middle is kept as NaN for fill_gaps to handle.
    """
    # Find the first non-None value.
    for i, sample in enumerate(samples):
        if sample is not None:
            start = i
            break
    else:
        return 0, np.array([])

    # Find the last non-None value. samples[start] is one, so this always finds an end.
    for j in range(len(samples) - 1, start - 1, -1):
        if samples[j] is not None:
            end = j + 1
            break

    return start, np.array(samples[start:end], dtype=float)


def fill_gaps(signal: np.ndarray, sampling_rate: float) -> tuple[int, np.ndarray]:
    """Fills short NaN gaps with a straight line and returns the longest gap-free part.

    The digitizer often loses the trace for a few samples in the middle of a lead, and
    the filters in later steps cannot handle NaN.

    Returns (start index of the part within signal, the part).
    """
    missing = np.isnan(signal)
    if not missing.any():
        return 0, signal

    # Fill every gap of up to MAX_GAP_MS by drawing a line between the values on each side.
    max_gap = int(MAX_GAP_MS * sampling_rate / 1000)
    known = np.flatnonzero(~missing)
    filled = signal.copy()
    # np.diff of the padded mask is 1 where a gap starts and -1 just after it ends.
    edges = np.diff(np.concatenate(([0], missing.astype(int), [0])))
    for gap_start, gap_end in zip(np.flatnonzero(edges == 1), np.flatnonzero(edges == -1)):
        if gap_end - gap_start <= max_gap:
            gap = np.arange(gap_start, gap_end)
            filled[gap] = np.interp(gap, known, signal[known])

    # Longer gaps are left as NaN. Keep the longest part between them.
    missing = np.isnan(filled)
    edges = np.diff(np.concatenate(([1], missing.astype(int), [1])))
    run_starts = np.flatnonzero(edges == -1)
    run_ends = np.flatnonzero(edges == 1)
    longest = np.argmax(run_ends - run_starts)
    return int(run_starts[longest]), filled[run_starts[longest] : run_ends[longest]]


def clean_signal(signal: np.ndarray, sampling_rate: float) -> np.ndarray:
    """Removes baseline wander and high-frequency noise from one lead's signal."""
    return nk.ecg_clean(signal, sampling_rate=sampling_rate)


def find_r_peaks(signal: np.ndarray, sampling_rate: float) -> np.ndarray:
    """Returns the sample indices of the R peaks in a cleaned signal.

    In leads where the QRS points down (always aVR, sometimes others) the detector
    picks the wrong spike, so it runs on an upright copy of those leads. Only the copy
    is flipped: the signal used for the T wave keeps its real direction.
    """
    upright, _ = nk.ecg_invert(signal, sampling_rate=sampling_rate)
    # ecg_peaks returns a tuple; the indices are in its second item.
    _, peaks_info = nk.ecg_peaks(upright, sampling_rate=sampling_rate)
    return np.asarray(peaks_info["ECG_R_Peaks"])


def reference_beats(r_peaks_per_lead: list[np.ndarray], lengths: list[int]) -> np.ndarray | None:
    """Returns the R peak times (on the shared time axis) of the lead with the most regular
    rhythm, or None if no lead has at least three beats.

    Only leads nearly as long as the longest one are considered, so the reference covers
    every lead (on a 3x4 printout that is the rhythm strip, not a 2.5 s column).
    Regularity is the spread of a lead's RR intervals relative to their mean; a lead with
    an extra beat counted on its T waves has alternating short and long intervals.
    """
    longest = max(lengths, default=0)
    best, best_spread = None, np.inf
    for r_peaks, length in zip(r_peaks_per_lead, lengths):
        if len(r_peaks) < 3 or length < 0.8 * longest:
            continue
        intervals = np.diff(r_peaks)
        spread = np.std(intervals) / np.mean(intervals)
        # On equal regularity, more beats is the better reference.
        if spread < best_spread - 0.01 or (spread < best_spread + 0.01 and best is not None and len(r_peaks) > len(best)):
            best, best_spread = r_peaks, spread
    return best


def match_reference_beats(
    r_peaks: np.ndarray, reference: np.ndarray, start: int, length: int, sampling_rate: float
) -> np.ndarray:
    """Keeps the R peaks that lie within R_MATCH_MS of a reference beat (both on the shared axis).

    A lead the reference does not reach (on a 6x2 printout the limb leads run in the first
    5 s and the chest leads in the last 5 s) keeps all its own R peaks.
    """
    if not ((reference >= start) & (reference < start + length)).any():
        return r_peaks
    tolerance = R_MATCH_MS * sampling_rate / 1000
    distances = np.abs(r_peaks[:, None] - reference[None, :]).min(axis=1)
    return r_peaks[distances <= tolerance]


def beat_after_r_ms(rr_ms: float | None) -> float:
    """Returns how long after the R peak the beat window runs, from the RR interval."""
    if rr_ms is None:
        return MIN_BEAT_AFTER_R_MS
    return float(np.clip(rr_ms - BEAT_END_BEFORE_NEXT_R_MS, MIN_BEAT_AFTER_R_MS, MAX_BEAT_AFTER_R_MS))


def build_median_beat(
    signal: np.ndarray, r_peaks: np.ndarray, sampling_rate: float, after_ms: float
) -> tuple[np.ndarray, int, int]:
    """Lines up every full beat on its R peak and takes the median at each sample.

    Cuts BEAT_BEFORE_R_MS before and after_ms after each R peak and skips beats whose
    window runs past either end of the signal.

    Returns (median beat, index of the R peak inside it, number of beats used).
    """
    before = int(BEAT_BEFORE_R_MS * sampling_rate / 1000)
    after = int(after_ms * sampling_rate / 1000)

    beats = []
    for r_peak in r_peaks:
        start = r_peak - before
        end = r_peak + after + 1
        if start < 0 or end > len(signal):
            continue
        beats.append(signal[start:end])

    if not beats:
        return np.array([]), 0, 0

    median_beat = np.median(np.array(beats), axis=0)
    r_index = before
    return median_beat, r_index, len(beats)


def find_qrs(median_beat: np.ndarray, r_index: int, sampling_rate: float) -> tuple[int, int]:
    """Finds where the QRS starts and ends in the median beat.

    Walking out from the R peak in each direction, the QRS edge is the first point where
    the beat's slope stays below QRS_SLOPE_FRACTION of the QRS's steepest slope for
    QRS_QUIET_MS. If no such point is found, the edge is QRS_MAX_HALF_WIDTH_MS from the R peak.

    Returns (onset, end) as indices into median_beat.
    """
    def samples(ms: float) -> int:
        return int(ms * sampling_rate / 1000)

    slope = np.abs(np.gradient(median_beat))
    reach = samples(QRS_MAX_HALF_WIDTH_MS)
    lo = max(r_index - reach, 0)
    hi = min(r_index + reach, len(median_beat) - 1)
    threshold = QRS_SLOPE_FRACTION * slope[lo : hi + 1].max()
    quiet = max(samples(QRS_QUIET_MS), 1)

    end = hi
    for i in range(r_index, hi - quiet + 1):
        if (slope[i : i + quiet] < threshold).all():
            end = i
            break
    onset = lo
    for i in range(r_index, lo + quiet - 1, -1):
        if (slope[i - quiet + 1 : i + 1] < threshold).all():
            onset = i
            break
    return onset, end


def delineate_t_wave(
    median_beat: np.ndarray, r_index: int, sampling_rate: float
) -> dict[str, int] | None:
    """Finds the QRS and the T wave's onset, peak and offset in the median beat.

    neurokit2's ecg_delineate is not used: its "dwt", "cwt" and "peak" methods refuse
    signals shorter than 4 s (a lead on a 3x4 printout has 2.5 s), and its "prominence"
    method often marks the wrong bump on digitized photos.

    Instead, measured from the baseline (the flat stretch just before the QRS):
    - the peak is the turning point farthest from the baseline from T_SEARCH_AFTER_QRS_MS
      after the QRS onward, so an inverted T wave is found the same way as an upright one;
    - the onset and offset are where the beat, walking away from the peak, comes back
      within T_EDGE_FRACTION of the peak's distance from the baseline.

    Returns {"qrs_onset", "qrs_end", "onset", "peak", "offset"} as indices into
    median_beat, or None if there is no turning point after the QRS (the T wave runs
    past the end of the beat window, or the trace is flat).
    """
    def samples(ms: float) -> int:
        return int(ms * sampling_rate / 1000)

    qrs_onset, qrs_end = find_qrs(median_beat, r_index, sampling_rate)

    # The 40 ms before the QRS (the end of the PR segment) is the beat's flat baseline.
    baseline_start = max(qrs_onset - samples(40), 0)
    baseline = np.median(median_beat[baseline_start : qrs_onset + 1])
    distance = np.abs(median_beat - baseline)

    # The peak must be a turning point (a local maximum of the distance): right after the
    # QRS the beat can still be far from the baseline on its way back, and at the end of
    # the window it can be cut off mid-wave, and neither is the T wave's peak.
    search_start = qrs_end + samples(T_SEARCH_AFTER_QRS_MS)
    if search_start >= len(median_beat) - 2:
        return None
    turning_points, _ = scipy.signal.find_peaks(distance[search_start:])
    if len(turning_points) == 0:
        return None
    peak = search_start + int(turning_points[np.argmax(distance[search_start:][turning_points])])
    edge = T_EDGE_FRACTION * distance[peak]

    onset = peak
    while onset > qrs_end and distance[onset - 1] > edge:
        onset -= 1
    offset = peak
    while offset < len(median_beat) - 1 and distance[offset + 1] > edge:
        offset += 1

    return {"qrs_onset": qrs_onset, "qrs_end": qrs_end, "onset": onset, "peak": peak, "offset": offset}


# --- Putting it together ----------------------------------------------------
def prepare_lead(
    samples: list[float | None], sampling_rate: float
) -> tuple[int, np.ndarray, np.ndarray] | None:
    """Cleans one lead and finds its R peaks. Returns None if the lead is too short.

    Returns (start of the cleaned signal on the shared time axis, cleaned signal, R peaks
    as indices into the cleaned signal).
    """
    run_start, signal = extract_signal_run(samples)
    if len(signal) == 0:
        return None
    part_start, signal = fill_gaps(signal, sampling_rate)
    # nk.ecg_invert in find_r_peaks fails on signals shorter than 2 s.
    if len(signal) < 2 * sampling_rate:
        return None

    cleaned = clean_signal(signal, sampling_rate)
    return run_start + part_start, cleaned, find_r_peaks(cleaned, sampling_rate)


def analyze_lead(
    cleaned: np.ndarray, r_peaks: np.ndarray, sampling_rate: float, after_ms: float
) -> dict[str, Any] | None:
    """Builds one lead's median beat and finds its T wave. Returns None if none was found."""
    median_beat, r_index, beats_used = build_median_beat(cleaned, r_peaks, sampling_rate, after_ms)
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
        "qrs_onset_ms": ms_from_r(t_wave["qrs_onset"]),
        "qrs_end_ms": ms_from_r(t_wave["qrs_end"]),
        "t_onset_ms": ms_from_r(t_wave["onset"]),
        "t_peak_ms": ms_from_r(t_wave["peak"]),
        "t_offset_ms": ms_from_r(t_wave["offset"]),
        "t_peak_mv": float(median_beat[t_wave["peak"]]),
        "beats_used": beats_used,
    }


def find_t_waves(leads: dict[str, list[float | None]], sampling_rate: float) -> dict[str, dict[str, Any]]:
    """Finds the T wave in every lead. Leads where none was found are left out."""
    # neurokit2 raises on signals it cannot process; one bad lead must not stop the rest.
    prepared: dict[str, tuple[int, np.ndarray, np.ndarray]] = {}
    for name, samples in leads.items():
        try:
            lead = prepare_lead(samples, sampling_rate)
        except Exception as e:
            print(f"R-peak detection failed for lead {name}: {e}")
            continue
        if lead is not None:
            prepared[name] = lead

    reference = reference_beats(
        [start + r_peaks for start, _, r_peaks in prepared.values()],
        [len(cleaned) for _, cleaned, _ in prepared.values()],
    )
    rr_ms = None if reference is None else float(np.median(np.diff(reference))) * 1000 / sampling_rate
    after_ms = beat_after_r_ms(rr_ms)

    results: dict[str, dict[str, Any]] = {}
    for name, (start, cleaned, r_peaks) in prepared.items():
        if reference is not None and len(r_peaks) > 0:
            r_peaks = match_reference_beats(start + r_peaks, reference, start, len(cleaned), sampling_rate) - start
        try:
            result = analyze_lead(cleaned, r_peaks, sampling_rate, after_ms)
        except Exception as e:
            print(f"T-wave analysis failed for lead {name}: {e}")
            continue
        if result is not None:
            results[name] = result
    return results


# --- Plot -------------------------------------------------------------------
PLOT_LEAD_ORDER = ["I", "aVR", "V1", "V4", "II", "aVL", "V2", "V5", "III", "aVF", "V3", "V6"]


def save_t_wave_plot(t_waves: dict[str, dict[str, Any]], sampling_rate: float, path: Path) -> None:
    """Draws each lead's median beat with its T wave marked and saves it as a PNG.

    The leads are laid out like a 3x4 printout. The QRS is shaded grey, the T wave
    (onset to offset) red, its peak is marked with a dot, and leads where no T wave was
    found are labelled no_twave.
    Not thread-safe (uses pyplot): callers running in several threads must hold a lock.
    """
    fig, axes = plt.subplots(3, 4, figsize=(16, 9), sharex=True)
    fig.text(0.99, 0.99, f"{sampling_rate:g} Hz", ha="right", va="top", color="#666666")
    for ax, name in zip(axes.flat, PLOT_LEAD_ORDER):
        ax.set_title(name, loc="left", fontsize=11)
        ax.grid(True, color="#e5e5e5", linewidth=0.6)
        ax.axvline(0, color="#bbbbbb", linewidth=0.8)  # R peak
        result = t_waves.get(name)
        if result is None:
            ax.text(0.5, 0.5, "no_twave", ha="center", va="center", color="#c0392b",
                    fontsize=16, fontweight="bold", transform=ax.transAxes)
            continue

        beat = np.asarray(result["median_beat"])
        times_ms = (np.arange(len(beat)) - result["r_index"]) * 1000 / sampling_rate
        ax.plot(times_ms, beat, color="#1f3a5f", linewidth=1.2)
        ax.axvspan(result["qrs_onset_ms"], result["qrs_end_ms"], color="#888888", alpha=0.15)
        ax.axvspan(result["t_onset_ms"], result["t_offset_ms"], color="#e07a5f", alpha=0.2)
        ax.plot(result["t_peak_ms"], result["t_peak_mv"], "o", color="#c0392b", markersize=5)
        beats = result["beats_used"]
        ax.set_title(f"{beats} beat{'s' if beats != 1 else ''}", loc="right", fontsize=9, color="#666666")

    for ax in axes[-1]:
        ax.set_xlabel("ms from R peak")
    for ax in axes[:, 0]:
        ax.set_ylabel("mV")
    fig.suptitle("Median beat per lead: QRS shaded grey, T wave red (onset to offset), peak marked")
    fig.tight_layout()
    fig.savefig(path, dpi=100)
    plt.close(fig)
