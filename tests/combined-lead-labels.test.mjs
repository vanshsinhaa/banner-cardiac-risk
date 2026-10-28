import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source = readFileSync(new URL('../src/lib/combined-lead-labels.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { combinedLeadLabels } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);

test('either recognizer confirms a label, without double counting', () => {
  const result = combinedLeadLabels(['I','V1','avr'], {
    modelRecognition: { status: 'success', leads: ['II','V1','aVR'] },
    recognition: { leads: { V2: { status: 'success', label: 'V3' } } },
  });
  assert.deepEqual(result.confirmed, ['I','II','aVR','V1','V3']);
  assert.deepEqual(result.missing, ['III','aVL','aVF','V2','V4','V5','V6']);
});
test('failed recognizers, unknown labels and raw waveform keys do not count', () => {
  const result = combinedLeadLabels(['unknown'], {
    modelRecognition: { status: 'failed', leads: ['II'] },
    recognition: { leads: { V1: { status: 'needs_review', label: 'V1' } } },
  });
  assert.deepEqual(result.confirmed, []);
  assert.equal(result.missing.length, 12);
});
test('I, II and III remain distinct and confirmed never appears in missing', () => {
  const result = combinedLeadLabels(['II','ii','II ']);
  assert.deepEqual(result.confirmed, ['II']);
  assert.ok(result.missing.includes('I'));
  assert.ok(result.missing.includes('III'));
  assert.ok(!result.missing.includes('II'));
});
test('complete model recognition clears OCR-only missing labels', () => {
  const leads = ['I','II','III','aVR','aVL','aVF','V1','V2','V3','V4','V5','V6'];
  const result = combinedLeadLabels(['I'], { modelRecognition: { status:'success', leads } });
  assert.equal(result.confirmed.length, 12);
  assert.deepEqual(result.missing, []);
});
test('OCR results remain usable when the model is unavailable', () => {
  assert.deepEqual(combinedLeadLabels(['V1','V2'], null).confirmed, ['V1','V2']);
});
