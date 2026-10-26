import { isConvex, type Corners, type Point } from "./cropCorners.ts";

export type Homography = readonly [number, number, number, number, number, number, number, number, number];

function assertQuad(corners: Corners) {
  if (!isConvex(corners)) throw new Error("Degenerate or non-convex quadrilateral.");
}

/** Solve eight coefficients with scaled coordinates and partial pivoting. */
export function computeHomography(source: Corners, destination: Corners): Homography {
  assertQuad(source);
  assertQuad(destination);
  const s = Math.max(1, ...source.flatMap(p => [Math.abs(p.x), Math.abs(p.y)]));
  const d = Math.max(1, ...destination.flatMap(p => [Math.abs(p.x), Math.abs(p.y)]));
  const rows: number[][] = [];
  source.forEach((p, i) => {
    const x = p.x / s, y = p.y / s, u = destination[i].x / d, v = destination[i].y / d;
    rows.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    rows.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  });
  for (let col = 0; col < 8; col++) {
    let pivot = col;
    for (let row = col + 1; row < 8; row++) if (Math.abs(rows[row][col]) > Math.abs(rows[pivot][col])) pivot = row;
    if (Math.abs(rows[pivot][col]) < 1e-12) throw new Error("Degenerate homography.");
    [rows[col], rows[pivot]] = [rows[pivot], rows[col]];
    const divisor = rows[col][col];
    for (let j = col; j <= 8; j++) rows[col][j] /= divisor;
    for (let row = 0; row < 8; row++) {
      if (row === col) continue;
      const factor = rows[row][col];
      for (let j = col; j <= 8; j++) rows[row][j] -= factor * rows[col][j];
    }
  }
  const h = rows.map(row => row[8]);
  return [h[0] * d / s, h[1] * d / s, h[2] * d, h[3] * d / s, h[4] * d / s, h[5] * d, h[6] / s, h[7] / s, 1];
}

export function mapPoint(h: Homography, p: Point): Point {
  const denominator = h[6] * p.x + h[7] * p.y + h[8];
  if (Math.abs(denominator) < 1e-12) throw new Error("Point maps to infinity.");
  return { x: (h[0] * p.x + h[1] * p.y + h[2]) / denominator, y: (h[3] * p.x + h[4] * p.y + h[5]) / denominator };
}

export function outputSize(corners: Corners): { width: number; height: number } {
  assertQuad(corners);
  const length = (a: number, b: number) => Math.hypot(corners[a].x - corners[b].x, corners[a].y - corners[b].y);
  const width = Math.trunc(Math.max(length(0, 1), length(3, 2)));
  const height = Math.trunc(Math.max(length(0, 3), length(1, 2)));
  if (width < 1 || height < 1) throw new Error("Selection is smaller than one pixel.");
  return { width, height };
}

/** Outer pixel boundaries, not centers of the last pixels (width-1, height-1).
 * This convention avoids stretching an integer axis-aligned crop by one pixel.
 */
export function outputCorners(width: number, height: number): Corners {
  return [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height }];
}

export interface PixelImage { width: number; height: number; data: Uint8ClampedArray }

/** Inverse warp with bilinear, premultiplied-alpha sampling. Pure, row-batchable.
 * Photo and output pixel centers are at (index + .5) in boundary coordinates.
 */
export function warpRows(source: PixelImage, target: PixelImage, inverse: Homography, from: number, to: number): void {
  const { width: sw, height: sh, data: src } = source;
  const { width, data: dst } = target;
  const h = inverse;
  for (let y = from; y < to; y++) {
    for (let x = 0; x < width; x++) {
      const denominator = h[6] * (x + .5) + h[7] * (y + .5) + h[8];
      const sx = Math.max(0, Math.min(sw - 1, (h[0] * (x + .5) + h[1] * (y + .5) + h[2]) / denominator - .5));
      const sy = Math.max(0, Math.min(sh - 1, (h[3] * (x + .5) + h[4] * (y + .5) + h[5]) / denominator - .5));
      const x0 = Math.floor(sx), y0 = Math.floor(sy), x1 = Math.min(x0 + 1, sw - 1), y1 = Math.min(y0 + 1, sh - 1);
      const fx = sx - x0, fy = sy - y0;
      const a = (y0 * sw + x0) * 4, b = (y0 * sw + x1) * 4, c = (y1 * sw + x0) * 4, d = (y1 * sw + x1) * 4;
      const wa = (1 - fx) * (1 - fy) * src[a + 3], wb = fx * (1 - fy) * src[b + 3];
      const wc = (1 - fx) * fy * src[c + 3], wd = fx * fy * src[d + 3];
      const alpha = wa + wb + wc + wd, offset = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel++) {
        dst[offset + channel] = alpha ? (src[a + channel] * wa + src[b + channel] * wb + src[c + channel] * wc + src[d + channel] * wd) / alpha : 0;
      }
      dst[offset + 3] = alpha;
    }
  }
}
