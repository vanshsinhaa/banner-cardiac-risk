const LEADS = ["I", "II", "III", "aVR", "aVL", "aVF", "V1", "V2", "V3", "V4", "V5", "V6"];

interface RecognitionEvidence {
  modelRecognition?: { status: string; leads: string[] };
  recognition?: { leads: Record<string, { status: string; label: string | null }> };
}

// Label presence is a union of both recognizers, not a vote on each waveform.
// Preserve I / II / III as distinct names and never count duplicates twice.
export function combinedLeadLabels(tesseract: string[] = [], digitization?: RecognitionEvidence | null) {
  const found = new Set<string>();
  const add = (value: string | null) => {
    const name = LEADS.find(lead => lead.toUpperCase() === value?.trim().toUpperCase());
    if (name) found.add(name);
  };
  tesseract.forEach(add);
  if (digitization?.modelRecognition?.status === "success") {
    digitization.modelRecognition.leads.forEach(add);
  }
  for (const item of Object.values(digitization?.recognition?.leads || {})) {
    if (item.status === "success") add(item.label);
  }
  return {
    confirmed: LEADS.filter(name => found.has(name)),
    missing: LEADS.filter(name => !found.has(name)),
  };
}
