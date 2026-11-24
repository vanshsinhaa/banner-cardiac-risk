'use client';

import Link from 'next/link';
import LeadReview from '@/components/LeadReview';
import styles from '@/components/ManualReview.module.css';
import { useReviewSession } from '@/components/ReviewSession';

export default function ReviewedResultPage() {
  const { snapshot, setSnapshot } = useReviewSession();
  if (!snapshot) return <main style={{ padding: 32 }}><h1>No active result</h1><Link href="/">Upload a scan</Link></main>;
  return <main className={styles.page}>
    <h1>ECG scan result</h1>
    {snapshot.assessment && <p>Original scan assessment: {snapshot.assessment.status.replaceAll('_', ' ')}. {snapshot.assessment.reasons.join(', ')}</p>}
    <p>{Object.keys(snapshot.result.leads).length} waveforms extracted at {snapshot.result.samplingRateHz} Hz.</p>
    {snapshot.image && <details><summary>{snapshot.result.privacyStatus === "testing_bypass" ? "View test scan (not de-identified)" : "View de-identified scan"}</summary>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={snapshot.image} alt={snapshot.result.privacyStatus === "testing_bypass" ? "Test ECG scan — not de-identified" : "De-identified ECG scan"} style={{ maxWidth: '100%' }} /></details>}
    <LeadReview key={snapshot.result.manualReview?.revision ?? 0} {...snapshot} />
    <p><Link href="/" onClick={() => setSnapshot(null)}>Start a new scan</Link></p>
  </main>;
}
