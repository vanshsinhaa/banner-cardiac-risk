// Check digitizer results with the wave-attribute validator (Taiga #64).
//
// Run with:  npm run validate:waves -- path/to/result.json [more.json ...]
// Add --json to print the full reports instead of the summary.
// Exit code 0 = every file is eligible for analysis, 1 = at least one is not.

import { readFileSync } from "node:fs";

import { validateWaveAttributes } from "../src/lib/waveValidation.ts";

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const files = args.filter(arg => arg !== "--json");
if (!files.length) {
  console.error("Usage: npm run validate:waves -- path/to/result.json [more.json ...] [--json]");
  process.exit(1);
}

const LABEL = { valid: "READY FOR ANALYSIS", needs_review: "NEEDS REVIEW", invalid: "INVALID" } as const;
let allEligible = true;
for (const file of files) {
  let record: unknown;
  try {
    record = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    console.log(`ERROR: ${file}: ${error instanceof Error ? error.message : "could not read"}`);
    allEligible = false;
    continue;
  }
  const report = validateWaveAttributes(record);
  allEligible &&= report.analysisEligible;
  if (asJson) {
    console.log(JSON.stringify({ file, ...report }, null, 2));
    continue;
  }
  const { errors, reviews, leadsReady, waveformsUsable, tWavesMeasured, labelsConfirmed } = report.counts;
  console.log(`${LABEL[report.status]}: ${file}`);
  console.log(`  ${leadsReady}/12 leads ready | ${waveformsUsable}/12 waveforms usable | ${tWavesMeasured}/12 T-waves measured | ${labelsConfirmed}/12 labels confirmed`);
  console.log(`  profile ${report.profile}; ${errors} errors, ${reviews} review items`);
  for (const issue of report.issues) {
    console.log(`  - [${issue.severity}] ${issue.code} at ${issue.path || "/"}: ${issue.message}`);
  }
}
process.exit(allEligible ? 0 : 1);
