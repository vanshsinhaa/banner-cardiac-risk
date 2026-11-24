import { ECG_LEADS } from "../ecg-digitizer/types.ts";
import { EDIT_KINDS } from "./traceEdits.ts";

// Strict validation for POST /api/trace-corrections: known keys only, known leads,
// equal-length sample arrays and well-formed edit log entries.
const MAX_SAMPLES = 20_000;
const MAX_EDITS = 10_000;
const ALLOWED_KEYS = ["captureId", "samplingRateHz", "sampleCount", "auto", "corrected", "editedLeads", "confirmedLeads", "edits", "alignment"];
const EDIT_KEYS = ["seq", "at", "lead", "kind", "index", "before", "after"];

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isLead = (value: unknown) => typeof value === "string" && (ECG_LEADS as readonly string[]).includes(value);
const isPoint = (value: unknown) =>
  value === null || (isObject(value) && Object.keys(value).length === 2 && Number.isFinite(value.i) && Number.isFinite(value.mv));

function isTrace(value: unknown, sampleCount: number) {
  return isObject(value) && Object.keys(value).length > 0 && Object.entries(value).every(([lead, samples]) =>
    isLead(lead) && Array.isArray(samples) && samples.length === sampleCount &&
    samples.every((sample) => sample === null || Number.isFinite(sample)));
}

function isEdit(value: unknown) {
  return isObject(value) && Object.keys(value).every((key) => EDIT_KEYS.includes(key)) &&
    Number.isInteger(value.seq) && typeof value.at === "string" && !Number.isNaN(Date.parse(value.at)) &&
    isLead(value.lead) && (EDIT_KINDS as readonly string[]).includes(value.kind as string) &&
    Number.isInteger(value.index) && isPoint(value.before) && isPoint(value.after);
}

export function validateCorrection(body: unknown): string | null {
  if (!isObject(body)) return "Send a JSON object.";
  const extra = Object.keys(body).filter((key) => !ALLOWED_KEYS.includes(key));
  if (extra.length) return `Unexpected fields: ${extra.join(", ")}.`;
  if (typeof body.captureId !== "string" || !/^[A-Za-z0-9-]{8,64}$/.test(body.captureId)) return "captureId must be 8-64 letters, digits or dashes.";
  if (!Number.isFinite(body.samplingRateHz) || (body.samplingRateHz as number) <= 0) return "samplingRateHz must be positive.";
  const count = body.sampleCount;
  if (!Number.isInteger(count) || (count as number) < 1 || (count as number) > MAX_SAMPLES) return "sampleCount is out of range.";
  if (!isTrace(body.auto, count as number)) return "auto must map lead names to sample arrays.";
  if (!isTrace(body.corrected, count as number)) return "corrected must map lead names to sample arrays.";
  if (!Array.isArray(body.editedLeads) || !body.editedLeads.every(isLead)) return "editedLeads must list lead names.";
  if (body.confirmedLeads !== undefined && (!Array.isArray(body.confirmedLeads) || !body.confirmedLeads.every(isLead))) return "confirmedLeads must list lead names.";
  if (!Array.isArray(body.edits) || body.edits.length > MAX_EDITS || !body.edits.every(isEdit)) return "edits must be a list of trace edits.";
  if (body.alignment !== undefined && !isObject(body.alignment)) return "alignment must be an object.";
  return null;
}

