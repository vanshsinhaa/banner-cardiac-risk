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

export type RegionBox = [number, number, number, number];
export interface LeadCorrection {
  source: string | null;
  label: string;
  labelBox?: RegionBox;
  mode?: "labels" | "waveform_regions";
  waveformBox: RegionBox;
}
export interface EcgDigitizationResult {
  privacyStatus?: "testing_bypass";
  manualReview?: { token: string; revision: number; image: string; width: number; height: number; expiresInSeconds: number;
    regions: Record<string, { box?: RegionBox; waveformBox?: RegionBox }> };
  manualReviewUnavailable?: string;
  manualCorrections?: LeadCorrection[];

  // Every lead shares one time axis. A sample is null where the lead has no signal,
  // e.g. outside the part of the strip where that lead is printed.
  leads: Partial<Record<EcgLead, (number | null)[]>>;
  samplingRateHz: number;
  units: "mV";
  requiresReview?: boolean;
  leadPreviews?: Record<string, string>;
  layoutRecheck?: { attempted: boolean; status: string };
  userReview?: { status: 'confirmed'; assignments: Record<string, EcgLead> };
  leadVerification?: { status: string; reason?: string; leads: Record<string, { status: string; reason?: string; observedLabels?: string[] }> };
  modelRecognition?: { status: string; leads: string[] };
  recognition?: { leads: Record<string, { status: string; label: string | null }> };
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
