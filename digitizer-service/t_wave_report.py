"""Turns t_wave.py's per-lead results into the `tWaves` field of the /digitize response.

t_wave.py measures one median beat per lead. Its times are milliseconds relative to
that median beat's R peak (negative before the R peak), not positions on the strip.
This module keeps that meaning explicit (`timeDomain`) so the validator (Taiga #64)
never compares them with the shared sample axis.

Every returned lead has a status, so "not attempted", "attempted but nothing found"
and "measured" stay distinguishable:

    {"status": "complete" | "unavailable", "reason"?: str,
     "method": "median-beat-v1", "timeDomain": "median_beat_r_relative_ms",
     "leads": {"II": {"status": "measured", "beatsUsed": 3, "windowStartMs": -200.0,
                      "windowEndMs": 650.0, "qrsOnsetMs": -40.0, "qrsEndMs": 48.0,
                      "tOnsetMs": 180.0, "tPeakMs": 260.0, "tOffsetMs": 330.0,
                      "tPeakMv": 0.31},
               "V2": {"status": "not_found"}}}

The full median beat is left out of the response to keep it small; the debug plot
still draws it from the raw results.
"""
from typing import Any, Callable

METHOD = "median-beat-v1"
TIME_DOMAIN = "median_beat_r_relative_ms"


def _round(value: float) -> float:
    return round(float(value), 3)


def lead_measurement(found: dict[str, Any], sampling_rate: float) -> dict[str, Any]:
    """Converts one find_t_waves entry to the JSON shape, without the median beat."""
    beat_length = len(found["median_beat"])
    r_index = found["r_index"]
    return {
        "status": "measured",
        "beatsUsed": int(found["beats_used"]),
        "windowStartMs": _round(-r_index * 1000 / sampling_rate),
        "windowEndMs": _round((beat_length - 1 - r_index) * 1000 / sampling_rate),
        "qrsOnsetMs": _round(found["qrs_onset_ms"]),
        "qrsEndMs": _round(found["qrs_end_ms"]),
        "tOnsetMs": _round(found["t_onset_ms"]),
        "tPeakMs": _round(found["t_peak_ms"]),
        "tOffsetMs": _round(found["t_offset_ms"]),
        "tPeakMv": round(float(found["t_peak_mv"]), 4),
    }


def _report(status: str, leads: dict[str, Any], reason: str | None = None) -> dict[str, Any]:
    report: dict[str, Any] = {"status": status, "method": METHOD, "timeDomain": TIME_DOMAIN, "leads": leads}
    if reason:
        report["reason"] = reason
    return report


def measure_t_waves(
    leads: dict[str, list[float | None]],
    sampling_rate: float,
    finder: Callable[[dict[str, list[float | None]], float], dict[str, dict[str, Any]]] | None = None,
) -> tuple[dict[str, dict[str, Any]], dict[str, Any]]:
    """Runs the T-wave finder once and returns (raw results for plotting, `tWaves` report).

    A missing dependency or a crash in the finder produces an "unavailable" report rather
    than failing the whole digitization: the samples are still useful for review, and the
    validator then keeps the record out of analysis.
    """
    if finder is None:
        try:
            from t_wave import find_t_waves as finder
        except ImportError:
            return {}, _report("unavailable", {}, "dependency_missing")
    try:
        found = finder(leads, sampling_rate)
    except Exception as e:
        print(f"T-wave measurement failed: {type(e).__name__}")
        return {}, _report("unavailable", {}, "analysis_failed")

    measured: dict[str, Any] = {}
    for name in leads:
        if name not in found:
            measured[name] = {"status": "not_found"}
            continue
        try:
            measured[name] = lead_measurement(found[name], sampling_rate)
        except (KeyError, TypeError, ValueError):
            measured[name] = {"status": "not_found"}
    return found, _report("complete", measured)
