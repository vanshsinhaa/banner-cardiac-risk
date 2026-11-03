// Real local browser and all three backends. No intercepted service replies.
// node scripts/verifyFullFlow.mjs /path/to/playwright
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require(process.argv[2] || "playwright");
const directory = path.resolve(".local-run/full-flow");
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1050 } });
  // Browser automation may omit streamed Blob bodies from postDataBuffer.
  // Observe digests of the actual outgoing bodies without replacing responses.
  await page.addInitScript(() => {
    const original = window.fetch;
    window.actualNumericalDigests = {};
    window.fetch = async (resource, options) => {
      if (["/api/analyze", "/api/ecg/digitize"].includes(resource) && options?.body instanceof Blob) {
        const digest = await crypto.subtle.digest("SHA-256", await options.body.arrayBuffer());
        window.actualNumericalDigests[resource] = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
      }
      return original(resource, options);
    };
  });
  await page.goto(process.env.CAPTURE_TEST_URL || "http://127.0.0.1:3107");
  await page.locator('input[type="file"]').setInputFiles(path.resolve(process.argv[3] || "ocr/samples/clean_1.jpg"));
  await page.getByRole("button", { name: "Use this crop", exact: true }).waitFor();
  for (const [label, right, bottom] of [
    ["Top left", false, false], ["Top right", true, false],
    ["Bottom right", true, true], ["Bottom left", false, true],
  ]) {
    const target = await page.getByAltText("Original EKG photo").boundingBox();
    const handle = await page.getByRole("button", { name: `${label} corner`, exact: true }).boundingBox();
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(target.x + (right ? target.width : 0), target.y + (bottom ? target.height : 0), { steps: 5 });
    await page.mouse.up();
  }
  const endpoints = ["/api/deidentify", "/api/analyze", "/api/ecg/digitize"];
  const pending = endpoints.map(endpoint => page.waitForResponse(reply => reply.url().endsWith(endpoint), { timeout: 160000 }));
  await page.getByRole("button", { name: "Use this crop", exact: true }).click();
  const responses = await Promise.all(pending);
  const summaries = [];
  let confirmedDigest;
  for (let index = 0; index < responses.length; index++) {
    const reply = responses[index];
    const value = await reply.json();
    assert.equal(reply.status(), 200, `${endpoints[index]} failed: ${value.error || value.code}`);
    if (index === 0) {
      assert.equal(value.status, "redacted");
      assert.ok(value.regions_redacted >= 4 && !value.mock);
      confirmedDigest = createHash("sha256").update(Buffer.from(value.image.split(",", 2)[1], "base64")).digest("hex");
      summaries.push({ endpoint: endpoints[index], status: value.status, regions: value.regions_redacted });
    } else if (index === 1) {
      assert.equal(await page.evaluate(() => window.actualNumericalDigests["/api/analyze"]), confirmedDigest,
        "Readability must receive the confirmed PNG");
      assert.ok(["passed", "needs_review", "failed"].includes(value.status));
      assert.ok(Array.isArray(value.detected_leads) && !value.error);
      summaries.push({ endpoint: endpoints[index], status: value.status, detected_leads: value.detected_leads, reasons: value.reasons });
    } else {
      assert.equal(await page.evaluate(() => window.actualNumericalDigests["/api/ecg/digitize"]), confirmedDigest,
        "Digitizer must receive the confirmed PNG");
      assert.equal(value.units, "mV");
      assert.ok(Number.isFinite(value.samplingRateHz) && value.samplingRateHz > 0);
      const entries = Object.entries(value.leads);
      assert.ok(entries.length > 0);
      assert.ok(entries.every(([, samples]) => samples.length === 5000 && samples.some(Number.isFinite)));
      assert.ok(value.leadVerification && typeof value.requiresReview === "boolean");
      summaries.push({ endpoint: endpoints[index], lead_count: entries.length,
        samplingRateHz: value.samplingRateHz, requiresReview: value.requiresReview,
        assignment_status: value.leadVerification.status,
        missing_sample_counts: Object.fromEntries(entries.map(([name, samples]) => [name, samples.filter(x => x === null).length])) });
      // Retain synthetic numerical output for reproducible inspection.
      await writeFile(path.join(directory, "digitizer-result.json"), JSON.stringify(value, null, 2));
    }
  }
  await page.getByText(/waveforms? extracted at/).waitFor();
  await page.getByRole("link", { name: "Save image", exact: true }).waitFor();
  assert.equal(await page.getByText(/could not finish:/).count(), 0);
  await page.screenshot({ path: path.join(directory, "complete-flow.png"), fullPage: true });
  await writeFile(path.join(directory, "summary.json"), JSON.stringify({ passed: true, services: summaries }, null, 2));
  console.log(JSON.stringify({ passed: true, services: summaries }, null, 2));
} finally {
  await browser.close();
}
