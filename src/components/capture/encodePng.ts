import type { PixelImage } from "../../lib/perspective.ts";

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value >>> 0;
});

function chunk(name: string, bytes: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(bytes.length + 12);
  const view = new DataView(result.buffer);
  view.setUint32(0, bytes.length);
  for (let i = 0; i < 4; i++) result[4 + i] = name.charCodeAt(i);
  result.set(bytes, 8);
  let crc = 0xffffffff;
  for (let i = 4; i < result.length - 4; i++) crc = crcTable[(crc ^ result[i]) & 255] ^ (crc >>> 8);
  view.setUint32(result.length - 4, (crc ^ 0xffffffff) >>> 0);
  return result;
}

/** PNG fallback for workers without OffscreenCanvas (e.g. Windows WebKit).
 * Native streaming DEFLATE, RGBA8, filter 0. No quantization or image library.
 */
export async function encodePng(image: PixelImage): Promise<Blob> {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, image.width);
  view.setUint32(4, image.height);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const stride = image.width * 4;
  let row = 0;
  const rows = new ReadableStream<Uint8Array<ArrayBuffer>>({
    pull(controller) {
      const count = Math.min(16, image.height - row);
      if (!count) { controller.close(); return; }
      const batch = new Uint8Array((stride + 1) * count);
      for (let i = 0; i < count; i++) {
        batch.set(image.data.subarray((row + i) * stride, (row + i + 1) * stride), i * (stride + 1) + 1);
      }
      row += count;
      controller.enqueue(batch);
    },
  });
  const compressed = new Uint8Array(await new Response(rows.pipeThrough(new CompressionStream("deflate"))).arrayBuffer());
  return new Blob([
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header), chunk("IDAT", compressed), chunk("IEND", new Uint8Array()),
  ], { type: "image/png" });
}
