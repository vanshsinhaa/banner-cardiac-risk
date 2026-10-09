import type { EcgDigitizationResult } from "./types";

export class DigitizerNotConfiguredError extends Error {
  constructor() {
    super("The ECG digitizer adapter has not been connected yet.");
    this.name = "DigitizerNotConfiguredError";
  }
}

export async function digitizeEcgImage(image: File): Promise<EcgDigitizationResult> {
  void image;
  throw new DigitizerNotConfiguredError();
}
