// Tests the explicit development bypass and the production lockout.
// One scenario uses real analysis/digitization; other race/reset cases use controlled fixtures.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.argv[2] || 'playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : { channel: 'chrome' }) });
const png = await readFile('public/synthetic-ecgs/standard-12-lead.png');
const image = `data:image/png;base64,${png.toString('base64')}`;
const button = 'Testing only: continue without de-identification';
const notice = 'TESTING ONLY: de-identification was skipped. This scan may contain identifying information.';
const directory = path.resolve('.local-run/testing-bypass');
await mkdir(directory, { recursive: true });
async function choose(page) {
  await page.locator('input[type=file]').setInputFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: png });
  await page.getByRole('button', { name: 'Use this crop', exact: true }).waitFor();
}
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let privacyCalls = 0, processingCalls = 0;
  page.on('request', request => {
    if (/\/api\/(analyze|ecg\/digitize)$/.test(request.url())) {
      processingCalls++;
      assert.equal(request.headers()['x-ecg-testing-bypass'], '1');
    }
  });
  await page.route('**/api/deidentify', route => { privacyCalls++; return route.fulfill({ status: 422, json: { error: 'Synthetic privacy rejection for testing.' } }); });
  await page.goto('http://127.0.0.1:3000');
  await choose(page);
  await page.getByRole('button', { name: 'Use this crop', exact: true }).click();
  await page.getByRole('heading', { name: 'Image not sent on' }).waitFor();
  assert.equal(processingCalls, 0, 'Privacy failure must not bypass automatically');
  const pending = ['/api/analyze', '/api/ecg/digitize'].map(endpoint => page.waitForResponse(r => r.url().endsWith(endpoint), { timeout: 150000 }));
  await page.getByRole('button', { name: button, exact: true }).click();
  const responses = await Promise.all(pending);
  const analysis = await responses[0].json(), result = await responses[1].json();
  assert.equal(responses[0].status(), 200, JSON.stringify(analysis));
  assert.equal(responses[1].status(), 200, JSON.stringify(result));
  assert.equal(result.privacyStatus, 'testing_bypass');
  assert.ok(Object.keys(result.leads).length);
  assert.equal(privacyCalls, 1);
  await page.getByText(notice, { exact: true }).first().waitFor();
  assert.equal(await page.getByText('Identifying information removed.', { exact: true }).count(), 0);
  await page.getByRole('link', { name: 'Save test image (not de-identified)', exact: true }).waitFor();
  await page.screenshot({ path: path.join(directory, 'bypass-result.png') });
  const popup = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'View and edit all lead graphs (new tab)', exact: true }).click();
  const graphs = await popup;
  await graphs.getByText(notice, { exact: true }).waitFor();
  const cached = await page.request.post('http://127.0.0.1:3000/api/ecg/review', { data: { token: result.manualReview.token, action: 'read' } });
  assert.equal((await cached.json()).privacyStatus, 'testing_bypass');
  await graphs.getByRole('link', { name: 'Review and confirm saved results', exact: true }).click();
  await graphs.getByRole('checkbox').first().waitFor();
  for (const checkbox of await graphs.getByRole('checkbox').all()) await checkbox.check();
  await graphs.getByRole('button', { name: 'Confirm all lead assignments', exact: true }).click();
  const downloading = graphs.waitForEvent('download');
  await graphs.getByRole('link', { name: 'Download confirmed waveform values', exact: true }).click();
  const download = await downloading;
  assert.equal(JSON.parse(await readFile(await download.path(), 'utf8')).privacyStatus, 'testing_bypass');

  // Direct crop bypass and interrupting a slow privacy request.
  for (const scenario of ['crop', 'in-progress']) {
    const testPage = await browser.newPage();
    let deid = 0, downstream = 0;
    await testPage.route('**/api/deidentify', async route => {
      deid++;
      // Keep privacy pending until the user explicitly continues.
      await new Promise(resolve => setTimeout(resolve, 2000));
      await route.fulfill({ json: { status: 'redacted', image, regions_redacted: 1, mock: false } }).catch(() => {});
    });
    await testPage.route('**/api/analyze', route => { downstream++; return route.fulfill({ json: { status: 'passed', detected_leads: [], reasons: [], processed_image: image } }); });
    await testPage.route('**/api/ecg/digitize', route => { downstream++; return route.fulfill({ json: { leads: { I: [1, 2] }, samplingRateHz: 500, units: 'mV' } }); });
    await testPage.goto('http://127.0.0.1:3000');
    await choose(testPage);
    if (scenario === 'in-progress') {
      await testPage.getByRole('button', { name: 'Use this crop', exact: true }).click();
      await testPage.getByRole('heading', { name: 'Removing identifying information' }).waitFor();
    }
    await testPage.getByRole('button', { name: button, exact: true }).click();
    await testPage.getByRole('button', { name: 'Run scan checks again', exact: true }).waitFor();
    await testPage.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent === 'Run scan checks again' && !b.disabled));
    await testPage.waitForTimeout(2200); // Deliver the deliberately late privacy reply.
    assert.equal(deid, scenario === 'crop' ? 0 : 1);
    assert.equal(downstream, 2, 'No duplicate scans after late privacy reply');
    await testPage.getByText(notice, { exact: true }).first().waitFor();
    // Starting another scan must clear the bypass state.
    await choose(testPage);
    assert.equal(await testPage.getByText(notice, { exact: true }).count(), 0);
    await testPage.close();
  }
  // A real production build hides the button and rejects a forged bypass request.
  const production = await browser.newPage();
  await production.route('**/api/deidentify', route => route.fulfill({ status: 422, json: { error: 'Synthetic privacy rejection.' } }));
  await production.goto('http://127.0.0.1:3001');
  await choose(production);
  assert.equal(await production.getByRole('button', { name: button, exact: true }).count(), 0);
  await production.getByRole('button', { name: 'Use this crop', exact: true }).click();
  await production.getByRole('heading', { name: 'Image not sent on' }).waitFor();
  assert.equal(await production.getByRole('button', { name: button, exact: true }).count(), 0);
  for (const endpoint of ['analyze', 'ecg/digitize']) {
    const response = await production.request.post(`http://127.0.0.1:3001/api/${endpoint}`, {
      headers: { 'Content-Type': 'image/png', 'X-ECG-Testing-Bypass': '1' }, data: png,
    });
    assert.equal(response.status(), 403);
  }
  assert.deepEqual(errors, []);
  const summary = { explicitBlockedBypass: 'passed', directCropBypass: 'passed', inProgressCancellation: 'passed',
    realAnalysis: analysis.status, realDigitizerLeadCount: Object.keys(result.leads).length,
    testingMarkerAcrossTabsServerCacheAndExport: 'passed', productionUIAndAPILockout: 'passed' };
  await writeFile(path.join(directory, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary));
} finally { await browser.close(); }
