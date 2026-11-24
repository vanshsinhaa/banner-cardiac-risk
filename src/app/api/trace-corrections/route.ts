import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { validateCorrection } from "@/lib/traceOverlay/correctionPayload";

export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store" };
const MAX_BYTES = 5 * 1024 * 1024;
// No database exists yet, so corrections are written as JSON under .data/ (gitignored).
// The auto-detected and corrected traces are stored side by side but never merged.
function storeDirectory() {
  return process.env.TRACE_CORRECTIONS_DIR ?? path.join(process.cwd(), ".data", "trace-corrections");
}

export async function POST(request: Request) {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    return Response.json({ error: "Send JSON." }, { status: 415, headers });
  }
  const text = await request.text();
  if (Buffer.byteLength(text) > MAX_BYTES) return Response.json({ error: "Correction is too large." }, { status: 413, headers });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400, headers });
  }
  const problem = validateCorrection(body);
  if (problem) return Response.json({ error: problem }, { status: 400, headers });

  const correction = body as Record<string, unknown>;
  const savedAt = new Date().toISOString();
  const file = `${correction.captureId}-${savedAt.replace(/[:.]/g, "-")}.json`;
  const record = {
    schema: "trace-correction/0.1",
    savedAt,
    captureId: correction.captureId,
    samplingRateHz: correction.samplingRateHz,
    sampleCount: correction.sampleCount,
    autoDetected: correction.auto,
    corrected: correction.corrected,
    editedLeads: correction.editedLeads,
    edits: correction.edits,
    alignment: correction.alignment ?? null,
  };
  try {
    const directory = storeDirectory();
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, file), JSON.stringify(record), { encoding: "utf-8", flag: "wx" });
  } catch {
    return Response.json({ error: "The correction could not be stored." }, { status: 500, headers });
  }
  // Audit line without trace values, matching the stdout audit style used elsewhere.
  console.info(`TRACE_CORRECTION ${JSON.stringify({ captureId: correction.captureId, savedAt, edits: (correction.edits as unknown[]).length, editedLeads: correction.editedLeads })}`);
  return Response.json({ savedAt, file, editCount: (correction.edits as unknown[]).length }, { status: 201, headers });
}
