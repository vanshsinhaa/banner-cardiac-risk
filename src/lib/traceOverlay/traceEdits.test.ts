import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { toControlPoints, toRuns, toSamples } from "./controlPoints.ts";
import { editedLeads, initReview, reviewReducer } from "./traceEdits.ts";

const at = "2026-11-23T10:00:00.000Z";

describe("control points", () => {
  it("samples every stride, keeps run ends and skips nulls", () => {
    const samples = [0, 1, 2, 3, null, null, null, null, null, null, null, null, null, null, null, null, 6, 7];
    assert.deepEqual(toControlPoints(samples, 2).map((p) => p.i), [0, 2, 3, 16, 17]);
  });

  it("splits runs at gaps and rebuilds samples by interpolation", () => {
    const points = [{ i: 0, mv: 0 }, { i: 4, mv: 1 }, { i: 40, mv: 2 }, { i: 42, mv: 0 }];
    assert.equal(toRuns(points, 10).length, 2);
    const samples = toSamples(points, 50, 10);
    assert.deepEqual(samples.slice(0, 5), [0, 0.25, 0.5, 0.75, 1]);
    assert.equal(samples[10], null);
    assert.deepEqual(samples.slice(40, 43), [2, 1, 0]);
    assert.equal(samples[49], null);
  });

  it("round-trips an untouched lead exactly at the control points", () => {
    const samples = Array.from({ length: 100 }, (_, i) => Math.round(Math.sin(i / 7) * 1000) / 1000);
    const rebuilt = toSamples(toControlPoints(samples), samples.length);
    for (let i = 0; i < samples.length; i += 10) assert.equal(rebuilt[i], samples[i]);
  });
});

describe("trace review reducer", () => {
  const start = () => initReview({ I: [{ i: 0, mv: 0 }, { i: 10, mv: 0.5 }, { i: 20, mv: 0 }], II: [{ i: 0, mv: 1 }] });

  it("moves a point in corrected only and logs before/after", () => {
    const state = reviewReducer(start(), { type: "move", lead: "I", index: 1, to: { i: 11, mv: 0.9 }, at });
    assert.deepEqual(state.corrected.I[1], { i: 11, mv: 0.9 });
    assert.deepEqual(state.auto.I[1], { i: 10, mv: 0.5 });
    assert.deepEqual(state.edits, [{ seq: 1, at, lead: "I", kind: "move", index: 1, before: { i: 10, mv: 0.5 }, after: { i: 11, mv: 0.9 } }]);
  });

  it("keeps a moved point between its neighbours", () => {
    const state = reviewReducer(start(), { type: "move", lead: "I", index: 1, to: { i: 99, mv: 0 }, at });
    assert.ok(state.corrected.I[1].i < 20);
  });

  it("adds in time order and deletes by index", () => {
    let state = reviewReducer(start(), { type: "add", lead: "I", point: { i: 15, mv: 0.2 }, at });
    assert.deepEqual(state.corrected.I.map((p) => p.i), [0, 10, 15, 20]);
    state = reviewReducer(state, { type: "delete", lead: "I", index: 0, at });
    assert.deepEqual(state.corrected.I.map((p) => p.i), [10, 15, 20]);
    assert.deepEqual(state.edits.map((e) => [e.seq, e.kind, e.index]), [[1, "add", 2], [2, "delete", 0]]);
    assert.deepEqual(editedLeads(state), ["I"]);
  });

  it("resets a lead to the auto trace and still logs it", () => {
    let state = reviewReducer(start(), { type: "delete", lead: "I", index: 0, at });
    state = reviewReducer(state, { type: "reset", lead: "I", at });
    assert.equal(state.corrected.I, state.auto.I);
    assert.equal(state.edits.length, 2);
    assert.deepEqual(editedLeads(state), []);
  });

  it("never mutates the frozen auto trace and ignores no-op actions", () => {
    const initial = start();
    assert.ok(Object.isFrozen(initial.auto.I));
    assert.equal(reviewReducer(initial, { type: "move", lead: "I", index: 0, to: { i: 0, mv: 0 }, at }), initial);
    assert.equal(reviewReducer(initial, { type: "delete", lead: "V9", index: 0, at }), initial);
    assert.equal(reviewReducer(initial, { type: "reset", lead: "I", at }), initial);
  });
});
