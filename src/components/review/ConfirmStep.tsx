import type { TracePoint } from "@/lib/traceOverlay/geometry";
import type { TraceReviewState } from "@/lib/traceOverlay/traceEdits";
import { toRuns } from "@/lib/traceOverlay/controlPoints";
import { leadEditCount } from "./TraceEditor";
import styles from "./review.module.css";

interface Props {
  leads: string[];
  review: TraceReviewState;
  onEdit: (lead: string) => void;
  onSubmit: () => void;
  busy: boolean;
  error: string | null;
}

// Small drawing of the trace alone (no paper), detected line dashed underneath.
function Thumbnail({ auto, corrected }: { auto: readonly TracePoint[]; corrected: readonly TracePoint[] }) {
  const all = [...auto, ...corrected];
  if (!all.length) return <div className={styles.thumb} />;
  const start = Math.min(...all.map((p) => p.i));
  const end = Math.max(...all.map((p) => p.i));
  const high = Math.max(1, ...all.map((p) => p.mv)) + 0.2;
  const low = Math.min(-0.5, ...all.map((p) => p.mv)) - 0.2;
  const line = (points: readonly TracePoint[]) => points.map((p) => `${p.i},${-p.mv * 300}`).join(" ");
  return (
    <svg className={styles.thumb} viewBox={`${start} ${-high * 300} ${end - start || 1} ${(high - low) * 300}`} preserveAspectRatio="none" aria-hidden="true">
      {auto !== corrected && toRuns(auto).map((run, i) => <polyline key={`a${i}`} points={line(run)} className={styles.autoLine} vectorEffect="non-scaling-stroke" />)}
      {toRuns(corrected).map((run, i) => <polyline key={`c${i}`} points={line(run)} className={styles.traceLine} vectorEffect="non-scaling-stroke" />)}
    </svg>
  );
}

export default function ConfirmStep({ leads, review, onEdit, onSubmit, busy, error }: Props) {
  const edited = leads.filter((lead) => review.corrected[lead] !== review.auto[lead]);
  return (
    <section className={styles.confirm} aria-labelledby="confirm-heading">
      <header className={styles.confirmHead}>
        <h2 id="confirm-heading">Confirm the trace</h2>
        <p>
          {edited.length === 0
            ? "No leads were changed. The score will use the trace exactly as detected."
            : `${edited.length} of ${leads.length} leads were corrected. The corrected trace is saved separately; the originally detected trace is kept unchanged.`}
        </p>
      </header>

      <ul className={styles.thumbGrid}>
        {leads.map((lead) => {
          const changed = review.corrected[lead] !== review.auto[lead];
          const count = leadEditCount(review, lead);
          return (
            <li key={lead} className={styles.thumbCard}>
              <div className={styles.thumbHead}>
                <strong>{lead}</strong>
                <span className={changed ? styles.badgeEdited : styles.badge}>{changed ? `Corrected · ${count}` : "As detected"}</span>
              </div>
              <Thumbnail auto={review.auto[lead] ?? []} corrected={review.corrected[lead] ?? []} />
              <button type="button" className={styles.linkButton} onClick={() => onEdit(lead)}>Edit lead {lead}</button>
            </li>
          );
        })}
      </ul>

      {error && <p role="alert" className={styles.errorText}>{error}</p>}
      <div className={styles.confirmActions}>
        <button type="button" className={styles.secondaryButton} onClick={() => onEdit(leads[0])}>Back to review</button>
        <button type="button" className={styles.primaryButton} onClick={onSubmit} disabled={busy}>
          {busy ? "Saving and calculating…" : "Save trace and calculate risk"}
        </button>
      </div>
    </section>
  );
}
