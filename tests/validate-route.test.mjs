import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { POST } from '../src/app/api/ecg/validate/route.ts';

const fixture = name => readFileSync(new URL(`./fixtures/wave-validation/${name}`, import.meta.url), 'utf8');
const post = (body, type = 'application/json') => POST(new Request('http://localhost/api/ecg/validate', {
  method: 'POST', headers: { 'Content-Type': type }, body,
}));

test('a complete synthetic record is eligible', async () => {
  const response = await post(fixture('valid-12-lead.json'));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const report = await response.json();
  assert.equal(report.status, 'valid');
  assert.equal(report.analysisEligible, true);
});

test('real T-wave finder output with dropped leads needs review, naming each lead', async () => {
  const report = await (await post(fixture('t-waves-missing.json'))).json();
  assert.equal(report.status, 'needs_review');
  assert.equal(report.analysisEligible, false);
  const missing = report.issues.filter(issue => issue.code === 'T_WAVE_MISSING').map(issue => issue.lead);
  assert.equal(missing.length, 10);
  assert.ok(missing.includes('V2'));
});

test('a posted eligibility claim is ignored', async () => {
  const record = JSON.parse(fixture('valid-12-lead.json'));
  delete record.tWaves;
  record.validation = { status: 'valid', analysisEligible: true, issues: [] };
  const report = await (await post(JSON.stringify(record))).json();
  assert.equal(report.analysisEligible, false);
  assert.equal(report.issues[0].code, 'T_WAVE_REPORT_MISSING');
});

test('wrong type, bad JSON and oversized bodies are rejected', async () => {
  assert.equal((await post('{}', 'text/plain')).status, 415);
  assert.equal((await post('{not json')).status, 400);
  assert.equal((await post(' '.repeat(4 * 1024 * 1024 + 1))).status, 413);
  const report = await (await post('[]')).json();
  assert.equal(report.status, 'invalid');
});

test('real digitizer output from dataset photos keeps its known results', async () => {
  const expected = {
    'doogee-22-labels-partly-confirmed.json': { leadsReady: 8, waveformsUsable: 12, tWavesMeasured: 12, labelsConfirmed: 8 },
    'samsung-82-label-conflicts.json': { leadsReady: 0, waveformsUsable: 12, tWavesMeasured: 12, labelsConfirmed: 0 },
    'bent-17-trace-gaps.json': { leadsReady: 0, waveformsUsable: 7, tWavesMeasured: 9, labelsConfirmed: 0 },
  };
  for (const [file, counts] of Object.entries(expected)) {
    const report = await (await post(fixture(`real-digitizer/${file}`))).json();
    assert.equal(report.status, 'needs_review', file);
    for (const [key, value] of Object.entries(counts)) assert.equal(report.counts[key], value, `${file} ${key}`);
  }
});
