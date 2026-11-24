import {
  BAND_LABELS, BAND_THRESHOLDS, RISK_BANDS, formatPercent, frequencySentence,
  type FactorEffect, type RiskBand, type RiskScoreResult,
} from "@/lib/riskScore/contract";
import ResearchDisclaimer from "../review/ResearchDisclaimer";
import styles from "./RiskScoreCard.module.css";

// Layout follows clinical-calculator conventions (MDCalc-style) and risk communication
// guidance: the time horizon sits with the number, the number is the largest text, the
// band has a word and an icon (not colour alone), a fixed "out of 100" frequency and
// icon array show the denominator, and only decision-relevant factors are listed.

const EFFECT_TEXT: Record<FactorEffect, string> = { raises: "Raises risk", lowers: "Lowers risk", neutral: "Little effect" };

function BandIcon({ band }: { band: RiskBand }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 2.2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={styles.bandIcon}>
      {band === "low" && <><circle cx="12" cy="12" r="9" {...common} /><path d="m8 12.5 2.7 2.7L16 9.8" {...common} /></>}
      {band === "borderline" && <><circle cx="12" cy="12" r="9" {...common} /><path d="M8 12h8" {...common} /></>}
      {band === "intermediate" && <path d="M12 3 2.5 20h19L12 3Zm0 6.5v4.5m0 3v.01" {...common} />}
      {band === "high" && <path d="M8.3 2.5h7.4l5.3 5.3v7.4l-5.3 5.3H8.3L3 15.2V7.8l5.3-5.3ZM12 7.5v5m0 3.5v.01" {...common} />}
    </svg>
  );
}

function EffectIcon({ effect }: { effect: FactorEffect }) {
  const d = effect === "raises" ? "M12 19V5m-6 6 6-6 6 6" : effect === "lowers" ? "M12 5v14m-6-6 6 6 6-6" : "M5 12h14";
  return <svg aria-hidden="true" viewBox="0 0 24 24" className={styles.effectIcon}><path d={d} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function bandRange(band: RiskBand): string {
  const index = BAND_THRESHOLDS.findIndex(([name]) => name === band);
  const min = BAND_THRESHOLDS[index][1];
  const max = index > 0 ? BAND_THRESHOLDS[index - 1][1] : null;
  return max === null ? `${min}% or more` : `${min}–${max}%`;
}

export default function RiskScoreCard({ result }: { result: RiskScoreResult }) {
  const filled = Math.min(100, Math.max(0, Math.round(result.riskPercent)));
  const bandClass = styles[`band_${result.band}`];
  return (
    <article className={`${styles.card} ${bandClass}`} aria-labelledby="risk-heading">
      <div className={styles.tags}>
        <span className={styles.tag}>Research use only</span>
        {result.status === "placeholder" && <span className={`${styles.tag} ${styles.tagPlaceholder}`}>Placeholder value — no validated model</span>}
      </div>

      <header className={styles.hero}>
        <h2 id="risk-heading" className={styles.eyebrow}>Estimated {result.horizonYears}-year cardiac event risk</h2>
        <div className={styles.scoreRow}>
          <p className={styles.score}>{formatPercent(result.riskPercent)}</p>
          <p className={styles.bandChip}>
            <BandIcon band={result.band} />
            <span>{BAND_LABELS[result.band]} risk</span>
          </p>
        </div>
        <p className={styles.summary}>{frequencySentence(result.riskPercent, result.horizonYears)}</p>
      </header>

      <section className={styles.visuals} aria-label="Risk in context">
        <figure className={styles.iconArray}>
          <div className={styles.dots} role="img" aria-label={`${filled} of 100 dots filled`}>
            {Array.from({ length: 100 }, (_, i) => <span key={i} className={i < filled ? styles.dotFilled : styles.dot} />)}
          </div>
          <figcaption>Each dot is one person out of 100.</figcaption>
        </figure>
        <ol className={styles.scale} aria-label="Risk categories">
          {RISK_BANDS.map((band) => (
            <li key={band} className={`${styles.scaleStep} ${styles[`band_${band}`]}`} aria-current={band === result.band ? "true" : undefined}>
              <span className={styles.scaleName}>{BAND_LABELS[band]}</span>
              <span className={styles.scaleRange}>{bandRange(band)}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className={styles.section} aria-labelledby="factors-heading">
        <h3 id="factors-heading">What drove this result</h3>
        <ul className={styles.factors}>
          {result.factors.map((factor) => (
            <li key={factor.id} className={`${styles.factor} ${styles[`effect_${factor.effect}`]}`}>
              <span className={styles.effect}><EffectIcon effect={factor.effect} />{EFFECT_TEXT[factor.effect]}</span>
              <div className={styles.factorBody}>
                <p className={styles.factorTitle}><span>{factor.label}</span><span className={styles.factorValue}>{factor.value}</span></p>
                <p className={styles.factorText}>{factor.explanation}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <details className={styles.details}>
        <summary>How this was calculated</summary>
        <dl>
          <div><dt>Model</dt><dd>{result.modelVersion}</dd></div>
          <div><dt>Trace used</dt><dd>{result.traceSource === "corrected" ? "Reviewer-corrected trace" : "Auto-detected trace (not reviewed)"}</dd></div>
          <div><dt>Calculated</dt><dd><time dateTime={result.generatedAt}>{new Date(result.generatedAt).toLocaleString()}</time></dd></div>
          <div><dt>Categories</dt><dd>Placeholder cut-offs (&lt;5, 5–7.5, 7.5–20, ≥20%) until the model defines calibrated bands.</dd></div>
        </dl>
      </details>

      <ResearchDisclaimer />
    </article>
  );
}
