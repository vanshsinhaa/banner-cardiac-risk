import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../src/app/api/ecg/digitize/route.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { POST } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const request = (body = 'png') => new Request('http://localhost/api/ecg/digitize', {
  method: 'POST', headers: { 'Content-Type': 'image/png' }, body,
});
const result = () => ({ leads: { V1: [0.1, null, 0.2] }, units: 'mV', samplingRateHz: 500 });
async function withService(payload, run) {
  const previousFetch = globalThis.fetch;
  const previousUrl = process.env.ECG_DIGITIZER_URL;
  process.env.ECG_DIGITIZER_URL = 'http://localhost:8000';
  globalThis.fetch = async (_, options) => {
    assert.ok(options.body instanceof FormData);
    assert.ok(options.signal);
    return Response.json(payload);
  };
  try { await run(); } finally {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.ECG_DIGITIZER_URL;
    else process.env.ECG_DIGITIZER_URL = previousUrl;
  }
}

test('older service cannot pass without localized verification', async () => {
  await withService({ ...result(), requiresReview: false }, async () => {
    const response = await POST(request());
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.requiresReview, true);
    assert.equal(body.leadVerification.status, 'needs_review');
  });
});
test('verified assignments retain samples and pass', async () => {
  const payload = { ...result(), leadVerification: { status: 'verified', leads: { V1: { status: 'verified' } } } };
  await withService(payload, async () => {
    const body = await (await POST(request())).json();
    assert.equal(body.requiresReview, false);
    assert.deepEqual(body.leads, payload.leads);
  });
});
test('a conflicting lead cannot pass even with an inconsistent summary', async () => {
  const payload = { ...result(), requiresReview: false, leadVerification: { status: 'verified', leads: { V1: { status: 'conflict' } } } };
  await withService(payload, async () => {
    const body = await (await POST(request())).json();
    assert.equal(body.requiresReview, true);
    assert.equal(body.leadVerification.status, 'needs_review');
  });
});
test('malformed waveform data is rejected', async () => {
  await withService({ ...result(), leads: { V1: ['bad'] } }, async () => {
    assert.equal((await POST(request())).status, 502);
  });
});
test('empty and oversized uploads are rejected', async () => {
  await withService(result(), async () => {
    assert.equal((await POST(request(''))).status, 400);
    assert.equal((await POST(request(new Uint8Array(10 * 1024 * 1024 + 1)))).status, 413);
  });
});
test('missing service is explicit', async () => {
  const previous = process.env.ECG_DIGITIZER_URL;
  delete process.env.ECG_DIGITIZER_URL;
  try { assert.equal((await POST(request())).status, 503); }
  finally { if (previous !== undefined) process.env.ECG_DIGITIZER_URL = previous; }
});

test('two-minute timeout returns 504 before headers or while reading the body', async () => {
  const previousTimeout = AbortSignal.timeout;
  try {
    AbortSignal.timeout = ms => {
      assert.equal(ms, 120_000);
      return new AbortController().signal;
    };
    for (const phase of ['headers', 'body']) {
      await withService(result(), async () => {
        globalThis.fetch = async (_, options) => {
          assert.ok(options.signal);
          if (phase === 'headers') throw new DOMException('Expired', 'TimeoutError');
          return { ok: true, json: async () => { throw new DOMException('Aborted', 'AbortError'); } };
        };
        const response = await POST(request());
        assert.equal(response.status, 504);
        assert.match((await response.json()).error, /2 minutes/);
      });
    }
  } finally { AbortSignal.timeout = previousTimeout; }
});

test('exactly 10 MB is accepted and oversized data never reaches the digitizer', async () => {
  await withService(result(), async () => {
    assert.equal((await POST(request(new Uint8Array(10 * 1024 * 1024)))).status, 200);
    globalThis.fetch = async () => { assert.fail('Oversized upload reached the service'); };
    assert.equal((await POST(request(new Uint8Array(10 * 1024 * 1024 + 1)))).status, 413);
  });
});

test('Tesseract is preferred when both recognizers return different labels', async () => {
  const payload = { ...result(), modelRecognition: { status: 'success', leads: ['V1'] },
    leadVerification: { status: 'conflict', leads: { V1: { status: 'conflict', observedLabels: ['V2'] } } } };
  await withService(payload, async () => {
    const body = await (await POST(request())).json();
    assert.equal(body.recognition.status, 'success');
    assert.deepEqual(body.recognition.leads.V1, { status: 'success', source: 'tesseract', label: 'V2' });
    assert.deepEqual(body.leads, payload.leads);
    assert.equal(body.leadVerification.status, 'conflict');
    assert.equal(body.requiresReview, true);
  });
});

test('model recognition supplies success when Tesseract has no usable label', async () => {
  await withService({ ...result(), modelRecognition: { status: 'success', leads: ['V1'] },
    leadVerification: { status: 'needs_review', leads: { V1: { status: 'unverified', observedLabels: [] } } } }, async () => {
    const body = await (await POST(request())).json();
    assert.equal(body.recognition.status, 'success');
    assert.equal(body.recognition.leads.V1.source, 'model');
  });
});

test('Tesseract succeeds when the model recognizer fails', async () => {
  await withService({ ...result(), modelRecognition: { status: 'failed', leads: [] },
    leadVerification: { status: 'conflict', leads: { V1: { status: 'conflict', observedLabels: ['aVR'] } } } }, async () => {
    const body = await (await POST(request())).json();
    assert.equal(body.recognition.status, 'success');
    assert.equal(body.recognition.leads.V1.label, 'aVR');
    assert.equal(body.recognition.leads.V1.source, 'tesseract');
  });
});

test('missing, failed or ambiguous recognizers cannot invent a success', async () => {
  for (const observedLabels of [[], ['V2','V3'], ['not-a-lead'], [null]]) {
    await withService({ ...result(), modelRecognition: { status: 'failed', leads: [] },
      leadVerification: { status: 'needs_review', leads: { V1: { status: 'unverified', observedLabels } } } }, async () => {
      assert.equal((await (await POST(request())).json()).recognition.status, 'needs_review');
    });
  }
});
