"use client";

import { useEffect, useMemo, useReducer, useState } from "react";
import type { EcgDigitizationResult } from "@/lib/ecg-digitizer/types";
import { DEFAULT_STRIDE, applyCorrections, toControlPoints } from "@/lib/traceOverlay/controlPoints";
import { DEFAULT_LAYOUT, rowForLead, signalRange, type GridLayout, type ImageSize, type LeadAlignment } from "@/lib/traceOverlay/geometry";
import { editedLeads, initReview, reviewReducer } from "@/lib/traceOverlay/traceEdits";
import { leadWindows } from "@/lib/traceOverlay/viewport";
import { isRiskScoreResult, type RiskScoreResult } from "@/lib/riskScore/contract";
import RiskScoreCard from "../risk/RiskScoreCard";
import AppBar, { AppBarButton, AppBarChip } from "../shell/AppBar";
import ConfirmStep from "./ConfirmStep";
import ResearchDisclaimer from "./ResearchDisclaimer";
import Stepper, { type ReviewStep } from "./Stepper";
import TraceEditor from "./TraceEditor";
import styles from "./review.module.css";

interface Props {
  imageSrc: string;
  digitization: EcgDigitizationResult;
  captureId?: string;
  onExit?: () => void;
  exitLabel?: string;
  /** Marks the page as running on synthetic demo data. */
  demoNote?: string;
}

// Review trace (#75) -> Confirm -> Risk score (#76). The reviewer checks every lead
// before the corrected trace is saved and the score is requested.
export default function ReviewFlow({ imageSrc, digitization, captureId, onExit, exitLabel = "Back to capture", demoNote }: Props) {
  const leads = useMemo(() => Object.keys(digitization.leads), [digitization]);
  const sampleCount = useMemo(() => Math.max(...Object.values(digitization.leads).map((samples) => samples?.length ?? 0)), [digitization]);
  const sampleRanges = useMemo(() => Object.fromEntries(leads.map((lead) =>
    [lead, signalRange(digitization.leads[lead as keyof typeof digitization.leads] ?? [])])), [digitization, leads]);
  const rows = useMemo(() => Object.fromEntries(leads.map((lead) => [lead, rowForLead(lead, sampleRanges[lead], sampleCount)])), [leads, sampleRanges, sampleCount]);

  const [review, dispatch] = useReducer(reviewReducer, digitization, (result) => initReview(Object.fromEntries(
    Object.entries(result.leads).map(([lead, samples]) => [lead, toControlPoints(samples ?? [])]),
  )));
  const [step, setStep] = useState<ReviewStep>("review");
  const [image, setImage] = useState<ImageSize | null>(null);
  const [imageError, setImageError] = useState(false);
  const [selected, setSelected] = useState(leads[0] ?? "");
  const [windowIndex, setWindowIndex] = useState(0);
  const [confirmed, setConfirmed] = useState<ReadonlySet<string>>(new Set());
  const [layout, setLayout] = useState<GridLayout>(DEFAULT_LAYOUT);
  const [alignments, setAlignments] = useState<Record<string, LeadAlignment>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [score, setScore] = useState<RiskScoreResult | null>(null);

  useEffect(() => {
    const element = new Image();
    element.onload = () => setImage({ width: element.naturalWidth, height: element.naturalHeight });
    element.onerror = () => setImageError(true);
    element.src = imageSrc;
  }, [imageSrc]);

  function selectLead(lead: string) {
    setSelected(lead);
    setWindowIndex(0);
  }

  function confirmLead(lead: string) {
    const next = new Set(confirmed).add(lead);
    setConfirmed(next);
    const following = [...leads.slice(leads.indexOf(lead) + 1), ...leads].find((other) => !next.has(other));
    if (following) selectLead(following);
  }

  async function submit() {
    setBusy(true);
    setError(null);
    const corrected = Object.fromEntries(Object.entries(review.corrected).map(([lead, points]) => [lead,
      applyCorrections(digitization.leads[lead as keyof typeof digitization.leads] ?? [], review.auto[lead] ?? [], points, DEFAULT_STRIDE)]));
    const changed = editedLeads(review);
    try {
      const saved = await fetch("/api/trace-corrections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          captureId: captureId ?? crypto.randomUUID(),
          samplingRateHz: digitization.samplingRateHz,
          sampleCount,
          auto: digitization.leads,
          corrected,
          editedLeads: changed,
          confirmedLeads: [...confirmed],
          edits: review.edits,
          alignment: { layout, leads: alignments },
        }),
      });
      if (!saved.ok) throw new Error((await saved.json().catch(() => ({}))).error ?? "The corrected trace could not be saved.");
      const response = await fetch("/api/risk-score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ traceSource: changed.length ? "corrected" : "auto" }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !isRiskScoreResult(result)) throw new Error("The risk score could not be calculated.");
      setScore(result);
      setStep("score");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const allConfirmed = leads.every((lead) => confirmed.has(lead));
  const canSelect = (target: ReviewStep) => target === "review" || (target === "confirm" && allConfirmed) || (target === "score" && score !== null);

  return (
    <div className={styles.page}>
      <AppBar section="Trace review"
        meta={<>{demoNote && <AppBarChip>Synthetic demo</AppBarChip>}{captureId && <AppBarChip>{captureId}</AppBarChip>}</>}
        action={onExit && <AppBarButton onClick={onExit}>{exitLabel}</AppBarButton>} />
    <div className={styles.flow}>
      <header className={styles.flowHeader}>
        <div className={styles.flowTitleRow}>
          <div>
            <h1 className={styles.flowTitle}>{step === "review" ? "Check the detected waveform" : step === "confirm" ? "Confirm before scoring" : "Risk score"}</h1>
          </div>
          <Stepper current={step} onSelect={setStep} canSelect={canSelect} />
        </div>
        {demoNote && <p className={styles.demoNote}>{demoNote}</p>}
        {step !== "score" && <ResearchDisclaimer compact />}
      </header>

      {imageError && <p role="alert" className={styles.errorText}>The EKG image could not be loaded.</p>}
      {step === "review" && image && (
        <TraceEditor imageSrc={imageSrc} image={image} leads={leads} rows={rows} sampleCount={sampleCount}
          autoSamples={digitization.leads[selected as keyof typeof digitization.leads] ?? []}
          rate={digitization.samplingRateHz} review={review} dispatch={dispatch} selected={selected} onSelect={selectLead}
          windows={leadWindows(sampleRanges[selected])} windowIndex={windowIndex} onWindow={setWindowIndex}
          confirmed={confirmed} onConfirm={confirmLead} onContinue={() => setStep("confirm")}
          layout={layout} onLayout={setLayout} alignments={alignments}
          onAlignment={(lead, alignment) => setAlignments({ ...alignments, [lead]: alignment })} />
      )}
      {step === "confirm" && (
        <ConfirmStep leads={leads} review={review} busy={busy} error={error} onSubmit={submit}
          onEdit={(lead) => { selectLead(lead); setStep("review"); }} />
      )}
      {step === "score" && score && (
        <div className={styles.scoreStep}>
          <RiskScoreCard result={score} />
          <div className={styles.confirmActions}>
            <button type="button" className={styles.secondaryButton} onClick={() => setStep("review")}>Back to trace review</button>
            {onExit && <button type="button" className={styles.primaryButton} onClick={onExit}>{exitLabel}</button>}
          </div>
        </div>
      )}
    </div>
    </div>
  );
}
