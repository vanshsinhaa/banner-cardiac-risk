// Minimum resolution settings for EKG captures (Taiga #44).
// This is the only place these numbers live. Change them here.

// How many image pixels must cover one millimeter of EKG grid paper.
// 8 is a starting guess. Tune it once trace extraction (#39, #40) can
// tell us how low we can go before the waveform is lost.
export const MIN_PIXELS_PER_MM = 8;

// Stand-in used until grid calibration exists.
// We cannot measure pixels per millimeter yet, so we estimate it from
// the size of the whole photo (not the crop). Cropping does not change
// how many pixels cover one millimeter, so the crop size tells us nothing.
// We assume the photo shows at most one full page, with a long side of
// 297 mm (A4; US letter is 279 mm, so this is the stricter choice).
// If the photo shows less than a full page, the real resolution is
// higher than our estimate, which is the safe direction.
export const ASSUMED_PAGE_LONG_SIDE_MM = 297;

// 2376 = 297 mm x 8 pixels per mm.
export const FALLBACK_MIN_PHOTO_LONG_SIDE_PX = ASSUMED_PAGE_LONG_SIDE_MM * MIN_PIXELS_PER_MM;
