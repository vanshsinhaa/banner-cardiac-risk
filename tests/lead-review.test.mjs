import { test } from 'node:test';
import assert from 'node:assert/strict';
import { confirmLeadAssignments } from '../src/lib/ecg-digitizer/review.ts';
const fixture = () => ({ units: 'mV', samplingRateHz: 500, leads: { V1: [1, null, 2], V2: [3, 4, null] }, leadPreviews: { V1: 'crop1', V2: 'crop2' }, leadVerification: { status: 'conflict', leads: {} } });
test('human swap preserves samples, missingness, timing and original machine audit', () => {
  const source = fixture();
  const result = confirmLeadAssignments(source, { V1: 'v2', V2: 'V1' });
  assert.equal(result.leads.V2, source.leads.V1);
  assert.equal(result.leads.V1, source.leads.V2);
  assert.equal(result.samplingRateHz, 500);
  assert.equal(result.leadVerification.status, 'conflict');
  assert.equal(result.requiresReview, false);
  assert.deepEqual(result.userReview.assignments, { V1: 'V2', V2: 'V1' });
  assert.deepEqual(source.leads.V1, [1, null, 2]);
});
test('duplicates, unknown labels, omissions and unlocatable source corrections are rejected', () => {
  for (const mapping of [{ V1: 'V2', V2: 'V2' }, { V1: 'foo', V2: 'V2' }, { V1: 'V1' }]) {
    assert.throws(() => confirmLeadAssignments(fixture(), mapping));
  }
  assert.throws(() => confirmLeadAssignments({ ...fixture(), leadPreviews: {} }, { V1: 'V2', V2: 'V1' }), /unavailable/);
});
