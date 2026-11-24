import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyCorrections, toControlPoints, toRuns, toSamples } from "./controlPoints.ts";
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

  it("keeps a narrow peak that falls between stride points", () => {
    const samples = Array.from({ length: 41 }, (_, i) => (i === 27 ? 1.5 : 0));
    assert.ok(toControlPoints(samples, 20).some((p) => p.i === 27 && p.mv === 1.5));
  });

  it("keeps original samples outside the edited stretch", () => {
    const auto = Array.from({ length: 100 }, (_, i) => Math.round(Math.sin(i / 3) * 1000) / 1000);
    const points = toControlPoints(auto, 20);
    assert.deepEqual(applyCorrections(auto, points, points, 20), auto);
    const moved = points.map((p) => (p.i === 60 ? { i: 60, mv: 2 } : p));
    const result = applyCorrections(auto, points, moved, 20);
    assert.equal(result[60], 2);
    assert.deepEqual(result.slice(0, 40), auto.slice(0, 40));
    assert.deepEqual(result.slice(85), auto.slice(85));
  });

  it("round-trips an untouched lead exactly at the control points", () => {
    const samples = Array.from({ length: 100 }, (_, i) => Math.round(Math.sin(i / 7) * 1000) / 1000);
    const rebuilt = toSamples(toControlPoints(samples), samples.length);
    for (let i = 0; i < samples.length; i += 40) assert.equal(rebuilt[i], samples[i]);
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

  it("undoes and redoes edits, logging both", () => {
    let state = reviewReducer(start(), { type: "move", lead: "I", index: 1, to: { i: 10, mv: 2 }, at });
    state = reviewReducer(state, { type: "delete", lead: "II", index: 0, at });
    state = reviewReducer(state, { type: "undo", at });
    assert.equal(state.corrected.II, state.auto.II);
    assert.equal(state.corrected.I[1].mv, 2);
    state = reviewReducer(state, { type: "undo", at });
    assert.equal(state.corrected.I, state.auto.I);
    state = reviewReducer(state, { type: "redo", at });
    assert.equal(state.corrected.I[1].mv, 2);
    assert.deepEqual(state.edits.map((e) => [e.kind, e.lead]), [["move", "I"], ["delete", "II"], ["undo", "II"], ["undo", "I"], ["redo", "I"]]);
    assert.equal(reviewReducer({ ...state, future: [] }, { type: "redo", at }).edits.length, state.edits.length);
  });

  it("clears redo after a new edit", () => {
    let state = reviewReducer(start(), { type: "move", lead: "I", index: 1, to: { i: 10, mv: 2 }, at });
    state = reviewReducer(state, { type: "undo", at });
    state = reviewReducer(state, { type: "add", lead: "I", point: { i: 5, mv: 1 }, at });
    assert.equal(state.future.length, 0);
  });
});
