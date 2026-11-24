import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateCorrection } from "./correctionPayload.ts";

const valid = () => ({
  captureId: "demo-capture-0001",
  samplingRateHz: 500,
  sampleCount: 4,
  auto: { I: [0, 0.1, null, 0.3] },
  corrected: { I: [0, 0.2, null, 0.3] },
  editedLeads: ["I"],
  edits: [{ seq: 1, at: "2026-11-23T10:00:00.000Z", lead: "I", kind: "move", index: 1, before: { i: 1, mv: 0.1 }, after: { i: 1, mv: 0.2 } }],
  alignment: { layout: {}, leads: {} },
});

describe("trace correction payload", () => {
  it("accepts a well-formed correction", () => {
    assert.equal(validateCorrection(valid()), null);
  });

  it("rejects unknown fields so nothing extra (e.g. patient text) is stored", () => {
    assert.match(validateCorrection({ ...valid(), patientName: "x" }) ?? "", /Unexpected fields: patientName/);
  });

  it("rejects capture ids that could escape the store directory", () => {
    assert.ok(validateCorrection({ ...valid(), captureId: "../../etc/passwd" }));
  });

  it("requires every lead to match sampleCount and be a known lead", () => {
    assert.ok(validateCorrection({ ...valid(), corrected: { I: [0, 1] } }));
    assert.ok(validateCorrection({ ...valid(), auto: { X1: [0, 0, 0, 0] } }));
  });

  it("rejects malformed edit entries", () => {
    const edit = { ...valid().edits[0], kind: "rewrite" };
    assert.ok(validateCorrection({ ...valid(), edits: [edit] }));
    assert.ok(validateCorrection({ ...valid(), edits: [{ ...valid().edits[0], note: "free text" }] }));
  });
});
