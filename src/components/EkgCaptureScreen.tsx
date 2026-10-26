"use client";

import { useEffect, useRef, useState } from "react";
import { MOVE_CLOSER } from "@/constants/captureMessages";
import { checkResolution, type ResolutionResult } from "@/lib/checkResolution";
import { insetCorners, isWithinPhoto, orderCorners, type CaptureDetails, type Corners, type PhotoSize } from "@/lib/cropCorners";
import { outputSize } from "@/lib/perspective";
import QuadCropper from "./capture/QuadCropper";
import { warpPreview } from "./capture/warpPreview";
import styles from "./EkgCaptureScreen.module.css";

interface EkgCaptureScreenProps {
  /** Detector proposal in orientation-applied source pixels: TL, TR, BR, BL. */
  initialCorners?: Corners;
  onCapture?: (dataUrl: string, details: CaptureDetails) => void;
}
type Stage = "idle" | "crop" | "processing" | "result";

export default function EkgCaptureScreen({ initialCorners, onCapture }: EkgCaptureScreenProps) {
  const [stage, setStage] = useState<Stage>("idle");
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [resultSrc, setResultSrc] = useState<string | null>(null);
  const [size, setSize] = useState<PhotoSize | null>(null);
  const [corners, setCorners] = useState<Corners | null>(null);
  const [count, setCount] = useState(0);
  const [resolutionFailure, setResolutionFailure] = useState<ResolutionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [proposalWarning, setProposalWarning] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const loadedImage = useRef<HTMLImageElement | null>(null);
  const processing = useRef<AbortController | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const cropping = stage === "crop" || stage === "processing";

  useEffect(() => () => { processing.current?.abort(); }, []);
  useEffect(() => () => { if (imageSrc) URL.revokeObjectURL(imageSrc); }, [imageSrc]);
  useEffect(() => { titleRef.current?.focus(); }, [stage]);

  function openPicker() {
    if (!inputRef.current) return;
    inputRef.current.value = "";
    inputRef.current.click();
  }
  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setImageSrc(URL.createObjectURL(file));
    loadedImage.current = null;
    setImage(null);
    setSize(null);
    setCorners(null);
    setResolutionFailure(null);
    setError(null);
    setProposalWarning(false);
    setStage("crop");
  }
  function handleImageLoad() {
    const img = imageRef.current;
    if (!img || loadedImage.current === img) return;
    loadedImage.current = img;
    const photo = { width: img.naturalWidth, height: img.naturalHeight };
    // Task #44: exactly once per loaded photo, using the whole original photo.
    const resolution = checkResolution(photo);
    setResolutionFailure(resolution.pass ? null : resolution);
    setSize(photo);
    setImage(img);
    const validProposal = initialCorners && isWithinPhoto(initialCorners, photo);
    setCorners(validProposal ? initialCorners.map(p => ({ ...p })) as unknown as Corners : insetCorners(photo));
    setProposalWarning(Boolean(initialCorners && !validProposal));
  }
  function canConfirm() {
    if (!size || !corners || !isWithinPhoto(corners, size) || resolutionFailure) return false;
    try { outputSize(corners); return true; } catch { return false; }
  }
  async function confirmCrop() {
    if (!image || !size || !corners || processing.current || !canConfirm()) return;
    const controller = new AbortController();
    processing.current = controller;
    setStage("processing");
    setError(null);
    const details: CaptureDetails = { ...size, corners: orderCorners(corners) };
    let dataUrl: string;
    try {
      dataUrl = await warpPreview(image, details.corners, controller.signal);
      controller.signal.throwIfAborted();
    } catch {
      if (!controller.signal.aborted) {
        setError("Could not process this crop. Please try again.");
        setStage("crop");
      }
      return;
    } finally {
      processing.current = null;
    }
    setResultSrc(dataUrl);
    setCount(c => c + 1);
    setStage("result");
    onCapture?.(dataUrl, details);
  }
  function reset() {
    setStage("idle");
    setImageSrc(null);
    setResultSrc(null);
    setError(null);
  }

  return (
    <main className={`${styles.screen} ${cropping ? styles.dark : ""}`} aria-busy={stage === "processing"}>
      <input ref={inputRef} type="file" accept="image/*" capture="environment" hidden onChange={handleFileChange} />
      <header className={styles.header}>
        <p className={styles.eyebrow}>EKG CAPTURE</p>
        <h1 ref={titleRef} tabIndex={-1}>{cropping ? "Adjust page corners" : stage === "result" ? "Review your capture" : "Capture a clear EKG"}</h1>
        <p className={styles.subtitle}>{cropping ? "Drag corners to the paper edges. Keep every waveform inside." : stage === "result" ? "Check that the full waveform is included before saving." : "Place the paper flat and fit the entire printout in your photo."}</p>
      </header>

      {stage === "idle" && <section className={styles.idleContent} aria-label="Take an EKG photo">
        <div className={styles.documentIcon} aria-hidden="true">
          <svg viewBox="0 0 160 180" fill="none"><rect x="25" y="15" width="110" height="150" rx="8" stroke="currentColor" strokeWidth="2" /><path d="M43 44H117M43 57H87M40 106H60L68 92L78 128L88 77L99 106H120M43 143H91" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </div>
        <p>One photo. All four corners.</p>
        <span>You can fine-tune the page boundary next.</span>
      </section>}

      {cropping && imageSrc && <QuadCropper key={imageSrc} src={imageSrc} imageRef={imageRef} image={image} size={size} corners={corners}
        disabled={stage === "processing"} onLoad={handleImageLoad} onChange={setCorners} />}

      {stage === "result" && resultSrc && <section className={styles.resultContent}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={resultSrc} alt="Perspective-corrected EKG capture" className={styles.resultImage} />
      </section>}

      <footer className={styles.actionBar}>
        <div className={styles.actionsInner}>
          {cropping && resolutionFailure && <div role="alert" className={styles.warning}>
            <strong>{MOVE_CLOSER}</strong><p>{resolutionFailure.reason}</p>
          </div>}
          {cropping && proposalWarning && <p className={styles.hint}>The suggested boundary was invalid. Adjust the starting corners to the page.</p>}
          {error && <p role="alert" className={styles.warning}>{error}</p>}
          {cropping && <p className={styles.hint} role="status">{stage === "processing" ? "Processing full-resolution image…" : "Each corner moves independently. Drag inside to move the selection."}</p>}
          <div className={styles.actions}>
            {stage === "idle" && <button className={styles.primary} onClick={openPicker}>Take / choose photo</button>}
            {cropping && <>
              <button className={styles.secondary} onClick={reset} disabled={stage === "processing"}>Retake</button>
              <button className={styles.primary} onClick={confirmCrop} disabled={stage === "processing" || !canConfirm()}>{stage === "processing" ? "Processing…" : "Confirm crop"}</button>
            </>}
            {stage === "result" && <>
              <button className={styles.secondary} onClick={reset}>Capture another</button>
              <a className={styles.primary} href={resultSrc ?? undefined} download={`ekg-capture-${count}.png`}>Save image</a>
            </>}
          </div>
          <p className={styles.count}>{count} {count === 1 ? "image" : "images"} captured this session</p>
        </div>
      </footer>
    </main>
  );
}
