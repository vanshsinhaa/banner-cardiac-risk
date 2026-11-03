#!/usr/bin/env bash
set -euo pipefail
service_dir="$(cd "$(dirname "$0")" && pwd)"
cd "$service_dir/../Open-ECG-Digitizer"
# Memory-bounded local profile. Smaller labels may remain unverified at 1200.
export ECG_RESAMPLE_SIZE="${ECG_RESAMPLE_SIZE:-1200}"
export OMP_NUM_THREADS="${OMP_NUM_THREADS:-1}"
export PYTORCH_ENABLE_MPS_FALLBACK=1
export PYTORCH_MPS_HIGH_WATERMARK_RATIO="${PYTORCH_MPS_HIGH_WATERMARK_RATIO:-1.0}"
export PYTORCH_MPS_LOW_WATERMARK_RATIO="${PYTORCH_MPS_LOW_WATERMARK_RATIO:-0.6}"
export MPLCONFIGDIR="$PWD/.cache/matplotlib"
export XDG_CACHE_HOME="$PWD/.cache"
exec .venv/bin/python -B -m uvicorn server:app --app-dir "$service_dir" --host 127.0.0.1 --port "${ECG_DIGITIZER_PORT:-8000}"
