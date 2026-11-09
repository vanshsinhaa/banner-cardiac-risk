// Wave-attribute validation (Taiga #64).
//
// Checks a digitizer response (see ecg-digitizer/types.ts) before its numbers may be
// used for analysis. It never changes the record and never guesses missing values.
//
// Three outcomes:
//   invalid       the record is broken or self-contradictory (severity "error")
//   needs_review  the record is well formed but incomplete or unconfirmed for the
//                 analysis profile below (severity "review")
//   valid         every rule passed; analysisEligible is true only in this case
//
// Every issue has a stable `code`, a JSON Pointer `path` into the checked record, and
// a short message safe to show and log (it never contains sample values or OCR text).

import { ECG_LEADS, type EcgLead } from "./ecg-digitizer/types.ts";

export const WAVE_VALIDATION_VERSION = "wave-validation/1";

export type ValidationStatus = "valid" | "needs_review" | "invalid";
export type IssueSeverity = "error" | "review";

export type IssueCode =
  | "RECORD_NOT_OBJECT"
  | "SAMPLING_RATE_INVALID"
  | "UNITS_UNSUPPORTED"
  | "LEADS_INVALID"
  | "LEAD_NAME_UNKNOWN"
  | "SAMPLES_NOT_ARRAY"
  | "SAMPLE_NOT_FINITE"
  | "SIGNAL_EMPTY"
  | "SAMPLE_AXIS_MISMATCH"
  | "LEAD_MISSING"
  | "LEAD_TOO_SHORT"
  | "SIGNAL_GAP"
  | "SIGNAL_FLAT"
  | "AMPLITUDE_OUT_OF_RANGE"
  | "LEAD_VERIFICATION_MISSING"
  | "LEAD_UNVERIFIED"
  | "LEAD_CONFLICT"
  | "T_WAVE_REPORT_MISSING"
  | "T_WAVE_REPORT_INVALID"
  | "T_WAVE_UNAVAILABLE"
  | "T_WAVE_LEAD_UNKNOWN"
  | "T_WAVE_MISSING"
  | "T_WAVE_VALUE_INVALID"
  | "T_WAVE_ORDER_INVALID"
  | "T_WAVE_OUTSIDE_BEAT"
  | "T_WAVE_AMPLITUDE_OUT_OF_RANGE";

export interface ValidationIssue {
  code: IssueCode;
  severity: IssueSeverity;
  path: string;
  lead?: EcgLead;
  message: string;
}

// What a record needs before analysis may use it. Values are chosen from the current
// digitizer and printout format, not from clinical normal ranges: amplitudes and
// intervals outside a "healthy" range are still valid measurements.
export interface ValidationProfile {
  id: string;
  requiredLeads: readonly EcgLead[];
  requireVerifiedLeads: boolean;
  requireTWave: boolean;
  // A lead on a 3x4 printout spans 2.5 s; t_wave.py cannot measure under 2 s.
  minLeadDurationMs: number;
  // t_wave.py bridges interior gaps up to 150 ms; longer gaps split the trace.
  maxInteriorGapMs: number;
  // Beyond this, a sample cannot come from a standard-gain trace on the page (10 mm/mV,
  // ~25 mm per lead row); it is treated as a digitization artifact needing review.
  maxAbsAmplitudeMv: number;
  // A lead whose whole trace stays within this range was probably not traced.
  minPeakToPeakMv: number;
}

export const TWELVE_LEAD_T_WAVE_PROFILE: ValidationProfile = {
  id: "twelve-lead-t-wave/1",
  requiredLeads: ECG_LEADS,
  requireVerifiedLeads: true,
  requireTWave: true,
  minLeadDurationMs: 2000,
  maxInteriorGapMs: 150,
  maxAbsAmplitudeMv: 10,
  minPeakToPeakMv: 0.05,
};

export interface LeadSignalStats {
  samples: number;
  measuredSamples: number;
  firstSample: number | null;
  lastSample: number | null;
  durationMs: number;
  leadingNulls: number;
  trailingNulls: number;
  interiorGapSamples: number;
  longestInteriorGapMs: number;
  minMv: number | null;
  maxMv: number | null;
}

// Which part of the record each lead-level code is about.
export const ISSUE_AREA: Record<IssueCode, "record" | "waveform" | "label" | "tWave"> = {
  RECORD_NOT_OBJECT: "record", SAMPLING_RATE_INVALID: "record", UNITS_UNSUPPORTED: "record",
  LEADS_INVALID: "record", SAMPLE_AXIS_MISMATCH: "record",
  LEAD_NAME_UNKNOWN: "waveform", SAMPLES_NOT_ARRAY: "waveform", SAMPLE_NOT_FINITE: "waveform",
  SIGNAL_EMPTY: "waveform", LEAD_MISSING: "waveform", LEAD_TOO_SHORT: "waveform", SIGNAL_GAP: "waveform",
  SIGNAL_FLAT: "waveform", AMPLITUDE_OUT_OF_RANGE: "waveform",
  LEAD_VERIFICATION_MISSING: "label", LEAD_UNVERIFIED: "label", LEAD_CONFLICT: "label",
  T_WAVE_REPORT_MISSING: "tWave", T_WAVE_REPORT_INVALID: "tWave", T_WAVE_UNAVAILABLE: "tWave",
  T_WAVE_LEAD_UNKNOWN: "tWave", T_WAVE_MISSING: "tWave", T_WAVE_VALUE_INVALID: "tWave",
  T_WAVE_ORDER_INVALID: "tWave", T_WAVE_OUTSIDE_BEAT: "tWave", T_WAVE_AMPLITUDE_OUT_OF_RANGE: "tWave",
};

export interface LeadSummary {
  status: "ok" | "needs_review" | "invalid" | "missing";
  codes: IssueCode[];
  signal?: LeadSignalStats;
}

export interface WaveValidationReport {
  version: typeof WAVE_VALIDATION_VERSION;
  profile: string;
  status: ValidationStatus;
  analysisEligible: boolean;
  issues: ValidationIssue[];
  leads: Partial<Record<EcgLead, LeadSummary>>;
  counts: {
    errors: number;
    reviews: number;
    leadsPresent: number;
    leadsReady: number;
    // Per-area counts over extracted leads, so the result shows what worked even
    // when the lead is not ready overall (e.g. waves fine, printed label unconfirmed).
    waveformsUsable: number;
    tWavesMeasured: number;
    labelsConfirmed: number;
  };
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const isLead = (name: string): name is EcgLead => (ECG_LEADS as readonly string[]).includes(name);
// JSON Pointer escaping (RFC 6901) so unknown keys cannot break the path format.
const pointer = (...parts: (string | number)[]) =>
  parts.map(part => "/" + String(part).replace(/~/g, "~0").replace(/\//g, "~1")).join("");

const T_FIELDS = ["qrsOnsetMs", "qrsEndMs", "tOnsetMs", "tPeakMs", "tOffsetMs", "tPeakMv", "windowStartMs", "windowEndMs"] as const;

export function signalStats(samples: readonly (number | null)[], samplingRateHz: number): LeadSignalStats {
  const msPerSample = 1000 / samplingRateHz;
  let first = -1, last = -1, measured = 0, interior = 0, run = 0, longest = 0;
  let min = Infinity, max = -Infinity;
  samples.forEach((value, index) => {
    if (value === null) {
      if (first !== -1) run++;
      return;
    }
    if (first === -1) first = index;
    else if (run) { interior += run; longest = Math.max(longest, run); }
    run = 0;
    last = index;
    measured++;
    if (value < min) min = value;
    if (value > max) max = value;
  });
  const hasSignal = first !== -1;
  return {
    samples: samples.length,
    measuredSamples: measured,
    firstSample: hasSignal ? first : null,
    lastSample: hasSignal ? last : null,
    durationMs: hasSignal ? (last - first + 1) * msPerSample : 0,
    leadingNulls: hasSignal ? first : samples.length,
    trailingNulls: hasSignal ? samples.length - 1 - last : 0,
    interiorGapSamples: interior,
    longestInteriorGapMs: longest * msPerSample,
    minMv: hasSignal ? min : null,
    maxMv: hasSignal ? max : null,
  };
}

export function validateWaveAttributes(
  record: unknown,
  profile: ValidationProfile = TWELVE_LEAD_T_WAVE_PROFILE,
): WaveValidationReport {
  const issues: ValidationIssue[] = [];
  const leadSummaries: Partial<Record<EcgLead, LeadSummary>> = {};
  const add = (code: IssueCode, severity: IssueSeverity, path: string, message: string, lead?: EcgLead) => {
    issues.push(lead ? { code, severity, path, lead, message } : { code, severity, path, message });
  };

  if (!isObject(record)) {
    add("RECORD_NOT_OBJECT", "error", "", "The digitizer result is not a JSON object.");
    return finish(profile, issues, leadSummaries);
  }

  // --- Shape and numeric integrity -------------------------------------------------
  const rate = record.samplingRateHz;
  const rateOk = isFiniteNumber(rate) && rate > 0;
  if (!rateOk) add("SAMPLING_RATE_INVALID", "error", "/samplingRateHz", "Sampling rate must be a positive finite number.");
  if (record.units !== "mV") add("UNITS_UNSUPPORTED", "error", "/units", "Amplitude units must be mV.");

  const leads = record.leads;
  if (!isObject(leads) || Object.keys(leads).length === 0) {
    add("LEADS_INVALID", "error", "/leads", "No lead waveforms were provided.");
    return finish(profile, issues, leadSummaries);
  }

  const usable: Partial<Record<EcgLead, (number | null)[]>> = {};
  for (const [name, samples] of Object.entries(leads)) {
    const path = pointer("leads", name);
    if (!isLead(name)) {
      add("LEAD_NAME_UNKNOWN", "error", path, "Lead name is not one of the 12 standard leads.");
      continue;
    }
    if (!Array.isArray(samples) || samples.length === 0) {
      add("SAMPLES_NOT_ARRAY", "error", path, `Lead ${name} has no sample array.`, name);
      continue;
    }
    const bad = samples.findIndex(value => value !== null && !isFiniteNumber(value));
    if (bad !== -1) {
      add("SAMPLE_NOT_FINITE", "error", pointer("leads", name, bad), `Lead ${name} contains a sample that is not a finite number or null.`, name);
      continue;
    }
    if (!samples.some(isFiniteNumber)) {
      add("SIGNAL_EMPTY", "error", path, `Lead ${name} has no measured samples.`, name);
      continue;
    }
    usable[name] = samples as (number | null)[];
  }

  // All leads share one zero-based sample axis in the current digitizer response.
  const lengths = new Set(Object.values(usable).map(samples => samples!.length));
  if (lengths.size > 1) {
    add("SAMPLE_AXIS_MISMATCH", "error", "/leads", "Leads do not share one sample axis (different lengths).");
  }

  // --- Lead completeness and signal quality ----------------------------------------
  for (const name of profile.requiredLeads) {
    if (!(name in leads)) add("LEAD_MISSING", "review", pointer("leads", name), `Lead ${name} was not extracted.`, name);
  }
  if (rateOk) {
    for (const [name, samples] of Object.entries(usable) as [EcgLead, (number | null)[]][]) {
      const stats = signalStats(samples, rate);
      leadSummaries[name] = { status: "ok", codes: [], signal: stats };
      const path = pointer("leads", name);
      if (stats.durationMs < profile.minLeadDurationMs) {
        add("LEAD_TOO_SHORT", "review", path, `Lead ${name} trace is shorter than ${profile.minLeadDurationMs / 1000} s.`, name);
      }
      if (stats.longestInteriorGapMs > profile.maxInteriorGapMs) {
        add("SIGNAL_GAP", "review", path, `Lead ${name} trace is missing for more than ${profile.maxInteriorGapMs} ms.`, name);
      }
      if (stats.maxMv! - stats.minMv! < profile.minPeakToPeakMv) {
        add("SIGNAL_FLAT", "review", path, `Lead ${name} trace is flat; the waveform may not have been traced.`, name);
      }
      const extreme = samples.findIndex(value => value !== null && Math.abs(value) > profile.maxAbsAmplitudeMv);
      if (extreme !== -1) {
        add("AMPLITUDE_OUT_OF_RANGE", "review", pointer("leads", name, extreme), `Lead ${name} has an amplitude beyond ±${profile.maxAbsAmplitudeMv} mV, likely a tracing error.`, name);
      }
    }
  }

  // --- Lead label / assignment evidence --------------------------------------------
  if (profile.requireVerifiedLeads) {
    const verification = record.leadVerification;
    const checks = isObject(verification) && isObject(verification.leads) ? verification.leads : null;
    if (!checks) {
      add("LEAD_VERIFICATION_MISSING", "review", "/leadVerification", "Lead label verification is missing, so lead assignments are unconfirmed.");
    } else {
      for (const name of Object.keys(usable) as EcgLead[]) {
        const check = checks[name];
        const status = isObject(check) ? check.status : undefined;
        const path = pointer("leadVerification", "leads", name, "status");
        if (status === "conflict") {
          add("LEAD_CONFLICT", "review", path, `Printed label near lead ${name} disagrees with its assignment.`, name);
        } else if (status !== "verified") {
          add("LEAD_UNVERIFIED", "review", path, `Lead ${name} assignment could not be confirmed from its printed label.`, name);
        }
      }
    }
  }

  // --- T-wave measurements -----------------------------------------------------------
  if (profile.requireTWave) validateTWaves(record.tWaves, usable, new Set(Object.keys(leads)), profile, add);

  return finish(profile, issues, leadSummaries, Object.keys(leads).filter(isLead));
}

function validateTWaves(
  tWaves: unknown,
  usable: Partial<Record<EcgLead, (number | null)[]>>,
  present: Set<string>,
  profile: ValidationProfile,
  add: (code: IssueCode, severity: IssueSeverity, path: string, message: string, lead?: EcgLead) => void,
) {
  if (tWaves === undefined) {
    add("T_WAVE_REPORT_MISSING", "review", "/tWaves", "T-wave measurements were not provided by the digitizer.");
    return;
  }
  if (!isObject(tWaves) || !["complete", "unavailable"].includes(tWaves.status as string) ||
      !isObject(tWaves.leads) || tWaves.timeDomain !== "median_beat_r_relative_ms") {
    add("T_WAVE_REPORT_INVALID", "error", "/tWaves", "T-wave measurements are not in the expected format.");
    return;
  }
  if (tWaves.status === "unavailable") {
    add("T_WAVE_UNAVAILABLE", "review", "/tWaves/status", "T-wave measurement could not run for this image.");
    return;
  }
  const measured = tWaves.leads;
  for (const name of Object.keys(measured)) {
    if (!isLead(name) || !present.has(name)) {
      add("T_WAVE_LEAD_UNKNOWN", "error", pointer("tWaves", "leads", name), "T-wave result refers to a lead without a waveform.");
    }
  }
  for (const name of Object.keys(usable) as EcgLead[]) {
    const path = pointer("tWaves", "leads", name);
    const lead = measured[name];
    if (!isObject(lead) || lead.status !== "measured") {
      if (isObject(lead) && lead.status !== "not_found") {
        add("T_WAVE_REPORT_INVALID", "error", pointer("tWaves", "leads", name, "status"), `T-wave status for lead ${name} is not recognised.`, name);
      } else {
        add("T_WAVE_MISSING", "review", path, `T-wave measurement unavailable for ${name}.`, name);
      }
      continue;
    }
    const badField = T_FIELDS.find(field => !isFiniteNumber(lead[field]));
    if (badField || !Number.isInteger(lead.beatsUsed) || (lead.beatsUsed as number) < 1) {
      add("T_WAVE_VALUE_INVALID", "error", pointer("tWaves", "leads", name, badField ?? "beatsUsed"), `T-wave measurement for ${name} has a missing or non-numeric value.`, name);
      continue;
    }
    const v = lead as Record<(typeof T_FIELDS)[number], number>;
    // Times are relative to the median beat's R peak (0 ms), so the QRS must contain 0
    // and the T wave must follow the QRS in onset -> peak -> offset order.
    if (!(v.qrsOnsetMs <= 0 && 0 <= v.qrsEndMs && v.qrsEndMs <= v.tOnsetMs && v.tOnsetMs <= v.tPeakMs && v.tPeakMs <= v.tOffsetMs)) {
      add("T_WAVE_ORDER_INVALID", "error", path, `T-wave timing for ${name} is out of order (QRS onset ≤ R ≤ QRS end ≤ T onset ≤ T peak ≤ T end).`, name);
    } else if (v.windowStartMs > v.qrsOnsetMs || v.tOffsetMs > v.windowEndMs) {
      add("T_WAVE_OUTSIDE_BEAT", "error", path, `T-wave timing for ${name} falls outside its measured beat.`, name);
    }
    if (Math.abs(v.tPeakMv) > profile.maxAbsAmplitudeMv) {
      add("T_WAVE_AMPLITUDE_OUT_OF_RANGE", "review", pointer("tWaves", "leads", name, "tPeakMv"), `T-wave amplitude for ${name} is beyond ±${profile.maxAbsAmplitudeMv} mV, likely a tracing error.`, name);
    }
  }
}

function finish(
  profile: ValidationProfile,
  issues: ValidationIssue[],
  leadSummaries: Partial<Record<EcgLead, LeadSummary>>,
  presentLeads: EcgLead[] = [],
): WaveValidationReport {
  for (const name of profile.requiredLeads) {
    if (!presentLeads.includes(name) && !leadSummaries[name]) leadSummaries[name] = { status: "missing", codes: [] };
  }
  for (const name of presentLeads) leadSummaries[name] ??= { status: "invalid", codes: [] };
  for (const issue of issues) {
    const summary = issue.lead && leadSummaries[issue.lead];
    if (!summary) continue;
    if (!summary.codes.includes(issue.code)) summary.codes.push(issue.code);
    if (summary.status === "missing") continue;
    if (issue.severity === "error") summary.status = "invalid";
    else if (summary.status === "ok") summary.status = "needs_review";
  }
  // Errors first, then review items; otherwise in the order the rules found them.
  issues.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "error" ? -1 : 1));
  const errors = issues.filter(issue => issue.severity === "error").length;
  // Record-wide issues (bad sampling rate, missing T-wave/label reports) count against
  // every lead in that area; lead-level issues only against their own lead.
  const recordWide = (area: string) => issues.some(issue => !issue.lead && (ISSUE_AREA[issue.code] === area || ISSUE_AREA[issue.code] === "record"));
  const clean = (area: string) => recordWide(area) ? 0 : presentLeads.filter(name => {
    const summary = leadSummaries[name];
    // `signal` exists only for leads whose samples were usable.
    return summary?.signal !== undefined && !summary.codes.some(code => ISSUE_AREA[code] === area);
  }).length;
  const reviews = issues.length - errors;
  const status: ValidationStatus = errors ? "invalid" : reviews ? "needs_review" : "valid";
  return {
    version: WAVE_VALIDATION_VERSION,
    profile: profile.id,
    status,
    analysisEligible: status === "valid",
    issues,
    leads: leadSummaries,
    counts: {
      errors,
      reviews,
      leadsPresent: presentLeads.length,
      leadsReady: presentLeads.filter(name => leadSummaries[name]?.status === "ok").length,
      waveformsUsable: clean("waveform"),
      tWavesMeasured: clean("tWave"),
      labelsConfirmed: clean("label"),
    },
  };
}

// The gate for any future dataset/model consumer. It re-validates server-side and
// ignores any client-supplied `validation` or `analysisEligible` value.
export class AnalysisAdmissionError extends Error {
  readonly report: WaveValidationReport;
  constructor(report: WaveValidationReport) {
    super(`Record is not eligible for analysis (${report.status}).`);
    this.name = "AnalysisAdmissionError";
    this.report = report;
  }
}

export function admitForAnalysis<T>(record: T, profile: ValidationProfile = TWELVE_LEAD_T_WAVE_PROFILE): { record: T; report: WaveValidationReport } {
  const report = validateWaveAttributes(record, profile);
  if (!report.analysisEligible) throw new AnalysisAdmissionError(report);
  return { record, report };
}
