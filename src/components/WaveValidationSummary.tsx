import { ECG_LEADS } from "@/lib/ecg-digitizer/types";
import { ISSUE_AREA, type IssueCode, type LeadSummary, type WaveValidationReport } from "@/lib/waveValidation";
import styles from "./WaveValidationSummary.module.css";

// Shows the server's wave-attribute validation (Taiga #64) on the capture result.
// Display only: eligibility is enforced server-side, not by this component.

const HEADLINE = {
  valid: "Measurements ready for analysis.",
  needs_review: "Measurements need review before analysis.",
  invalid: "Measurements cannot be used for analysis.",
} as const;

const LEAD_STATE: Record<LeadSummary["status"], string> = {
  ok: "ready",
  needs_review: "review",
  invalid: "invalid",
  missing: "missing",
};

const AREA_WORD = { waveform: "trace", tWave: "T-wave", label: "label", record: "data" } as const;

// Short reason under a lead that is not ready, e.g. "label" or "trace, T-wave".
function leadReason(lead: LeadSummary | undefined): string | null {
  if (!lead || lead.status === "ok" || lead.status === "missing") return null;
  const areas = [...new Set(lead.codes.map(code => AREA_WORD[ISSUE_AREA[code]]))];
  return areas.length ? areas.join(", ") : null;
}

const LABEL_CODES: IssueCode[] = ["LEAD_MISSING", "LEAD_CONFLICT", "LEAD_UNVERIFIED", "LEAD_VERIFICATION_MISSING"];
const TRACE_CODES: IssueCode[] = ["SIGNAL_GAP", "SIGNAL_FLAT", "LEAD_TOO_SHORT", "AMPLITUDE_OUT_OF_RANGE", "T_WAVE_MISSING", "T_WAVE_AMPLITUDE_OUT_OF_RANGE"];

function nextStep(report: WaveValidationReport): string | null {
  if (report.status === "valid") return null;
  if (report.status === "invalid") return "The extracted data is inconsistent. Run the checks again; if it repeats, use another image and report the problem.";
  const found = new Set(report.issues.map(issue => issue.code));
  if (LABEL_CODES.some(code => found.has(code))) return "Check the crop includes every lead label and its full waveform, then run the checks again.";
  if (TRACE_CODES.some(code => found.has(code))) return "Some waveforms could not be measured reliably. Review the affected leads, or try a sharper, evenly lit image.";
  return "Run the checks again or use another image.";
}

const VISIBLE_ISSUES = 5;

export default function WaveValidationSummary({ report }: { report: WaveValidationReport }) {
  const step = nextStep(report);
  const shown = report.issues.slice(0, VISIBLE_ISSUES);
  const hidden = report.issues.slice(VISIBLE_ISSUES);
  return (
    <section className={styles.panel} data-status={report.status} aria-label="Measurement checks">
      <p className={styles.headline}>{HEADLINE[report.status]}</p>
      <p className={styles.meta}>{report.counts.leadsReady}/12 leads ready for analysis</p>
      <ul className={styles.areas} aria-label="What was checked">
        <li><strong>{report.counts.waveformsUsable}/12</strong> waveforms usable</li>
        <li><strong>{report.counts.tWavesMeasured}/12</strong> T-waves measured</li>
        <li><strong>{report.counts.labelsConfirmed}/12</strong> printed labels confirmed</li>
      </ul>
      <ul className={styles.leads} aria-label="Lead status">
        {ECG_LEADS.map(name => {
          const lead = report.leads[name];
          const state = lead ? lead.status : "missing";
          const reason = leadReason(lead);
          return (
            <li key={name} className={styles.lead} data-state={state} title={lead?.codes.join(", ") || undefined}>
              <span className={styles.leadName}>{name}</span>
              <span className={styles.leadState}>{LEAD_STATE[state]}</span>
              {reason && <span className={styles.leadReason}>{reason}</span>}
            </li>
          );
        })}
      </ul>
      {shown.length > 0 && <ul className={styles.issues}>
        {shown.map((issue, index) => <li key={`${issue.code}-${issue.path}-${index}`} data-severity={issue.severity}>{issue.message}</li>)}
      </ul>}
      {hidden.length > 0 && <details className={styles.more}>
        <summary>Show {hidden.length} more</summary>
        <ul className={styles.issues}>
          {hidden.map((issue, index) => <li key={`${issue.code}-${issue.path}-${index}`} data-severity={issue.severity}>{issue.message}</li>)}
        </ul>
      </details>}
      {step && <p className={styles.step}>{step}</p>}
      <details className={styles.more}>
        <summary>Technical details</summary>
        <p>Profile {report.profile} ({report.version}).</p>
        {report.issues.length > 0 && <ul className={styles.codes}>
          {report.issues.map((issue, index) => <li key={`${issue.code}-${issue.path}-${index}`}><code>{issue.code}</code> <code>{issue.path || "/"}</code></li>)}
        </ul>}
      </details>
    </section>
  );
}
