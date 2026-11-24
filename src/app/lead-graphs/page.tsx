'use client';

import { useEffect, useState } from 'react';
import TestingBypassNotice from '@/components/TestingBypassNotice';
import Link from 'next/link';
import { useReviewSession, type ReviewSnapshot } from '@/components/ReviewSession';
import Trace from '@/components/LeadTrace';
import RegionSelector from '@/components/RegionSelector';
import styles from '@/components/ManualReview.module.css';
import { ECG_LEADS, isEcgDigitizationResult, type EcgDigitizationResult, type RegionBox } from '@/lib/ecg-digitizer/types';

export default function LeadGraphsPage() {
  const { snapshot, setSnapshot } = useReviewSession();
  const [waiting, setWaiting] = useState(true);
  useEffect(() => {
    const id = window.location.hash.slice(1);
    let received = false;
    function receive(event: MessageEvent) {
      if (event.origin !== window.location.origin || event.source !== window.opener ||
          event.data?.type !== 'ecg-graphs-snapshot' || event.data.id !== id ||
          !isEcgDigitizationResult(event.data.snapshot?.result)) return;
      received = true;
      setSnapshot(event.data.snapshot);
      setWaiting(false);
    }
    window.addEventListener('message', receive);
    function requestSnapshot() {
      if (!received && id && window.opener && !window.opener.closed) window.opener.postMessage({ type: 'ecg-graphs-ready', id }, window.location.origin);
    }
    requestSnapshot();
    // Retry the handshake if the parent was still hydrating or a message was missed.
    const retry = window.setInterval(requestSnapshot, 500);
    const timer = window.setTimeout(() => { window.clearInterval(retry); setWaiting(false); }, 10000);
    return () => { window.removeEventListener('message', receive); window.clearTimeout(timer); window.clearInterval(retry); };
  }, [setSnapshot]);
  if (!snapshot) return <main className={styles.page}><h1>All lead graphs</h1>
    <p role="status">{waiting ? 'Opening your scan results…' : 'No scan is available in this tab. Open this view using the button on your scan results page.'}</p><Link href="/">Upload a scan</Link></main>;
  return <GraphEditor key={`${snapshot.result.manualReview?.token ?? 'view'}:${snapshot.result.manualReview?.revision ?? 0}`} snapshot={snapshot}
    onResult={result => {
      setSnapshot({ ...snapshot, result });
      if (window.opener) window.opener.postMessage({ type: 'ecg-graphs-updated', id: window.location.hash.slice(1), result }, window.location.origin);
    }} />;
}

function GraphEditor({ snapshot, onResult }: { snapshot: ReviewSnapshot; onResult: (result: EcgDigitizationResult) => void }) {
  const result = snapshot.result, review = result.manualReview;
  const names = ECG_LEADS.filter(name => result.leads[name]);
  const [drafts, setDrafts] = useState<Record<string, RegionBox>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const changed = Object.keys(drafts);
  function change(name: string, value: RegionBox) {
    setDrafts(current => {
      const next = { ...current };
      if (JSON.stringify(value) === JSON.stringify(review?.regions[name]?.waveformBox)) delete next[name];
      else next[name] = value;
      return next;
    });
    setError(null);
  }
  async function submit(reload = false) {
    if (!review) return;
    if (!reload && changed.some(name => {
      const b = drafts[name];
      return b.some(v => !Number.isFinite(v)) || b[0] < 0 || b[1] < 0 || b[2] > review.width || b[3] > review.height || b[2]-b[0] < 30 || b[3]-b[1] < 8;
    })) { setError('Select a region inside the scan, at least 30 pixels wide and 8 pixels tall, for each changed lead.'); return; }
    setBusy(true); setError(null);
    try {
      const response = await fetch('/api/ecg/review', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: review.token, revision: review.revision,
          ...(reload ? { action: 'read' } : { mode: 'waveform_regions', corrections: changed.map(name => ({ source: name, label: name, waveformBox: drafts[name] })) }) }),
        signal: AbortSignal.timeout(120_000) });
      const updated = await response.json();
      if (!response.ok) { setStale(response.status === 409); throw new Error(updated.error || 'Unable to update these graphs.'); }
      if (!isEcgDigitizationResult(updated) || updated.manualReview?.token !== review.token) throw new Error('The server returned an invalid result.');
      onResult(updated);
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to update these graphs.'); }
    finally { setBusy(false); }
  }
  return <main className={styles.page}>
    <h1>All lead graphs</h1>
    <TestingBypassNotice status={result.privacyStatus} />
    <p>View all {names.length} extracted leads below. Open a lead’s region editor to adjust which portion of the scan belongs to that label, including leads already confirmed by OCR.</p>
    <p>Labels stay unchanged. Select one waveform with its full height; changes are saved only when you click <strong>Save graph regions</strong>. Unedited graphs retain their existing values.</p>
    {review ? <p>Keep the original results tab open to receive updates there. Sessions last up to 20 minutes; restarting the service or opening several scans can expire them sooner.</p> : <p role="alert">{result.manualReviewUnavailable || 'Graph editing is unavailable for this result. Upload the scan again to create an editing session.'}</p>}
    {!!result.manualCorrections?.length && <p role="status">Saved graph changes are shown below. Confirm the updated leads before downloading.</p>}
    <p><Link href="/review-leads/result" onClick={event => {
      if (busy || (changed.length > 0 && !window.confirm('Discard unsaved region selections and view saved results?'))) event.preventDefault();
    }}>Review and confirm saved results</Link></p>
    <p>{result.samplingRateHz} samples per second · values in mV · graphs scaled individually for preview</p>
    <div className={styles.graphToolbar}>
      <span role="status">{changed.length} {changed.length === 1 ? 'lead' : 'leads'} changed</span>
      <button disabled={!review || busy || !changed.length || stale} onClick={() => submit()}>{busy ? 'Processing waveforms…' : 'Save graph regions'}</button>
      <button disabled={busy || !changed.length} onClick={() => { setDrafts({}); setError(null); }}>Discard unsaved changes</button>
    </div>
    {error && <p role="alert">{error}</p>}
    {stale && <p>Another tab saved a newer result. <button disabled={busy} onClick={() => submit(true)}>Reload latest result and discard selections</button></p>}
    {names.map(name => <section key={name} className={styles.card} aria-label={`Lead ${name} graph`}>
      <h2>Lead {name}</h2>
      <p>{result.leadVerification?.leads[name]?.status === 'verified' ? 'Layout and OCR agreed on this label. Its waveform region can still be adjusted.' :
        result.leadVerification?.leads[name]?.status === 'human_corrected' ? 'Waveform assignment adjusted by a person.' : 'This assignment still needs your confirmation.'}</p>
      <Trace samples={result.leads[name]!} />
      {result.leadPreviews?.[name] && <details><summary>View current source image for {name}</summary>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={result.leadPreviews[name]} alt={`Current waveform source for ${name}`} style={{ maxWidth: '100%' }} />
      </details>}
      {review && <details><summary>Adjust waveform region for {name}{drafts[name] ? ' — unsaved changes' : ''}</summary>
        <RegionSelector title={`Lead ${name} waveform region`} {...review} value={drafts[name] ?? review.regions[name]?.waveformBox}
          disabled={busy} onChange={value => change(name, value)} />
        <button disabled={busy || !drafts[name]} onClick={() => setDrafts(current => { const next = { ...current }; delete next[name]; return next; })}>Reset {name} region</button>
      </details>}
    </section>)}
  </main>;
}
