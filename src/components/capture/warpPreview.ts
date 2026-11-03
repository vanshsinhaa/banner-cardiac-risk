import type { Corners } from "@/lib/cropCorners";
import { computeHomography, outputCorners, outputSize, warpRows } from "@/lib/perspective";

/** Replace this adapter with original-photo + corners upload when the backend lands.
 * The displayed image is already orientation-applied by the browser. Do not decode
 * the file a second time or apply EXIF rotation here.
 */
export async function warpPreview(image: HTMLImageElement, corners: Corners, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  // Processing and encoding happen off the UI thread on current browsers.
  // createImageBitmap copies the displayed/oriented image, not the original file.
  const workerCanvas = typeof createImageBitmap !== "undefined" &&
    typeof OffscreenCanvas !== "undefined" && "convertToBlob" in OffscreenCanvas.prototype;
  if (typeof Worker !== "undefined" && (workerCanvas || typeof CompressionStream !== "undefined")) {
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    signal.throwIfAborted();
    const bitmap = workerCanvas ? await createImageBitmap(image) : undefined;
    const pixels = bitmap ? undefined : readSourcePixels(image);
    if (signal.aborted) { bitmap?.close(); signal.throwIfAborted(); }
    const blob = await new Promise<Blob>((resolve, reject) => {
      let worker: Worker;
      try { worker = new Worker(new URL("./warpPreview.worker.ts", import.meta.url), { type: "module" }); }
      catch (error) { bitmap?.close(); reject(error); return; }
      const cleanup = () => { signal.removeEventListener("abort", abort); worker.terminate(); bitmap?.close(); };
      const abort = () => { cleanup(); reject(signal.reason); };
      signal.addEventListener("abort", abort, { once: true });
      worker.onmessage = ({ data }: MessageEvent<{ blob?: Blob; error?: string }>) => {
        cleanup();
        if (data.blob) resolve(data.blob);
        else reject(new Error(data.error ?? "Could not process the crop."));
      };
      worker.onerror = () => { cleanup(); reject(new Error("Could not start image processing.")); };
      worker.onmessageerror = () => { cleanup(); reject(new Error("Could not read the processed crop.")); };
      try {
        if (bitmap) worker.postMessage({ image: bitmap, corners }, [bitmap]);
        else if (pixels) worker.postMessage({ pixels, corners }, [pixels.data.buffer]);
      }
      catch (error) { cleanup(); reject(error); }
    });
    signal.throwIfAborted();
    return readPng(blob);
  }
  return warpOnMainThread(image, corners, signal);
}

function readSourcePixels(image: HTMLImageElement): ImageData {
  const canvas = document.createElement("canvas");
  try {
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Could not read the photo.");
    context.drawImage(image, 0, 0);
    return context.getImageData(0, 0, canvas.width, canvas.height);
  } finally { canvas.width = canvas.height = 0; }
}

function readPng(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Could not read the crop."));
    reader.readAsDataURL(blob);
  });
}

/** Compatibility fallback: yield during resampling even without worker canvases. */
async function warpOnMainThread(image: HTMLImageElement, corners: Corners, signal: AbortSignal): Promise<string> {
  const yieldToUI = () => new Promise<void>(resolve => setTimeout(resolve, 0));
  signal.throwIfAborted();
  // Let React's Processing state paint before reading full-resolution pixels.
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  signal.throwIfAborted();
  const sourceCanvas = document.createElement("canvas");
  const targetCanvas = document.createElement("canvas");
  try {
    sourceCanvas.width = image.naturalWidth;
    sourceCanvas.height = image.naturalHeight;
    const sourceContext = sourceCanvas.getContext("2d", { willReadFrequently: true });
    if (!sourceContext) throw new Error("Could not read the photo.");
    sourceContext.drawImage(image, 0, 0);
    const source = sourceContext.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
    const { width, height } = outputSize(corners);
    targetCanvas.width = width;
    targetCanvas.height = height;
    const context = targetCanvas.getContext("2d");
    if (!context) throw new Error("Could not create the crop.");
    const target = context.createImageData(width, height);
    const inverse = computeHomography(outputCorners(width, height), corners);
    let sliceStart = performance.now();
    for (let row = 0; row < height; row += 8) {
      signal.throwIfAborted();
      warpRows(source, target, inverse, row, Math.min(row + 8, height));
      if (performance.now() - sliceStart >= 8) {
        await yieldToUI();
        sliceStart = performance.now();
      }
    }
    context.putImageData(target, 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) => targetCanvas.toBlob(
      value => value ? resolve(value) : reject(new Error("Could not encode the crop.")), "image/png"));
    signal.throwIfAborted();
    return await readPng(blob);
  } finally {
    sourceCanvas.width = sourceCanvas.height = targetCanvas.width = targetCanvas.height = 0;
  }
}
