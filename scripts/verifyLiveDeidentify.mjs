// Actual browser -> Next.js -> metadata -> OCR flow. No intercepted responses.
// node scripts/verifyLiveDeidentify.mjs /path/to/playwright
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require(process.argv[2] || "playwright");
const artifacts = path.resolve(".next/deid-evidence");
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  await page.goto(process.env.CAPTURE_TEST_URL || "http://127.0.0.1:3107");
  async function crop(name) {
    await page.locator('input[type="file"]').setInputFiles(path.resolve("ocr/samples", name));
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
  }
  await crop("clean_1.jpg");
  const successReply = page.waitForResponse(response => response.url().endsWith("/api/deidentify"), { timeout: 65000 });
  await page.getByRole("button", { name: "Use this crop", exact: true }).click();
  const response = await successReply;
  assert.equal(response.status(), 200);
  const data = await response.json();
  assert.equal(data.status, "redacted");
  assert.ok(!data.mock && data.regions_redacted >= 4);
  await page.getByRole("link", { name: "Save image", exact: true }).waitFor();
  await page.getByText("Identifying information removed.", { exact: true }).waitFor();
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("link", { name: "Save image", exact: true }).click();
  await (await downloadEvent).saveAs(path.join(artifacts, "browser-synthetic-redacted.png"));
  await page.screenshot({ path: path.join(artifacts, "live-privacy-success.png"), fullPage: true });

  await crop("very_blurry_1.jpg");
  let downstream = 0;
  page.on("request", request => {
    if (/\/api\/(analyze|ecg\/digitize)$/.test(request.url())) downstream++;
  });
  const blockedReply = page.waitForResponse(reply => reply.url().endsWith("/api/deidentify"), { timeout: 65000 });
  await page.getByRole("button", { name: "Use this crop", exact: true }).click();
  const blocked = await blockedReply;
  assert.ok(!blocked.ok());
  assert.equal((await blocked.json()).image, undefined);
  await page.getByText("De-identification was not confirmed.", { exact: true }).waitFor();
  assert.equal(await page.getByRole("link", { name: "Save image", exact: true }).count(), 0);
  assert.equal(downstream, 0);
  await page.screenshot({ path: path.join(artifacts, "live-privacy-blocked.png"), fullPage: true });
  console.log("Real Chromium privacy flow passed: verified synthetic output and save; blurred input blocked without downstream requests.");
} finally {
  await browser.close();
}
