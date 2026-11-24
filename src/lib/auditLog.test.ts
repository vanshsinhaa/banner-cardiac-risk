//task #61

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildAuditEvent, logAuditEvent, newCaptureId, reasonFromError,
} from "./auditLog.ts";

// A real synthetic sample and the fake identifiers printed on it
const sample = "clean_1.jpg";
const truth = JSON.parse(readFileSync(new URL("../../ocr/samples/ground_truth.json", import.meta.url), "utf8"));
const fullLines: string[] = truth[sample].phi.map((p: { text: string }) => p.text);   // "Patient: Jane Mockwell", ...
const values = fullLines.map(line => line.split(": ").slice(1).join(": "));          // "Jane Mockwell", ...
const imageBase64 = readFileSync(new URL(`../../ocr/samples/${sample}`, import.meta.url)).toString("base64");

// A fake fetch that records every request body instead of sending it
function recorder(sent: string[]): typeof fetch {
  return (async (_url: unknown, init?: RequestInit) => {
    sent.push(String(init?.body));
    return new Response(null, { status: 204 });
  }) as typeof fetch;
}

test("a full capture's events contain no image data, file names or identifier text", async () => {
  const sent: string[] = [];
  const id = newCaptureId();
  // A badly behaved service error whose message is full of sensitive text
  const nasty = Object.assign(
    new Error(`${fullLines.join(" ")} ekg-capture-1.png ${sample} data:image/png;base64,${imageBase64.slice(0, 200)}`),
    { status: 422, code: "uncertain_text" },
  );
  await logAuditEvent(id, "crop_confirmed", "success", undefined, recorder(sent));
  await logAuditEvent(id, "deid_requested", "success", undefined, recorder(sent));
  await logAuditEvent(id, "deid_blocked", "blocked", reasonFromError(nasty), recorder(sent));
  await logAuditEvent(id, "deid_succeeded", "success", undefined, recorder(sent));
  await logAuditEvent(id, "image_save_requested", "success", undefined, recorder(sent));

  assert.equal(sent.length, 5);
  const events = sent.map(body => JSON.parse(body));
  // The exact order the five events were sent in above (a real capture would not
  // have both a block and a success; this just exercises every event type)
  assert.deepEqual(events.map(e => e.event_type),
    ["crop_confirmed", "deid_requested", "deid_blocked", "deid_succeeded", "image_save_requested"]);  assert.equal(new Set(events.map(e => e.capture_id)).size, 1);   // one capture id
  assert.equal(new Set(events.map(e => e.event_id)).size, 5);     // unique event ids
  assert.equal(events[2].reason, "uncertain_text");                // a category, not the message

  const forbidden = [...fullLines, ...values, "ekg-capture", ".png", ".jpg", sample, "data:image", imageBase64.slice(0, 40)];
  for (const body of sent) {
    for (const text of forbidden) assert.ok(!body.includes(text), `event leaked: ${text}`);
    for (const key of Object.keys(JSON.parse(body))) {
      assert.ok(["event_id", "capture_id", "timestamp", "event_type", "outcome", "reason"].includes(key));
    }
  }
});

test("free text cannot be smuggled in as a reason or capture id", () => {
  const id = newCaptureId();
  assert.equal(buildAuditEvent(id, "deid_blocked", "blocked", fullLines[0] as never).reason, "unspecified");
  assert.throws(() => buildAuditEvent(sample, "crop_confirmed", "success"));   // a file name is not an id
});

test("a failed send is never silent and the event is delivered later, in order", async () => {
  const quiet = console.error;
  console.error = () => {};
  try {
    const id = newCaptureId();
    const down = (async () => { throw new TypeError("network"); }) as typeof fetch;
    assert.equal(await logAuditEvent(id, "crop_confirmed", "success", undefined, down), false);
    const delivered: string[] = [];
    assert.equal(await logAuditEvent(id, "deid_requested", "success", undefined, recorder(delivered)), true);
    assert.deepEqual(delivered.map(b => JSON.parse(b).event_type), ["crop_confirmed", "deid_requested"]);
  } finally { console.error = quiet; }
});

test("events fired at the same moment are all delivered once, in order", async () => {
  const sent: string[] = [];
  const id = newCaptureId();
  await Promise.all([
    logAuditEvent(id, "crop_confirmed", "success", undefined, recorder(sent)),
    logAuditEvent(id, "deid_requested", "success", undefined, recorder(sent)),
    logAuditEvent(id, "deid_succeeded", "success", undefined, recorder(sent)),
  ]);
  assert.deepEqual(sent.map(b => JSON.parse(b).event_type), ["crop_confirmed", "deid_requested", "deid_succeeded"]);
});

test("error categories come from name, status and code only", () => {
  assert.equal(reasonFromError(Object.assign(new Error("x"), { code: "uncertain_text" })), "uncertain_text");
  assert.equal(reasonFromError(new DOMException("t", "TimeoutError")), "timeout");
  assert.equal(reasonFromError(new TypeError("Failed to fetch")), "service_unavailable");
  assert.equal(reasonFromError(new Error("anything else")), "unspecified");
});