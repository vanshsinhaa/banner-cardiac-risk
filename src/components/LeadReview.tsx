"use client";

import { useEffect, useState } from 'react';
import { ECG_LEADS, type EcgDigitizationResult } from '@/lib/ecg-digitizer/types';
import { confirmLeadAssignments } from '@/lib/ecg-digitizer/review';
import styles from './EkgCaptureScreen.module.css';

function Trace({ samples }: { samples: (number | null)[] }) {
  const finite = samples.filter((v): v is number => v !== null);
  const min = Math.min(...finite), max = Math.max(...finite);
  let path = '', gap = true;
  samples.forEach((value, i) => {
    if (value === null) { gap = true; return; }
    path += `${gap ? 'M' : 'L'}${(i * 600 / Math.max(1, samples.length - 1)).toFixed(2)},${(75 - (value - min) * 65 / (max - min || 1)).toFixed(2)} `;
    gap = false;
  });
  return <svg viewBox="0 0 600 85" role="img" aria-label="Extracted waveform, amplitude scaled for preview" style={{ width: '100%', background: '#fff' }}><path d={path} fill="none" stroke="#164e63" strokeWidth="1" /></svg>;
}

export default function LeadReview({ result }: { result: EcgDigitizationResult }) {
  const [editing, setEditing] = useState(false);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
  const [output, setOutput] = useState<EcgDigitizationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [download, setDownload] = useState<string | null>(null);
  useEffect(() => () => { if (download) URL.revokeObjectURL(download); }, [download]);
  const names = Object.keys(result.leads);
  const needsReview = names.filter(name => result.leadVerification?.leads[name]?.status !== 'verified');
  function apply() {
    try {
      const next = confirmLeadAssignments(result, Object.fromEntries(names.map(name => [name, labels[name] ?? name])));
      setLabels(next.userReview!.assignments);
      setEditing(false);
      setConfirmed({});
      setOutput(null);
      setError(null);
    } catch (err) { setError((err as Error).message); }
  }
  return <section aria-label="Review lead assignments">
    <h3>Confirm recognized leads</h3>
    {!output && result.layoutRecheck?.attempted && <p>A layout recheck was requested. {result.layoutRecheck.status === 'accepted' ? 'The alternative passed.' : 'No alternative was fully verified. Please review the remaining assignments.'}</p>}
    {!output && needsReview.length > 0 && <p>{needsReview.length} assignments need manual review.</p>}
    <button type="button" className={styles.secondary} onClick={() => { setEditing(true); setOutput(null); setConfirmed({}); }}>{needsReview.length ? 'Review conflicting leads' : 'Edit lead labels'}</button>
    {editing && <p>Read each printed label in its source image and enter it below. Correct both labels when leads are swapped.</p>}
    <datalist id="ecg-lead-options">{ECG_LEADS.map(name => <option key={name} value={name} />)}</datalist>
    {names.map(name => {
      const check = result.leadVerification?.leads[name];
      const label = labels[name] ?? name;
      const preview = result.leadPreviews?.[name];
      return <article key={name} style={{ border: '1px solid #b6c5ce', borderRadius: 8, padding: 12, marginBlock: 12 }}>
        <h4>Lead {label}</h4>
        <p>Model: {name}. Tesseract: {check?.observedLabels?.join(', ') || 'unconfirmed'}. {check?.status === 'verified' ? 'Labels agree.' : 'Machine checks did not agree.'}</p>
        {preview?.startsWith('data:image/png;base64,') ?
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt={`Printed label and source waveform assigned to ${name}`} style={{ maxWidth: '100%' }} /> :
          <p>Source region unavailable. Retry the scan if the assignment is incorrect.</p>}
        <Trace samples={result.leads[name as keyof typeof result.leads]!} />
        {editing ? <label>Printed lead label for model assignment {name}{' '}
          <input list="ecg-lead-options" value={label} maxLength={3} onChange={event => setLabels({ ...labels, [name]: event.target.value })} />
        </label> : <label><input type="checkbox" checked={!!confirmed[name]} disabled={!!output} onChange={event => setConfirmed({ ...confirmed, [name]: event.target.checked })} /> I confirm this waveform is lead {label}</label>}
      </article>;
    })}
    {error && <p role="alert">{error}</p>}
    {editing ? <button className={styles.primary} onClick={apply}>Apply labels and review all leads</button> :
      <button className={styles.primary} disabled={!!output || !names.every(name => confirmed[name])} onClick={() => {
        try {
          const reviewed = confirmLeadAssignments(result, Object.fromEntries(names.map(name => [name, labels[name] ?? name])));
          setOutput(reviewed);
          setDownload(URL.createObjectURL(new Blob([JSON.stringify(reviewed)], { type: 'application/json' })));
          setError(null);
        }
        catch (err) { setError((err as Error).message); }
      }}>Confirm all lead assignments</button>}
    {output && <p role="status">All displayed lead assignments confirmed. {download && <a href={download} download="confirmed-ecg.json">Download confirmed waveform values</a>}</p>}
  </section>;
}
