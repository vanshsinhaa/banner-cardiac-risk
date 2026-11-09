import type { WaveValidationReport } from "../waveValidation.ts";

export const ECG_LEADS = [
  "I",
  "II",
  "III",
  "aVR",
  "aVL",
  "aVF",
  "V1",
  "V2",
  "V3",
  "V4",
  "V5",
  "V6",
] as const;

export type EcgLead = (typeof ECG_LEADS)[number];

export interface EcgDigitizationResult {
  // Every lead shares one time axis. A sample is null where the lead has no signal,
  // e.g. outside the part of the strip where that lead is printed.
  leads: Partial<Record<EcgLead, (number | null)[]>>;
  samplingRateHz: number;
  units: "mV";
  requiresReview?: boolean;
  leadVerification?: { status: string; reason?: string; leads: Record<string, { status: string; reason?: string; observedLabels?: string[] }> };
  modelRecognition?: { status: string; leads: string[] };
  recognition?: { leads: Record<string, { status: string; label: string | null }> };
  // Median-beat T-wave measurements; times are ms relative to that beat's R peak.
  tWaves?: TWaveReport;
  // Added server-side by /api/ecg/digitize (Taiga #64). Display only: consumers must
  // re-validate with admitForAnalysis instead of trusting this field.
  validation?: WaveValidationReport;
}

export interface TWaveLeadMeasurement {
  status: "measured";
  beatsUsed: number;
  windowStartMs: number;
  windowEndMs: number;
  qrsOnsetMs: number;
  qrsEndMs: number;
  tOnsetMs: number;
  tPeakMs: number;
  tOffsetMs: number;
  tPeakMv: number;
}

export interface TWaveReport {
  status: "complete" | "unavailable";
  reason?: string;
  method: string;
  timeDomain: "median_beat_r_relative_ms";
  leads: Partial<Record<EcgLead, TWaveLeadMeasurement | { status: "not_found" }>>;
}

export function isEcgDigitizationResult(value: unknown): value is EcgDigitizationResult {
  if (typeof value !== "object" || value === null) return false;

  const result = value as Record<string, unknown>;
  if (
    typeof result.samplingRateHz !== "number" ||
    !Number.isFinite(result.samplingRateHz) ||
    result.samplingRateHz <= 0 ||
    result.units !== "mV" ||
    typeof result.leads !== "object" ||
    result.leads === null || Array.isArray(result.leads)
  ) {
    return false;
  }

  const leads = result.leads as Record<string, unknown>;
  const entries = Object.entries(leads);
  return (
    entries.length > 0 &&
    entries.every(
      ([lead, samples]) =>
        ECG_LEADS.some((knownLead) => knownLead === lead) &&
        Array.isArray(samples) &&
        samples.length > 0 &&
        samples.some(sample => typeof sample === "number" && Number.isFinite(sample)) &&
        samples.every(
          (sample) => sample === null || (typeof sample === "number" && Number.isFinite(sample)),
        ),
    )
  );
}
