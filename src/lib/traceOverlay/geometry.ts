// Maps digitized samples (mV over time) back onto the EKG image so the trace can be
// drawn over the paper. The digitizer does not return pixel coordinates yet, so the
// mapping comes from the standard printed layout: a 10 s grid, 25 mm/s, 10 mm/mV,
// three rows of four 2.5 s leads and a lead II rhythm strip underneath.

export const PAPER_SPEED_MM_S = 25;
export const GAIN_MM_MV = 10;
export const STRIP_SECONDS = 10;
export const GRID_WIDTH_MM = PAPER_SPEED_MM_S * STRIP_SECONDS;

export const STANDARD_ROWS = [
  ["I", "aVR", "V1", "V4"],
  ["II", "aVL", "V2", "V5"],
  ["III", "aVF", "V3", "V6"],
] as const;
export const RHYTHM_ROW = 3;

// Where the grid sits on the page, as fractions of the image size. The defaults match
// the team's synthetic fixture (scripts/makeFullFlowFixture.py); the reviewer can nudge
// them when a real capture is framed differently.
export interface GridLayout {
  left: number;
  width: number;
  firstBaseline: number;
  rowPitch: number;
}
export const DEFAULT_LAYOUT: GridLayout = { left: 160 / 2400, width: 2000 / 2400, firstBaseline: 540 / 1600, rowPitch: 260 / 1600 };

// Per-lead fine adjustment in image pixels and as a gain multiplier.
export interface LeadAlignment {
  dx: number;
  dy: number;
  gain: number;
}
export const NO_ALIGNMENT: LeadAlignment = { dx: 0, dy: 0, gain: 1 };

export interface ImageSize {
  width: number;
  height: number;
}

export interface LeadFrame {
  lead: string;
  row: number;
  originX: number; // x of sample 0
  pxPerSample: number;
  baselineY: number;
  pxPerMv: number;
}

export interface SampleRange {
  start: number;
  end: number; // inclusive
}

// First and last sample index that carry signal, or null for an empty lead.
export function signalRange(samples: readonly (number | null)[]): SampleRange | null {
  let start = -1;
  let end = -1;
  samples.forEach((value, index) => {
    if (value === null || !Number.isFinite(value)) return;
    if (start < 0) start = index;
    end = index;
  });
  return start < 0 ? null : { start, end };
}

// A lead that covers most of the strip is the rhythm strip, otherwise use its grid row.
export function rowForLead(lead: string, range: SampleRange | null, sampleCount: number): number {
  if (range && (range.end - range.start + 1) / sampleCount > 0.5) return RHYTHM_ROW;
  const row = STANDARD_ROWS.findIndex((leads) => (leads as readonly string[]).includes(lead));
  return row < 0 ? RHYTHM_ROW : row;
}

export function leadFrame(
  lead: string,
  row: number,
  sampleCount: number,
  image: ImageSize,
  layout: GridLayout = DEFAULT_LAYOUT,
  alignment: LeadAlignment = NO_ALIGNMENT,
): LeadFrame {
  const gridWidthPx = layout.width * image.width;
  const pxPerMm = gridWidthPx / GRID_WIDTH_MM;
  return {
    lead,
    row,
    originX: layout.left * image.width + alignment.dx,
    pxPerSample: gridWidthPx / sampleCount,
    baselineY: (layout.firstBaseline + row * layout.rowPitch) * image.height + alignment.dy,
    pxPerMv: pxPerMm * GAIN_MM_MV * alignment.gain,
  };
}

export interface TracePoint {
  i: number; // sample index (may be fractional while editing)
  mv: number;
}

export interface PixelPoint {
  x: number;
  y: number;
}

export function sampleToPx(frame: LeadFrame, point: TracePoint): PixelPoint {
  return { x: frame.originX + point.i * frame.pxPerSample, y: frame.baselineY - point.mv * frame.pxPerMv };
}

export function pxToSample(frame: LeadFrame, pixel: PixelPoint): TracePoint {
  return { i: (pixel.x - frame.originX) / frame.pxPerSample, mv: (frame.baselineY - pixel.y) / frame.pxPerMv };
}
