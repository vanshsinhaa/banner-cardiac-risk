import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PHOTO_LONG_SIDE_REFERENCE_PX, REFERENCE_PIXELS_PER_MM } from "../config/resolution.ts";
import { checkResolution } from "./checkResolution.ts";

describe("source-image detail advice", () => {
  it("lets the native 1700 x 1100 privacy-fixture dimensions proceed with advice", () => {
    const result = checkResolution({ width: 1700, height: 1100 });
    assert.equal(result.status, "advisory");
    assert.equal(result.measure, "photoLongSidePx");
    assert.equal(result.measured, 1700);
    assert.match(result.reason, /You can crop it/);
  });

  it("does not certify quality at or above the old cutoff", () => {
    for (const width of [PHOTO_LONG_SIDE_REFERENCE_PX, PHOTO_LONG_SIDE_REFERENCE_PX + 500]) {
      const result = checkResolution({ width, height: 800 });
      assert.equal(result.status, "unassessed");
      assert.equal(result.reference, PHOTO_LONG_SIDE_REFERENCE_PX);
      assert.match(result.reason, /assessed during processing/);
    }
  });

  it("gives the same advice in portrait and landscape without changing the input", () => {
    const original = Object.freeze({ width: 1700, height: 1100 });
    assert.deepEqual(checkResolution(original), checkResolution({ width: 1100, height: 1700 }));
  });

  it("rejects invalid source dimensions, independently of the quality heuristic", () => {
    for (const value of [0, -1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      assert.equal(checkResolution({ width: value, height: 1100 }).status, "invalid");
      assert.equal(checkResolution({ width: 1700, height: value }).status, "invalid");
    }
  });

  it("uses measured source-grid density as advice rather than a quality pass", () => {
    const low = checkResolution({ width: 5000, height: 2000, pixelsPerMm: REFERENCE_PIXELS_PER_MM - .5 });
    assert.equal(low.status, "advisory");
    assert.equal(low.measure, "pixelsPerMm");
    assert.equal(low.reference, REFERENCE_PIXELS_PER_MM);
    const high = checkResolution({ width: 100, height: 100, pixelsPerMm: REFERENCE_PIXELS_PER_MM });
    assert.equal(high.status, "unassessed");
  });

  it("ignores unusable grid calibration instead of reporting false quality evidence", () => {
    for (const pixelsPerMm of [0, -1, NaN, Infinity]) {
      const result = checkResolution({ width: 1700, height: 1100, pixelsPerMm });
      assert.equal(result.measure, "photoLongSidePx");
      assert.equal(result.status, "advisory");
    }
  });
});
