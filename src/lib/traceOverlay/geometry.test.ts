import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_LAYOUT, RHYTHM_ROW, leadFrame, pxToSample, rowForLead, sampleToPx, signalRange } from "./geometry.ts";

function near(actual: number, expected: number, tolerance = 1e-9) {
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
}

// The synthetic fixture page: 2400x1600 px, 8 px/mm, grid starts at x=160, first row baseline y=540.
const page = { width: 2400, height: 1600 };

describe("trace overlay geometry", () => {
  it("finds the first and last sample with signal", () => {
    assert.deepEqual(signalRange([null, null, 0.1, null, 0.3, null]), { start: 2, end: 4 });
    assert.equal(signalRange([null, null]), null);
  });

  it("puts short leads on their printed row and long leads on the rhythm strip", () => {
    assert.equal(rowForLead("aVR", { start: 1250, end: 2499 }, 5000), 0);
    assert.equal(rowForLead("V6", { start: 3750, end: 4999 }, 5000), 2);
    assert.equal(rowForLead("II", { start: 0, end: 4999 }, 5000), RHYTHM_ROW);
    assert.equal(rowForLead("II", { start: 0, end: 1249 }, 5000), 1);
  });

  it("matches the fixture's 25 mm/s and 10 mm/mV scale", () => {
    const frame = leadFrame("I", 0, 5000, page);
    // 1 mV is 10 mm = 80 px above the baseline; 2.5 s (1250 samples) is 62.5 mm = 500 px.
    assert.deepEqual(sampleToPx(frame, { i: 0, mv: 0 }), { x: 160, y: 540 });
    const point = sampleToPx(frame, { i: 1250, mv: 1 });
    near(point.x, 660);
    near(point.y, 460);
    near(leadFrame("II", RHYTHM_ROW, 5000, page).baselineY, 1320);
  });

  it("round-trips pixels and samples, including alignment", () => {
    const frame = leadFrame("V2", 1, 5000, page, DEFAULT_LAYOUT, { dx: 7, dy: -4, gain: 1.2 });
    const original = { i: 2731, mv: -0.42 };
    const back = pxToSample(frame, sampleToPx(frame, original));
    near(back.i, original.i);
    near(back.mv, original.mv);
  });
});
