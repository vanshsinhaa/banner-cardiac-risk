// Tests for checkResolution. Run with: npm test
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { FALLBACK_MIN_CROP_WIDTH_PX, MIN_PIXELS_PER_MM } from "../config/resolution.ts";
import { checkResolution } from "./checkResolution.ts";

describe("checkResolution, crop width fallback", () => {
  it("passes an image above the limit", () => {
    const result = checkResolution({ width: FALLBACK_MIN_CROP_WIDTH_PX + 500, height: 800 });
    assert.equal(result.pass, true);
    assert.equal(result.measure, "cropWidthPx");
    assert.equal(result.measured, FALLBACK_MIN_CROP_WIDTH_PX + 500);
    assert.equal(result.required, FALLBACK_MIN_CROP_WIDTH_PX);
  });

  it("passes an image exactly at the limit", () => {
    const result = checkResolution({ width: FALLBACK_MIN_CROP_WIDTH_PX, height: 800 });
    assert.equal(result.pass, true);
  });

  it("fails an image below the limit and gives a reason", () => {
    const result = checkResolution({ width: FALLBACK_MIN_CROP_WIDTH_PX - 1, height: 800 });
    assert.equal(result.pass, false);
    assert.equal(result.measured, FALLBACK_MIN_CROP_WIDTH_PX - 1);
    assert.equal(result.required, FALLBACK_MIN_CROP_WIDTH_PX);
    assert.match(result.reason, /Image too small/);
    assert.match(result.reason, new RegExp(String(FALLBACK_MIN_CROP_WIDTH_PX)));
  });
});

// Calibration does not exist yet. These tests make sure the swap to
// pixels per millimeter works when it arrives.
describe("checkResolution, pixels per millimeter", () => {
  it("passes above the limit", () => {
    const result = checkResolution({ width: 100, height: 100, pixelsPerMm: MIN_PIXELS_PER_MM + 2 });
    assert.equal(result.pass, true);
    assert.equal(result.measure, "pixelsPerMm");
  });

  it("passes exactly at the limit", () => {
    const result = checkResolution({ width: 100, height: 100, pixelsPerMm: MIN_PIXELS_PER_MM });
    assert.equal(result.pass, true);
  });

  it("fails below the limit and gives a reason, even if the image is wide", () => {
    const result = checkResolution({ width: 5000, height: 2000, pixelsPerMm: MIN_PIXELS_PER_MM - 0.5 });
    assert.equal(result.pass, false);
    assert.equal(result.required, MIN_PIXELS_PER_MM);
    assert.match(result.reason, /Resolution too low/);
  });
});
