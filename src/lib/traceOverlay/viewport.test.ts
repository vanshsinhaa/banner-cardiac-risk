import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { leadFrame, sampleToPx } from "./geometry.ts";
import { distanceToLine, leadWindows, nearestPoint, windowViewBox } from "./viewport.ts";

const frame = leadFrame("I", 0, 5000, { width: 2400, height: 1600 });

describe("trace viewport", () => {
  it("keeps a 2.5 s lead in one window and pages the 10 s rhythm strip", () => {
    assert.deepEqual(leadWindows({ start: 30, end: 1229 }), [{ start: 30, end: 1229 }]);
    const pages = leadWindows({ start: 30, end: 4979 });
    assert.equal(pages.length, 4);
    assert.equal(pages[0].start, 30);
    assert.equal(pages[3].end, 4979);
    assert.deepEqual(leadWindows(null), []);
  });

  it("frames the window with at least -0.8..+1.6 mV visible", () => {
    const box = windowViewBox(frame, [{ i: 100, mv: 0 }], { start: 0, end: 1249 });
    // 1 mV = 80 px on the fixture page; baseline y=540.
    assert.ok(box.y <= 540 - 1.6 * 80);
    assert.ok(box.y + box.height >= 540 + 0.8 * 80);
    assert.ok(box.x < 160 && box.x + box.width > 660);
  });

  it("grows the frame for tall peaks", () => {
    const box = windowViewBox(frame, [{ i: 100, mv: 3 }], { start: 0, end: 1249 });
    assert.ok(box.y <= 540 - 3 * 80);
  });

  it("picks the nearest point within reach, ignoring other windows", () => {
    const points = [{ i: 100, mv: 0 }, { i: 140, mv: 0.5 }, { i: 2000, mv: 0 }];
    const target = sampleToPx(frame, points[1]);
    assert.equal(nearestPoint(frame, points, { x: target.x + 3, y: target.y }, 10), 1);
    assert.equal(nearestPoint(frame, points, { x: target.x + 30, y: target.y }, 10), null);
    const far = sampleToPx(frame, points[2]);
    assert.equal(nearestPoint(frame, points, far, 10, { start: 0, end: 1249 }), null);
  });

  it("measures vertical distance to the drawn line", () => {
    const points = [{ i: 0, mv: 0 }, { i: 100, mv: 1 }];
    const mid = sampleToPx(frame, { i: 50, mv: 0.5 });
    assert.ok((distanceToLine(frame, points, { x: mid.x, y: mid.y + 12 }) ?? -1) - 12 < 1e-9);
    assert.equal(distanceToLine(frame, points, { x: 0, y: 0 }), null);
  });
});
