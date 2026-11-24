import { sampleToPx, type LeadFrame, type PixelPoint, type SampleRange, type TracePoint } from "./geometry.ts";

// The editor shows one lead at a time, zoomed to a 2.5 s window (the width of one
// printed lead), so control points are far enough apart on screen to grab.

export const WINDOW_SAMPLES = 1250;

export function leadWindows(range: SampleRange | null, perWindow = WINDOW_SAMPLES): SampleRange[] {
  if (!range) return [];
  const length = range.end - range.start + 1;
  const count = Math.max(1, Math.round(length / perWindow));
  const size = Math.ceil(length / count);
  return Array.from({ length: count }, (_, k) => ({
    start: range.start + k * size,
    end: Math.min(range.end, range.start + (k + 1) * size - 1),
  }));
}

export interface ViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Image region that holds the window's trace with some paper around it. The vertical
// range always covers at least -0.8..+1.6 mV so flat leads do not get over-zoomed.
export function windowViewBox(frame: LeadFrame, points: readonly TracePoint[], window: SampleRange): ViewBox {
  let low = -0.8;
  let high = 1.6;
  for (const point of points) {
    if (point.i < window.start || point.i > window.end) continue;
    low = Math.min(low, point.mv);
    high = Math.max(high, point.mv);
  }
  const margin = 0.35;
  const left = sampleToPx(frame, { i: window.start, mv: 0 }).x;
  const right = sampleToPx(frame, { i: window.end, mv: 0 }).x;
  const padX = (right - left) * 0.03;
  const top = sampleToPx(frame, { i: 0, mv: high + margin }).y;
  const bottom = sampleToPx(frame, { i: 0, mv: low - margin }).y;
  return { x: left - padX, y: top, width: right - left + padX * 2, height: bottom - top };
}

export function inWindow(point: TracePoint, window: SampleRange): boolean {
  return point.i >= window.start && point.i <= window.end;
}

// Index of the closest point within `maxDistance` image units, or null.
export function nearestPoint(
  frame: LeadFrame, points: readonly TracePoint[], pixel: PixelPoint, maxDistance: number, window?: SampleRange,
): number | null {
  let best: number | null = null;
  let bestDistance = maxDistance;
  points.forEach((point, index) => {
    if (window && !inWindow(point, window)) return;
    const p = sampleToPx(frame, point);
    const distance = Math.hypot(p.x - pixel.x, p.y - pixel.y);
    if (distance <= bestDistance) {
      best = index;
      bestDistance = distance;
    }
  });
  return best;
}

// Vertical distance from the pixel to the trace line drawn through `points`, or null
// when the pixel is outside the trace's time range.
export function distanceToLine(frame: LeadFrame, points: readonly TracePoint[], pixel: PixelPoint): number | null {
  for (let k = 0; k < points.length - 1; k++) {
    const a = sampleToPx(frame, points[k]);
    const b = sampleToPx(frame, points[k + 1]);
    if (pixel.x < a.x || pixel.x > b.x) continue;
    const t = b.x === a.x ? 0 : (pixel.x - a.x) / (b.x - a.x);
    return Math.abs(a.y + (b.y - a.y) * t - pixel.y);
  }
  return null;
}
