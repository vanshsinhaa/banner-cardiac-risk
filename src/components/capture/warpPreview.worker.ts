import type { Corners } from "../../lib/cropCorners.ts";
import { computeHomography, outputCorners, outputSize, warpRows, type PixelImage } from "../../lib/perspective.ts";
import { encodePng } from "./encodePng.ts";

/** Worker owns its bitmap/canvases. Terminating it also cancels processing. */
self.onmessage = async ({ data }: MessageEvent<{ image?: ImageBitmap; pixels?: PixelImage; corners: Corners }>) => {
  const { image, corners } = data;
  let sourceCanvas: OffscreenCanvas | undefined;
  let targetCanvas: OffscreenCanvas | undefined;
  try {
    let source = data.pixels;
    if (image) {
      sourceCanvas = new OffscreenCanvas(image.width, image.height);
      const sourceContext = sourceCanvas.getContext("2d", { willReadFrequently: true });
      if (!sourceContext) throw new Error("Could not read the photo.");
      sourceContext.drawImage(image, 0, 0);
      source = sourceContext.getImageData(0, 0, image.width, image.height);
      image.close();
    }
    if (!source) throw new Error("Missing source pixels.");
    const { width, height } = outputSize(corners);
    const target = { width, height, data: new Uint8ClampedArray(width * height * 4) };
    const inverse = computeHomography(outputCorners(width, height), corners);
    warpRows(source, target, inverse, 0, height);
    let blob: Blob;
    if (typeof OffscreenCanvas !== "undefined" && "convertToBlob" in OffscreenCanvas.prototype) {
      targetCanvas = new OffscreenCanvas(width, height);
      const context = targetCanvas.getContext("2d");
      if (!context) throw new Error("Could not create the crop.");
      context.putImageData(new ImageData(target.data, width, height), 0, 0);
      blob = await targetCanvas.convertToBlob({ type: "image/png" });
    } else {
      blob = await encodePng(target);
    }
    self.postMessage({ blob });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : "Could not process the crop." });
  } finally {
    image?.close();
    if (sourceCanvas) sourceCanvas.width = sourceCanvas.height = 0;
    if (targetCanvas) targetCanvas.width = targetCanvas.height = 0;
  }
};
