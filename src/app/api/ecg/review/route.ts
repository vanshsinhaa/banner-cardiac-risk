import { isEcgDigitizationResult } from '@/lib/ecg-digitizer/types';

export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'no-store' };

export async function POST(request: Request) {
  const url = process.env.ECG_DIGITIZER_URL;
  if (!url) return Response.json({ error: 'The digitizer service is not configured.' }, { status: 503, headers });
  const reader = request.body?.getReader();
  if (!reader) return Response.json({ error: 'No corrections were sent.' }, { status: 400, headers });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 32 * 1024) {
        await reader.cancel();
        return Response.json({ error: 'Correction request is too large.' }, { status: 413, headers });
      }
      chunks.push(value);
    }
    const body = Buffer.concat(chunks).toString('utf8');
    try { JSON.parse(body); } catch {
      return Response.json({ error: 'Invalid correction request.' }, { status: 400, headers });
    }
    const upstream = await fetch(`${url.replace(/\/$/, '')}/review-leads`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(120_000)]),
    });
    const result = await upstream.json();
    if (!upstream.ok) return Response.json({ error: typeof result.detail === 'string' ? result.detail : 'Unable to process these regions.' },
      { status: [409, 410, 413, 422].includes(upstream.status) ? upstream.status : 502, headers });
    if (!isEcgDigitizationResult(result)) return Response.json({ error: 'The service returned invalid waveform data.' }, { status: 502, headers });
    return Response.json(result, { headers });
  } catch {
    return Response.json({ error: 'Region processing could not finish. Your selections are still available; retry or upload again if the session expired.' }, { status: 503, headers });
  } finally { reader.releaseLock(); }
}
