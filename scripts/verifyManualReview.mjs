// Browser integration: real digitizer result/session and real correction endpoint.
// Privacy/readability replies are isolated synthetic fixtures; this does not test those engines.
// node scripts/verifyManualReview.mjs /path/to/playwright /tmp/manual-real-result.json
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.argv[2] || 'playwright');
const initial = JSON.parse(await readFile(process.argv[3], 'utf8'));
assert.ok(initial.manualReview?.token, 'Generate a fresh real digitizer session first');
const png = await readFile('public/synthetic-ecgs/standard-12-lead.png');
const dataUrl = `data:image/png;base64,${png.toString('base64')}`;
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : { channel: 'chrome' }) });
const output = path.resolve('.local-run/manual-review');
await mkdir(output, { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/deidentify', route => route.fulfill({ json: { status: 'redacted', image: dataUrl, regions_redacted: 4, mock: false } }));
  await page.route('**/api/analyze', route => route.fulfill({ json: { status: 'needs_review', detected_leads: [], reasons: ['synthetic_browser_fixture'], processed_image: dataUrl } }));
  await page.route('**/api/ecg/digitize', route => route.fulfill({ json: initial }));
  await page.goto('http://127.0.0.1:3000');
  await page.locator('input[type=file]').setInputFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: png });
  await page.getByRole('button', { name: 'Use this crop', exact: true }).click();
  await page.getByRole('link', { name: 'Edit unrecognized leads', exact: true }).click();
  await page.waitForURL('**/review-leads');
  await page.getByRole('button', { name: 'Process labels and waveform regions', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Enter a unique valid label' }).waitFor();
  // Known printed positions on the model-aligned synthetic fixture (1200 x 662).
  for (const [index, name, labelBox, waveformBox] of [
    [1, 'I', [38, 48, 65, 77], [40, 75, 315, 145]],
    [2, 'II', [38, 195, 65, 225], [40, 225, 315, 295]],
    [3, 'III', [38, 342, 70, 374], [40, 375, 315, 440]],
  ]) {
    await page.getByLabel(`Printed lead label ${index}`, { exact: true }).fill(name);
    for (const [region, values] of [['label characters', labelBox], ['waveform', waveformBox]]) {
      for (const [coordinate, value] of ['Left', 'Top', 'Right', 'Bottom'].map((v, i) => [v, values[i]])) {
        await page.getByRole('spinbutton', { name: `Lead ${index} ${region} ${coordinate}`, exact: true }).fill(String(value));
      }
    }
  }
  // Exercise drag coordinates as well as keyboard-accessible numeric fields.
  const selector = page.getByRole('img', { name: 'Lead 1 label characters', exact: true });
  await selector.scrollIntoViewIfNeeded();
  const rect = await selector.boundingBox();
  await page.mouse.move(rect.x + 38 / 1200 * rect.width, rect.y + 48 / 662 * rect.height);
  await page.mouse.down();
  await page.mouse.move(rect.x + 65 / 1200 * rect.width, rect.y + 77 / 662 * rect.height, { steps: 5 });
  await page.mouse.up();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(output, 'region-editor.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Mobile selectors should not overflow');
  await page.screenshot({ path: path.join(output, 'mobile-editor.png') });
  await page.setViewportSize({ width: 1280, height: 1000 });
  const pending = page.waitForResponse(response => response.url().endsWith('/api/ecg/review'), { timeout: 130000 });
  await page.getByRole('button', { name: 'Process labels and waveform regions', exact: true }).click();
  const response = await pending;
  const result = await response.json();
  assert.equal(response.status(), 200, JSON.stringify(result));
  await page.waitForURL('**/review-leads/result');
  for (const name of ['I', 'II', 'III']) {
    assert.equal(result.leadVerification.leads[name].status, 'human_corrected');
    assert.equal(result.leads[name].length, 5000);
    assert.notDeepEqual(result.leads[name], initial.leads[name], 'Must re-extract selected regions, not just rename arrays');
  }
  for (const name of Object.keys(initial.leads).filter(name => !['I', 'II', 'III'].includes(name))) {
    assert.deepEqual(result.leads[name], initial.leads[name], `Preserve agreed ${name}`);
  }
  assert.equal(result.samplingRateHz, initial.samplingRateHz);
  const confirm = page.getByRole('button', { name: 'Confirm all lead assignments', exact: true });
  assert.equal(await confirm.isDisabled(), true);
  for (const checkbox of await page.getByRole('checkbox').all()) await checkbox.check();
  await confirm.click();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download confirmed waveform values', exact: true }).click();
  const download = await downloadEvent;
  const downloaded = JSON.parse(await readFile(await download.path(), 'utf8'));
  assert.equal(downloaded.userReview.status, 'confirmed');
  assert.equal(downloaded.manualReview, undefined, 'Never export review tokens or full scan pixels');
  assert.deepEqual(downloaded.leads, result.leads);
  await page.screenshot({ path: path.join(output, 'confirmed-result.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Mobile result should not overflow');
  await page.getByRole('link', { name: 'Edit unrecognized leads', exact: true }).click();
  await page.getByRole('button', { name: 'Process labels and waveform regions', exact: true }).waitFor();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Mobile editor should not overflow');
  await page.reload();
  await page.getByRole('heading', { name: 'No active scan to edit' }).waitFor();
  assert.deepEqual(errors, []);
  const summary = { realNeuralDigitization: true, realServerRegionExtraction: true, privacyAndReadability: 'synthetic fixtures',
    correctedLeads: ['I', 'II', 'III'], preservedLeads: 9, finalConfirmationAndDownload: 'passed', mobileOverflow: false, refreshRecovery: 'passed' };
  await writeFile(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary));
} finally { await browser.close(); }
