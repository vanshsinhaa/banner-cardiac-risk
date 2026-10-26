// Optional browser verification; no project dependency required.
// Start next dev, then: node scripts/verifyCapture.mjs <path-to-playwright-package> [chromium|webkit]
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import ts from "typescript";

const require = createRequire(import.meta.url);
const playwright = require(process.argv[2] || "playwright");
const engine = process.argv[3] || "chromium";
const artifacts = path.resolve(".next/capture-verification", engine);
await mkdir(artifacts, { recursive: true });
const browser = await playwright[engine].launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
const page = await context.newPage();
const errors = [];
page.on("pageerror", error => errors.push(error.message));
page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
page.setDefaultTimeout(15000);
const photos = [];
for (const name of await readdir("public/camera-ecgs")) {
  if (!name.endsWith(".jpeg")) continue;
  const file = path.resolve("public/camera-ecgs", name);
  if ((await stat(file)).size <= 2) continue;
  const info = await sharp(file).metadata();
  const rotated = (info.orientation ?? 1) >= 5;
  photos.push({ file, name, width: rotated ? info.height : info.width, height: rotated ? info.width : info.height });
}
const representative = [photos.find(p => p.width === 4624), photos.find(p => p.width === 4160), photos.find(p => p.name.includes("crumbles"))];
assert.ok(representative.every(Boolean), "Both photo sizes and a crumpled photo are available");
const near = (a, b, tolerance = .1) => assert.ok(Math.abs(a - b) < tolerance, `${a} differs from ${b}`);
const selection = () => page.locator("polygon").getAttribute("points").then(value => value.split(" ").map(pair => pair.split(",").map(Number)));
async function drag(name, dx, dy, during) {
  const box = await page.getByRole("button", { name, exact: true }).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 8 });
  if (during) await during();
  await page.mouse.up();
}
async function upload(photo) {
  await page.locator('input[type="file"]').setInputFiles(photo.file);
  await page.getByRole("button", { name: "Top left corner", exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector('button[data-kind="corner"]')?.disabled);
}

try {
  await page.goto(process.env.CAPTURE_TEST_URL || "http://localhost:3000");
  // Wait for hydration before Playwright hides input carets for screenshots.
  await page.waitForFunction(() => document.activeElement?.tagName === "H1");
  console.log(JSON.stringify({ engine, capabilities: await page.evaluate(() => ({
    worker: typeof Worker, bitmap: typeof createImageBitmap, offscreen: typeof OffscreenCanvas,
    convert: typeof OffscreenCanvas !== "undefined" && "convertToBlob" in OffscreenCanvas.prototype,
    compression: typeof CompressionStream,
  })) }));
  assert.equal(await page.locator('input[type="file"]').getAttribute("capture"), "environment");
  await page.screenshot({ path: path.join(artifacts, "idle.png") });
  await upload(representative[0]);
  assert.equal(await page.locator("button[data-kind]").count(), 4);
  const initial = await selection();
  const imgBox = await page.getByAltText("Original EKG photo").boundingBox();
  const photo = representative[0];
  const displayScale = imgBox.width / photo.width;
  const corner = page.getByRole("button", { name: "Top left corner", exact: true });
  await corner.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Shift+ArrowDown");
  const nudged = await selection();
  near(nudged[0][0] - initial[0][0], displayScale, .001);
  near(nudged[0][1] - initial[0][1], 10 * displayScale, .001);
  await drag("Top left corner", 12, 14, async () => {
    assert.equal(await page.locator("canvas").count(), 1);
    const box = await page.locator("canvas").boundingBox();
    assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= 390 && box.y + box.height <= 844);
    await page.screenshot({ path: path.join(artifacts, "loupe.png") });
  });
  assert.equal(await page.locator("canvas").count(), 0);
  const beforeMove = await selection();
  assert.deepEqual(beforeMove.slice(1), nudged.slice(1), "Moving one corner leaves the other three unchanged");
  await drag("Move entire selection", 3, 4);
  const afterMove = await selection();
  for (let i = 0; i < 4; i++) { near(afterMove[i][0] - beforeMove[i][0], 3); near(afterMove[i][1] - beforeMove[i][1], 4); }
  // Resize should preserve source coordinates and the selection's proportions.
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForFunction(() => {
    const svg = document.querySelector('svg[aria-label="Adjust EKG page boundary"]');
    return Math.abs(svg.viewBox.baseVal.width - svg.getBoundingClientRect().width) < 1;
  });
  await page.screenshot({ path: path.join(artifacts, "landscape.png") });
  assert.ok(await page.getByRole("button", { name: "Confirm crop" }).isVisible());
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => {
    const svg = document.querySelector('svg[aria-label="Adjust EKG page boundary"]');
    return Math.abs(svg.viewBox.baseVal.width - svg.getBoundingClientRect().width) < 1;
  });
  if (engine === "chromium") {
    const cdp = await context.newCDPSession(page);
    const box = await corner.boundingBox();
    const x = box.x + 22, y = box.y + 22;
    const beforeTouch = await selection();
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, id: 1 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + 10, y: y + 10, id: 1 }] });
    await page.locator("canvas").waitFor();
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await page.waitForFunction(() => !document.querySelector("canvas"));
    const afterTouch = await selection();
    near(afterTouch[0][0] - beforeTouch[0][0], 10);
    near(afterTouch[0][1] - beforeTouch[0][1], 10);
    assert.equal(await page.evaluate(() => window.scrollY), 0);
    await cdp.detach();
  }
  await page.screenshot({ path: path.join(artifacts, "crop.png") });
  const started = performance.now();
  await page.getByRole("button", { name: "Confirm crop" }).click();
  await page.getByRole("button", { name: "Processing…", exact: true }).waitFor();
  await page.getByAltText("Perspective-corrected EKG capture").waitFor({ timeout: 60000 });
  console.log(JSON.stringify({ engine, uiCaptureMs: Math.round(performance.now() - started) }));
  await page.getByText("1 image captured this session", { exact: true }).waitFor();
  assert.match(await page.getByRole("link", { name: "Save image" }).getAttribute("href"), /^data:image\/png;base64,/);
  await page.screenshot({ path: path.join(artifacts, "result.png") });
  await page.getByRole("button", { name: "Capture another" }).click();
  const small = await sharp(representative[0].file).resize(200).png().toBuffer();
  await page.locator('input[type="file"]').setInputFiles({ name: "small.png", mimeType: "image/png", buffer: small });
  const warning = page.locator("main").getByRole("alert");
  await warning.waitFor();
  assert.match(await warning.innerText(), /Move closer[\s\S]*Photo too small/);
  assert.ok(await page.getByRole("button", { name: "Confirm crop" }).isDisabled());
  await drag("Top left corner", 5, 5);
  assert.ok(await page.getByRole("button", { name: "Confirm crop" }).isDisabled());
  await page.getByRole("button", { name: "Retake" }).click();
  await page.getByText("1 image captured this session", { exact: true }).waitFor();
  await page.locator('input[type="file"]').setInputFiles([]);
  await page.getByRole("button", { name: "Take / choose photo" }).waitFor();
  await upload(representative[1]);
  // A failed encoder must return to the editable crop without incrementing count.
  await page.evaluate(() => {
    window.captureOriginalWorker = window.Worker;
    window.Worker = undefined; // Also exercise the older-browser fallback.
    window.captureOriginalToBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (callback) { callback(null); };
  });
  await page.getByRole("button", { name: "Confirm crop" }).click();
  await page.getByText("Could not process this crop. Please try again.", { exact: true }).waitFor({ timeout: 60000 });
  await page.getByText("1 image captured this session", { exact: true }).waitFor();
  assert.ok(await page.getByRole("button", { name: "Confirm crop" }).isEnabled());
  await page.evaluate(() => {
    window.Worker = window.captureOriginalWorker;
    HTMLCanvasElement.prototype.toBlob = window.captureOriginalToBlob;
  });
  await page.getByRole("button", { name: "Retake" }).click();
  // Compile the actual adapter and pure math into in-page modules for reproducible
  // full-photo timing and canvas crop comparison without adding a production route.
  const modulePaths = ["src/lib/cropCorners.ts", "src/lib/perspective.ts", "src/components/capture/warpPreview.ts", "src/components/capture/warpPreview.worker.ts", "src/components/capture/encodePng.ts"];
  const modules = [];
  for (const file of modulePaths) modules.push(ts.transpileModule(await readFile(file, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } }).outputText);
  await page.evaluate(async sources => {
    const url = text => URL.createObjectURL(new Blob([text], { type: "text/javascript" }));
    const cornersURL = url(sources[0]);
    const perspectiveURL = url(sources[1].replaceAll('"./cropCorners.ts"', JSON.stringify(cornersURL)));
    const encoderURL = url(sources[4]);
    const workerURL = url(sources[3].replaceAll('"../../lib/perspective.ts"', JSON.stringify(perspectiveURL)).replaceAll('"./encodePng.ts"', JSON.stringify(encoderURL)));
    const adapterURL = url(sources[2].replaceAll('"@/lib/perspective"', JSON.stringify(perspectiveURL)).replace('new URL("./warpPreview.worker.ts", import.meta.url)', `new URL(${JSON.stringify(workerURL)})`));
    window.captureVerification = { ...(await import(adapterURL)), ...(await import(perspectiveURL)) };
  }, modules);
  for (const sample of representative) {
    const result = await page.evaluate(async name => {
      const { warpPreview, outputCorners } = window.captureVerification;
      const image = new Image();
      image.src = `/camera-ecgs/${name}`;
      await image.decode();
      const width = image.naturalWidth, height = image.naturalHeight;
      let ticks = 0, lastTick = performance.now(), maxTickGap = 0;
      const timer = setInterval(() => {
        ticks++;
        const now = performance.now();
        maxTickGap = Math.max(maxTickGap, now - lastTick);
        lastTick = now;
      }, 16);
      const start = performance.now();
      const data = await warpPreview(image, outputCorners(width, height), new AbortController().signal);
      const ms = performance.now() - start;
      maxTickGap = Math.max(maxTickGap, performance.now() - lastTick);
      clearInterval(timer);
      const output = new Image(); output.src = data; await output.decode();
      const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(image, 0, 0);
      const expected = ctx.getImageData(0, 0, width, height).data;
      ctx.clearRect(0, 0, width, height); ctx.drawImage(output, 0, 0);
      const actual = ctx.getImageData(0, 0, width, height).data;
      let differences = 0;
      for (let i = 0; i < expected.length; i++) if (expected[i] !== actual[i]) differences++;
      return { name, width, height, outputWidth: output.naturalWidth, outputHeight: output.naturalHeight, warpAndPngMs: Math.round(ms), eventLoopTicks: ticks, maxEventLoopGapMs: Math.round(maxTickGap), differingBytes: differences };
    }, sample.name);
    console.log(JSON.stringify({ engine, ...result }));
    assert.equal(result.outputWidth, result.width);
    assert.equal(result.outputHeight, result.height);
    assert.equal(result.differingBytes, 0);
    assert.ok(result.eventLoopTicks > 2, "UI event loop must remain active during the warp");
  }
  assert.deepEqual(errors, []);
  console.log(`${engine}: capture interaction, keyboard, loupe, resolution gate, PNG, counter, cancellation, processing failure, and full-photo pixel checks passed. ${photos.length} valid photos; 2-byte files ignored.`);
} finally {
  await browser.close();
}
