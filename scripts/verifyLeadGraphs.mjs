// Real model result + real graph-correction endpoint; privacy/readability are fixtures.
// node scripts/verifyLeadGraphs.mjs /path/to/playwright /tmp/lead-graphs-initial.json
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.argv[2] || 'playwright');
const initial = JSON.parse(await readFile(process.argv[3], 'utf8'));
assert.equal(initial.leadVerification.leads.V1.status, 'verified');
const png = await readFile('public/synthetic-ecgs/standard-12-lead.png');
const image = `data:image/png;base64,${png.toString('base64')}`;
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : { channel: 'chrome' }) });
const directory = path.resolve('.local-run/lead-graphs');
await mkdir(directory, { recursive: true });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const errors = [];
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  const page = await context.newPage();
  await page.route('**/api/deidentify', route => route.fulfill({ json: { status: 'redacted', image, regions_redacted: 4, mock: false } }));
  await page.route('**/api/analyze', route => route.fulfill({ json: { status: 'needs_review', detected_leads: [], reasons: ['synthetic_browser_fixture'], processed_image: image } }));
  await page.route('**/api/ecg/digitize', route => route.fulfill({ json: initial }));
  await page.goto('http://127.0.0.1:3000');
  await page.locator('input[type=file]').setInputFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: png });
  await page.getByRole('button', { name: 'Use this crop', exact: true }).click();
  await page.getByRole('checkbox').first().check();
  async function openEditor() {
    const popup = page.waitForEvent('popup');
    await page.getByRole('button', { name: 'View and edit all lead graphs (new tab)', exact: true }).click();
    const editor = await popup;
    await editor.getByRole('heading', { name: 'Lead V1', exact: true }).waitFor();
    assert.match(editor.url(), /\/lead-graphs#/);
    assert.ok(!editor.url().includes(initial.manualReview.token));
    assert.equal(await editor.getByRole('region', { name: /^Lead .* graph$/ }).count(), 12);
    assert.equal(await editor.getByRole('img', { name: 'Extracted waveform, amplitude scaled for preview', exact: true }).count(), 12);
    assert.deepEqual(await editor.evaluate(() => [localStorage.length, sessionStorage.length]), [0, 0]);
    return editor;
  }
  const editor = await openEditor();
  const staleEditor = await openEditor();
  async function selectRegion(tab, left = 620) {
    await tab.getByText('Adjust waveform region for V1', { exact: true }).click();
    for (const [label, value] of [['Left', left], ['Top', 75], ['Right', 875], ['Bottom', 145]]) {
      await tab.getByRole('spinbutton', { name: `Lead V1 waveform region ${label}`, exact: true }).fill(String(value));
    }
  }
  await selectRegion(editor);
  await selectRegion(staleEditor, 630);
  // An invalid selection is rejected locally and does not change saved results.
  await editor.getByRole('spinbutton', { name: 'Lead V1 waveform region Right', exact: true }).fill('625');
  await editor.getByRole('button', { name: 'Save graph regions', exact: true }).click();
  await editor.getByRole('alert').filter({ hasText: 'at least 30 pixels' }).waitFor();
  await editor.getByRole('spinbutton', { name: 'Lead V1 waveform region Right', exact: true }).fill('875');
  await editor.getByRole('heading', { name: 'Lead V1', exact: true }).scrollIntoViewIfNeeded();
  await editor.screenshot({ path: path.join(directory, 'graph-region-editor.png') });
  const pending = editor.waitForResponse(r => r.url().endsWith('/api/ecg/review'), { timeout: 130000 });
  await editor.getByRole('button', { name: 'Save graph regions', exact: true }).click();
  const response = await pending, result = await response.json();
  assert.equal(response.status(), 200, JSON.stringify(result));
  assert.equal(result.manualReview.revision, initial.manualReview.revision + 1);
  assert.equal(result.leadVerification.leads.V1.status, 'human_corrected');
  assert.equal(result.leadVerification.leads.V1.reason, 'user_waveform_region');
  assert.notDeepEqual(result.leads.V1, initial.leads.V1);
  for (const name of Object.keys(initial.leads).filter(name => name !== 'V1')) assert.deepEqual(result.leads[name], initial.leads[name]);
  assert.deepEqual(Object.keys(result.leads).sort(), Object.keys(initial.leads).sort());
  assert.equal(result.samplingRateHz, initial.samplingRateHz);
  await page.getByText('Waveform assignment adjusted by you and processed by the server.', { exact: true }).waitFor();
  assert.equal(await page.locator('input[type=checkbox]:checked').count(), 0, 'Original tab must clear stale confirmations');
  // Simultaneous editing cannot silently overwrite a newer result.
  await staleEditor.getByRole('button', { name: 'Save graph regions', exact: true }).click();
  await staleEditor.getByRole('button', { name: 'Reload latest result and discard selections', exact: true }).click();
  await staleEditor.getByRole('status').filter({ hasText: 'Saved graph changes' }).waitFor();
  assert.equal(await staleEditor.getByRole('button', { name: 'Save graph regions', exact: true }).isDisabled(), true);
  await staleEditor.reload();
  await staleEditor.getByRole('heading', { name: 'Lead V1', exact: true }).waitFor();
  await staleEditor.getByRole('status').filter({ hasText: 'Saved graph changes' }).waitFor();
  await editor.setViewportSize({ width: 390, height: 844 });
  await editor.getByText('Adjust waveform region for V1', { exact: true }).click();
  assert.ok(await editor.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await editor.getByRole('heading', { name: 'Lead V1', exact: true }).scrollIntoViewIfNeeded();
  await editor.screenshot({ path: path.join(directory, 'mobile-graph-editor.png') });
  await editor.getByRole('link', { name: 'Review and confirm saved results', exact: true }).click();
  const confirm = editor.getByRole('button', { name: 'Confirm all lead assignments', exact: true });
  assert.equal(await confirm.isDisabled(), true);
  for (const checkbox of await editor.getByRole('checkbox').all()) await checkbox.check();
  await confirm.click();
  const downloading = editor.waitForEvent('download');
  await editor.getByRole('link', { name: 'Download confirmed waveform values', exact: true }).click();
  const download = await downloading;
  const exported = JSON.parse(await readFile(await download.path(), 'utf8'));
  assert.deepEqual(exported.leads, result.leads);
  assert.equal(exported.manualReview, undefined);
  assert.equal(exported.userReview.status, 'confirmed');
  // Direct visits and popup blockers have recovery UI.
  const direct = await context.newPage();
  await direct.goto('http://127.0.0.1:3000/lead-graphs');
  await direct.getByRole('status').filter({ hasText: 'No scan is available' }).waitFor();
  await page.evaluate(() => { window.open = () => null; });
  await page.getByRole('button', { name: 'View and edit all lead graphs (new tab)', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Allow pop-ups' }).waitFor();
  await page.getByRole('link', { name: 'Open lead graphs in this tab', exact: true }).click();
  await page.waitForURL('**/lead-graphs');
  await page.getByRole('heading', { name: 'All lead graphs', exact: true }).waitFor();
  await page.getByRole('heading', { name: 'Lead V1', exact: true }).waitFor();
  assert.equal(await page.getByRole('region', { name: /^Lead .* graph$/ }).count(), 12);
  assert.deepEqual(errors, []);
  const summary = { separateTab: 'passed', displayedLeads: 12, editedPreviouslyVerifiedLead: 'V1', unchangedLeads: 11,
    originalTabSync: 'passed', staleEditsAndReload: 'passed', finalConfirmationAndDownload: 'passed', mobileLayout: 'passed',
    popupAndDirectVisitRecovery: 'passed', realServerExtraction: true, privacyAndReadability: 'synthetic fixtures' };
  await writeFile(path.join(directory, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary));
} finally { await browser.close(); }
