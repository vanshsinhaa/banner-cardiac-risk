import styles from "./review.module.css";

export const REVIEW_STEPS = [
  { id: "review", label: "Review trace" },
  { id: "confirm", label: "Confirm" },
  { id: "score", label: "Risk score" },
] as const;
export type ReviewStep = (typeof REVIEW_STEPS)[number]["id"];

// Step state is shown with a number or check and text, not colour alone.
export default function Stepper({ current, onSelect, canSelect }: {
  current: ReviewStep;
  onSelect: (step: ReviewStep) => void;
  canSelect: (step: ReviewStep) => boolean;
}) {
  const currentIndex = REVIEW_STEPS.findIndex((step) => step.id === current);
  return (
    <nav aria-label="Review progress">
      <ol className={styles.stepper}>
        {REVIEW_STEPS.map((step, index) => {
          const state = index < currentIndex ? "done" : index === currentIndex ? "current" : "upcoming";
          const content = (
            <>
              <span className={styles.stepMarker} aria-hidden="true">{state === "done" ? "✓" : index + 1}</span>
              <span className={styles.stepLabel}>
                {step.label}
                <span className={styles.visuallyHidden}>{state === "done" ? " (completed)" : state === "current" ? " (current step)" : ""}</span>
              </span>
            </>
          );
          return (
            <li key={step.id} className={styles.step} data-state={state} aria-current={state === "current" ? "step" : undefined}>
              {state !== "current" && canSelect(step.id)
                ? <button type="button" className={styles.stepButton} onClick={() => onSelect(step.id)}>{content}</button>
                : <span className={styles.stepButton}>{content}</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
