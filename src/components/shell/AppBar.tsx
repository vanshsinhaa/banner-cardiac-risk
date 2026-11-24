import type { ReactNode } from "react";
import styles from "./AppBar.module.css";

interface Props {
  /** Where the user is, e.g. "Capture" or "Trace review". */
  section: string;
  /** Short status chips on the right, e.g. a case id or "Synthetic demo". */
  meta?: ReactNode;
  /** Primary action on the right, e.g. an exit button. */
  action?: ReactNode;
}

// Product bar shared by the capture and review screens, so both read as one tool.
export default function AppBar({ section, meta, action }: Props) {
  return (
    <header className={styles.bar}>
      <div className={styles.inner}>
        <div className={styles.brand}>
          <span className={styles.mark} aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none"><path d="M2 12h4l2-5 4 11 3-8 2 2h5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </span>
          <span className={styles.product}>Cardiac Risk</span>
          <span className={styles.divider} aria-hidden="true" />
          <span className={styles.section}>{section}</span>
        </div>
        <div className={styles.right}>
          {meta}
          <span className={styles.chip}>Research use only</span>
          {action}
        </div>
      </div>
    </header>
  );
}

export function AppBarChip({ children }: { children: ReactNode }) {
  return <span className={styles.chip}>{children}</span>;
}

export function AppBarButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return <button type="button" className={styles.button} onClick={onClick}>{children}</button>;
}
