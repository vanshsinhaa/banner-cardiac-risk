// Full check of a digitized EKG file (Taiga #42).
// Step 1: check the shape against schemas/ekg_digitized.schema.json.
// Step 2: if the shape is fine, check the time order of the waves.
//
// Runs in Node only (it reads the schema file from disk).

import { readFileSync } from "node:fs";

import Ajv2020 from "ajv/dist/2020.js";

import { checkWaveOrder } from "./checkWaveOrder.ts";

const schemaUrl = new URL("../../schemas/ekg_digitized.schema.json", import.meta.url);
const schema = JSON.parse(readFileSync(schemaUrl, "utf8"));

// allErrors: report every problem, not only the first one.
const ajv = new Ajv2020({ allErrors: true });
const validateShape = ajv.compile(schema);

// Returns a list of problems. An empty list means the data is valid.
export function validateEkg(data: unknown): string[] {
  if (!validateShape(data)) {
    return (validateShape.errors ?? []).map((error) => {
      const where = error.instancePath || "(top level)";
      return `${where}: ${error.message}`;
    });
  }
  // The shape is valid here, so the helper can read the fields safely.
  return checkWaveOrder(data as Parameters<typeof checkWaveOrder>[0]);
}
