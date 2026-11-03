import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { insetCorners, isConvex, isWithinPhoto, moveCorners, orderCorners, type Corners, type Point } from "./cropCorners.ts";
import { computeHomography, mapPoint, outputCorners, outputSize, warpRows } from "./perspective.ts";

function near(actual: number, expected: number) { assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`); }
function nearPoint(actual: Point, expected: Point) { near(actual.x, expected.x); near(actual.y, expected.y); }
const skew: Corners = [{ x: 10, y: 20 }, { x: 180, y: 35 }, { x: 210, y: 160 }, { x: 30, y: 190 }];

describe("perspective geometry", () => {
  it("maps all four source corners to output corners, and back", () => {
    const { width, height } = outputSize(skew);
    const output = outputCorners(width, height);
    const forward = computeHomography(skew, output), inverse = computeHomography(output, skew);
    skew.forEach((p, i) => nearPoint(mapPoint(forward, p), output[i]));
    output.forEach((p, i) => nearPoint(mapPoint(inverse, p), skew[i]));
  });
  it("gives pure translation and scale for an axis-aligned rectangle", () => {
    const source: Corners = [{ x: 10, y: 20 }, { x: 110, y: 20 }, { x: 110, y: 70 }, { x: 10, y: 70 }];
    const matrix = computeHomography(source, outputCorners(200, 150));
    [2, 0, -20, 0, 3, -60, 0, 0, 1].forEach((v, i) => near(matrix[i], v));
    nearPoint(mapPoint(matrix, { x: 60, y: 45 }), { x: 100, y: 75 });
  });
  it("maps a known interior point of a projective trapezoid", () => {
    // x' = 2x/(1+y/100), y' = 3y/(1+y/100).
    const trapezoid: Corners = [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 100, y: 150 }, { x: 0, y: 150 }];
    const matrix = computeHomography(outputCorners(100, 100), trapezoid);
    nearPoint(mapPoint(matrix, { x: 50, y: 50 }), { x: 200 / 3, y: 100 });
  });
  it("uses the longer opposite edges in source pixels and truncates", () => {
    assert.deepEqual(outputSize(skew), { width: Math.trunc(Math.hypot(180, -30)), height: Math.trunc(Math.hypot(20, 170)) });
    assert.deepEqual(outputSize(outputCorners(4624, 3468)), { width: 4624, height: 3468 });
    assert.deepEqual(outputSize(outputCorners(10.9, 20.9)), { width: 10, height: 20 });
  });
  it("reports collinear triples, duplicate points, crossed and concave shapes", () => {
    const invalid: Corners[] = [
      [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }, { x: 0, y: 10 }],
      [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }],
      [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 10, y: 0 }, { x: 0, y: 10 }],
      [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 10 }],
    ];
    invalid.forEach(c => {
      assert.throws(() => computeHomography(c, outputCorners(10, 10)), /Degenerate/);
      assert.throws(() => outputSize(c), /Degenerate/);
    });
    assert.throws(() => outputSize(outputCorners(.5, 10)), /one pixel/);
  });
  it("orders all 24 permutations TL, TR, BR, BL without mutating input", () => {
    function permutations(points: readonly Point[]): Point[][] {
      return points.length ? points.flatMap((p, i) => permutations(points.filter((_, j) => j !== i)).map(rest => [p, ...rest])) : [[]];
    }
    for (const shape of [skew, outputCorners(100, 80), [{ x: 50, y: 0 }, { x: 100, y: 50 }, { x: 50, y: 100 }, { x: 0, y: 50 }] as Corners]) {
      for (const permutation of permutations(shape)) {
        const copy = structuredClone(permutation);
        assert.deepEqual(orderCorners(permutation), shape);
        assert.deepEqual(permutation, copy);
      }
    }
  });
});

describe("pixel-accurate bilinear warp", () => {
  it("matches an integer plain crop byte-for-byte, including the last row/column", () => {
    const source = { width: 8, height: 6, data: new Uint8ClampedArray(8 * 6 * 4) };
    for (let i = 0; i < source.data.length; i += 4) source.data.set([i % 256, (i * 7) % 256, (i * 11) % 256, 255], i);
    const corners: Corners = [{ x: 2, y: 1 }, { x: 7, y: 1 }, { x: 7, y: 5 }, { x: 2, y: 5 }];
    const target = { width: 5, height: 4, data: new Uint8ClampedArray(5 * 4 * 4) };
    warpRows(source, target, computeHomography(outputCorners(5, 4), corners), 0, 4);
    for (let y = 0; y < 4; y++) assert.deepEqual(target.data.slice(y * 20, (y + 1) * 20), source.data.slice(((y + 1) * 8 + 2) * 4, ((y + 1) * 8 + 7) * 4));
  });
  it("interpolates four neighboring pixels with bilinear weights", () => {
    const source = { width: 2, height: 2, data: new Uint8ClampedArray([0, 0, 0, 255, 100, 0, 0, 255, 100, 0, 0, 255, 200, 0, 0, 255]) };
    const target = { width: 1, height: 1, data: new Uint8ClampedArray(4) };
    warpRows(source, target, [1, 0, .5, 0, 1, .5, 0, 0, 1], 0, 1);
    assert.deepEqual([...target.data], [100, 0, 0, 255]);
  });
  it("preserves the full photo on an identity warp", () => {
    const source = { width: 3, height: 2, data: new Uint8ClampedArray(Array.from({ length: 24 }, (_, i) => i % 4 === 3 ? 255 : i * 10)) };
    const target = { width: 3, height: 2, data: new Uint8ClampedArray(24) };
    warpRows(source, target, computeHomography(outputCorners(3, 2), outputCorners(3, 2)), 0, 2);
    assert.deepEqual(target.data, source.data);
  });
});

describe("crop constraints", () => {
  const size = { width: 100, height: 100 };
  const corners = insetCorners(size);
  it("moves one corner independently and rejects crossing or flattening", () => {
    const handle = { kind: "corner", index: 0 } as const;
    const moved = moveCorners(corners, handle, { x: 3, y: 5 }, size);
    assert.deepEqual(moved[0], { x: 13, y: 15 });
    assert.deepEqual(moved.slice(1), corners.slice(1));
    assert.equal(moveCorners(corners, handle, { x: 90, y: 90 }, size), corners);
    assert.equal(moveCorners(corners, handle, { x: 80, y: 0 }, size), corners);
  });
  it("clamps whole-shape translations without changing edge lengths", () => {
    const all = moveCorners(corners, { kind: "move" }, { x: -500, y: 500 }, size);
    assert.deepEqual(all, [{ x: 0, y: 20 }, { x: 80, y: 20 }, { x: 80, y: 100 }, { x: 0, y: 100 }]);
    assert.ok(isWithinPhoto(all, size));
  });
  it("never accepts a flip or out-of-image point over a grid of large drags", () => {
    for (let index = 0; index < 4; index++) {
      for (let x = -150; x <= 150; x += 15) for (let y = -150; y <= 150; y += 15) {
        const moved = moveCorners(corners, { kind: "corner", index }, { x, y }, size);
        assert.ok(isConvex(moved) && isWithinPhoto(moved, size));
      }
    }
  });
});
