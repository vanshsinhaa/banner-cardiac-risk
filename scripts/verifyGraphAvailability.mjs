// Browser regression with controlled service fixtures; no model accuracy claims.
// BROWSER_EXECUTABLE=/path/to/browser node scripts/verifyGraphAvailability.mjs /path/to/playwright
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { chromium } = require(process.argv[2] || 'playwright');
const png = await readFile('public/synthetic-ecgs/standard-12-lead.png');
const image = `data:image/png;base64,${png.toString('base64')}`;
const names = ['I', 'II', 'III', 'aVR', 'aVL', 'aVF', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6'];
const result = { leads: Object.fromEntries(names.map(name => [name, [0, 0.2, -0.1, 0.5, 0]])),
  samplingRateHz: 500, units: 'mV', requiresReview: true,
  leadVerification: { status: 'needs_review', leads: Object.fromEntries(names.map(name => [name, { status: 'unverified' }])) } };
const browser = await chromium.launch({ headless: true,
  ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : { channel: 'chrome' }) });
try {
  const context = await browser.newContext();
  const errors = [];
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  const page = await context.newPage();
  await page.route('**/api/analyze', route => route.fulfill({ json: {
    status: 'needs_review', detected_leads: ['V1'], reasons: [], processed_image: image,
  } }));
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  let attempts = 0;
  await page.route('**/api/ecg/digitize', async route => {
    if (++attempts === 1) {
      await pending;
      await route.fulfill({ status: 503, json: { error: 'The waveform service is not running or cannot be reached.' } });
    } else await route.fulfill({ json: result });
  });
  await page.goto('http://127.0.0.1:3000');
  await page.locator('input[type=file]').setInputFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: png });
  await page.getByRole('button', { name: 'Testing only: continue without de-identification', exact: true }).click();
  const button = page.getByRole('button', { name: 'View and edit all lead graphs (new tab)', exact: true });
  const progress = page.getByRole('status').filter({ hasText: 'Scan processing is in progress' });
  await progress.waitFor();
  assert.equal(await button.isVisible(), true);
  assert.equal(await button.isDisabled(), true);
  release();
  await page.getByRole('status').filter({ hasText: 'Lead graphs are unavailable' }).waitFor();
  await progress.waitFor({ state: 'hidden' });
  assert.equal(await button.isVisible(), true);
  assert.equal(await button.isDisabled(), true);
  await page.getByRole('button', { name: 'Run scan checks again', exact: true }).click();
  await page.getByText('12 waveforms extracted at 500 Hz.', { exact: true }).waitFor();
  await page.getByRole('status').filter({ hasText: 'Extracted lead labels and graphs are ready to review.' }).waitFor();
  await progress.waitFor({ state: 'hidden' });
  assert.equal(await button.count(), 1);
  assert.equal(await button.isEnabled(), true);
  // Drop the first ready message; the editor must retry and still receive its data.
  await page.evaluate(() => {
    window.addEventListener('message', function dropFirst(event) {
      if (event.data?.type === 'ecg-graphs-ready') {
        event.stopImmediatePropagation();
        window.removeEventListener('message', dropFirst, true);
        window.__droppedGraphHandshake = true;
      }
    }, true);
  });
  const popup = page.waitForEvent('popup');
  await button.click();
  const editor = await popup;
  await editor.getByRole('heading', { name: 'Lead V1', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__droppedGraphHandshake), true);
  assert.equal(await editor.getByRole('region', { name: /^Lead .* graph$/ }).count(), 12);
  assert.equal(await editor.getByRole('img', { name: 'Extracted waveform, amplitude scaled for preview', exact: true }).count(), 12);
  assert.deepEqual(await editor.evaluate(() => [localStorage.length, sessionStorage.length]), [0, 0]);
  await editor.close();
  await page.evaluate(() => { window.open = () => null; });
  await button.click();
  await page.getByRole('alert').filter({ hasText: 'The browser blocked the new tab' }).waitFor();
  await page.evaluate(() => { window.open = () => { throw new DOMException('Blocked', 'SecurityError'); }; });
  await button.click();
  await page.getByRole('link', { name: 'Open lead graphs in this tab', exact: true }).click();
  await page.waitForURL('**/lead-graphs');
  await page.getByRole('heading', { name: 'All lead graphs', exact: true }).waitFor();
  await page.getByRole('heading', { name: 'Lead V1', exact: true }).waitFor();
  assert.equal(await page.getByRole('region', { name: /^Lead .* graph$/ }).count(), 12);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ loadingButton: 'passed', unavailableButton: 'passed', retryRecovery: 'passed',
    separateTab: 'passed', displayedLeads: 12, missedHandshakeRecovery: 'passed',
    popupNullAndException: 'passed', sameTabFallback: 'passed', serviceResponses: 'fixtures' }));
} finally { await browser.close(); }
