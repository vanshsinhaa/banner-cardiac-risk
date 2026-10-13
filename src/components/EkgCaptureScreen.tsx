"use client";

import { useCallback, useRef, useState } from "react";
import type { CSSProperties } from "react";

// Fallback capture screen for user story #2 (task #34).
// Crop, preprocess, and assess lead-label readability through the local API.

type Stage = "idle" | "crop" | "processing" | "result";

interface Assessment {
  accepted: boolean;
  status: "passed" | "failed" | "needs_review";
  uncertain_leads: string[];
  rotation_degrees: number;
  ocr_timed_out: boolean;
  reasons: string[];
  detected_leads: string[];
  missing_leads: string[];
  boundary_found: boolean;
  width: number;
  height: number;
  processed_image: string;
}

const reasonLabels: Record<string, string> = {
  invalid_image: "The image could not be assessed.",
  resolution_too_low: "The crop is too small. Keep at least 600 pixels on each side.",
  insufficient_contrast: "The image has too little contrast. Retake it with clearer lighting.",
  lead_labels_unreadable_or_missing: "OCR could not confirm all 12 labels. This can happen on a readable scan. Check the unconfirmed labels below; a partial ECG page cannot pass the full 12-lead check.",
};

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface DragState {
  mode: "move" | "nw" | "ne" | "sw" | "se";
  startPointer: { x: number; y: number };
  startRect: Rect;
}

interface EkgCaptureScreenProps {
  onCapture?: (dataUrl: string) => void;
}

export default function EkgCaptureScreen({ onCapture }: EkgCaptureScreenProps) {
  const [stage, setStage] = useState<Stage>("idle");
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [resultSrc, setResultSrc] = useState<string | null>(null);
  const [rect, setRect] = useState<Rect>({ x: 0, y: 0, w: 0, h: 0 });
  const [count, setCount] = useState(0);
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<DragState | null>(null);

  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

  const handleOpenPicker = () => {
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
      fileInputRef.current.click();
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (imageSrc) URL.revokeObjectURL(imageSrc);
    setImageSrc(URL.createObjectURL(file));
    setAssessment(null);
    setError(null);
    setResultSrc(null);
    setStage("crop");
  };

  const handleImageLoad = () => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    const bw = w;
    const bh = h;
    setRect({ x: (w - bw) / 2, y: (h - bh) / 2, w: bw, h: bh });
  };

  const onDragMove = useCallback((e: PointerEvent) => {
    const ds = dragState.current;
    const wrap = wrapRef.current;
    if (!ds || !wrap) return;

    const dx = e.clientX - ds.startPointer.x;
    const dy = e.clientY - ds.startPointer.y;
    const bounds = { w: wrap.clientWidth, h: wrap.clientHeight };
    const r: Rect = { ...ds.startRect };

    if (ds.mode === "move") {
      r.x = clamp(ds.startRect.x + dx, 0, bounds.w - ds.startRect.w);
      r.y = clamp(ds.startRect.y + dy, 0, bounds.h - ds.startRect.h);
    } else {
      if (ds.mode.startsWith("n")) {
        r.y = clamp(ds.startRect.y + dy, 0, ds.startRect.y + ds.startRect.h - 40);
        r.h = ds.startRect.h - (r.y - ds.startRect.y);
      }
      if (ds.mode.startsWith("s")) {
        r.h = clamp(ds.startRect.h + dy, 40, bounds.h - ds.startRect.y);
      }
      if (ds.mode.includes("w")) {
        r.x = clamp(ds.startRect.x + dx, 0, ds.startRect.x + ds.startRect.w - 40);
        r.w = ds.startRect.w - (r.x - ds.startRect.x);
      }
      if (ds.mode.includes("e")) {
        r.w = clamp(ds.startRect.w + dx, 40, bounds.w - ds.startRect.x);
      }
    }
    setRect(r);
  }, []);

  const onDragEnd = useCallback(() => {
    dragState.current = null;
    window.removeEventListener("pointermove", onDragMove);
    window.removeEventListener("pointerup", onDragEnd);
  }, [onDragMove]);

  const startDrag = (mode: DragState["mode"]) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragState.current = { mode, startPointer: { x: e.clientX, y: e.clientY }, startRect: rect };
    window.addEventListener("pointermove", onDragMove);
    window.addEventListener("pointerup", onDragEnd);
  };

  const handleConfirmCrop = async () => {
    const img = imgRef.current;
    if (!img || stage !== "crop") return;

    const scaleX = img.naturalWidth / img.clientWidth;
    const scaleY = img.naturalHeight / img.clientHeight;
    const sx = rect.x * scaleX;
    const sy = rect.y * scaleY;
    const sw = rect.w * scaleX;
    const sh = rect.h * scaleY;

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(sw));
    canvas.height = Math.max(1, Math.round(sh));
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

    setAssessment(null);
    setError(null);
    setResultSrc(canvas.toDataURL("image/png"));
    setStage("processing");
    try {
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Could not create the crop.")), "image/png");
      });
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "image/png" },
        body: blob,
        signal: AbortSignal.timeout(60_000),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "The image check could not complete.");
      setAssessment(result as Assessment);
      setResultSrc(result.processed_image);
      setCount((c) => c + 1);
      if (result.accepted) onCapture?.(result.processed_image);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The image check could not complete. Try again.");
    } finally {
      setStage("result");
    }
  };

  return (
    <div style={styles.wrap}>
      <h1 style={styles.h1}>EKG capture, fallback prototype</h1>
      <p style={styles.sub}>Crop the full 12-lead ECG to automatically check label readability.</p>

      <div style={styles.card}>
        {stage === "idle" && (
          <>
            <div style={styles.placeholder}>Choose a photo showing all 12 ECG lead labels.</div>
            <button style={styles.btnPrimary} onClick={handleOpenPicker}>
              Take / choose photo
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              style={{ display: "none" }}
              onChange={handleFileChange}
            />
          </>
        )}

        {stage === "crop" && imageSrc && (
          <>
            <div ref={wrapRef} style={styles.stageImgWrap}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                ref={imgRef}
                src={imageSrc}
                onLoad={handleImageLoad}
                alt="Captured EKG"
                style={styles.img}
              />
              <div
                style={{ ...styles.cropBox, left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
                onPointerDown={startDrag("move")}
              >
                <div style={{ ...styles.handle, top: -9, left: -9, cursor: "nwse-resize" }} onPointerDown={startDrag("nw")} />
                <div style={{ ...styles.handle, top: -9, right: -9, cursor: "nesw-resize" }} onPointerDown={startDrag("ne")} />
                <div style={{ ...styles.handle, bottom: -9, left: -9, cursor: "nesw-resize" }} onPointerDown={startDrag("sw")} />
                <div style={{ ...styles.handle, bottom: -9, right: -9, cursor: "nwse-resize" }} onPointerDown={startDrag("se")} />
              </div>
            </div>
            <div style={styles.row}>
              <button style={styles.btnSecondary} onClick={() => setStage("idle")}>
                Retake
              </button>
              <button style={styles.btnPrimaryFlex} onClick={handleConfirmCrop}>
                Confirm crop & check
              </button>
            </div>
          </>
        )}

        {stage === "processing" && (
          <div role="status" aria-live="polite" style={{ padding: 24 }}>
            Processing image and checking lead labels… This may take up to 45 seconds.
          </div>
        )}

        {stage === "result" && resultSrc && (
          <>
            <div role="status" aria-live="polite" style={{
              padding: 16, marginBottom: 16, borderRadius: 8,
              background: error || assessment?.status === "needs_review" ? "#fff4dc" : assessment?.accepted ? "#e7f5ec" : "#fff0ef",
              color: "#16202a", display: "grid", gap: 10,
            }}>
              <strong>{error ? "Check unavailable" : assessment?.accepted ? "Passed — lead labels readable" : assessment?.status === "needs_review" ? "Needs review — OCR incomplete" : "Failed — image quality check"}</strong>
              {error && <p>{error}</p>}
              {assessment && (
                <>
                  {assessment.reasons.map((reason) => <p key={reason}>{reasonLabels[reason] || reason}</p>)}
                  <p>Confirmed labels ({assessment.detected_leads.length}/12): {assessment.detected_leads.join(", ") || "None"}</p>
                  {assessment.uncertain_leads?.length > 0 && <p>Seen with low confidence: {assessment.uncertain_leads.join(", ")}</p>}
                  {assessment.ocr_timed_out && <p>Some OCR attempts timed out. The label list may be incomplete; try a tighter crop around the full ECG.</p>}
                  {assessment.missing_leads.length > 0 && <p>Not confirmed: {assessment.missing_leads.join(", ")}</p>}
                  <p style={{ fontSize: 13 }}>
                    {assessment.boundary_found ? "Perspective corrected." : "No page boundary found; used your crop."}
                    {" "}{assessment.rotation_degrees > 0 && `Rotated ${assessment.rotation_degrees}° clockwise for reading. `}Lighting adjusted. Output: {assessment.width} × {assessment.height} pixels.
                  </p>
                  <p style={{ fontSize: 13 }}>This checks lead-label readability, not waveform accuracy or heart health.</p>
                </>
              )}
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={resultSrc} alt={assessment ? "Processed ECG" : "Original crop; check unavailable"} style={{ width: "100%", borderRadius: 8, display: "block" }} />
            <div style={styles.row}>
              <button style={styles.btnSecondary} onClick={() => setStage("crop")}>
                {error ? "Retry / adjust crop" : "Adjust crop"}
              </button>
              <button style={styles.btnSecondary} onClick={() => setStage("idle")}>
                Capture another
              </button>
            </div>
            <div style={styles.row}>
              <a style={styles.btnPrimaryLink} href={resultSrc} download={`ekg-${assessment ? "processed" : "crop"}-${Date.now()}.png`}>
                {assessment ? "Save processed image" : "Save original crop"}
              </a>
            </div>
          </>
        )}
      </div>

      <div style={styles.count}>
        {count} {count === 1 ? "check" : "checks"} completed this session
      </div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  wrap: { maxWidth: 480, margin: "0 auto", padding: "24px 20px 40px" },
  h1: { fontSize: 20, margin: "0 0 4px" },
  sub: { color: "#5b6672", fontSize: 14, margin: "0 0 24px" },
  card: { background: "#fff", border: "1px solid #dde1e4", borderRadius: 10, padding: 20 },
  placeholder: {
    aspectRatio: "4 / 3",
    border: "1px dashed #dde1e4",
    borderRadius: 8,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#5b6672",
    fontSize: 14,
    textAlign: "center",
    padding: 16,
  },
  btnPrimary: {
    background: "#2f6f5e",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    padding: "12px 18px",
    width: "100%",
    marginTop: 16,
    cursor: "pointer",
    font: "inherit",
  },
  btnPrimaryFlex: {
    background: "#2f6f5e",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    padding: "12px 18px",
    flex: 1,
    cursor: "pointer",
    font: "inherit",
  },
  btnPrimaryLink: {
    background: "#2f6f5e",
    color: "#fff",
    borderRadius: 8,
    padding: "12px 18px",
    flex: 1,
    textAlign: "center",
    textDecoration: "none",
    cursor: "pointer",
  },
  btnSecondary: {
    background: "transparent",
    border: "1px solid #dde1e4",
    color: "#16202a",
    borderRadius: 8,
    padding: "12px 18px",
    flex: 1,
    cursor: "pointer",
    font: "inherit",
  },
  row: { display: "flex", gap: 10, marginTop: 16 },
  stageImgWrap: { position: "relative", borderRadius: 8, overflow: "hidden", touchAction: "none" },
  img: { display: "block", width: "100%", height: "auto", userSelect: "none" },
  cropBox: {
    position: "absolute",
    border: "2px solid #2f6f5e",
    boxShadow: "0 0 0 9999px rgba(0,0,0,0.35)",
    cursor: "move",
  },
  handle: {
    position: "absolute",
    width: 18,
    height: 18,
    background: "#2f6f5e",
    border: "2px solid #fff",
    borderRadius: "50%",
  },
  count: { fontSize: 13, color: "#5b6672", marginTop: 18, textAlign: "center" },
};
