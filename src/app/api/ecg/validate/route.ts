import { validateWaveAttributes } from "../../../../lib/waveValidation.ts";

export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store" };
// 12 leads x 5000 samples is well under 1 MB of JSON; leave headroom for evidence fields.
const MAX_BYTES = 4 * 1024 * 1024;

// Re-validates a digitizer result server-side (Taiga #64). Any `validation` or
// eligibility value inside the posted record is ignored: the report is recomputed.
// Use this before admitting a record into a dataset or model, or to check a saved result.
export async function POST(request: Request) {
  const contentType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    return Response.json({ error: "Send the digitizer result as JSON." }, { status: 415, headers });
  }
  const reader = request.body?.getReader();
  if (!reader) return Response.json({ error: "No result was sent." }, { status: 400, headers });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel();
        return Response.json({ error: "The result is larger than 4 MB." }, { status: 413, headers });
      }
      chunks.push(value);
    }
  } catch {
    return Response.json({ error: "The upload was interrupted." }, { status: 400, headers });
  } finally {
    reader.releaseLock();
  }
  const text = Buffer.concat(chunks).toString("utf8");
  let record: unknown;
  try {
    record = JSON.parse(text);
  } catch {
    return Response.json({ error: "The body is not valid JSON." }, { status: 400, headers });
  }
  // A failed validation is still a successful check, so the status code is 200 and
  // callers read `status` / `analysisEligible` from the report.
  return Response.json(validateWaveAttributes(record), { headers });
}
