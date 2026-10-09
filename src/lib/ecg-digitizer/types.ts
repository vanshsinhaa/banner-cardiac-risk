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
  leads: Partial<Record<EcgLead, number[]>>;
  samplingRateHz: number;
  units: "mV";
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
    result.leads === null
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
        samples.every((sample) => typeof sample === "number" && Number.isFinite(sample)),
    )
  );
}
