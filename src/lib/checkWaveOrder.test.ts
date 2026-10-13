// Tests for checkWaveOrder. Run with: npm test
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { checkWaveOrder } from "./checkWaveOrder.ts";

// Load a fresh copy of the valid example for each test, so one test
// cannot change the data another test sees.
function loadValidExample() {
  const url = new URL("../../schemas/examples/valid_lead_ii.json", import.meta.url);
  return JSON.parse(readFileSync(url, "utf8"));
}

describe("checkWaveOrder", () => {
  it("finds no problems in the valid example", () => {
    assert.deepEqual(checkWaveOrder(loadValidExample()), []);
  });

  it("catches a peak before the onset", () => {
    const ekg = loadValidExample();
    ekg.leads[0].beats[0].qrs.peak_ms = 200; // onset is 240
    const errors = checkWaveOrder(ekg);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /lead II, beat 0, qrs: onset_ms \(240\) is after peak_ms \(200\)/);
  });

  it("catches an offset before the peak", () => {
    const ekg = loadValidExample();
    ekg.leads[0].beats[0].t.offset_ms = 500; // peak is 540
    const errors = checkWaveOrder(ekg);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /beat 0, t: peak_ms \(540\) is after offset_ms \(500\)/);
  });

  it("catches a wave that starts before the wave before it ends", () => {
    const ekg = loadValidExample();
    ekg.leads[0].beats[0].qrs.onset_ms = 150; // P ends at 180
    const errors = checkWaveOrder(ekg);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /beat 0, qrs: onset_ms \(150\) is before the end of lead II, beat 0, p \(180\)/);
  });

  it("catches a beat that starts before the beat before it ends", () => {
    const ekg = loadValidExample();
    ekg.leads[0].beats[1].p.onset_ms = 600; // T of beat 0 ends at 620
    const errors = checkWaveOrder(ekg);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /beat 1, p: .* before the end of lead II, beat 0, t/);
  });

  it("skips a missing P wave", () => {
    const ekg = loadValidExample();
    ekg.leads[0].beats[1].p = null;
    assert.deepEqual(checkWaveOrder(ekg), []);
  });
});
