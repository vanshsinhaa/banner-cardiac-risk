import type { TracePoint } from "./geometry.ts";

// The digitizer returns thousands of samples per lead. A reviewer edits a sparse set of
// control points instead, and the corrected samples are rebuilt from them.

export const DEFAULT_STRIDE = 40;
const PEAK_WINDOW = 3;
const PEAK_MV = 0.05;

// A sample that is the highest or lowest within +/-PEAK_WINDOW samples and stands out by
// PEAK_MV. Keeping these means narrow QRS peaks survive the downsampling.
function isPeak(samples: readonly (number | null)[], i: number): boolean {
  const mv = samples[i] as number;
  let higher = true;
  let lower = true;
  let prominence = 0;
  for (let k = i - PEAK_WINDOW; k <= i + PEAK_WINDOW; k++) {
    const other = samples[k];
    if (k === i || other === null || other === undefined) continue;
    if (other > mv) higher = false;
    if (other < mv) lower = false;
    prominence = Math.max(prominence, Math.abs(mv - other));
  }
  return (higher || lower) && prominence >= PEAK_MV;
}

// One point every `stride` samples, plus local peaks and the last sample of every run
// of signal. Null samples are skipped.
export function toControlPoints(samples: readonly (number | null)[], stride = DEFAULT_STRIDE): TracePoint[] {
  const points: TracePoint[] = [];
  samples.forEach((mv, i) => {
    if (mv === null || !Number.isFinite(mv)) return;
    const runEnds = i === samples.length - 1 || samples[i + 1] === null;
    if (i % stride === 0 || runEnds || isPeak(samples, i)) points.push({ i, mv });
  });
  return points;
}

// Points further apart than this are treated as separate runs (no line across a gap).
export function maxGap(stride = DEFAULT_STRIDE): number {
  return stride * 2;
}

// Split points into runs that should be drawn as separate polylines.
export function toRuns(points: readonly TracePoint[], stride = DEFAULT_STRIDE): TracePoint[][] {
  const runs: TracePoint[][] = [];
  let current: TracePoint[] = [];
  points.forEach((point, index) => {
    if (index > 0 && point.i - points[index - 1].i > maxGap(stride)) {
      runs.push(current);
      current = [];
    }
    current.push(point);
  });
  if (current.length) runs.push(current);
  return runs;
}

// Rebuild a full-length sample array by linear interpolation between control points.
// Samples outside every run stay null, so the corrected trace keeps the same shape as
// the digitizer's output and can be compared sample-by-sample.
export function toSamples(points: readonly TracePoint[], sampleCount: number, stride = DEFAULT_STRIDE): (number | null)[] {
  const samples: (number | null)[] = new Array(sampleCount).fill(null);
  for (const run of toRuns(points, stride)) {
    if (run.length === 1) {
      const i = Math.round(run[0].i);
      if (i >= 0 && i < sampleCount) samples[i] = round(run[0].mv);
      continue;
    }
    for (let k = 0; k < run.length - 1; k++) {
      const a = run[k];
      const b = run[k + 1];
      const from = Math.max(0, Math.ceil(a.i));
      const to = Math.min(sampleCount - 1, Math.floor(b.i));
      for (let i = from; i <= to; i++) {
        const t = b.i === a.i ? 0 : (i - a.i) / (b.i - a.i);
        samples[i] = round(a.mv + (b.mv - a.mv) * t);
      }
    }
  }
  return samples;
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}

// Corrected samples for one lead. Wherever the edits did not change the interpolated
// line, the original digitizer samples are kept exactly, so untouched stretches (and
// untouched leads) are not smoothed by the control-point downsampling.
export function applyCorrections(
  autoSamples: readonly (number | null)[],
  autoPoints: readonly TracePoint[],
  correctedPoints: readonly TracePoint[],
  stride = DEFAULT_STRIDE,
): (number | null)[] {
  if (autoPoints === correctedPoints) return autoSamples.slice();
  const before = toSamples(autoPoints, autoSamples.length, stride);
  const after = toSamples(correctedPoints, autoSamples.length, stride);
  return after.map((value, i) => (value === before[i] ? autoSamples[i] : value));
}

// Full-resolution runs of non-null samples between `start` and `end` (inclusive), used
// to draw the trace exactly as stored rather than through the sparse control points.
export function sampleRuns(samples: readonly (number | null)[], start = 0, end = samples.length - 1): TracePoint[][] {
  const runs: TracePoint[][] = [];
  let current: TracePoint[] = [];
  for (let i = Math.max(0, start); i <= Math.min(end, samples.length - 1); i++) {
    const mv = samples[i];
    if (mv === null || !Number.isFinite(mv)) {
      if (current.length) runs.push(current);
      current = [];
    } else current.push({ i, mv });
  }
  if (current.length) runs.push(current);
  return runs;
}
