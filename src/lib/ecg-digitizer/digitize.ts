// Bridge between the Next.js backend and the Python digitizer service
// (digitizer-service/server.py). Called by src/app/api/ecg/digitize/route.ts.

import { isEcgDigitizationResult, type EcgDigitizationResult } from "./types";

// Thrown when ECG_DIGITIZER_URL is not set, so the route can answer 501.
export class DigitizerNotConfiguredError extends Error {
  constructor() {
    super("The ECG digitizer adapter has not been connected yet.");
    this.name = "DigitizerNotConfiguredError";
  }
}

// Thrown when the digitizer service cannot be reached (it is not running).
export class DigitizerUnavailableError extends Error {
  constructor() {
    super("The ECG digitizer service is not reachable.");
    this.name = "DigitizerUnavailableError";
  }
}

// Thrown when the service answered but could not digitize the image.
export class DigitizerFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DigitizerFailedError";
  }
}

// Sends an uploaded image to the digitizer service and returns the digitized leads.
// It is async because the service takes several seconds to answer, so it returns a
// Promise: the result arrives later, or one of the errors above is thrown.
export async function digitizeEcgImage(image: File): Promise<EcgDigitizationResult> {
  // Base address of the service, e.g. http://127.0.0.1:8000, set in .env.local.
  const url = process.env.ECG_DIGITIZER_URL;
  if (!url) {
    throw new DigitizerNotConfiguredError();
  }

  // Package the image as a form upload. The field name "image" must match the
  // `image` parameter of the /digitize endpoint in server.py.
  const formData = new FormData();
  formData.append("image", image);

  // Send the upload and wait for the answer. fetch() only throws when the service
  // cannot be reached at all; an error status from the service does not throw.
  // `response` is declared outside the try block so it can be used after it.
  let response: Response;
  try {
    response = await fetch(`${url}/digitize`, { method: "POST", body: formData });
  } catch {
    throw new DigitizerUnavailableError();
  }

  // Parse the reply body as JSON. If it is not valid JSON, use null instead of crashing.
  // The type is `unknown` because data from another program has to be checked before use.
  const payload: unknown = await response.json().catch(() => null);

  // The service answered with an error status (e.g. 422 for an image it could not digitize).
  // It reports errors as { detail: "..." }, so use that message when it is present.
  if (!response.ok) {
    const detail =
      typeof payload === "object" &&
      payload !== null &&
      "detail" in payload &&
      typeof payload.detail === "string"
        ? payload.detail
        : `The ECG digitizer service failed (${response.status}).`;
    throw new DigitizerFailedError(detail);
  }

  // Confirm the reply has the shape the app expects (named leads of finite numbers,
  // a sampling rate, and "mV" units) before handing it back.
  if (!isEcgDigitizationResult(payload)) {
    throw new DigitizerFailedError("The ECG digitizer service returned data in an unexpected format.");
  }
  return payload;
}
