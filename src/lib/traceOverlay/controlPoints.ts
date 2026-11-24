import type { TracePoint } from "./geometry.ts";

// The digitizer returns thousands of samples per lead. A reviewer edits a sparse set of
// control points instead, and the corrected samples are rebuilt from them.

export const DEFAULT_STRIDE = 10;

// One point every `stride` samples, plus the last sample of every run of signal so
// peaks at the end of a segment are not dropped. Null samples are skipped.
export function toControlPoints(samples: readonly (number | null)[], stride = DEFAULT_STRIDE): TracePoint[] {
  const points: TracePoint[] = [];
  samples.forEach((mv, i) => {
    if (mv === null || !Number.isFinite(mv)) return;
    const runEnds = i === samples.length - 1 || samples[i + 1] === null;
    if (i % stride === 0 || runEnds) points.push({ i, mv });
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
