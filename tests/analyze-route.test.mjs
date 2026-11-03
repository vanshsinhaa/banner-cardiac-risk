import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../src/app/api/analyze/route.ts', import.meta.url), 'utf8')
  .replace('import { execFile } from "node:child_process";', 'const execFile = (...args: any[]) => (globalThis as any).analysisExec(...args);');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { POST } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const request = size => new Request('http://localhost/api/analyze', {
  method: 'POST', headers: { 'Content-Type': 'image/png' }, body: new Uint8Array(size),
});

async function withAnalysis(error, run) {
  const previous = globalThis.analysisExec;
  globalThis.analysisExec = (_, __, options, callback) => {
    assert.equal(options.timeout, 120_000);
    return { stdin: { on() {}, end() { callback(error, JSON.stringify({ accepted: false })); } } };
  };
  try { await run(); } finally { globalThis.analysisExec = previous; }
}

test('readability check accepts exactly 10 MB but rejects larger and empty uploads', async () => {
  await withAnalysis(null, async () => {
    assert.equal((await POST(request(10 * 1024 * 1024))).status, 200);
    globalThis.analysisExec = () => assert.fail('Invalid upload started analysis');
    assert.equal((await POST(request(10 * 1024 * 1024 + 1))).status, 413);
    assert.equal((await POST(request(0))).status, 400);
  });
});

test('readability timeout returns a two-minute retry error', async () => {
  await withAnalysis(Object.assign(new Error('Killed'), { killed: true }), async () => {
    const response = await POST(request(3));
    assert.equal(response.status, 504);
    assert.match((await response.json()).error, /2 minutes/);
  });
});

test('other analysis failures are not mislabeled as timeouts', async () => {
  await withAnalysis(new Error('Missing Python'), async () => {
    assert.equal((await POST(request(3))).status, 503);
  });
});
