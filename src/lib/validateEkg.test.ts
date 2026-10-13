// Tests for the digitized EKG schema and its examples. Run with: npm test
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { validateEkg } from "./validateEkg.ts";

function loadExample(fileName: string) {
  const url = new URL(`../../schemas/examples/${fileName}`, import.meta.url);
  return JSON.parse(readFileSync(url, "utf8"));
}

describe("ekg_digitized schema", () => {
  it("accepts the valid lead II example", () => {
    assert.deepEqual(validateEkg(loadExample("valid_lead_ii.json")), []);
  });

  it("rejects a missing required field and names the field", () => {
    const errors = validateEkg(loadExample("invalid_missing_required.json"));
    assert.equal(errors.length, 1);
    assert.match(errors[0], /must have required property 'sample_rate_hz'/);
  });

  it("rejects a wrong type and says where", () => {
    const errors = validateEkg(loadExample("invalid_wrong_type.json"));
    assert.equal(errors.length, 1);
    assert.match(errors[0], /\/sample_rate_hz: must be number/);
  });

  it("rejects a confidence above 1 and says where", () => {
    const errors = validateEkg(loadExample("invalid_confidence_above_1.json"));
    assert.equal(errors.length, 1);
    assert.match(errors[0], /\/leads\/0\/confidence: must be <= 1/);
  });

  it("reports an out-of-order boundary in a file with a valid shape", () => {
    const ekg = loadExample("valid_lead_ii.json");
    ekg.leads[0].beats[0].p.offset_ms = 100; // peak is 130
    const errors = validateEkg(ekg);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /beat 0, p: peak_ms \(130\) is after offset_ms \(100\)/);
  });
});
