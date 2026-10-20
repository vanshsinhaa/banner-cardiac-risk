// Resolution check for an EKG photo (Taiga #44).
// Plain function with no browser code, so tests and scripts can use it.

// The ".ts" ending is needed so Node can run this file directly
// (npm test, npm run experiment).
import { FALLBACK_MIN_PHOTO_LONG_SIDE_PX, MIN_PIXELS_PER_MM } from "../config/resolution.ts";

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
  pass: boolean;
  // Which measure was used for this check.
  measure: "pixelsPerMm" | "photoLongSidePx";
  measured: number;
  required: number;
  // Short explanation, for logs and for the screen.
  reason: string;
}

export function checkResolution(image: ResolutionInput): ResolutionResult {
  // Preferred measure: pixels per millimeter, once calibration provides it.
  if (image.pixelsPerMm !== undefined) {
    const measured = image.pixelsPerMm;
    const required = MIN_PIXELS_PER_MM;
    const pass = measured >= required;
    return {
      pass,
      measure: "pixelsPerMm",
      measured,
      required,
      reason: pass
        ? "Resolution OK."
        : `Resolution too low: ${measured.toFixed(1)} pixels per mm, need at least ${required}.`,
    };
  }

  // Stand-in measure: long side of the whole photo in pixels. Using the
  // long side means portrait and landscape photos are treated the same.
  const measured = Math.max(image.width, image.height);
  const required = FALLBACK_MIN_PHOTO_LONG_SIDE_PX;
  const pass = measured >= required;
  return {
    pass,
    measure: "photoLongSidePx",
    measured,
    required,
    reason: pass
      ? "Resolution OK."
      : `Photo too small: ${measured} pixels on its long side, need at least ${required}.`,
  };
}
