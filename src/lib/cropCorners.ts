/** Coordinates in the full-resolution, orientation-applied photo; origin top-left.
 * Coordinates describe pixel boundaries: (width, height) is the outer bottom-right.
 */
export interface Point { x: number; y: number }
export type Corners = readonly [Point, Point, Point, Point]; // TL, TR, BR, BL
export interface PhotoSize { width: number; height: number }
export interface CaptureDetails extends PhotoSize { corners: Corners }
export type CropHandle = { kind: "corner"; index: number } | { kind: "move" };

const cross = (a: Point, b: Point, c: Point) =>
  (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);

/** Strictly convex, clockwise in image coordinates. Also rejects collinear triples. */
export function isConvex(corners: Corners): boolean {
  if (corners.length !== 4 || !corners.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))) return false;
  const scale = Math.max(1, ...corners.map((p, i) => Math.hypot(
    p.x - corners[(i + 1) % 4].x, p.y - corners[(i + 1) % 4].y)));
  return corners.every((p, i) => cross(p, corners[(i + 1) % 4], corners[(i + 2) % 4]) > scale * scale * 1e-10);
}

/** Order an unordered convex quadrilateral TL, TR, BR, BL.
 * Like order_points(), TL minimizes x+y; ties choose the upper point.
 * Winding resolves sum/difference ties without duplicating a corner.
 */
export function orderCorners(points: readonly Point[]): Corners {
  if (points.length !== 4 || !points.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))) {
    throw new Error("Four finite corners are required.");
  }
  const center = points.reduce((c, p) => ({ x: c.x + p.x / 4, y: c.y + p.y / 4 }), { x: 0, y: 0 });
  const sorted = points.map(p => ({ ...p })).sort((a, b) =>
    Math.atan2(a.y - center.y, a.x - center.x) - Math.atan2(b.y - center.y, b.x - center.x));
  const first = sorted.reduce((best, p, i) => {
    const q = sorted[best];
    return p.x + p.y < q.x + q.y || (p.x + p.y === q.x + q.y && p.y < q.y) ? i : best;
  }, 0);
  const result = [...sorted.slice(first), ...sorted.slice(0, first)] as unknown as Corners;
  if (!isConvex(result)) throw new Error("Corners must form a non-degenerate convex quadrilateral.");
  return result;
}

export function isWithinPhoto(corners: Corners, size: PhotoSize): boolean {
  return isConvex(corners) && corners.every(p => p.x >= 0 && p.y >= 0 && p.x <= size.width && p.y <= size.height);
}

export function insetCorners({ width, height }: PhotoSize): Corners {
  return orderCorners([
    { x: width * .1, y: height * .1 }, { x: width * .9, y: height * .1 },
    { x: width * .9, y: height * .9 }, { x: width * .1, y: height * .9 },
  ]);
}

export function handlePoint(corners: Corners, handle: CropHandle): Point {
  return corners[handle.kind === "move" ? 0 : handle.index];
}

/** Clamp translations to the image; reject flips/crossings. */
export function moveCorners(corners: Corners, handle: CropHandle, delta: Point, size: PhotoSize): Corners {
  const indices = handle.kind === "move" ? [0, 1, 2, 3] : [handle.index];
  const selected = indices.map(i => corners[i]);
  const dx = Math.max(-Math.min(...selected.map(p => p.x)), Math.min(delta.x, size.width - Math.max(...selected.map(p => p.x))));
  const dy = Math.max(-Math.min(...selected.map(p => p.y)), Math.min(delta.y, size.height - Math.max(...selected.map(p => p.y))));
  const candidate = corners.map((p, i) => indices.includes(i) ? { x: p.x + dx, y: p.y + dy } : p) as unknown as Corners;
  return isWithinPhoto(candidate, size) ? candidate : corners;
}
