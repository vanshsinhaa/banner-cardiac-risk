"use client";

import { useEffect, useRef, useState } from "react";
import type { Dispatch, KeyboardEvent, PointerEvent } from "react";
import { applyCorrections, sampleRuns } from "@/lib/traceOverlay/controlPoints";
import {
  NO_ALIGNMENT, leadFrame, pxToSample, sampleToPx,
  type GridLayout, type ImageSize, type LeadAlignment, type LeadFrame, type PixelPoint, type SampleRange, type TracePoint,
} from "@/lib/traceOverlay/geometry";
import { insertionIndex, type TraceAction, type TraceEdit, type TraceReviewState } from "@/lib/traceOverlay/traceEdits";
import { distanceToLine, inWindow, nearestPoint, windowViewBox } from "@/lib/traceOverlay/viewport";
import styles from "./review.module.css";

// Screen-pixel sizes. Handles are drawn at 14px but grabbed anywhere within 22px
// (a 44px target), and clicking within 16px of the line adds a point.
const HANDLE_RADIUS = 7;
const HOVER_RADIUS = 9;
const GRAB_RADIUS = 22;
const ADD_DISTANCE = 16;
const CLICK_SLOP = 4;

interface Props {
  imageSrc: string;
  image: ImageSize;
  leads: string[];
  rows: Record<string, number>;
  sampleCount: number;
  autoSamples: readonly (number | null)[];
  rate: number;
  review: TraceReviewState;
  dispatch: Dispatch<TraceAction>;
  selected: string;
  onSelect: (lead: string) => void;
  windows: SampleRange[];
  windowIndex: number;
  onWindow: (index: number) => void;
  confirmed: ReadonlySet<string>;
  onConfirm: (lead: string) => void;
  onContinue: () => void;
  layout: GridLayout;
  onLayout: (layout: GridLayout) => void;
  alignments: Record<string, LeadAlignment>;
  onAlignment: (lead: string, alignment: LeadAlignment) => void;
}

interface Drag {
  pointerId: number;
  index: number;
  preview: TracePoint;
  moved: boolean;
}

const now = () => new Date().toISOString();

function path(frame: LeadFrame, points: readonly TracePoint[]): string {
  return points.map((point) => {
    const { x, y } = sampleToPx(frame, point);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
}

function describeEdit(edit: TraceEdit, rate: number): string {
  const at = (point: TracePoint | null) => (point ? `${(point.i / rate).toFixed(2)} s, ${point.mv.toFixed(2)} mV` : "");
  switch (edit.kind) {
    case "move": return `Moved point to ${at(edit.after)}`;
    case "add": return `Added point at ${at(edit.after)}`;
    case "delete": return `Deleted point at ${at(edit.before)}`;
    case "reset": return "Reset to detected trace";
    case "undo": return "Undid last change";
    case "redo": return "Redid change";
  }
}

export function leadEditCount(review: TraceReviewState, lead: string): number {
  return review.edits.filter((edit) => edit.lead === lead).length;
}

export default function TraceEditor(props: Props) {
  const {
    imageSrc, image, leads, rows, sampleCount, autoSamples, rate, review, dispatch, selected, onSelect,
    windows, windowIndex, onWindow, confirmed, onConfirm, onContinue, layout, onLayout, alignments, onAlignment,
  } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [displayWidth, setDisplayWidth] = useState(1);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [pendingAdd, setPendingAdd] = useState<{ pointerId: number; x: number; y: number } | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [nearLine, setNearLine] = useState(false);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const element = wrapRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setDisplayWidth(Math.max(1, entry.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const alignment = alignments[selected] ?? NO_ALIGNMENT;
  const frame = leadFrame(selected, rows[selected], sampleCount, image, layout, alignment);
  const view = windows[Math.min(windowIndex, windows.length - 1)] ?? { start: 0, end: sampleCount - 1 };
  const box = windowViewBox(frame, review.auto[selected] ?? [], view);
  const k = box.width / displayWidth; // image units per screen pixel
  const points = review.corrected[selected] ?? [];
  const shown = drag ? points.map((point, index) => (index === drag.index ? drag.preview : point)) : points;
  // Lines are drawn from full-resolution samples; handles are only for grabbing.
  const autoRuns = sampleRuns(autoSamples, view.start - 20, view.end + 20);
  const traceRuns = sampleRuns(applyCorrections(autoSamples, review.auto[selected] ?? [], shown), view.start - 20, view.end + 20);
  const allConfirmed = leads.every((lead) => confirmed.has(lead));
  const leadIndex = leads.indexOf(selected);
  const edits = leadEditCount(review, selected);

  function toImage(event: { clientX: number; clientY: number }): PixelPoint | null {
    const matrix = svgRef.current?.getScreenCTM();
    if (!matrix) return null;
    const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return { x: p.x, y: p.y };
  }

  function onPointerDown(event: PointerEvent<SVGSVGElement>) {
    if (event.button !== 0 || !event.isPrimary) return;
    const pixel = toImage(event);
    if (!pixel) return;
    svgRef.current?.focus({ preventScroll: true });
    const index = nearestPoint(frame, points, pixel, GRAB_RADIUS * k, view);
    if (index !== null) {
      event.preventDefault();
      svgRef.current?.setPointerCapture(event.pointerId);
      setActive(index);
      setDrag({ pointerId: event.pointerId, index, preview: points[index], moved: false });
      return;
    }
    const distance = distanceToLine(frame, points, pixel);
    if (distance !== null && distance <= ADD_DISTANCE * k) setPendingAdd({ pointerId: event.pointerId, x: event.clientX, y: event.clientY });
    else setActive(null);
  }

  function onPointerMove(event: PointerEvent<SVGSVGElement>) {
    const pixel = toImage(event);
    if (!pixel) return;
    if (drag && drag.pointerId === event.pointerId) {
      setDrag({ ...drag, preview: pxToSample(frame, pixel), moved: true });
      return;
    }
    const index = nearestPoint(frame, points, pixel, GRAB_RADIUS * k, view);
    setHover(index);
    const distance = index === null ? distanceToLine(frame, points, pixel) : null;
    setNearLine(distance !== null && distance <= ADD_DISTANCE * k);
  }

  function onPointerUp(event: PointerEvent<SVGSVGElement>) {
    if (drag && drag.pointerId === event.pointerId) {
      // One log entry per drag, written when the point is dropped.
      if (drag.moved) dispatch({ type: "move", lead: selected, index: drag.index, to: drag.preview, at: now() });
      setDrag(null);
      return;
    }
    if (pendingAdd && pendingAdd.pointerId === event.pointerId) {
      setPendingAdd(null);
      if (Math.hypot(event.clientX - pendingAdd.x, event.clientY - pendingAdd.y) > CLICK_SLOP) return;
      const pixel = toImage(event);
      if (!pixel) return;
      const point = pxToSample(frame, pixel);
      if (!inWindow(point, view)) return;
      dispatch({ type: "add", lead: selected, point, at: now() });
      setActive(insertionIndex(points, point.i));
    }
  }

  function onPointerCancel() {
    setDrag(null);
    setPendingAdd(null);
  }

  function deleteActive() {
    if (active === null || !points[active]) return;
    dispatch({ type: "delete", lead: selected, index: active, at: now() });
    setActive(null);
  }

  function onKeyDown(event: KeyboardEvent<SVGSVGElement>) {
    const mod = event.ctrlKey || event.metaKey;
    if (mod && event.key.toLowerCase() === "z") {
      dispatch({ type: event.shiftKey ? "redo" : "undo", at: now() });
    } else if (mod && event.key.toLowerCase() === "y") {
      dispatch({ type: "redo", at: now() });
    } else if (active !== null && points[active]) {
      const point = points[active];
      const step = event.shiftKey ? 0.2 : 0.05;
      if (event.key === "Delete" || event.key === "Backspace") deleteActive();
      else if (event.key === "ArrowUp") dispatch({ type: "move", lead: selected, index: active, to: { ...point, mv: point.mv + step }, at: now() });
      else if (event.key === "ArrowDown") dispatch({ type: "move", lead: selected, index: active, to: { ...point, mv: point.mv - step }, at: now() });
      else if (event.key === "ArrowLeft") setActive(Math.max(0, active - 1));
      else if (event.key === "ArrowRight") setActive(Math.min(points.length - 1, active + 1));
      else if (event.key === "Escape") setActive(null);
      else return;
    } else return;
    event.preventDefault();
  }

  function selectLead(lead: string) {
    setActive(null);
    setHover(null);
    onSelect(lead);
  }

  const instruction = drag
    ? "Release to place the point."
    : active !== null
      ? "Point selected. Drag it, nudge it with ↑ ↓, or press Delete to remove it."
      : "Compare the orange line with the printed waveform underneath. Drag any point that is off, or click the line to add one.";
  const cursor = drag ? "grabbing" : hover !== null ? "grab" : nearLine ? "copy" : "default";

  return (
    <div className={styles.editorLayout}>
      <section className={styles.editorMain} aria-label={`Lead ${selected}`}>
        <div className={styles.editorHead}>
          <div>
            <p className={styles.kicker}>Lead {leadIndex + 1} of {leads.length}</p>
            <h2 className={styles.leadTitle}>Lead {selected}</h2>
          </div>
          {windows.length > 1 && (
            <div className={styles.pager} role="group" aria-label="Time window">
              <button type="button" className={styles.iconButton} disabled={windowIndex === 0}
                onClick={() => { setActive(null); onWindow(windowIndex - 1); }} aria-label="Earlier">‹</button>
              <span>{(view.start / rate).toFixed(1)}–{((view.end + 1) / rate).toFixed(1)} s</span>
              <button type="button" className={styles.iconButton} disabled={windowIndex >= windows.length - 1}
                onClick={() => { setActive(null); onWindow(windowIndex + 1); }} aria-label="Later">›</button>
            </div>
          )}
        </div>

        <p className={styles.instruction} role="status">{instruction}</p>

        <div ref={wrapRef} className={styles.canvas}>
          <svg ref={svgRef} className={styles.canvasSvg} viewBox={`${box.x} ${box.y} ${box.width} ${box.height}`}
            style={{ aspectRatio: `${box.width} / ${box.height}`, cursor }} tabIndex={0}
            aria-label={`Trace editor for lead ${selected}. Use arrow keys to move between and nudge points.`}
            onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel} onPointerLeave={() => { setHover(null); setNearLine(false); }} onKeyDown={onKeyDown}>
            <image href={imageSrc} x={0} y={0} width={image.width} height={image.height} preserveAspectRatio="none" />
            {autoRuns.map((run, i) => (
              <polyline key={`a${i}`} points={path(frame, run)} className={styles.autoLine} vectorEffect="non-scaling-stroke" />
            ))}
            {traceRuns.map((run, i) => (
              <polyline key={`c${i}`} points={path(frame, run)} className={styles.traceLine} vectorEffect="non-scaling-stroke" />
            ))}
            {shown.map((point, index) => {
              if (!inWindow(point, view)) return null;
              const { x, y } = sampleToPx(frame, point);
              const isActive = index === active;
              const isHover = index === hover;
              return (
                <g key={index}>
                  {(isActive || isHover) && <circle cx={x} cy={y} r={16 * k} className={styles.handleHalo} />}
                  <circle cx={x} cy={y} r={(isActive || isHover ? HOVER_RADIUS : HANDLE_RADIUS) * k}
                    className={isActive ? styles.handleActive : styles.handle} vectorEffect="non-scaling-stroke" />
                </g>
              );
            })}
          </svg>
        </div>

        <div className={styles.legendRow}>
          <span><i className={styles.swatchTrace} /> Trace used for scoring</span>
          <span><i className={styles.swatchAuto} /> Originally detected</span>
          <span className={styles.muted}>Ctrl+Z undo · Delete removes selected point</span>
        </div>

        <div className={styles.toolbar}>
          <div className={styles.toolGroup}>
            <button type="button" className={styles.toolButton} disabled={!review.past.length} onClick={() => dispatch({ type: "undo", at: now() })}>Undo</button>
            <button type="button" className={styles.toolButton} disabled={!review.future.length} onClick={() => dispatch({ type: "redo", at: now() })}>Redo</button>
            <button type="button" className={styles.toolButton} disabled={active === null} onClick={deleteActive}>Delete point</button>
            <button type="button" className={styles.toolButton} disabled={review.corrected[selected] === review.auto[selected]}
              onClick={() => { setActive(null); dispatch({ type: "reset", lead: selected, at: now() }); }}>Reset lead</button>
          </div>
          {allConfirmed
            ? <button type="button" className={styles.primaryButton} onClick={onContinue}>Continue to confirm →</button>
            : <button type="button" className={styles.primaryButton} onClick={() => { setActive(null); onConfirm(selected); }}>
                {confirmed.has(selected) ? "Next lead →" : "✓ Lead looks correct"}
              </button>}
        </div>
      </section>

      <aside className={styles.sidePanel}>
        <div className={styles.panelBlock}>
          <p className={styles.panelTitle}>Where you are</p>
          <svg className={styles.minimap} viewBox={`0 0 ${image.width} ${image.height}`} aria-hidden="true">
            <image href={imageSrc} x={0} y={0} width={image.width} height={image.height} preserveAspectRatio="none" />
            <rect x={box.x} y={box.y} width={box.width} height={box.height} className={styles.minimapBox} vectorEffect="non-scaling-stroke" />
          </svg>
        </div>

        <div className={styles.panelBlock}>
          <p className={styles.panelTitle}>Leads <span className={styles.muted}>· {confirmed.size} of {leads.length} checked</span></p>
          <progress className={styles.progress} max={leads.length} value={confirmed.size}>{confirmed.size} of {leads.length}</progress>
          <ul className={styles.leadList}>
            {leads.map((lead) => {
              const count = leadEditCount(review, lead);
              const status = confirmed.has(lead) ? "Checked" : "To check";
              return (
                <li key={lead}>
                  <button type="button" className={styles.leadItem} aria-current={lead === selected ? "true" : undefined} onClick={() => selectLead(lead)}>
                    <span className={styles.leadStatus} data-done={confirmed.has(lead)} aria-hidden="true">{confirmed.has(lead) ? "✓" : ""}</span>
                    <span className={styles.leadName}>{lead}</span>
                    <span className={styles.leadMeta}>{count ? `${count} ${count === 1 ? "change" : "changes"}` : status}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <details className={styles.panelBlock}>
          <summary className={styles.panelTitle}>Line not on top of the waveform?</summary>
          <p className={styles.panelHelp}>Shift or stretch the overlay for lead {selected}. This only moves the drawing, not the trace values.</p>
          {([["dx", "Left / right", -80, 80, 1], ["dy", "Up / down", -80, 80, 1], ["gain", "Height", 0.5, 2, 0.05]] as const).map(([key, label, min, max, step]) => (
            <label key={key} className={styles.slider}>
              <span>{label}</span>
              <input type="range" min={min} max={max} step={step} value={alignment[key]}
                onChange={(e) => onAlignment(selected, { ...alignment, [key]: Number(e.target.value) })} />
            </label>
          ))}
          <p className={styles.panelHelp}>Whole grid (all leads)</p>
          {([["left", "Grid left", 0, 0.3], ["width", "Grid width", 0.5, 1], ["firstBaseline", "First row", 0.1, 0.6], ["rowPitch", "Row spacing", 0.08, 0.3]] as const).map(([key, label, min, max]) => (
            <label key={key} className={styles.slider}>
              <span>{label}</span>
              <input type="range" min={min} max={max} step={0.002} value={layout[key]}
                onChange={(e) => onLayout({ ...layout, [key]: Number(e.target.value) })} />
            </label>
          ))}
        </details>

        <details className={styles.panelBlock}>
          <summary className={styles.panelTitle}>Change history ({review.edits.length})</summary>
          {review.edits.length === 0 ? <p className={styles.panelHelp}>No changes yet.</p> : (
            <ol className={styles.history}>
              {[...review.edits].reverse().slice(0, 100).map((edit) => (
                <li key={edit.seq}>
                  <strong>{edit.lead}</strong> {describeEdit(edit, rate)}
                  <time className={styles.muted} dateTime={edit.at}> · {new Date(edit.at).toLocaleTimeString()}</time>
                </li>
              ))}
            </ol>
          )}
        </details>
        {edits > 0 && <p className={styles.panelHelp}>{edits} {edits === 1 ? "change" : "changes"} on lead {selected}.</p>}
      </aside>
    </div>
  );
}
