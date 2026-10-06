// Validate one digitized EKG file from the command line (Taiga #42).
//
// Run with:  npm run validate:ekg -- path/to/file.json
// Exit code 0 = valid, 1 = not valid.

import { readFileSync } from "node:fs";

import { validateEkg } from "../src/lib/validateEkg.ts";

const filePath = process.argv[2];
if (!filePath) {
  console.error("Usage: npm run validate:ekg -- path/to/file.json");
  process.exit(1);
}

const errors = validateEkg(JSON.parse(readFileSync(filePath, "utf8")));

if (errors.length === 0) {
  console.log(`VALID: ${filePath}`);
} else {
  console.log(`NOT VALID: ${filePath}`);
  for (const error of errors) {
    console.log(`  - ${error}`);
  }
  process.exit(1);
}
