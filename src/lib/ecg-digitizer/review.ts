import { ECG_LEADS, type EcgLead, type EcgDigitizationResult } from './types.ts';

// Resolve simultaneously so a V1/V2 swap cannot overwrite either waveform.
export function confirmLeadAssignments(result: EcgDigitizationResult, labels: Record<string, string>): EcgDigitizationResult {
  const leads: EcgDigitizationResult['leads'] = {};
  const assignments: Record<string, EcgLead> = {};
  for (const [source, samples] of Object.entries(result.leads)) {
    const label = ECG_LEADS.find(name => name.toUpperCase() === labels[source]?.trim().toUpperCase());
    if (!label) throw new Error(`Enter a valid lead label for ${source}.`);
    if (leads[label]) throw new Error(`Two waveforms are labeled ${label}. Correct the duplicate before confirming.`);
    if (label !== source && !result.leadPreviews?.[source]) {
      throw new Error(`The source region for ${source} is unavailable. Retry the scan before relabeling it.`);
    }
    leads[label] = samples;
    assignments[source] = label;
  }
  return { ...result, leads, requiresReview: false,
    userReview: { status: 'confirmed', assignments },
    // Keep machine evidence keyed to its original source, never imply that
    // a human correction was independently verified by OCR.
  };
}
