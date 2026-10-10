// Tests for checkResolution. Run with: npm test
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { FALLBACK_MIN_PHOTO_LONG_SIDE_PX, MIN_PIXELS_PER_MM } from "../config/resolution.ts";
import { checkResolution } from "./checkResolution.ts";

describe("checkResolution, photo size fallback", () => {
  it("passes a photo above the limit", () => {
    const result = checkResolution({ width: FALLBACK_MIN_PHOTO_LONG_SIDE_PX + 500, height: 800 });
    assert.equal(result.pass, true);
    assert.equal(result.measure, "photoLongSidePx");
    assert.equal(result.measured, FALLBACK_MIN_PHOTO_LONG_SIDE_PX + 500);
    assert.equal(result.required, FALLBACK_MIN_PHOTO_LONG_SIDE_PX);
  });

  it("passes a photo exactly at the limit", () => {
    const result = checkResolution({ width: FALLBACK_MIN_PHOTO_LONG_SIDE_PX, height: 800 });
    assert.equal(result.pass, true);
  });

  it("fails a photo below the limit and gives a reason", () => {
    const result = checkResolution({ width: FALLBACK_MIN_PHOTO_LONG_SIDE_PX - 1, height: 800 });
    assert.equal(result.pass, false);
    assert.equal(result.measured, FALLBACK_MIN_PHOTO_LONG_SIDE_PX - 1);
    assert.equal(result.required, FALLBACK_MIN_PHOTO_LONG_SIDE_PX);
    assert.match(result.reason, /Photo too small/);
    assert.match(result.reason, new RegExp(String(FALLBACK_MIN_PHOTO_LONG_SIDE_PX)));
  });

  it("uses the long side, so a portrait photo passes like a landscape one", () => {
    const landscape = checkResolution({ width: FALLBACK_MIN_PHOTO_LONG_SIDE_PX, height: 800 });
    const portrait = checkResolution({ width: 800, height: FALLBACK_MIN_PHOTO_LONG_SIDE_PX });
    assert.equal(portrait.pass, true);
    assert.equal(portrait.measured, landscape.measured);
  });

  it("fails when both sides are below the limit", () => {
    const side = FALLBACK_MIN_PHOTO_LONG_SIDE_PX - 1;
    assert.equal(checkResolution({ width: side, height: side }).pass, false);
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
