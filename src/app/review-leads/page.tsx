'use client';

import { useState } from 'react';
import TestingBypassNotice from '@/components/TestingBypassNotice';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useReviewSession } from '@/components/ReviewSession';
import RegionSelector from '@/components/RegionSelector';
import styles from '@/components/ManualReview.module.css';
import { ECG_LEADS, isEcgDigitizationResult, type LeadCorrection, type RegionBox } from '@/lib/ecg-digitizer/types';

type Draft = { id: string; source: string | null; label: string; labelBox?: RegionBox; waveformBox?: RegionBox };

export default function ReviewLeadsPage() {
  const { snapshot, setSnapshot } = useReviewSession();
  const router = useRouter();
  const review = snapshot?.result.manualReview;
  const [drafts, setDrafts] = useState<Draft[]>(() => snapshot ? Object.keys(snapshot.result.leads)
    .filter(name => !['verified', 'human_corrected'].includes(snapshot.result.leadVerification?.leads[name]?.status ?? ''))
    .map(name => ({ id: name, source: name, label: '', labelBox: review?.regions[name]?.box, waveformBox: review?.regions[name]?.waveformBox })) : []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!snapshot || !review) return <main style={{ padding: 32 }}><h1>No active scan to edit</h1><p>Open this page from a scan result. Refreshing the page clears the in-memory review.</p><Link href="/">Upload a scan</Link></main>;
  const active = snapshot;
  function patch(id: string, value: Partial<Draft>) { setDrafts(current => current.map(draft => draft.id === id ? { ...draft, ...value } : draft)); }
  async function submit() {
    setError(null);
    const corrections: LeadCorrection[] = [];
    const labels = new Set<string>();
    for (const draft of drafts) {
      const label = ECG_LEADS.find(name => name.toUpperCase() === draft.label.trim().toUpperCase());
      if (!label || labels.has(label) || !draft.labelBox || !draft.waveformBox ||
          [draft.labelBox, draft.waveformBox].some(b => b[2] <= b[0] || b[3] <= b[1])) {
        setError('Enter a unique valid label and select both a label region and waveform region for every correction.'); return;
      }
      labels.add(label);
      corrections.push({ source: draft.source, label, labelBox: draft.labelBox, waveformBox: draft.waveformBox });
    }
    setBusy(true);
    try {
      const response = await fetch('/api/ecg/review', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: review!.token, revision: review!.revision, corrections }), signal: AbortSignal.timeout(120_000) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to process these regions.');
      if (!isEcgDigitizationResult(result)) throw new Error('The server returned invalid waveform data.');
      setSnapshot({ ...active, result });
      router.push('/review-leads/result');
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to process these regions.'); }
    finally { setBusy(false); }
  }
  return <main className={styles.page}>
    <h1>Edit unrecognized leads</h1>
    <TestingBypassNotice status={snapshot.result.privacyStatus} />
    <p>Read the printed lead characters, enter their label, and select the corresponding waveform. Include one waveform only, with its full height and recording width. The server will extract values from your selected region.</p>
    <p>Leads confirmed by layout and OCR are retained. Review sessions last up to 20 minutes and may expire sooner if the service restarts or is busy. Keep this tab open.</p>
    <p><Link href="/review-leads/result" aria-disabled={busy} onClick={event => { if (busy) event.preventDefault(); }}>Cancel and return to results</Link></p>
    <datalist id="manual-lead-labels">{ECG_LEADS.map(name => <option key={name} value={name} />)}</datalist>
    {drafts.map((draft, index) => <section key={draft.id} className={styles.card}>
      <h2>{draft.source ? `Unconfirmed assignment: ${draft.source}` : `Additional lead ${index+1}`}</h2>
      <p>Tesseract: {draft.source ? active.result.leadVerification?.leads[draft.source]?.observedLabels?.join(', ') || 'No confirmed label' : 'Manually located lead'}.</p>
      <label>Printed lead label <input aria-label={`Printed lead label ${index+1}`} list="manual-lead-labels" maxLength={3} value={draft.label} disabled={busy} onChange={e => patch(draft.id, { label: e.target.value })} /></label>
      <RegionSelector title={`Lead ${index+1} label characters`} {...review} value={draft.labelBox} disabled={busy} onChange={labelBox => patch(draft.id, { labelBox })} />
      <RegionSelector title={`Lead ${index+1} waveform`} {...review} value={draft.waveformBox} disabled={busy} onChange={waveformBox => patch(draft.id, { waveformBox })} />
      {!draft.source && <button disabled={busy} onClick={() => setDrafts(drafts.filter(value => value.id !== draft.id))}>Remove additional lead</button>}
    </section>)}
    <button disabled={busy || Object.keys(active.result.leads).length + drafts.filter(d => !d.source).length >= 12}
      onClick={() => setDrafts([...drafts, { id: crypto.randomUUID(), source: null, label: '' }])}>Add a missing lead</button>
    {error && <p role="alert">{error}</p>}
    <p><button disabled={busy || !drafts.length} onClick={submit}>{busy ? 'Processing selected waveforms…' : 'Process labels and waveform regions'}</button></p>
    {busy && <p role="status">Processing your regions on the server. Keep this page open.</p>}
  </main>;
}
