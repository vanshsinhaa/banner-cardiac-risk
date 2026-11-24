"use client";

import { useMemo, useReducer, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent, PointerEvent } from "react";
import type { EcgDigitizationResult } from "@/lib/ecg-digitizer/types";
import { DEFAULT_STRIDE, toControlPoints, toRuns, toSamples } from "@/lib/traceOverlay/controlPoints";
import {
  DEFAULT_LAYOUT, NO_ALIGNMENT, leadFrame, pxToSample, rowForLead, sampleToPx, signalRange,
  type GridLayout, type ImageSize, type LeadAlignment, type LeadFrame, type PixelPoint, type TracePoint,
} from "@/lib/traceOverlay/geometry";
import { editedLeads, initReview, reviewReducer, type TraceEdit } from "@/lib/traceOverlay/traceEdits";
import styles from "./TraceOverlayEditor.module.css";

interface Props {
  imageSrc: string;
  digitization: EcgDigitizationResult;
  captureId?: string;
  onClose?: () => void;
}

interface Drag {
  pointerId: number;
  index: number;
  preview: TracePoint;
}

type SaveState = { status: "idle" } | { status: "saving" } | { status: "saved"; file: string } | { status: "error"; message: string };

const now = () => new Date().toISOString();

function polyline(frame: LeadFrame, points: readonly TracePoint[]): string {
  return points.map((point) => {
    const { x, y } = sampleToPx(frame, point);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
}

function describePoint(point: TracePoint | null, rate: number): string {
  if (!point) return "—";
  return `${(point.i / rate).toFixed(3)} s, ${point.mv.toFixed(2)} mV`;
}

function describeEdit(edit: TraceEdit, rate: number): string {
  if (edit.kind === "reset") return "reset lead to auto-detected trace";
  if (edit.kind === "add") return `added point at ${describePoint(edit.after, rate)}`;
  if (edit.kind === "delete") return `deleted point at ${describePoint(edit.before, rate)}`;
  return `moved ${describePoint(edit.before, rate)} → ${describePoint(edit.after, rate)}`;
}

export default function TraceOverlayEditor({ imageSrc, digitization, captureId, onClose }: Props) {
  const sampleCount = useMemo(() => Math.max(...Object.values(digitization.leads).map((samples) => samples?.length ?? 0)), [digitization]);
  const leads = useMemo(() => Object.keys(digitization.leads), [digitization]);
  const rows = useMemo(() => Object.fromEntries(leads.map((lead) => {
    const samples = digitization.leads[lead as keyof typeof digitization.leads] ?? [];
    return [lead, rowForLead(lead, signalRange(samples), sampleCount)];
  })), [digitization, leads, sampleCount]);

  const [review, dispatch] = useReducer(reviewReducer, digitization, (result) => initReview(Object.fromEntries(
    Object.entries(result.leads).map(([lead, samples]) => [lead, toControlPoints(samples ?? [])]),
  )));
  const [image, setImage] = useState<ImageSize | null>(null);
  const [selected, setSelected] = useState(leads[0] ?? "");
  const [activePoint, setActivePoint] = useState<number | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [layout, setLayout] = useState<GridLayout>(DEFAULT_LAYOUT);
  const [alignments, setAlignments] = useState<Record<string, LeadAlignment>>({});
  const [save, setSave] = useState<SaveState>({ status: "idle" });
  const svgRef = useRef<SVGSVGElement>(null);

  const rate = digitization.samplingRateHz;
  const edited = new Set(editedLeads(review));
  const alignment = alignments[selected] ?? NO_ALIGNMENT;
  const frameFor = (lead: string) => image && leadFrame(lead, rows[lead], sampleCount, image, layout, alignments[lead] ?? NO_ALIGNMENT);
  const frame = frameFor(selected);
  const points = review.corrected[selected] ?? [];
  const shown = drag ? points.map((point, index) => (index === drag.index ? drag.preview : point)) : points;
  const radius = image ? Math.max(3, image.width / 450) : 4;

  function toImage(event: { clientX: number; clientY: number }): PixelPoint | null {
    const svg = svgRef.current;
    const matrix = svg?.getScreenCTM();
    if (!svg || !matrix) return null;
    const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return { x: p.x, y: p.y };
  }

  function startDrag(event: PointerEvent<SVGCircleElement>, index: number) {
    if (event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    event.stopPropagation();
    svgRef.current?.setPointerCapture(event.pointerId);
    svgRef.current?.focus({ preventScroll: true });
    setActivePoint(index);
    setDrag({ pointerId: event.pointerId, index, preview: points[index] });
  }
  function moveDrag(event: PointerEvent<SVGSVGElement>) {
    if (!drag || drag.pointerId !== event.pointerId || !frame) return;
    const pixel = toImage(event);
    if (pixel) setDrag({ ...drag, preview: pxToSample(frame, pixel) });
  }
  function endDrag(event: PointerEvent<SVGSVGElement>, cancelled = false) {
    if (!drag || drag.pointerId !== event.pointerId) return;
    // One log entry per drag, written when the point is dropped.
    if (!cancelled) dispatch({ type: "move", lead: selected, index: drag.index, to: drag.preview, at: now() });
    setDrag(null);
  }
  function addPoint(event: MouseEvent<SVGPolylineElement>) {
    if (!frame || event.detail > 1) return;
    const pixel = toImage(event);
    if (!pixel) return;
    const point = pxToSample(frame, pixel);
    if (point.i < 0 || point.i > sampleCount - 1) return;
    dispatch({ type: "add", lead: selected, point, at: now() });
  }
  function deletePoint(index: number) {
    dispatch({ type: "delete", lead: selected, index, at: now() });
    setActivePoint(null);
  }
  function onKeyDown(event: KeyboardEvent<SVGSVGElement>) {
    if (activePoint === null || !points[activePoint]) return;
    const point = points[activePoint];
    const step = event.shiftKey ? 0.1 : 0.02;
    if (event.key === "Delete" || event.key === "Backspace") deletePoint(activePoint);
    else if (event.key === "ArrowUp") dispatch({ type: "move", lead: selected, index: activePoint, to: { ...point, mv: point.mv + step }, at: now() });
    else if (event.key === "ArrowDown") dispatch({ type: "move", lead: selected, index: activePoint, to: { ...point, mv: point.mv - step }, at: now() });
    else if (event.key === "ArrowLeft") setActivePoint(Math.max(0, activePoint - 1));
    else if (event.key === "ArrowRight") setActivePoint(Math.min(points.length - 1, activePoint + 1));
    else return;
    event.preventDefault();
  }
  function selectLead(lead: string) {
    setSelected(lead);
    setActivePoint(null);
    setDrag(null);
  }
  function setAlignment(patch: Partial<LeadAlignment>) {
    setAlignments({ ...alignments, [selected]: { ...alignment, ...patch } });
  }

  async function saveCorrection() {
    setSave({ status: "saving" });
    const corrected = Object.fromEntries(Object.entries(review.corrected).map(([lead, leadPoints]) => [lead, toSamples(leadPoints, sampleCount, DEFAULT_STRIDE)]));
    try {
      const response = await fetch("/api/trace-corrections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          captureId: captureId ?? crypto.randomUUID(),
          samplingRateHz: rate,
          sampleCount,
          auto: digitization.leads,
          corrected,
          editedLeads: [...edited],
          edits: review.edits,
          alignment: { layout, leads: alignments },
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : `Save failed (${response.status}).`);
      setSave({ status: "saved", file: body.file });
    } catch (error) {
      setSave({ status: "error", message: error instanceof Error ? error.message : "Save failed." });
    }
  }

  return (
    <section className={styles.editor} aria-label="Trace review">
      <header className={styles.header}>
        <div>
          <h2>Review detected trace</h2>
          <p>Drag a point to correct it. Click the selected trace to add a point. Double-click a point, or select it and press Delete, to remove it.</p>
        </div>
        {onClose && <button type="button" className={styles.secondary} onClick={onClose}>Back to result</button>}
      </header>

      <div className={styles.leadTabs} role="tablist" aria-label="Leads">
        {leads.map((lead) => (
          <button key={lead} type="button" role="tab" aria-selected={lead === selected}
            className={lead === selected ? styles.tabActive : styles.tab} onClick={() => selectLead(lead)}>
            {lead}{edited.has(lead) && <span className={styles.editedDot} aria-label="edited"> ●</span>}
          </button>
        ))}
      </div>

      <div className={styles.workspace}>
        <div className={styles.canvas}>
          {/* eslint-disable-next-line @next/next/no-img-element -- data URL from the capture, not a static asset */}
          <img src={imageSrc} alt="De-identified EKG" className={styles.image}
            onLoad={(event) => setImage({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} />
          {image && (
            <svg ref={svgRef} className={styles.overlay} viewBox={`0 0 ${image.width} ${image.height}`} tabIndex={0}
              aria-label={`Trace overlay, lead ${selected}`} onPointerMove={moveDrag} onPointerUp={(e) => endDrag(e)}
              onPointerCancel={(e) => endDrag(e, true)} onKeyDown={onKeyDown}>
              {leads.filter((lead) => lead !== selected).map((lead) => {
                const other = frameFor(lead)!;
                return toRuns(review.corrected[lead] ?? []).map((run, k) => (
                  <polyline key={`${lead}-${k}`} points={polyline(other, run)} className={styles.otherTrace}
                    onClick={() => selectLead(lead)}><title>{`Lead ${lead} — click to review`}</title></polyline>
                ));
              })}
              {frame && toRuns(review.auto[selected] ?? []).map((run, k) => (
                <polyline key={`auto-${k}`} points={polyline(frame, run)} className={styles.autoTrace} />
              ))}
              {frame && toRuns(shown).map((run, k) => (
                <g key={`corrected-${k}`}>
                  <polyline points={polyline(frame, run)} className={styles.correctedTrace} />
                  <polyline points={polyline(frame, run)} className={styles.hitLine} onClick={addPoint} />
                </g>
              ))}
              {frame && shown.map((point, index) => {
                const { x, y } = sampleToPx(frame, point);
                return (
                  <circle key={index} cx={x} cy={y} r={index === activePoint ? radius * 1.6 : radius}
                    className={index === activePoint ? styles.pointActive : styles.point}
                    onPointerDown={(event) => startDrag(event, index)}
                    onDoubleClick={() => deletePoint(index)} />
                );
              })}
            </svg>
          )}
        </div>

        <aside className={styles.panel}>
          <div className={styles.legend}>
            <span><i className={styles.swatchAuto} /> auto-detected</span>
            <span><i className={styles.swatchCorrected} /> corrected</span>
          </div>

          <fieldset className={styles.controls}>
            <legend>Align lead {selected}</legend>
            <label>Shift left/right <input type="range" min={-80} max={80} value={alignment.dx}
              onChange={(e) => setAlignment({ dx: Number(e.target.value) })} /></label>
            <label>Shift up/down <input type="range" min={-80} max={80} value={alignment.dy}
              onChange={(e) => setAlignment({ dy: Number(e.target.value) })} /></label>
            <label>Gain ×{alignment.gain.toFixed(2)} <input type="range" min={0.5} max={2} step={0.05} value={alignment.gain}
              onChange={(e) => setAlignment({ gain: Number(e.target.value) })} /></label>
          </fieldset>

          <details className={styles.controls}>
            <summary>Grid position (all leads)</summary>
            {([["left", "Grid left", 0, 0.3], ["width", "Grid width", 0.5, 1], ["firstBaseline", "First row", 0.1, 0.6], ["rowPitch", "Row spacing", 0.08, 0.3]] as const).map(([key, label, min, max]) => (
              <label key={key}>{label} <input type="range" min={min} max={max} step={0.002} value={layout[key]}
                onChange={(e) => setLayout({ ...layout, [key]: Number(e.target.value) })} /></label>
            ))}
          </details>

          <div className={styles.actions}>
            <button type="button" className={styles.secondary} disabled={!edited.has(selected)}
              onClick={() => dispatch({ type: "reset", lead: selected, at: now() })}>Reset lead {selected}</button>
            <button type="button" className={styles.primary} disabled={save.status === "saving"} onClick={saveCorrection}>
              {save.status === "saving" ? "Saving…" : "Save corrected trace"}
            </button>
          </div>
          <p className={styles.status} role="status">
            {save.status === "saved" && `Saved separately from the auto-detected trace (${save.file}).`}
            {save.status === "error" && save.message}
          </p>

          <h3>Edit log ({review.edits.length})</h3>
          {review.edits.length === 0 ? <p className={styles.muted}>No edits yet.</p> : (
            <ol className={styles.log} reversed>
              {[...review.edits].reverse().slice(0, 100).map((edit) => (
                <li key={edit.seq}>
                  <span className={styles.logLead}>{edit.lead}</span> {describeEdit(edit, rate)}
                  <time className={styles.muted} dateTime={edit.at}> {edit.at.slice(11, 19)}</time>
                </li>
              ))}
            </ol>
          )}
        </aside>
      </div>
    </section>
  );
}
