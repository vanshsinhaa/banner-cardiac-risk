// Source-image detail advice. Dimensions never establish ECG readability.
// Plain function with no browser code, so tests and scripts can use it.

// The ".ts" ending is needed so Node can run this file directly
// (npm test, npm run experiment).
import { PHOTO_LONG_SIDE_REFERENCE_PX, REFERENCE_PIXELS_PER_MM } from "../config/resolution.ts";

export interface ResolutionInput {
  // Size of the whole photo in pixels, before cropping. Cropping does
  // not change the resolution, so do not pass the crop size here.
  width: number;
  height: number;
  // Pixels per millimeter of grid. Grid calibration will fill this in
  // later. Leave it out for now.
  pixelsPerMm?: number;
}

export interface ResolutionResult {
  status: "unassessed" | "advisory" | "invalid";
  // Which measure was used for this check.
  measure: "pixelsPerMm" | "photoLongSidePx";
  measured: number | null;
  reference: number;
  // Short explanation, for logs and for the screen.
  reason: string;
}

export function checkResolution(image: ResolutionInput): ResolutionResult {
  if (![image.width, image.height].every(value => Number.isSafeInteger(value) && value > 0)) {
    return {
      status: "invalid", measure: "photoLongSidePx", measured: null,
      reference: PHOTO_LONG_SIDE_REFERENCE_PX,
      reason: "This image has invalid dimensions. Choose another JPEG or PNG.",
    };
  }
  // Invalid/unavailable calibration falls back to original dimensions. Neither
  // provisional reference can authorize downstream numerical analysis.
  const hasGridScale = image.pixelsPerMm !== undefined &&
    Number.isFinite(image.pixelsPerMm) && image.pixelsPerMm > 0;
  const measure = hasGridScale ? "pixelsPerMm" : "photoLongSidePx";
  const measured = hasGridScale ? image.pixelsPerMm! : Math.max(image.width, image.height);
  const reference = hasGridScale ? REFERENCE_PIXELS_PER_MM : PHOTO_LONG_SIDE_REFERENCE_PX;
  const status = measured < reference ? "advisory" : "unassessed";
  return {
    status, measure, measured, reference,
    reason: status === "advisory"
      ? "This file may have limited detail. You can crop it and we’ll check whether it can be processed."
      : "Image detail will be assessed during processing.",
  };
}
