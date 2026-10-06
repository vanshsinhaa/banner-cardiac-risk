// Time order check for digitized EKG data (Taiga #42).
//
// The JSON Schema in schemas/ekg_digitized.schema.json checks types,
// units, and ranges. It cannot compare one field with another, so it
// cannot check time order. This helper does that part.
//
// Rules checked, for each lead:
//   1. Inside a wave: onset_ms <= peak_ms <= offset_ms.
//   2. Each wave starts at or after the end of the wave before it.
//      This covers P -> QRS -> T inside a beat, and the last wave of one
//      beat -> the first wave of the next beat. Missing (null) waves are
//      skipped.
//
// Run the schema check first. This helper assumes the shape is valid.

// Only the fields this helper reads. This is not the full data type.
interface Wave {
  onset_ms: number;
  peak_ms: number;
  offset_ms: number;
}

interface EkgForOrderCheck {
  leads: {
    name: string;
    beats: { p: Wave | null; qrs: Wave | null; t: Wave | null }[];
  }[];
}

// Returns a list of problems. An empty list means the order is fine.
export function checkWaveOrder(ekg: EkgForOrderCheck): string[] {
  const errors: string[] = [];

  for (const lead of ekg.leads) {
    // End time and label of the wave before the current one.
    let previousOffset: number | null = null;
    let previousLabel = "";

    lead.beats.forEach((beat, beatIndex) => {
      const waves: [string, Wave | null][] = [
        ["p", beat.p],
        ["qrs", beat.qrs],
        ["t", beat.t],
      ];

      for (const [waveName, wave] of waves) {
        if (wave === null) continue;
        const label = `lead ${lead.name}, beat ${beatIndex}, ${waveName}`;

        // Rule 1: onset, then peak, then offset.
        if (wave.onset_ms > wave.peak_ms) {
          errors.push(`${label}: onset_ms (${wave.onset_ms}) is after peak_ms (${wave.peak_ms}).`);
        }
        if (wave.peak_ms > wave.offset_ms) {
          errors.push(`${label}: peak_ms (${wave.peak_ms}) is after offset_ms (${wave.offset_ms}).`);
        }

        // Rule 2: this wave starts after the wave before it ends.
        if (previousOffset !== null && wave.onset_ms < previousOffset) {
          errors.push(
            `${label}: onset_ms (${wave.onset_ms}) is before the end of ${previousLabel} (${previousOffset}).`,
          );
        }

        previousOffset = wave.offset_ms;
        previousLabel = label;
      }
    });
  }

  return errors;
}
