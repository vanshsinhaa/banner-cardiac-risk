"use client";

import { useCallback, useRef, useState } from "react";
import type { CSSProperties } from "react";

import { MOVE_CLOSER } from "@/constants/captureMessages";
import { checkResolution } from "@/lib/checkResolution";
import type { ResolutionResult } from "@/lib/checkResolution";

// Fallback capture screen for user story #2 (task #34).
// Minimal camera input + basic crop. Wire onCapture to your upload/
// de-identification pipeline once this is integrated.

type Stage = "idle" | "crop" | "result";

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
  // Set when the last crop failed the resolution check (task #44).
  const [resolutionFailure, setResolutionFailure] = useState<ResolutionResult | null>(null);

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
    setImageSrc(URL.createObjectURL(file));
    setResolutionFailure(null);
    setStage("crop");
  };

  const handleImageLoad = () => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    const bw = w * 0.7;
    const bh = h * 0.5;
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

  const handleConfirmCrop = () => {
    const img = imgRef.current;
    if (!img) return;

    const scaleX = img.naturalWidth / img.clientWidth;
    const scaleY = img.naturalHeight / img.clientHeight;
    const sx = rect.x * scaleX;
    const sy = rect.y * scaleY;
    const sw = rect.w * scaleX;
    const sh = rect.h * scaleY;

    const canvas = document.createElement("canvas");
    canvas.width = sw;
    canvas.height = sh;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

    // Resolution check (task #44). If the crop has too few pixels, stop
    // here: no result, no save. The user sees "Move closer" and can retake.
    const resolution = checkResolution({ width: canvas.width, height: canvas.height });
    if (!resolution.pass) {
      setResolutionFailure(resolution);
      return;
    }
    setResolutionFailure(null);

    const dataUrl = canvas.toDataURL("image/png");
    setResultSrc(dataUrl);
    setCount((c) => c + 1);
    setStage("result");
    onCapture?.(dataUrl);
  };

  return (
    <div style={styles.wrap}>
      <h1 style={styles.h1}>EKG capture, fallback prototype</h1>
      <p style={styles.sub}>Photo capture plus a basic crop, no lab lighting needed.</p>

      <div style={styles.card}>
        {stage === "idle" && (
          <>
            <div style={styles.placeholder}>Take a photo of the EKG strip or on-screen waveform.</div>
            <button style={styles.btnPrimary} onClick={handleOpenPicker}>
              Take / choose photo
            </button>
            {/* Camera resolution (task #44): this input opens the phone's own
                camera app, which takes the photo at the highest resolution
                the device allows. There is no setting to ask for more.
                A live getUserMedia preview would give smaller video frames. */}
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
            {resolutionFailure && (
              <div role="alert" style={styles.warning}>
                <strong>{MOVE_CLOSER}</strong>
                <div style={styles.warningDetail}>{resolutionFailure.reason}</div>
              </div>
            )}
            <div style={styles.row}>
              <button style={styles.btnSecondary} onClick={() => setStage("idle")}>
                Retake
              </button>
              <button style={styles.btnPrimaryFlex} onClick={handleConfirmCrop}>
                Confirm crop
              </button>
            </div>
          </>
        )}

        {stage === "result" && resultSrc && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={resultSrc} alt="Cropped result" style={{ width: "100%", borderRadius: 8, display: "block" }} />
            <div style={styles.row}>
              <button style={styles.btnSecondary} onClick={() => setStage("idle")}>
                Capture another
              </button>
              <a style={styles.btnPrimaryLink} href={resultSrc} download={`ekg-capture-${Date.now()}.png`}>
                Save image
              </a>
            </div>
          </>
        )}
      </div>

      <div style={styles.count}>
        {count} {count === 1 ? "image" : "images"} captured this session
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
  warning: {
    marginTop: 16,
    padding: "10px 12px",
    borderRadius: 8,
    background: "#fdecea",
    border: "1px solid #f1b0a8",
    color: "#8a1c12",
    fontSize: 15,
  },
  warningDetail: { fontSize: 13, marginTop: 2 },
  count: { fontSize: 13, color: "#5b6672", marginTop: 18, textAlign: "center" },
};
