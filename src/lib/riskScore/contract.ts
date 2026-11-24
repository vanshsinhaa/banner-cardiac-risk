// Contract between the risk model and the score display (Taiga #76). No model is
// validated yet, so the API returns status "placeholder" and the UI says so. When a
// model exists it fills this same shape and the display does not change.

export const RISK_SCORE_SCHEMA = "risk-score/0.1";

export const RISK_BANDS = ["low", "borderline", "intermediate", "high"] as const;
export type RiskBand = (typeof RISK_BANDS)[number];

export const FACTOR_EFFECTS = ["raises", "lowers", "neutral"] as const;
export type FactorEffect = (typeof FACTOR_EFFECTS)[number];

export interface RiskFactor {
  id: string;
  label: string; // plain-language name, e.g. "Corrected QT interval (QTc)"
  value: string; // display value with unit, e.g. "462 ms"
  effect: FactorEffect;
  explanation: string; // one plain sentence a clinician could repeat to a patient
}

export interface RiskScoreResult {
  schema: typeof RISK_SCORE_SCHEMA;
  status: "placeholder" | "validated";
  riskPercent: number; // 0-100
  horizonYears: number;
  band: RiskBand;
  factors: RiskFactor[];
  modelVersion: string;
  traceSource: "auto" | "corrected";
  generatedAt: string;
}

// Band cut-offs follow the familiar 10-year ASCVD categories (<5, 5-7.5, 7.5-20, >=20 %).
// They are a display placeholder until the model defines its own calibrated bands.
export const BAND_THRESHOLDS: readonly [RiskBand, number][] = [["high", 20], ["intermediate", 7.5], ["borderline", 5], ["low", 0]];

export const BAND_LABELS: Record<RiskBand, string> = {
  low: "Low",
  borderline: "Borderline",
  intermediate: "Intermediate",
  high: "High",
};

export function riskBand(percent: number): RiskBand {
  return BAND_THRESHOLDS.find(([, min]) => percent >= min)?.[0] ?? "low";
}

// Whole percentages only: decimals would claim precision the model does not have.
export function formatPercent(percent: number): string {
  if (percent > 0 && percent < 1) return "<1%";
  if (percent > 99 && percent < 100) return ">99%";
  return `${Math.round(percent)}%`;
}

// "About 12 in 100" phrasing with a fixed denominator, which is easier to grasp than a percentage alone.
export function frequencySentence(percent: number, horizonYears: number): string {
  const amount = percent > 0 && percent < 1 ? "Fewer than 1" : `About ${Math.round(percent)}`;
  return `${amount} in 100 people with a similar EKG would be expected to have a cardiac event within ${horizonYears} years.`;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isText = (value: unknown, max: number) => typeof value === "string" && value.length > 0 && value.length <= max;

export function isRiskScoreResult(value: unknown): value is RiskScoreResult {
  if (!isObject(value)) return false;
  return value.schema === RISK_SCORE_SCHEMA &&
    (value.status === "placeholder" || value.status === "validated") &&
    typeof value.riskPercent === "number" && value.riskPercent >= 0 && value.riskPercent <= 100 &&
    typeof value.horizonYears === "number" && value.horizonYears > 0 &&
    (RISK_BANDS as readonly unknown[]).includes(value.band) &&
    (value.traceSource === "auto" || value.traceSource === "corrected") &&
    isText(value.modelVersion, 80) && isText(value.generatedAt, 40) &&
    Array.isArray(value.factors) && value.factors.length <= 12 &&
    value.factors.every((factor) => isObject(factor) && isText(factor.id, 40) && isText(factor.label, 80) &&
      isText(factor.value, 40) && (FACTOR_EFFECTS as readonly unknown[]).includes(factor.effect) &&
      isText(factor.explanation, 200));
}

// Fixed demo values for design work. The factors are the metrics the T-wave work
// (#72-#74) will measure; the numbers here are illustrative, not measured.
export function placeholderRiskScore(traceSource: "auto" | "corrected", generatedAt: string): RiskScoreResult {
  const riskPercent = 12;
  return {
    schema: RISK_SCORE_SCHEMA,
    status: "placeholder",
    riskPercent,
    horizonYears: 10,
    band: riskBand(riskPercent),
    modelVersion: "placeholder-0 (no validated model)",
    traceSource,
    generatedAt,
    factors: [
      { id: "qtc", label: "Corrected QT interval (QTc)", value: "462 ms", effect: "raises",
        explanation: "The heart takes slightly longer than typical to recover between beats." },
      { id: "t_wave_area", label: "T-wave area", value: "38 mV·ms", effect: "raises",
        explanation: "The recovery wave is larger than expected for this lead." },
      { id: "j_to_t_end", label: "J-point to T-wave end", value: "298 ms", effect: "neutral",
        explanation: "The recovery phase length is in the usual range." },
      { id: "heart_rate", label: "Heart rate", value: "75 bpm", effect: "lowers",
        explanation: "A resting rate in the normal range is reassuring." },
    ],
  };
}
