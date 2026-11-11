// task #61

// Builds and sends audit events for the capture screen.

// PRIVACY BY DESIGN: an event can only be made from the fixed lists below
// (event types, outcomes, reason categories) plus random IDs. No parameter
// accepts free text, a file name, or image data, so none of those can reach
// the log, no matter who calls these functions later

// The steps a capture goes through
export const AUDIT_EVENT_TYPES = [
  "crop_confirmed",       // user confirmed the crop
  "deid_requested",       // image sent for de-identification
  "deid_succeeded",       // de-identification confirmed
  "deid_blocked",         // de-identification refused, failed, or cancelled
  "image_save_requested", // user clicked Save (the browser can't tell us if it finished)
] as const;

export const AUDIT_OUTCOMES = ["success", "blocked", "failed"] as const;

// Safe reason categories for blocks
export const AUDIT_REASONS = [
  "nothing_detected", "uncertain_text", "unsupported_pixels", "ocr_failed",
  "redaction_failed", "verification_failed", "timeout", "service_unavailable",
  "invalid_response", "cancelled", "unspecified",
] as const;

export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number];
export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number];
export type AuditReason = (typeof AUDIT_REASONS)[number];

export interface AuditEvent {
  event_id: string;       // random, unique per event
  capture_id: string;     // random, groups the events of one capture
  timestamp: string;      // ISO 8601, e.g. 2026-11-09T17:04:05.000Z
  event_type: AuditEventType;
  outcome: AuditOutcome;
  reason?: AuditReason;   // only on blocked or failed events
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// crypto.randomUUID() only exists on secure pages (https or localhost). A phone
// testing over a plain http network link doesn't have it, so fall back to
// getRandomValues, which works everywhere
function randomUuid(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;   // mark it as a version 4 (random) UUID
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, x => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// One ID per capture. All events for that capture share it
export function newCaptureId(): string {
  return randomUuid();
}

// Build an event. Anything outside the allowed lists is rejected or replaced
// with a safe value, so a mistake by the caller cannot put data into the log
export function buildAuditEvent(
  captureId: string,
  eventType: AuditEventType,
  outcome: AuditOutcome,
  reason?: AuditReason,
): AuditEvent {
  if (!UUID.test(captureId)) throw new Error("Invalid capture id.");
  if (!AUDIT_EVENT_TYPES.includes(eventType)) throw new Error("Invalid event type.");
  if (!AUDIT_OUTCOMES.includes(outcome)) throw new Error("Invalid outcome.");
  const event: AuditEvent = {
    event_id: randomUuid(),
    capture_id: captureId,
    timestamp: new Date().toISOString(),
    event_type: eventType,
    outcome,
  };
  if (outcome !== "success") {
    // An unknown reason becomes "unspecified" instead of being passed through
    event.reason = reason && AUDIT_REASONS.includes(reason) ? reason : "unspecified";
  }
  return event;
}

// Turn an error into a safe reason category. It reads ONLY the error's name,
// HTTP status and block code, never its message, because messages can contain
// anything
export function reasonFromError(error: unknown): AuditReason {
  if (typeof error !== "object" || error === null) return "unspecified";
  const e = error as { name?: unknown; status?: unknown; code?: unknown };
  // A safe block code from the backend, like "uncertain_text"
  if (typeof e.code === "string" && (AUDIT_REASONS as readonly string[]).includes(e.code)) {
    return e.code as AuditReason;
  }
  if (e.name === "TimeoutError" || e.status === 504) return "timeout";
  if (e.status === 502 || e.status === 503 || e.name === "TypeError") return "service_unavailable";
  return "unspecified";
}

// ---- Sending ----
// Events that could not be sent stay here and are retried with the next event.
// Capped so a long outage cannot grow memory without limit
const pending: AuditEvent[] = [];
const MAX_PENDING = 100;

export const AUDIT_ENDPOINT = "/api/audit";

async function post(event: AuditEvent, fetchImpl: typeof fetch): Promise<boolean> {
  try {
    const response = await fetchImpl(AUDIT_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
      keepalive: true,                      // lets the send finish even if the page closes
      signal: AbortSignal.timeout(5_000),   // never hang the capture screen
    });
    return response.ok;
  } catch {
    return false;                           // no error details are kept
  }
}

// Queue the event, then send everything pending, oldest first. Stops at the
// first failure and keeps the rest queued
async function deliver(event: AuditEvent, fetchImpl: typeof fetch): Promise<boolean> {
  pending.push(event);
  if (pending.length > MAX_PENDING) pending.shift();   // drop the oldest if capped
  while (pending.length) {
    if (!(await post(pending[0], fetchImpl))) {
      console.error("Audit log unavailable: events are queued for retry.");   // fixed message only
      return false;
    }
    pending.shift();
  }
  return true;
}

// Sends run strictly one after another. Without this, two events fired at the
// same moment could duplicate or lose each other in the queue.
let sendChain: Promise<boolean> = Promise.resolve(true);

// Build and send an event. NEVER throws and never blocks the capture. Returns
// true if everything pending was delivered, false if the audit endpoint is
// unavailable. The caller shows a visible warning on false, so a logging
// failure is never silent
export function logAuditEvent(
  captureId: string,
  eventType: AuditEventType,
  outcome: AuditOutcome,
  reason?: AuditReason,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  let event: AuditEvent;
  try {
    event = buildAuditEvent(captureId, eventType, outcome, reason);
  } catch {
    console.error("Audit event rejected: invalid fields.");
    return Promise.resolve(false);
  }
  const run = sendChain.then(() => deliver(event, fetchImpl));
  sendChain = run;   // deliver() never rejects, so the chain never breaks
  return run;
}