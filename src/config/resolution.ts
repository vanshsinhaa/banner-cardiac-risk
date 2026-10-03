// Minimum resolution settings for EKG captures (Taiga #44).
// This is the only place these numbers live. Change them here.

// How many image pixels must cover one millimeter of EKG grid paper.
// 8 is a starting guess. Tune it once trace extraction (#39, #40) can
// tell us how low we can go before the waveform is lost.
export const MIN_PIXELS_PER_MM = 8;

// Stand-in limit used until grid calibration exists.
// We cannot measure pixels per millimeter yet, so we check the width of
// the cropped image instead.
// 2000 = 250 mm (a 10 second strip at 25 mm/s) x 8 pixels per mm.
// This is also a guess. It assumes the crop covers a full-width strip.
export const FALLBACK_MIN_CROP_WIDTH_PX = 2000;
