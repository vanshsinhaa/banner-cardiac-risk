"use client";

import { useState } from "react";
import type { WaveValidationReport } from "@/lib/waveValidation";
import WaveValidationSummary from "./WaveValidationSummary";
import styles from "./WaveValidationDemo.module.css";

// Development demo for Taiga #64: load a digitizer result JSON, optionally inject
// defects, and send it to the real /api/ecg/validate endpoint.

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const DEFECTS: { id: string; label: string; apply: (record: Json) => void }[] = [
  { id: "t-missing", label: "T wave not found in V2", apply: r => { if (r.tWaves?.leads) r.tWaves.leads.V2 = { status: "not_found" }; } },
  { id: "conflict", label: "Printed label conflicts with lead V4", apply: r => { if (r.leadVerification?.leads?.V4) r.leadVerification.leads.V4.status = "conflict"; } },
  { id: "drop-lead", label: "Lead aVL not extracted", apply: r => { delete r.leads?.aVL; delete r.tWaves?.leads?.aVL; delete r.leadVerification?.leads?.aVL; } },
  { id: "gap", label: "Trace lost for 300 ms in V1", apply: r => {
    const v1: (number | null)[] | undefined = r.leads?.V1;
    const first = v1?.findIndex(value => value !== null) ?? -1;
    if (v1 && first !== -1) for (let i = first + 200; i < first + 200 + 0.3 * r.samplingRateHz; i++) v1[i] = null;
  } },
  { id: "t-order", label: "T-wave onset after its peak in II", apply: r => { const ii = r.tWaves?.leads?.II; if (ii?.tPeakMs !== undefined) ii.tOnsetMs = ii.tPeakMs + 20; } },
  { id: "bad-sample", label: "Non-numeric sample in lead I", apply: r => { if (r.leads?.I) r.leads.I[10] = "NaN"; } },
  { id: "no-t-report", label: "Older digitizer without T-wave report", apply: r => { delete r.tWaves; } },
];

export default function WaveValidationDemo() {
  const [record, setRecord] = useState<Json | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [defects, setDefects] = useState<string[]>([]);
  const [report, setReport] = useState<WaveValidationReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load(file: File) {
    setReport(null);
    setError(null);
    try {
      setRecord(JSON.parse(await file.text()));
      setFileName(file.name);
    } catch {
      setRecord(null);
      setError("That file is not valid JSON.");
    }
  }

  async function validate() {
    if (!record) return;
    const copy: Json = structuredClone(record);
    for (const defect of DEFECTS) if (defects.includes(defect.id)) defect.apply(copy);
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/ecg/validate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(copy) });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error ?? `Validation failed (${response.status}).`);
      setReport(body);
    } catch (caught) {
      setReport(null);
      setError(caught instanceof Error ? caught.message : "Validation failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.page}>
      <header>
        <p className={styles.eyebrow}>DEVELOPMENT DEMO · TAIGA #64</p>
        <h1>Wave-attribute validation</h1>
        <p className={styles.lead}>Load a digitizer result (for example <code>tests/fixtures/wave-validation/valid-12-lead.json</code>), add defects, and check it with the server validator.</p>
      </header>
      <label className={styles.file}>
        <span>Digitizer result JSON</span>
        <input type="file" accept="application/json,.json" onChange={event => { const file = event.target.files?.[0]; if (file) void load(file); }} />
      </label>
      {fileName && <p className={styles.loaded}>Loaded {fileName}: {Object.keys(record?.leads ?? {}).length} leads.</p>}
      <fieldset className={styles.defects} disabled={!record}>
        <legend>Inject defects (applied to a copy)</legend>
        {DEFECTS.map(defect => <label key={defect.id}>
          <input type="checkbox" checked={defects.includes(defect.id)}
            onChange={event => setDefects(current => event.target.checked ? [...current, defect.id] : current.filter(id => id !== defect.id))} />
          {defect.label}
        </label>)}
      </fieldset>
      <button className={styles.primary} disabled={!record || busy} onClick={() => void validate()}>{busy ? "Checking…" : "Validate"}</button>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {report && <WaveValidationSummary report={report} />}
    </main>
  );
}
