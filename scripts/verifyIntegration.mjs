// Synthetic browser fixtures verify integration behavior, not real OCR/inference.
// node scripts/verifyIntegration.mjs <path-to-playwright> [chromium|webkit]
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, readFile } from "node:fs/promises";
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
  await page.getByRole("button", { name: "Use this crop", exact: true }).waitFor();
  await page.waitForFunction(() => ![...document.querySelectorAll("button")].find(button => button.textContent === "Use this crop")?.disabled);
};
const selectionInSourcePixels = page => page.locator('svg[aria-label="Adjust EKG page boundary"]').evaluate(svg => {
  const frame = svg.querySelector("foreignObject");
  const image = frame.querySelector("img");
  return Array.from(svg.querySelector("polygon").points, point => [
    Math.round((point.x - frame.x.baseVal.value) * image.naturalWidth / frame.width.baseVal.value * 1e6) / 1e6,
    Math.round((point.y - frame.y.baseVal.value) * image.naturalHeight / frame.height.baseVal.value * 1e6) / 1e6,
  ]);
});
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
const privacyDimensions = [];
await page.route("**/api/deidentify", async route => {
  const selected = mode;
  if (selected === "slow") await new Promise(resolve => { release = resolve; });
  if (selected === "fail") return route.fulfill({ status: 503, json: { status: "failed", error: "Synthetic privacy service unavailable." } });
  if (selected === "nothing") return route.fulfill({ json: { status: "nothing_detected" } });
  const form = await new Response(route.request().postDataBuffer(), { headers: { "Content-Type": route.request().headers()["content-type"] } }).formData();
  let original = Buffer.from(await form.get("file").arrayBuffer());
  if (!original.length && engine === "webkit") original = Buffer.from(await page.evaluate(() => window.integrationUploads["/api/deidentify"]), "base64");
  const info = await sharp(original).metadata();
  privacyDimensions.push([info.width, info.height]);
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
  if (mode === "analysis-unavailable") return route.fulfill({ status: 503, json: { error: "Synthetic readability service unavailable." } });
  await route.fulfill({ json: { status: "needs_review", detected_leads: ["I", "II"], missing_leads: ["V1", "V2"], advisories: ["limited_image_dimensions"], reasons: ["lead_labels_unreadable_or_missing"], processed_image: lastImage } });
});
await page.route("**/api/ecg/digitize", async route => {
  checks++;
  assert.ok((await requestPixels(route)).equals(Buffer.from(lastImage.split(",")[1], "base64")), "digitizer receives redacted pixels");
  if (mode === "digitizer-unavailable") return route.fulfill({ status: 503, json: { error: "Synthetic digitizer service unavailable." } });
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
  await page.getByRole("button", { name: "Use this crop", exact: true }).click();
  await page.getByAltText("De-identified EKG capture", { exact: true }).waitFor();
  await page.getByText(/1 waveforms? extracted at 500 Hz/).waitFor();
  await page.getByText(/2\/12 lead labels recognized/).waitFor();
  assert.equal(checks, 2);
  assert.ok(await page.getByRole("link", { name: "Save image", exact: true }).isVisible());
  await page.screenshot({ path: path.join(artifacts, "combined-result.png"), fullPage: true });
  // Canceling replacement must preserve the current confirmed result.
  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Choose another image", exact: true }).click();
  await (await chooserPromise).setFiles([]);
  assert.ok(await page.getByRole("link", { name: "Save image", exact: true }).isVisible());

  // Failed and unconfirmed privacy checks block saving and every downstream call.
  for (mode of ["fail", "nothing"]) {
    const before = checks;
    await upload(page);
    await page.getByRole("button", { name: "Top left corner", exact: true }).focus();
    await page.keyboard.press("Shift+ArrowRight");
    const originalSelection = await selectionInSourcePixels(page);
    await page.getByRole("button", { name: "Use this crop", exact: true }).click();
    await page.getByRole("heading", { name: "Image not sent on", exact: true }).waitFor();
    assert.equal(checks, before);
    assert.equal(await page.getByRole("link", { name: "Save image", exact: true }).count(), 0);
    await page.screenshot({ path: path.join(artifacts, `blocked-${mode}.png`) });
    if (mode === "fail") {
      mode = "success";
      await page.getByRole("button", { name: "Try again", exact: true }).click();
      await page.getByText(/1 waveforms? extracted at 500 Hz/).waitFor();
      assert.equal(checks, before + 2);
    } else {
      // A privacy failure permits editing the same original without losing corners.
      await page.getByRole("button", { name: "Adjust crop", exact: true }).click();
      assert.ok(await page.getByRole("button", { name: "Use this crop", exact: true }).isEnabled());
      await page.getByRole("button", { name: "Top left corner", exact: true }).waitFor();
      await page.waitForFunction(() => {
        const svg = document.querySelector('svg[aria-label="Adjust EKG page boundary"]');
        return svg?.viewBox.baseVal.width > 1 && Math.abs(svg.viewBox.baseVal.width - svg.getBoundingClientRect().width) < 1;
      });
      assert.deepEqual(await selectionInSourcePixels(page), originalSelection);
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
    }
  }

  mode = "mock";
  const beforeMock = checks;
  await upload(page);
  await page.getByRole("button", { name: "Use this crop", exact: true }).click();
  await page.getByText(/TEST MODE:/).waitFor();
  assert.equal(checks, beforeMock);
  assert.equal(await page.getByRole("link", { name: "Save image", exact: true }).count(), 0);

  mode = "slow";
  await upload(page);
  await page.getByRole("button", { name: "Use this crop", exact: true }).click();
  await page.getByRole("heading", { name: "Removing identifying information", exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector("h1")?.textContent === "Removing identifying information");
  while (!release) await new Promise(resolve => setTimeout(resolve, 20));
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  release();
  await page.getByRole("heading", { name: "Capture a clear EKG", exact: true }).waitFor();
  assert.equal(checks, beforeMock);

  mode = "success";
  // Use Faith's actual native fixture rather than enlarging it to satisfy a gate.
  const native = await readFile("ocr/samples/clean_1.jpg");
  await page.locator('input[type="file"]').setInputFiles({ name: "synthetic-privacy-fixture.jpg", mimeType: "image/jpeg", buffer: native });
  await page.getByRole("status").filter({ hasText: "This file may have limited detail" }).waitFor();
  assert.ok(await page.getByRole("button", { name: "Use this crop", exact: true }).isEnabled());
  await page.getByText("Image details", { exact: true }).click();
  await page.getByText(/Original image: 1700 × 1100 pixels/).waitFor();
  await page.screenshot({ path: path.join(artifacts, "native-1700-advisory.png") });
  await page.getByRole("button", { name: "Use this crop", exact: true }).click();
  await page.getByText(/1 waveforms? extracted at 500 Hz/).waitFor();
  assert.deepEqual(privacyDimensions.at(-1), [1360, 880], "crop retains native detail without upscaling");

  // Even a narrow crop can be assessed, while real service failures remain errors.
  const small = await sharp(synthetic).resize(800).png().toBuffer();
  for (mode of ["success", "analysis-unavailable", "digitizer-unavailable"]) {
    await page.locator('input[type="file"]').setInputFiles({ name: "small.png", mimeType: "image/png", buffer: small });
    await page.getByRole("status").filter({ hasText: "This file may have limited detail" }).waitFor();
    await page.getByRole("button", { name: "Use this crop", exact: true }).click();
    await page.getByRole("button", { name: "Run scan checks again", exact: true }).waitFor();
    await page.waitForFunction(() => ![...document.querySelectorAll("button")].find(button => button.textContent === "Run scan checks again")?.disabled);
    assert.ok(await page.getByRole("link", { name: "Save image", exact: true }).isVisible());
    if (mode === "success") await page.getByText(/Some lead labels could not be read/).waitFor();
    else await page.getByRole("alert").filter({ hasText: "could not finish" }).waitFor();
    await page.screenshot({ path: path.join(artifacts, `small-${mode}.png`), fullPage: true });
    if (mode !== "success") {
      const beforeRetry = checks;
      mode = "success";
      await page.getByRole("button", { name: "Run scan checks again", exact: true }).click();
      await page.getByText(/1 waveforms? extracted at 500 Hz/).waitFor();
      await page.waitForFunction(() => ![...document.querySelectorAll("button")].find(button => button.textContent === "Run scan checks again")?.disabled);
      await page.locator("main").getByRole("alert").waitFor({ state: "hidden" });
      assert.equal(checks, beforeRetry + 2);
      assert.equal(await page.locator("main").getByRole("alert").count(), 0);
    }
  }
  // Invalid image bytes remain a hard failure, independently of image detail advice.
  await page.locator('input[type="file"]').setInputFiles({ name: "broken.png", mimeType: "image/png", buffer: Buffer.from("not an image") });
  await page.getByRole("alert").filter({ hasText: "could not be displayed" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Use this crop", exact: true }).count(), 0);
  // An actual production request (no browser fixtures) must fail closed without configuration.
  const production = await context.request.post(`${url}/api/deidentify`, { multipart: { file: { name: "synthetic.png", mimeType: "image/png", buffer: synthetic } } });
  assert.equal(production.status(), 503);
  assert.equal((await production.json()).image, undefined);
  assert.deepEqual(errors, []);
  console.log(`${engine}: native 1700px advisory, narrow-image processing, crop geometry, canceled replacement, service recovery, redacted-only requests, privacy failure/retry, mocks, cancellation, invalid files, and production fail-closed checks passed.`);
  console.log(`Synthetic screenshots: ${artifacts}`);
} catch (error) {
  console.error("Browser failure state:", await page.locator("main").getByRole("alert").allTextContents());
  await page.screenshot({ path: path.join(artifacts, "failure.png"), fullPage: true }).catch(() => {});
  throw error;
} finally { await browser.close(); }
