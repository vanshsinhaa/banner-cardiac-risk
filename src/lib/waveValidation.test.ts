import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  admitForAnalysis,
  AnalysisAdmissionError,
  signalStats,
  TWELVE_LEAD_T_WAVE_PROFILE,
  validateWaveAttributes,
  type IssueCode,
} from "./waveValidation.ts";

// Synthetic 12-lead record built by digitizer-service/make_validation_fixture.py: real
// t_wave.py measurements on a neurokit2 simulation laid out like a 3x4 printout.
const FIXTURE = readFileSync(new URL("../../tests/fixtures/wave-validation/valid-12-lead.json", import.meta.url), "utf8");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const valid = (): any => JSON.parse(FIXTURE);
const codes = (record: unknown) => validateWaveAttributes(record).issues.map(issue => issue.code);
const issue = (record: unknown, code: IssueCode) => validateWaveAttributes(record).issues.find(item => item.code === code);

test("synthetic 12-lead record with verified leads and T waves is eligible", () => {
  const report = validateWaveAttributes(valid());
  assert.deepEqual(report.issues, []);
  assert.equal(report.status, "valid");
  assert.equal(report.analysisEligible, true);
  assert.equal(report.profile, "twelve-lead-t-wave/1");
  assert.deepEqual(report.counts, { errors: 0, reviews: 0, leadsPresent: 12, leadsReady: 12,
    waveformsUsable: 12, tWavesMeasured: 12, labelsConfirmed: 12 });
  // Leads printed in one 2.5 s column keep their null padding; that is not a gap.
  const v1 = report.leads.V1!.signal!;
  assert.ok(v1.leadingNulls > 0 && v1.trailingNulls > 0);
  assert.equal(v1.interiorGapSamples, 0);
});

test("validation never changes the record", () => {
  const record = valid();
  record.leads.V2[1500] = null;
  const before = JSON.stringify(record);
  validateWaveAttributes(record);
  assert.equal(JSON.stringify(record), before);
});

test("broken records are invalid with stable codes and paths, without throwing", () => {
  assert.deepEqual(codes(null), ["RECORD_NOT_OBJECT"]);
  assert.deepEqual(codes([]), ["RECORD_NOT_OBJECT"]);
  assert.deepEqual(codes({ ...valid(), leads: {} }).slice(0, 1), ["LEADS_INVALID"]);
  for (const samplingRateHz of [0, -500, Number.NaN, "500", undefined]) {
    assert.equal(issue({ ...valid(), samplingRateHz }, "SAMPLING_RATE_INVALID")?.path, "/samplingRateHz");
  }
  assert.equal(issue({ ...valid(), units: "uV" }, "UNITS_UNSUPPORTED")?.severity, "error");

  const record = valid();
  record.leads["V7/x"] = [0.1];
  assert.equal(issue(record, "LEAD_NAME_UNKNOWN")?.path, "/leads/V7~1x");

  const notFinite = valid();
  notFinite.leads.V1[2600] = "0.2";
  const found = issue(notFinite, "SAMPLE_NOT_FINITE");
  assert.equal(found?.path, "/leads/V1/2600");
  assert.equal(found?.lead, "V1");

  const report = validateWaveAttributes(notFinite);
  assert.equal(report.status, "invalid");
  assert.equal(report.analysisEligible, false);
  assert.equal(report.leads.V1!.status, "invalid");
});

test("an all-null lead and a mismatched sample axis are invalid", () => {
  const empty = valid();
  empty.leads.aVL = empty.leads.aVL.map(() => null);
  assert.equal(issue(empty, "SIGNAL_EMPTY")?.path, "/leads/aVL");

  const short = valid();
  short.leads.V6 = short.leads.V6.slice(0, 4000);
  assert.ok(codes(short).includes("SAMPLE_AXIS_MISMATCH"));
});

test("a missing lead needs review and is shown as missing", () => {
  const record = valid();
  delete record.leads.V2;
  delete record.tWaves.leads.V2;
  const report = validateWaveAttributes(record);
  assert.equal(report.status, "needs_review");
  assert.equal(report.analysisEligible, false);
  assert.deepEqual(report.issues.map(item => [item.code, item.path]), [["LEAD_MISSING", "/leads/V2"]]);
  assert.deepEqual(report.leads.V2, { status: "missing", codes: ["LEAD_MISSING"] });
});

test("interior trace loss is flagged only beyond the 150 ms profile limit", () => {
  const record = valid();
  // V1 is printed from sample 2500; 50 samples at 500 Hz = 100 ms.
  for (let i = 2700; i < 2750; i++) record.leads.V1[i] = null;
  assert.equal(validateWaveAttributes(record).status, "valid");
  assert.equal(validateWaveAttributes(record).leads.V1!.signal!.longestInteriorGapMs, 100);
  for (let i = 2750; i < 2900; i++) record.leads.V1[i] = null;
  const gap = issue(record, "SIGNAL_GAP");
  assert.equal(gap?.path, "/leads/V1");
  assert.equal(gap?.severity, "review");
});

test("short, flat and out-of-range traces need review; zero and negative values do not", () => {
  const short = valid();
  short.leads.V3 = short.leads.V3.map((value: number | null, i: number) => (i < 2500 + 900 ? value : null));
  assert.equal(issue(short, "LEAD_TOO_SHORT")?.lead, "V3");

  const flat = valid();
  flat.leads.aVF = flat.leads.aVF.map((value: number | null) => (value === null ? null : 0));
  assert.equal(issue(flat, "SIGNAL_FLAT")?.lead, "aVF");

  const spike = valid();
  spike.leads.I[100] = 25;
  assert.equal(issue(spike, "AMPLITUDE_OUT_OF_RANGE")?.path, "/leads/I/100");

  const negative = valid();
  negative.leads.I[100] = -1.5;
  negative.leads.I[101] = 0;
  assert.equal(validateWaveAttributes(negative).status, "valid");
});

test("unverified or conflicting lead assignments block eligibility", () => {
  const conflict = valid();
  conflict.leadVerification.leads.V4.status = "conflict";
  // Another recognizer supplying a label must not clear a spatial conflict.
  conflict.recognition = { status: "success", leads: { V4: { status: "success", source: "model", label: "V4" } } };
  const found = issue(conflict, "LEAD_CONFLICT");
  assert.equal(found?.path, "/leadVerification/leads/V4/status");
  assert.equal(validateWaveAttributes(conflict).analysisEligible, false);

  const unverified = valid();
  delete unverified.leadVerification.leads.III;
  assert.equal(issue(unverified, "LEAD_UNVERIFIED")?.lead, "III");

  const missing = valid();
  delete missing.leadVerification;
  assert.deepEqual(codes(missing), ["LEAD_VERIFICATION_MISSING"]);
});

test("missing T-wave measurements need review with the affected lead", () => {
  const older = valid();
  delete older.tWaves;
  assert.deepEqual(codes(older), ["T_WAVE_REPORT_MISSING"]);

  const unavailable = valid();
  unavailable.tWaves = { ...unavailable.tWaves, status: "unavailable", reason: "dependency_missing", leads: {} };
  assert.deepEqual(codes(unavailable), ["T_WAVE_UNAVAILABLE"]);

  const notFound = valid();
  notFound.tWaves.leads.V2 = { status: "not_found" };
  const found = issue(notFound, "T_WAVE_MISSING");
  assert.equal(found?.path, "/tWaves/leads/V2");
  assert.equal(found?.message, "T-wave measurement unavailable for V2.");
  assert.equal(validateWaveAttributes(notFound).leads.V2!.status, "needs_review");

  const omitted = valid();
  delete omitted.tWaves.leads.V5;
  assert.equal(issue(omitted, "T_WAVE_MISSING")?.lead, "V5");
});

test("inconsistent T-wave values are invalid", () => {
  const nullValue = valid();
  nullValue.tWaves.leads.II.tPeakMs = null;
  assert.equal(issue(nullValue, "T_WAVE_VALUE_INVALID")?.path, "/tWaves/leads/II/tPeakMs");

  const noBeats = valid();
  noBeats.tWaves.leads.II.beatsUsed = 0;
  assert.equal(issue(noBeats, "T_WAVE_VALUE_INVALID")?.path, "/tWaves/leads/II/beatsUsed");

  const order = valid();
  const ii = order.tWaves.leads.II;
  [ii.tOnsetMs, ii.tOffsetMs] = [ii.tOffsetMs, ii.tOnsetMs];
  assert.equal(issue(order, "T_WAVE_ORDER_INVALID")?.lead, "II");

  const outside = valid();
  outside.tWaves.leads.V6.windowEndMs = outside.tWaves.leads.V6.tOffsetMs - 10;
  assert.equal(issue(outside, "T_WAVE_OUTSIDE_BEAT")?.lead, "V6");

  const stray = valid();
  delete stray.leads.V6;
  assert.equal(issue(stray, "T_WAVE_LEAD_UNKNOWN")?.path, "/tWaves/leads/V6");

  const strip = valid();
  strip.tWaves.timeDomain = "strip_ms";
  assert.deepEqual(codes(strip), ["T_WAVE_REPORT_INVALID"]);

  const badStatus = valid();
  badStatus.tWaves.leads.I = { status: "maybe" };
  assert.equal(issue(badStatus, "T_WAVE_REPORT_INVALID")?.path, "/tWaves/leads/I/status");
});

test("an inverted T wave is a valid measurement", () => {
  const record = valid();
  record.tWaves.leads.aVR.tPeakMv = -0.4;
  assert.equal(validateWaveAttributes(record).status, "valid");
  record.tWaves.leads.aVR.tPeakMv = -40;
  assert.equal(issue(record, "T_WAVE_AMPLITUDE_OUT_OF_RANGE")?.severity, "review");
});

test("the admission gate re-validates and ignores client-supplied eligibility", () => {
  assert.equal(admitForAnalysis(valid()).report.analysisEligible, true);
  const forged = valid();
  delete forged.tWaves;
  forged.validation = { status: "valid", analysisEligible: true, issues: [] };
  assert.throws(() => admitForAnalysis(forged), (error: unknown) =>
    error instanceof AnalysisAdmissionError && error.report.issues[0].code === "T_WAVE_REPORT_MISSING");
});

test("a narrower profile can accept partial records", () => {
  const record = valid();
  for (const name of ["V1", "V2", "V3", "V4", "V5", "V6"]) {
    delete record.leads[name];
    delete record.tWaves.leads[name];
  }
  assert.equal(validateWaveAttributes(record).status, "needs_review");
  const limb = { ...TWELVE_LEAD_T_WAVE_PROFILE, id: "limb-leads/test", requiredLeads: ["I", "II", "III", "aVR", "aVL", "aVF"] as const };
  assert.equal(validateWaveAttributes(record, limb).status, "valid");
});

test("signal statistics separate padding from interior gaps", () => {
  const stats = signalStats([null, null, 0.1, null, null, 0.3, 0, null], 1000);
  assert.deepEqual(stats, {
    samples: 8, measuredSamples: 3, firstSample: 2, lastSample: 6, durationMs: 5,
    leadingNulls: 2, trailingNulls: 1, interiorGapSamples: 2, longestInteriorGapMs: 2, minMv: 0, maxMv: 0.3,
  });
});

test("errors are listed before review items", () => {
  const record = valid();
  record.tWaves.leads.V2 = { status: "not_found" };
  record.leads.I[10] = "bad";
  assert.deepEqual(validateWaveAttributes(record).issues.map(item => item.severity), ["error", "review"]);
});

test("per-area counts show what worked when leads are not ready", () => {
  const record = valid();
  for (const name of ["I", "II", "III", "V1"]) record.leadVerification.leads[name].status = "unverified";
  record.tWaves.leads.V2 = { status: "not_found" };
  for (let i = 2700; i < 2900; i++) record.leads.V1[i] = null;
  record.leads.aVL[1500] = "bad";
  const { counts } = validateWaveAttributes(record);
  // aVL has unusable samples, so it counts in none of the areas.
  assert.equal(counts.waveformsUsable, 10);
  assert.equal(counts.tWavesMeasured, 10);
  assert.equal(counts.labelsConfirmed, 7);
  assert.equal(counts.leadsReady, 6);

  const noTWaves = valid();
  delete noTWaves.tWaves;
  assert.equal(validateWaveAttributes(noTWaves).counts.tWavesMeasured, 0);
  assert.equal(validateWaveAttributes(noTWaves).counts.labelsConfirmed, 12);
});
