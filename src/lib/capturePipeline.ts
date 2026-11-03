import { isEcgDigitizationResult, type EcgDigitizationResult } from "./ecg-digitizer/types.ts";
import { DEID_ENDPOINT, DEID_SUCCESS_STATUS, DEID_TIMEOUT_MS } from "../config/deidentification.ts";

export const MAX_CAPTURE_BYTES = 10 * 1024 * 1024;
const PNG = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/;

export interface DeidentifiedCapture {
  status: "redacted";
  image: string;
  regions_redacted: number;
  mock: boolean;
}

export interface Assessment {
  status: "passed" | "needs_review" | "failed";
  detected_leads: string[];
  reasons: string[];
  advisories?: string[];
  missing_leads?: string[];
  processed_image: string;
}

export function pngBlob(image: string): Blob {
  if (!PNG.test(image)) throw new Error("The service did not return a PNG image.");
  const encoded = image.slice(image.indexOf(",") + 1);
  if (encoded.length > Math.ceil(MAX_CAPTURE_BYTES / 3) * 4) {
    throw new Error("The processed image exceeds 10 MB. Try a smaller crop.");
  }
  const bytes = Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
  if (!bytes.length || bytes.length > MAX_CAPTURE_BYTES) throw new Error("The processed image exceeds 10 MB.");
  return new Blob([bytes], { type: "image/png" });
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  const value: unknown = await response.json();
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The service returned an invalid response.");
  const data = value as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "The image service could not complete the request.");
  return data;
}

export async function deidentifyCapture(blob: Blob, signal: AbortSignal): Promise<DeidentifiedCapture> {
  if (!blob.size || blob.size > MAX_CAPTURE_BYTES) throw new Error("The crop must be no larger than 10 MB.");
  const body = new FormData();
  body.append("file", blob, "ekg-capture.png");
  const data = await responseJson(await fetch(DEID_ENDPOINT, {
    method: "POST", body, signal: AbortSignal.any([signal, AbortSignal.timeout(DEID_TIMEOUT_MS)]),
  }));
  if (data.status !== DEID_SUCCESS_STATUS || typeof data.image !== "string" || !PNG.test(data.image) ||
      typeof data.regions_redacted !== "number" || !Number.isInteger(data.regions_redacted) || data.regions_redacted < 0) {
    throw new Error("De-identification was not confirmed. Nothing was saved or sent for analysis.");
  }
  pngBlob(data.image);
  return { status: "redacted", image: data.image, regions_redacted: data.regions_redacted, mock: data.mock === true };
}

export async function analyzeCapture(capture: DeidentifiedCapture, signal: AbortSignal): Promise<Assessment> {
  if (capture.mock) throw new Error("Test previews cannot be sent for analysis.");
  const data = await responseJson(await fetch("/api/analyze", {
    method: "POST", headers: { "Content-Type": "image/png" }, body: pngBlob(capture.image),
    signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]),
  }));
  if (!["passed", "needs_review", "failed"].includes(String(data.status)) ||
      !Array.isArray(data.detected_leads) || !data.detected_leads.every(item => typeof item === "string") ||
      !Array.isArray(data.reasons) || !data.reasons.every(item => typeof item === "string") ||
      (data.advisories !== undefined && (!Array.isArray(data.advisories) || !data.advisories.every(item => typeof item === "string"))) ||
      (data.missing_leads !== undefined && (!Array.isArray(data.missing_leads) || !data.missing_leads.every(item => typeof item === "string"))) ||
      typeof data.processed_image !== "string" || !PNG.test(data.processed_image)) {
    throw new Error("The readability service returned an invalid assessment.");
  }
  return data as unknown as Assessment;
}

export async function digitizeCapture(capture: DeidentifiedCapture, signal: AbortSignal): Promise<EcgDigitizationResult> {
  if (capture.mock) throw new Error("Test previews cannot be sent to the digitizer.");
  const data = await responseJson(await fetch("/api/ecg/digitize", {
    method: "POST", headers: { "Content-Type": "image/png" }, body: pngBlob(capture.image),
    signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]),
  }));
  if (!isEcgDigitizationResult(data)) throw new Error("The digitizer returned invalid waveform data.");
  return data;
}
