import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatPercent, frequencySentence, isRiskScoreResult, placeholderRiskScore, riskBand } from "./contract.ts";

const at = "2026-11-23T10:00:00.000Z";

describe("risk score contract", () => {
  it("assigns bands at the cut-offs", () => {
    assert.equal(riskBand(0), "low");
    assert.equal(riskBand(4.9), "low");
    assert.equal(riskBand(5), "borderline");
    assert.equal(riskBand(7.5), "intermediate");
    assert.equal(riskBand(19.9), "intermediate");
    assert.equal(riskBand(20), "high");
  });

  it("shows whole percentages without false precision", () => {
    assert.equal(formatPercent(12.34), "12%");
    assert.equal(formatPercent(0.4), "<1%");
    assert.equal(formatPercent(0), "0%");
    assert.equal(formatPercent(99.6), ">99%");
  });

  it("states the frequency with a fixed denominator and the time horizon", () => {
    assert.equal(frequencySentence(12, 10), "About 12 in 100 people with a similar EKG would be expected to have a cardiac event within 10 years.");
    assert.match(frequencySentence(0.3, 10), /^Fewer than 1 in 100/);
  });

  it("produces a valid, clearly marked placeholder", () => {
    const result = placeholderRiskScore("corrected", at);
    assert.ok(isRiskScoreResult(result));
    assert.equal(result.status, "placeholder");
    assert.equal(result.band, "intermediate");
    assert.equal(result.traceSource, "corrected");
  });

  it("rejects malformed results", () => {
    const result = placeholderRiskScore("auto", at);
    assert.equal(isRiskScoreResult({ ...result, riskPercent: 140 }), false);
    assert.equal(isRiskScoreResult({ ...result, band: "severe" }), false);
    assert.equal(isRiskScoreResult({ ...result, status: "final" }), false);
    assert.equal(isRiskScoreResult({ ...result, factors: [{ ...result.factors[0], effect: "maybe" }] }), false);
  });
});
