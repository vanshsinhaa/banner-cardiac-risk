//task #61
// Receives audit events from the capture screen. It checks them strictly,
// rebuilds a clean copy, and writes it to the audit sink.
import { AUDIT_EVENT_TYPES, AUDIT_OUTCOMES, AUDIT_REASONS } from "../../../lib/auditLog.ts";

export const runtime = "nodejs";

const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const MAX_BYTES = 2048;   // a real event is about 300 bytes
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const FIELDS = ["event_id", "capture_id", "timestamp", "event_type", "outcome", "reason"];

const inList = (list: readonly unknown[], value: unknown) => list.includes(value);

// Every rejection looks the same and echoes nothing back
function reject() {
  return Response.json({ status: "rejected" }, { status: 400, headers });
}

export async function POST(request: Request) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return reject();
  const text = await request.text();
  if (text.length > MAX_BYTES) return reject();

  let body: unknown;
  try { body = JSON.parse(text); } catch { return reject(); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return reject();
  const e = body as Record<string, unknown>;

  // Only the known fields are allowed. An extra field means something is wrong
  if (Object.keys(e).some(key => !FIELDS.includes(key))) return reject();

  if (typeof e.event_id !== "string" || !UUID.test(e.event_id)) return reject();
  if (typeof e.capture_id !== "string" || !UUID.test(e.capture_id)) return reject();
  if (typeof e.timestamp !== "string" || !ISO.test(e.timestamp) || Number.isNaN(Date.parse(e.timestamp))) return reject();
  if (!inList(AUDIT_EVENT_TYPES, e.event_type)) return reject();
  if (!inList(AUDIT_OUTCOMES, e.outcome)) return reject();
  // A reason is required on blocks and failures, and not allowed on successes.
  if (e.outcome === "success" ? e.reason !== undefined : !inList(AUDIT_REASONS, e.reason)) return reject();

  // Rebuild the event from the checked values instead of passing the raw object on
  const clean = {
    event_id: e.event_id, capture_id: e.capture_id, timestamp: e.timestamp,
    event_type: e.event_type, outcome: e.outcome,
    ...(e.reason !== undefined ? { reason: e.reason } : {}),
  };

  // Sink 1: one structured line in the server log
  console.log(`AUDIT ${JSON.stringify(clean)}`);

  // Sink 2 (optional): forward to the backend's audit store once the team agrees
  // on one. Set AUDIT_SINK_URL to switch it on; the event_id lets the receiver
  // ignore a repeated event
  const sink = process.env.AUDIT_SINK_URL;
  if (sink) {
    try {
      const forwarded = await fetch(sink, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(clean), signal: AbortSignal.timeout(5_000), cache: "no-store",
      });
      if (!forwarded.ok) return Response.json({ status: "unavailable" }, { status: 502, headers });
    } catch {
      return Response.json({ status: "unavailable" }, { status: 502, headers });
    }
  }
  return new Response(null, { status: 204, headers });
}