import styles from "./review.module.css";

// Persistent notice shown on every review and score step. The text carries the meaning;
// the icon is decorative (GOV.UK warning text pattern).
export default function ResearchDisclaimer({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? `${styles.disclaimer} ${styles.disclaimerCompact}` : styles.disclaimer} role="note">
      <svg aria-hidden="true" viewBox="0 0 24 24" className={styles.disclaimerIcon}>
        <path d="M12 3 2 20h20L12 3Zm0 6v5m0 3v.01" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <p>
        <strong>Research use only.</strong>{" "}
        {compact ? "Not validated for clinical decisions." :
          "This tool is not validated for clinical decisions. Do not use it to diagnose, treat or reassure a patient."}
      </p>
    </div>
  );
}
