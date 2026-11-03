"use client";

import { useEffect, useRef, useState } from "react";
import { CAMERA_DETAIL_RECOVERY, FILE_DETAIL_RECOVERY, LIMITED_DETAIL_TITLE } from "@/constants/captureMessages";
import { checkResolution, type ResolutionResult } from "@/lib/checkResolution";
import { insetCorners, isWithinPhoto, orderCorners, type CaptureDetails, type Corners, type PhotoSize } from "@/lib/cropCorners";
import { outputSize } from "@/lib/perspective";
import { analyzeCapture, deidentifyCapture, digitizeCapture, MAX_CAPTURE_BYTES, pngBlob, type Assessment, type DeidentifiedCapture } from "@/lib/capturePipeline";
import { combinedLeadLabels } from "@/lib/combined-lead-labels";
import type { EcgDigitizationResult } from "@/lib/ecg-digitizer/types";
import CameraGuide from "./CameraGuide";
import QuadCropper from "./capture/QuadCropper";
import { warpPreview } from "./capture/warpPreview";
import styles from "./EkgCaptureScreen.module.css";

interface EkgCaptureScreenProps {
  /** Detector proposal in orientation-applied source pixels: TL, TR, BR, BL. */
  initialCorners?: Corners;
  onCapture?: (dataUrl: string, details: CaptureDetails) => void;
}
type Stage = "idle" | "camera" | "crop" | "processing" | "deidentifying" | "blocked" | "result";

function errorMessage(error: unknown) {
  if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)) return "The image check timed out. Please try again.";
  return error instanceof Error ? error.message : "The image could not be processed. Please try again.";
}

export default function EkgCaptureScreen({ initialCorners, onCapture }: EkgCaptureScreenProps) {
  const [stage, setStage] = useState<Stage>("idle");
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [resultSrc, setResultSrc] = useState<string | null>(null);
  const [size, setSize] = useState<PhotoSize | null>(null);
  const [corners, setCorners] = useState<Corners | null>(null);
  const [count, setCount] = useState(0);
  const [resolution, setResolution] = useState<ResolutionResult | null>(null);
  const [photoSource, setPhotoSource] = useState<"file" | "camera">("file");
  const [error, setError] = useState<string | null>(null);
  const [proposalWarning, setProposalWarning] = useState(false);
  const [capture, setCapture] = useState<DeidentifiedCapture | null>(null);
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [digitization, setDigitization] = useState<EcgDigitizationResult | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [digitizerError, setDigitizerError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const pendingCrop = useRef<{ blob: Blob; details: CaptureDetails } | null>(null);
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
    if (!file.type.startsWith("image/") || !file.size || file.size > MAX_CAPTURE_BYTES) {
      setError("Choose a nonempty image no larger than 10 MB.");
      return;
    }
    loadPhoto(URL.createObjectURL(file));
  }
  function loadPhoto(src: string, source: "file" | "camera" = "file") {
    processing.current?.abort();
    processing.current = null;
    pendingCrop.current = null;
    setImageSrc(src);
    setPhotoSource(source);
    loadedImage.current = null;
    setImage(null);
    setSize(null);
    setCorners(null);
    setResolution(null);
    setError(null);
    setProposalWarning(false);
    setCapture(null);
    setResultSrc(null);
    setAssessment(null);
    setDigitization(null);
    setAnalysisError(null);
    setDigitizerError(null);
    setScanning(false);
    setStage("crop");
  }
  function handleImageLoad() {
    const img = imageRef.current;
    if (!img || loadedImage.current === img) return;
    loadedImage.current = img;
    const photo = { width: img.naturalWidth, height: img.naturalHeight };
    // Original dimensions provide advice, never a claim about ECG quality.
    setResolution(checkResolution(photo));
    setSize(photo);
    setImage(img);
    const validProposal = initialCorners && isWithinPhoto(initialCorners, photo);
    // Returning from a blocked privacy request preserves the user's edits.
    setCorners(current => current ?? (validProposal ? initialCorners.map(p => ({ ...p })) as unknown as Corners : insetCorners(photo)));
    setProposalWarning(Boolean(initialCorners && !validProposal));
  }
  function canConfirm() {
    if (!size || !corners || !isWithinPhoto(corners, size) || resolution?.status === "invalid") return false;
    try { outputSize(corners); return true; } catch { return false; }
  }
  async function scan(confirmed: DeidentifiedCapture, controller = new AbortController()) {
    if (confirmed.mock) return;
    processing.current?.abort();
    processing.current = controller;
    const current = () => processing.current === controller && !controller.signal.aborted;
    setScanning(true);
    setAssessment(null);
    setDigitization(null);
    setAnalysisError(null);
    setDigitizerError(null);
    await Promise.allSettled([
      analyzeCapture(confirmed, controller.signal)
        .then(value => { if (current()) setAssessment(value); })
        .catch(error => { if (current()) setAnalysisError(errorMessage(error)); }),
      digitizeCapture(confirmed, controller.signal)
        .then(value => { if (current()) setDigitization(value); })
        .catch(error => { if (current()) setDigitizerError(errorMessage(error)); }),
    ]);
    if (current()) { setScanning(false); processing.current = null; }
  }
  async function sendForDeidentification(pending: { blob: Blob; details: CaptureDetails }, controller: AbortController) {
    setError(null);
    setStage("deidentifying");
    let confirmed: DeidentifiedCapture;
    try {
      confirmed = await deidentifyCapture(pending.blob, controller.signal);
      controller.signal.throwIfAborted();
    } catch (error) {
      if (!controller.signal.aborted && processing.current === controller) {
        setError(errorMessage(error));
        setStage("blocked");
        processing.current = null;
      }
      return;
    }
    pendingCrop.current = null;
    setImageSrc(null);
    setImage(null);
    loadedImage.current = null;
    setCapture(confirmed);
    setResultSrc(confirmed.image);
    setCount(c => c + 1);
    setStage("result");
    processing.current = null;
    // A mock is a preview only: never call downstream consumers with it.
    if (!confirmed.mock) {
      void scan(confirmed);
      onCapture?.(confirmed.image, pending.details);
    }
  }
  function retryDeidentification() {
    if (!pendingCrop.current || processing.current) return;
    const controller = new AbortController();
    processing.current = controller;
    void sendForDeidentification(pendingCrop.current, controller);
  }
  function adjustCrop() {
    if (!pendingCrop.current || processing.current) return;
    pendingCrop.current = null;
    setError(null);
    setStage("crop");
  }
  function replacePhoto() {
    if (photoSource === "file") openPicker();
    else { reset(); setStage("camera"); }
  }
  async function confirmCrop() {
    if (!image || !size || !corners || processing.current || !canConfirm()) return;
    const controller = new AbortController();
    processing.current = controller;
    setStage("processing");
    setError(null);
    const details: CaptureDetails = { ...size, corners: orderCorners(corners) };
    try {
      const dataUrl = await warpPreview(image, details.corners, controller.signal);
      controller.signal.throwIfAborted();
      const pending = { blob: pngBlob(dataUrl), details };
      pendingCrop.current = pending;
      await sendForDeidentification(pending, controller);
    } catch (error) {
      if (!controller.signal.aborted) {
        setError(errorMessage(error));
        setStage("crop");
      }
    } finally {
      if (processing.current === controller) processing.current = null;
    }
  }
  function reset() {
    processing.current?.abort();
    processing.current = null;
    pendingCrop.current = null;
    setStage("idle");
    setImageSrc(null);
    setResultSrc(null);
    setError(null);
    setImage(null);
    loadedImage.current = null;
    setCapture(null);
    setSize(null);
    setCorners(null);
    setResolution(null);
    setScanning(false);
    setAssessment(null);
    setDigitization(null);
    setAnalysisError(null);
    setDigitizerError(null);
  }

  const labels = combinedLeadLabels(assessment?.detected_leads, digitization);
  const detailRecovery = photoSource === "camera" ? CAMERA_DETAIL_RECOVERY : FILE_DETAIL_RECOVERY;
  const replacementLabel = photoSource === "camera" ? "Retake photo" : "Choose another image";
  const readabilityMessage = assessment?.status === "passed" ? "Lead labels found." :
    assessment?.reasons.includes("insufficient_contrast") ? "The ECG has too little contrast for the readability check. Try the original file or a better-lit photo." :
    "Some lead labels could not be read. Check the crop includes the full ECG.";

  return (
    <main className={`${styles.screen} ${cropping ? styles.dark : ""}`} aria-busy={stage === "processing" || stage === "deidentifying"}>
      <input ref={inputRef} type="file" accept="image/*" capture="environment" hidden onChange={handleFileChange} />
      <header className={styles.header}>
        <p className={styles.eyebrow}>EKG CAPTURE</p>
        <h1 ref={titleRef} tabIndex={-1}>{cropping ? "Adjust page corners" : stage === "result" ? "Review your capture" : stage === "deidentifying" ? "Removing identifying information" : stage === "blocked" ? "Image not sent on" : "Capture a clear EKG"}</h1>
        <p className={styles.subtitle}>{cropping ? "Drag corners to the paper edges. Keep every waveform and lead label inside." : stage === "result" ? "Review the image and scan checks before continuing." : "Choose an image or photograph the full printout. You can adjust the page boundary next."}</p>
      </header>

      {stage === "idle" && <section className={styles.idleContent} aria-label="Take an EKG photo">
        <div className={styles.documentIcon} aria-hidden="true">
          <svg viewBox="0 0 160 180" fill="none"><rect x="25" y="15" width="110" height="150" rx="8" stroke="currentColor" strokeWidth="2" /><path d="M43 44H117M43 57H87M40 106H60L68 92L78 128L88 77L99 106H120M43 143H91" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </div>
        <p>One photo. All four corners.</p>
        <span>You can fine-tune the page boundary next.</span>
      </section>}

      {stage === "camera" && <section className={styles.cameraContent}><CameraGuide onPhoto={src => loadPhoto(src, "camera")} onCancel={reset} /></section>}

      {stage === "deidentifying" && <section className={styles.idleContent} role="status" aria-live="polite">
        <p>Removing identifying information. This can take several seconds.</p>
        <span>Please keep this page open.</span>
      </section>}

      {stage === "blocked" && <section className={styles.idleContent}>
        <p>De-identification was not confirmed.</p>
        <span>The image was not saved or sent for analysis.</span>
      </section>}

      {cropping && imageSrc && <QuadCropper key={imageSrc} src={imageSrc} imageRef={imageRef} image={image} size={size} corners={corners}
        disabled={stage === "processing"} onLoad={handleImageLoad} onChange={setCorners}
        onError={() => { reset(); setError("This photo could not be displayed. Try a JPEG or PNG."); }} />}

      {stage === "result" && resultSrc && <section className={styles.resultContent}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={resultSrc} alt="De-identified EKG capture" className={styles.resultImage} />
        {capture?.mock && <p role="alert" className={styles.warning}>TEST MODE: this preview was not de-identified. Saving, analysis, and digitization are disabled.</p>}
        {!capture?.mock && <div className={styles.scanResults} aria-label="Scan checks">
          <p className={styles.privacyStatus}>Identifying information removed.</p>
          {scanning && <p role="status">Checking the ECG: reading lead labels and extracting waveforms. Allow up to 2 minutes.</p>}
          {assessment && <p>Readability: {readabilityMessage}</p>}
          {!!assessment?.missing_leads?.length && <p className={styles.resultHint}>Not read by the readability check: {assessment.missing_leads.join(", ")}.</p>}
          {assessment?.advisories?.includes("limited_image_dimensions") && <p className={styles.resultHint}>This crop has limited image dimensions. The readability result uses the labels found in it.</p>}
          {(assessment || digitization) && <p>{labels.confirmed.length}/12 lead labels recognized. Label presence does not confirm waveform assignments.</p>}
          {analysisError && <p role="alert">Readability check could not finish: {analysisError}</p>}
          {digitizerError && <p role="alert">Waveform extraction could not finish: {digitizerError}</p>}
          {digitization && <p>{Object.keys(digitization.leads).length} {Object.keys(digitization.leads).length === 1 ? "waveform" : "waveforms"} extracted at {digitization.samplingRateHz} Hz. {digitization.requiresReview !== false ? "Lead assignments need review." : "Printed labels agree with the extracted lead assignments."}</p>}
          {assessment && <details><summary>Lighting-corrected preview</summary>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={assessment.processed_image} alt="Lighting-corrected de-identified EKG" className={styles.resultImage} />
          </details>}
          {(assessment?.status !== "passed" || analysisError || digitizerError || digitization?.requiresReview !== false) && !scanning && <p className={styles.resultHint}>You can retry the checks or use another image. {detailRecovery}</p>}
          {capture && <button className={styles.secondary} disabled={scanning} onClick={() => void scan(capture)}>Run scan checks again</button>}
        </div>}
        {size && <details className={styles.imageDetails}><summary>Image details</summary>
          <p>Original image: {size.width} × {size.height} pixels.</p>
          <p>Dimensions alone do not confirm waveform quality. Cropping does not add missing detail.</p>
        </details>}
      </section>}

      <footer className={styles.actionBar}>
        <div className={styles.actionsInner}>
          {cropping && resolution?.status === "advisory" && <div role="status" className={styles.advisory}>
            <strong>{LIMITED_DETAIL_TITLE}</strong><p>{resolution.reason}</p>
          </div>}
          {cropping && resolution?.status === "invalid" && <p role="alert" className={styles.warning}>{resolution.reason}</p>}
          {cropping && size && <details className={styles.imageDetails}><summary>Image details</summary>
            <p>Original image: {size.width} × {size.height} pixels. {detailRecovery}</p>
          </details>}
          {cropping && proposalWarning && <p className={styles.hint}>The suggested boundary was invalid. Adjust the starting corners to the page.</p>}
          {error && <p role="alert" className={styles.warning}>{error}</p>}
          {cropping && <p className={styles.hint} role="status">{stage === "processing" ? "Processing full-resolution image…" : "Each corner moves independently. Drag inside to move the selection."}</p>}
          <div className={styles.actions}>
            {stage === "idle" && <>
              <button className={styles.primary} onClick={openPicker}>Take / choose photo</button>
              <button className={styles.secondary} onClick={() => setStage("camera")}>Use camera guide</button>
            </>}
            {stage === "deidentifying" && <button className={styles.secondary} onClick={reset}>Cancel</button>}
            {stage === "blocked" && <>
              <button className={styles.secondary} onClick={replacePhoto}>{replacementLabel}</button>
              <button className={styles.primary} onClick={retryDeidentification}>Try again</button>
            </>}
            {cropping && <>
              <button className={styles.secondary} onClick={replacePhoto} disabled={stage === "processing"}>{replacementLabel}</button>
              <button className={styles.primary} onClick={confirmCrop} disabled={stage === "processing" || !canConfirm()}>{stage === "processing" ? "Processing…" : "Use this crop"}</button>
            </>}
            {stage === "result" && <>
              <button className={styles.secondary} onClick={replacePhoto}>{replacementLabel}</button>
              {!capture?.mock && <a className={styles.primary} href={resultSrc ?? undefined} download={`ekg-capture-${count}.png`}>Save image</a>}
            </>}
          </div>
          {stage === "blocked" && <button className={styles.textAction} onClick={adjustCrop}>Adjust crop</button>}
          {cropping && stage !== "processing" && <button className={styles.textAction} onClick={reset}>Cancel</button>}
          <p className={styles.count}>{count} {count === 1 ? "image" : "images"} captured this session</p>
        </div>
      </footer>
    </main>
  );
}
