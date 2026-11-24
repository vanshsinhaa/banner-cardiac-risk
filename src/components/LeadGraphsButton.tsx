'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useReviewSession } from './ReviewSession';
import type { EcgDigitizationResult } from '@/lib/ecg-digitizer/types';
import type { Assessment } from '@/lib/capturePipeline';
import styles from './EkgCaptureScreen.module.css';

export default function LeadGraphsButton({ result, image, assessment, loading = false, onResult }: {
  result: EcgDigitizationResult | null; image?: string; assessment?: Assessment | null;
  loading?: boolean; onResult?: (result: EcgDigitizationResult) => void;
}) {
  const { setSnapshot, openGraphEditor } = useReviewSession();
  const [blocked, setBlocked] = useState(false);
  return <div aria-label="Lead graph viewer" className={styles.graphViewer}>
    {!result && loading && <div className={styles.processingStatus} role="status" aria-atomic="true">
      <span className={styles.processingSpinner} aria-hidden="true" />
      <div>
        <strong>Scan processing is in progress</strong>
        <p>We’re preparing the scan portions with lead labels and their graphs. They will appear here automatically when ready.</p>
        <p className={styles.processingHint}>This can take up to 2 minutes. Please keep this page open.</p>
      </div>
    </div>}
    {result && <p role="status" className={styles.graphReady}>Extracted lead labels and graphs are ready to review.</p>}
    <button type="button" className={styles.secondary} disabled={!result} onClick={() => {
      if (result) setBlocked(!openGraphEditor({ result, image, assessment }, onResult));
    }}>View and edit all lead graphs (new tab)</button>
    {!result && !loading && <p role="status">Lead graphs are unavailable because waveform extraction has not succeeded. Retry the scan checks after the waveform service is ready.</p>}
    {blocked && result && <p role="alert">The browser blocked the new tab. Allow pop-ups for this site, or{' '}
      <Link href="/lead-graphs" onClick={() => setSnapshot({ result, image, assessment })}>Open lead graphs in this tab</Link>.</p>}
  </div>;
}
