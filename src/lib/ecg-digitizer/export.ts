// Converts a digitized ECG into other file formats for download.
// Used by src/app/api/ecg/digitize/route.ts (server)

import { ECG_LEADS, type EcgDigitizationResult } from "./types";

// Turns a digitized ECG into CSV text: one row per sample, one column per lead.
//
//   time_s,I,II,III,...
//   0.000,0.012,0.031,,...
//   0.002,0.015,0.029,,...
//

// - A null sample (no signal) is written as an empty cell.
export function toCsv(result: EcgDigitizationResult): string {
  // Leads present in the result, in the standard order (not the JSON's key order).
  const leads = ECG_LEADS.filter((lead) => result.leads[lead] !== undefined);

  // Every lead shares one time axis, so any lead's length is the number of rows.
  const sampleCount = result.leads[leads[0]]?.length ?? 0;

  const rows = [["time_s", ...leads].join(",")];
  for (let i = 0; i < sampleCount; i++) {
    const time = (i / result.samplingRateHz).toFixed(3);
    const samples = leads.map((lead) => result.leads[lead]![i] ?? "");
    rows.push([time, ...samples].join(","));
  }
  return rows.join("\n") + "\n";
}
