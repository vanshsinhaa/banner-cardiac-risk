import assert from "node:assert/strict";
import { test } from "node:test";
import { analyzeCapture, deidentifyCapture, digitizeCapture, pngBlob, type DeidentifiedCapture } from "./capturePipeline.ts";
import { isEcgDigitizationResult } from "./ecg-digitizer/types.ts";
import { toCsv } from "./ecg-digitizer/export.ts";

const image = "data:image/png;base64," + btoa("sanitized-redacted-pixels");
const confirmed: DeidentifiedCapture = { status: "redacted", image, mock: false, regions_redacted: 1 };
const signal = () => new AbortController().signal;

test("unconfirmed de-identification never produces a usable capture", async () => {
  const previous = globalThis.fetch;
  try {
    for (const response of [{ status: "nothing_detected", image }, { ...confirmed, image: "data:text/html;base64,eA==" }, { ...confirmed, status: "failed" }]) {
      globalThis.fetch = async () => Response.json(response);
      await assert.rejects(deidentifyCapture(pngBlob(image), signal()), /not confirmed/);
    }
  } finally { globalThis.fetch = previous; }
});

test("test previews cannot reach either downstream service", async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async () => assert.fail("Mock image escaped to a downstream service");
  try {
    await assert.rejects(analyzeCapture({ ...confirmed, mock: true }, signal()), /Test previews/);
    await assert.rejects(digitizeCapture({ ...confirmed, mock: true }, signal()), /Test previews/);
  } finally { globalThis.fetch = previous; }
});

test("downstream requests carry the redacted pixels and preserve review metadata", async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(await (options?.body as Blob).text(), "sanitized-redacted-pixels");
    assert.equal((options?.headers as Record<string, string>)["Content-Type"], "image/png");
    if (url === "/api/analyze") return Response.json({ status: "needs_review", detected_leads: ["V1"], missing_leads: ["V2"], advisories: ["limited_image_dimensions"], reasons: [], processed_image: image });
    return Response.json({ leads: { V1: [0.1, null, 0.3] }, samplingRateHz: 250, units: "mV", requiresReview: true });
  };
  try {
    const assessment = await analyzeCapture(confirmed, signal());
    assert.equal(assessment.status, "needs_review");
    assert.deepEqual(assessment.advisories, ["limited_image_dimensions"]);
    assert.deepEqual(assessment.missing_leads, ["V2"]);
    const result = await digitizeCapture(confirmed, signal());
    assert.equal(result.requiresReview, true);
    assert.deepEqual(result.leads.V1, [0.1, null, 0.3]);
    assert.equal(toCsv(result), "time_s,V1\n0.000,0.1\n0.004,\n0.008,0.3\n");
  } finally { globalThis.fetch = previous; }
});

test("empty, all-missing, and non-finite leads cannot pass validation", () => {
  for (const leads of [[], { V1: [] }, { V1: [null, null] }, { V1: [Infinity] }]) {
    assert.equal(isEcgDigitizationResult({ leads, samplingRateHz: 500, units: "mV" }), false);
  }
});

test("malformed readability advice is rejected instead of reaching result rendering", async () => {
  const previous = globalThis.fetch;
  try {
    for (const extra of [{ advisories: "limited" }, { missing_leads: [null] }]) {
      globalThis.fetch = async () => Response.json({ status: "needs_review", detected_leads: [], reasons: [], processed_image: image, ...extra });
      await assert.rejects(analyzeCapture(confirmed, signal()), /invalid assessment/);
    }
  } finally { globalThis.fetch = previous; }
});

// Camera JPEG size is not the size of its lossless PNG representation.
test('expanded PNG crops above 10 MiB reach the privacy endpoint without resizing', async () => {
  const { pngBlob, deidentifyCapture, MAX_CAPTURE_BYTES, MAX_PROCESSED_BYTES } = await import('./capturePipeline.ts');
  assert.equal(MAX_CAPTURE_BYTES, 10 * 1024 * 1024);
  assert.equal(MAX_PROCESSED_BYTES, 64 * 1024 * 1024);
  const bytes = Buffer.alloc(11 * 1024 * 1024, 1);
  const expanded = 'data:image/png;base64,' + bytes.toString('base64');
  const blob = pngBlob(expanded);
  assert.equal(blob.size, bytes.length);
  const original = globalThis.fetch;
  let uploaded = 0;
  globalThis.fetch = async (_url, init) => {
    uploaded = (init!.body as FormData).get('file') instanceof Blob ? ((init!.body as FormData).get('file') as Blob).size : 0;
    return Response.json({ status: 'redacted', image: expanded, regions_redacted: 1 });
  };
  try {
    await deidentifyCapture(blob, new AbortController().signal);
    assert.equal(uploaded, bytes.length);
  } finally { globalThis.fetch = original; }
});
