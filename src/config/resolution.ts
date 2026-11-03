// Provisional detail references (Taiga #44), not extraction requirements.

// Source-grid density reference, pending extraction-error benchmarking.
export const REFERENCE_PIXELS_PER_MM = 8;

// The original estimate assumes a full A4 page fills the photo. Different
// layouts, framing and resized uploads invalidate that assumption. Source
// dimensions must stay separate from crop/output dimensions and resampling.
export const ASSUMED_PAGE_LONG_SIDE_MM = 297;

// 2376 = 297 mm x 8 pixels per mm.
export const PHOTO_LONG_SIDE_REFERENCE_PX = ASSUMED_PAGE_LONG_SIDE_MM * REFERENCE_PIXELS_PER_MM;
