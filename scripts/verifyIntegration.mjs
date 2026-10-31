// Synthetic browser fixtures verify integration behavior, not real OCR/inference.
// node scripts/verifyIntegration.mjs <path-to-playwright> [chromium|webkit]
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const require = createRequire(import.meta.url);
const playwright = require(process.argv[2] || "playwright");
const engine = process.argv[3] || "chromium";
const url = process.env.CAPTURE_TEST_URL || "http://127.0.0.1:3107";
const artifacts = path.resolve(".next/integration-verification", engine);
await mkdir(artifacts, { recursive: true });
const synthetic = await sharp(Buffer.from(`<svg width="2400" height="1600" xmlns="http://www.w3.org/2000/svg"><defs><pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="#efbbbb" stroke-width="2"/></pattern></defs><rect width="100%" height="100%" fill="white"/><rect width="100%" height="100%" fill="url(#grid)"/><text x="250" y="230" font-size="60">Patient: SYNTHETIC TEST ONLY</text><text x="250" y="480" font-size="60">I</text><text x="250" y="800" font-size="60">II</text><path d="M350 500H700L730 450L760 620L800 300L840 500H1100L1130 450L1160 620L1200 300L1240 500H1900M350 850H700L730 800L760 970L800 650L840 850H1100L1130 800L1160 970L1200 650L1240 850H1900" fill="none" stroke="#222" stroke-width="5"/></svg>`)).png().toBuffer();
const upload = async page => {
  await page.locator('input[type="file"]').setInputFiles({ name: "synthetic-ekg.png", mimeType: "image/png", buffer: synthetic });
  await page.getByRole("button", { name: "Confirm crop", exact: true }).waitFor();
  await page.waitForFunction(() => ![...document.querySelectorAll("button")].find(button => button.textContent === "Confirm crop")?.disabled);
};
const browser = await playwright[engine].launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
const page = await context.newPage();
if (engine === "webkit") {
  // Playwright/WebKit omits multipart file bytes in intercepted postDataBuffer.
  // Record the actual browser File before fetch; the request still runs normally.
  await page.addInitScript(() => {
    const original = window.fetch;
    window.fetch = async (resource, options) => {
      const blob = options?.body instanceof FormData ? options.body.get("file") : options?.body;
      if (typeof resource === "string" && resource.startsWith("/api/") && blob instanceof Blob) {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let binary = "";
        for (const byte of bytes) binary += String.fromCharCode(byte);
        window.integrationUploads ||= {};
        window.integrationUploads[resource] = btoa(binary);
      }
      return original(resource, options);
    };
  });
}
const errors = [];
page.on("pageerror", error => errors.push(error.message));
let mode = "success", checks = 0, lastImage, release;
await page.route("**/api/deidentify", async route => {
  const selected = mode;
  if (selected === "slow") await new Promise(resolve => { release = resolve; });
  if (selected === "fail") return route.fulfill({ status: 503, json: { status: "failed", error: "Synthetic privacy service unavailable." } });
  if (selected === "nothing") return route.fulfill({ json: { status: "nothing_detected" } });
  const form = await new Response(route.request().postDataBuffer(), { headers: { "Content-Type": route.request().headers()["content-type"] } }).formData();
  let original = Buffer.from(await form.get("file").arrayBuffer());
  if (!original.length && engine === "webkit") original = Buffer.from(await page.evaluate(() => window.integrationUploads["/api/deidentify"]), "base64");
  const info = await sharp(original).metadata();
  const bar = await sharp({ create: { width: info.width, height: 250, channels: 3, background: "black" } }).png().toBuffer();
  const redacted = await sharp(original).composite([{ input: bar, top: 0, left: 0 }]).png().toBuffer();
  lastImage = `data:image/png;base64,${redacted.toString("base64")}`;
  await route.fulfill({ json: { status: "redacted", image: lastImage, regions_redacted: 1, mock: selected === "mock" } }).catch(() => {});
});
async function requestPixels(route) {
  return route.request().postDataBuffer() || Buffer.from(await page.evaluate(resource => window.integrationUploads[resource], new URL(route.request().url()).pathname), "base64");
}
await page.route("**/api/analyze", async route => {
  checks++;
  assert.ok((await requestPixels(route)).equals(Buffer.from(lastImage.split(",")[1], "base64")), "analysis receives redacted pixels");
  await route.fulfill({ json: { status: "needs_review", detected_leads: ["I", "II"], reasons: ["lead_labels_unreadable_or_missing"], processed_image: lastImage } });
});
await page.route("**/api/ecg/digitize", async route => {
  checks++;
  assert.ok((await requestPixels(route)).equals(Buffer.from(lastImage.split(",")[1], "base64")), "digitizer receives redacted pixels");
  await route.fulfill({ json: { leads: { I: [0, .1, null] }, samplingRateHz: 500, units: "mV", requiresReview: true, modelRecognition: { status: "success", leads: ["I"] } } });
});

try {
  await page.goto(url);
  await page.waitForFunction(() => document.activeElement?.tagName === "H1");
  await page.screenshot({ path: path.join(artifacts, "idle.png") });
  await upload(page);
  assert.equal(await page.locator("button[data-kind=corner]").count(), 4);
  await page.getByRole("button", { name: "Top left corner", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await page.screenshot({ path: path.join(artifacts, "four-corner-crop.png") });
  await page.getByRole("button", { name: "Confirm crop", exact: true }).click();
  await page.getByAltText("De-identified EKG capture", { exact: true }).waitFor();
  await page.getByText(/1 waveforms? extracted at 500 Hz/).waitFor();
  await page.getByText(/2\/12 lead labels recognized/).waitFor();
  assert.equal(checks, 2);
  assert.ok(await page.getByRole("link", { name: "Save image", exact: true }).isVisible());
  await page.screenshot({ path: path.join(artifacts, "combined-result.png"), fullPage: true });
  await page.getByRole("button", { name: "Capture another", exact: true }).click();

  // Failed and unconfirmed privacy checks block saving and every downstream call.
  for (mode of ["fail", "nothing"]) {
    const before = checks;
    await upload(page);
    await page.getByRole("button", { name: "Confirm crop", exact: true }).click();
    await page.getByRole("heading", { name: "Image not sent on", exact: true }).waitFor();
    assert.equal(checks, before);
    assert.equal(await page.getByRole("link", { name: "Save image", exact: true }).count(), 0);
    await page.screenshot({ path: path.join(artifacts, `blocked-${mode}.png`) });
    if (mode === "fail") {
      mode = "success";
      await page.getByRole("button", { name: "Try again", exact: true }).click();
      await page.getByText(/1 waveforms? extracted at 500 Hz/).waitFor();
      assert.equal(checks, before + 2);
      await page.getByRole("button", { name: "Capture another", exact: true }).click();
    } else await page.getByRole("button", { name: "Retake", exact: true }).click();
  }

  mode = "mock";
  const beforeMock = checks;
  await upload(page);
  await page.getByRole("button", { name: "Confirm crop", exact: true }).click();
  await page.getByText(/TEST MODE:/).waitFor();
  assert.equal(checks, beforeMock);
  assert.equal(await page.getByRole("link", { name: "Save image", exact: true }).count(), 0);
  await page.getByRole("button", { name: "Capture another", exact: true }).click();

  mode = "slow";
  await upload(page);
  await page.getByRole("button", { name: "Confirm crop", exact: true }).click();
  await page.getByRole("heading", { name: "Removing identifying information", exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector("h1")?.textContent === "Removing identifying information");
  while (!release) await new Promise(resolve => setTimeout(resolve, 20));
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  release();
  await page.getByRole("heading", { name: "Capture a clear EKG", exact: true }).waitFor();
  assert.equal(checks, beforeMock);

  const small = await sharp(synthetic).resize(800).png().toBuffer();
  await page.locator('input[type="file"]').setInputFiles({ name: "small.png", mimeType: "image/png", buffer: small });
  await page.getByText("Move closer", { exact: true }).waitFor();
  assert.ok(await page.getByRole("button", { name: "Confirm crop", exact: true }).isDisabled());
  await page.getByRole("button", { name: "Retake", exact: true }).click();
  // An actual production request (no browser fixtures) must fail closed without configuration.
  const production = await context.request.post(`${url}/api/deidentify`, { multipart: { file: { name: "synthetic.png", mimeType: "image/png", buffer: synthetic } } });
  assert.equal(production.status(), 503);
  assert.equal((await production.json()).image, undefined);
  assert.deepEqual(errors, []);
  console.log(`${engine}: four-corner UI, redacted-only downstream requests, scan results, privacy failure/retry, nothing-detected, mock isolation, cancellation, resolution gate, and production fail-closed checks passed.`);
  console.log(`Synthetic screenshots: ${artifacts}`);
} finally { await browser.close(); }
