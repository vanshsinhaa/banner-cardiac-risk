"use client";

import { useCallback, useRef, useState } from "react";
import type { CSSProperties } from "react";
import CameraGuide from "./CameraGuide";
import {
  DEID_ENDPOINT, 
  DEID_MESSAGES,
  DEID_SUCCESS_STATUS,
  DEID_TIMEOUT_MS,
} from "../config/deidentification";

// Fallback capture screen for user story #2 (task #34).
// Minimal camera input + basic crop. Wire onCapture to your upload/
// de-identification pipeline once this is integrated.

// Task #51: after the crop, the image is sent to the de-identification step.
//onCapture now receives ONLY the de-identified image, never the raw crop. 

// "processing" = waiting for de-identification, "blocked" = it failed, nothing is passed on
type Stage = "idle" | "camera" | "crop" | "processing" | "blocked" | "result";

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
  const [error, setError] = useState<string | null>(null);
  //message shown on the "blocked" screen (separate from the start-screen error above)
  const [deidError, setDeidError] = useState<string | null>(null);
  //true when backend says its answercame from a test mock, not real de-identification
  const [isTestMode, setIsTestMode] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<DragState | null>(null);
  //raw (not de-identified) crop. lives only here so "try again" an resend
  //never shown after the crop, never saved, and never given to onCapture
  const rawCropRef = useRef<Blob | null>(null);
  //lets us cancel an in-flight request, and tell "user pressed Cancel" from "timed out"
  const abortRef = useRef<AbortController | null>(null);
  const userCancelledRef = useRef(false);

  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

  const handleOpenPicker = () => {
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
      fileInputRef.current.click();
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    //if user cancelled the picker, no file and nothing to do 
    if (!file) return;
    
    //reject anything that isn't image 
    if (!file.type.startsWith("image/")) {
      setError("That file isn't an image. Please choose a photo.");
      return;
    }

    setError(null); //clear old error
    //free memory used by previous photo before loading a new one 
    if (imageSrc) URL.revokeObjectURL(imageSrc);
    setImageSrc(URL.createObjectURL(file));
    setStage("crop");
  };

    //receives frame captured by live cameraand sends it into same crop step file picker uses 
    const handleCameraPhoto = (dataUrl: string) => {
      setError(null);
      setImageSrc(dataUrl);
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

  //sends cropped image to de-identification step and waits for answer
  //fail safe: only an explicit "redacted" answerwith an image counts as success
  //every other outcome (error, timeout, unexpected answer) lands on the "blocked" screen
  // and raw crop is not passed anywhere
  const sendToDeidentification = async (blob: Blob) => {
    setDeidError(null);
    setIsTestMode(false);
    userCancelledRef.current = false;
    //show processing screen right away
    setStage("processing");

    const controller = new AbortController();
    abortRef.current = controller;
    //if nothing comes back in time, cancel the request ourselves 
    const timer = setTimeout(() => controller.abort(), DEID_TIMEOUT_MS);

    try {
      const form = new FormData();
      //field name "file", same as upload API
      form.append("file", blob, "capture.jpg");
      const res = await fetch(DEID_ENDPOINT, { method: "POST", body: form, signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      //must be exactly success status and contain image or treat as failure
      if (
        data.status !== DEID_SUCCESS_STATUS ||
        typeof data.image !== "string" ||
        !data.image.startsWith("data:image/")
      ) {
        throw new Error("not-confirmed");
      }

      //success: only now does image become visible, savable, or passed on 
      rawCropRef.current = null; //raw crop no longer needed
      setResultSrc(data.image);
      setIsTestMode(data.mock === true);
      setCount((c) => c + 1);
      setStage("result");
      onCapture?.(data.image); //de-identified image, not raw crop 
    } catch (err) {
      if (userCancelledRef.current) return; //user pressed Cancel; already back on start screen
      const timedOut = err instanceof DOMException && err.name === "AbortError";
      const notConfirmed = err instanceof Error && err.message === "not-confirmed";
      setDeidError(timedOut ? DEID_MESSAGES.timeout : notConfirmed ? DEID_MESSAGES.notConfirmed : DEID_MESSAGES.failed);
      setStage("blocked");
    } finally {
      clearTimeout(timer);
    }
  };

  //try again on blocked screen: resend same crop 
  const handleRetry = () => {
    if (rawCropRef.current) {
      sendToDeidentification(rawCropRef.current);
    } else {
      setStage("idle");
    }
  };

  //cancel while processing: stop the request and go back to start
  const handleCancelProcessing = () => {
    userCancelledRef.current = true;
    abortRef.current?.abort();
    rawCropRef.current = null;
    setStage("idle");
  };
  
  //retake on blocked screen: throw away raw crop and start over
  const handleRetake = () => {
    rawCropRef.current = null;
    setDeidError(null);
    setStage("idle");
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

    //JPEG at 92% quality is smaller than PNG and still sharp 
    //toBlob gives us file-like object that can be uploaded
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setDeidError(DEID_MESSAGES.failed);
          setStage("blocked");
          return;
        }
        rawCropRef.current = blob;
        sendToDeidentification(blob);
      },
      "image/jpeg",
      0.92
    );
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

            <button
              style={{ ...styles.btnSecondary, width: "100%", marginTop: 10 }}
              onClick={() => setStage("camera")}
            >
              Use camera guide 
            </button>

            {error && <p style={styles.error}>{error}</p>}
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

        {stage === "camera" && (
          <CameraGuide 
            onPhoto={handleCameraPhoto}
            onCancel={() => setStage("idle")}
          />
        )}

        {stage === "crop" && imageSrc && (
          <>
            <div ref={wrapRef} style={styles.stageImgWrap}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                ref={imgRef}
                src={imageSrc}
                onLoad={handleImageLoad}
                onError={() => {
                  //browser can't decode file, go back to start screen w/ message instead of blank crop box
                  setError("This photo couldn't be displayed. Try a JPEG or PNG.");
                  setStage("idle");
                }}
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
                Confirm crop
              </button>
            </div>
          </>
        )}

        {/*waiting for de-identification step. no image shown on purpose. */}
        {stage === "processing" && (
          <>
            <div style={styles.placeholder} role="status" aria-live="polite">
            Removing identifying information. This can take several seconds, so please keep this page open.
            </div>
            <button style={{ ...styles.btnSecondary, width: "100%", marginTop: 16 }} onClick={handleCancelProcessing}>
              Cancel
            </button>
          </>
        )}

        {/* de-identification failed: show the problem, show NO image, pass nothing on */}
        {stage === "blocked" && (
          <>
            <div style = {styles.blockedBox} role="alert">
              <strong> Image not sent on.</strong>
              <p style={{margin: "8px 0 0" }}>{deidError}</p>
            </div>
            <div style={styles.row}>
              <button style={styles.btnSecondary} onClick={handleRetake}>
                Retake
              </button>
              <button style={styles.btnPrimaryFlex} onClick={handleRetry}>
                Try again
              </button>
            </div>
          </>
        )}

        {stage === "result" && resultSrc && (
          <>
            {isTestMode && (
              <p style={styles.testNotice} role="alert">
                TEST MODE: this image was NOT actually de-identified.
              </p>
            )}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={resultSrc} alt="De-identified result" style={{ width: "100%", borderRadius: 8, display: "block" }} />
            <div style={styles.row}>
              <button style={styles.btnSecondary} onClick={() => setStage("idle")}>
                Capture another
              </button>
              <a style={styles.btnPrimaryLink} href={resultSrc} download={`ekg-capture-${Date.now()}.jpg`}>
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
  count: { fontSize: 13, color: "#5b6672", marginTop: 18, textAlign: "center" },
  error: { color: "#b3261e", fontSize: 14, marginTop: 12 },
  blockedBox: {
    border: "1px solid #b3261e",
    background: "#fdecea",
    color: "#b3261e",
    borderRadius: 8,
    padding: 16,
    fontSize: 14,
  },
  testNotice: {
    background: "#fff4cc",
    border: "1px solid #e0b400",
    color: "#5c4a00",
    borderRadius: 8,
    padding: "8px 12px",
    fontSize: 13,
    margin: "0 0 12px",
  },
};
