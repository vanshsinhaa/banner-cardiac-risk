// Browser -> metadata sanitizer (#48) -> de-identification backend (#51).
// Only an explicit redaction result may cross this boundary.
export const runtime = "nodejs";
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_REQUEST_BYTES = MAX_BYTES + 64 * 1024;
const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const png = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/;
// Fixed wording for each safe block code the service can return.
// The service's own text is never relayed to the screen; only these messages are.
// The wording tells the person how to fix it, since most blocks are bad photos.
const blockedReasons: Record<string, string> = {
  nothing_detected: "The printed header at the top of the page was not found. Retake the photo with the whole page in view, or drag the corners to include the header.",
  uncertain_text: "Some printed text was too unclear to check safely. Retake the photo in good light, held steady, with the page flat.",
  unsupported_pixels: "The privacy service needs an opaque PNG crop. Choose another image.",
  redaction_failed: "The identifying header could not be removed safely. This usually means the photo is blurry, rotated or too dark. Retake it in good light with the page flat and the whole page in view.",
  verification_failed: "The cropped image did not pass the final safety check, so nothing was passed on. Retake the photo and try again.",
  ocr_failed: "The text check could not complete. Wait a moment and try again, or check that the printed-text service is running.",
};

function fail(status: number, error: string, code?: string) {
  return Response.json({ status: "failed", error, ...(code ? { code } : {}) }, { status, headers });
}

export async function POST(request: Request) {
  const mock = process.env.NODE_ENV !== "production" ? process.env.DEID_MOCK : undefined;
  const sanitizer = process.env.UPLOAD_API_URL;
  const backend = process.env.DEID_BACKEND_URL;
  if (!mock && (!sanitizer || !backend)) {
    return fail(503, "De-identification is not configured. No image was passed on.");
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data;")) {
    return fail(415, "Send one PNG or JPEG as a multipart field named 'file'.");
  }
  const reader = request.body?.getReader();
  if (!reader) return fail(400, "No image was sent.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_REQUEST_BYTES) {
        await reader.cancel();
        return fail(413, "Image is larger than 10 MB.");
      }
      chunks.push(value);
    }
  } catch {
    return fail(400, "The upload was interrupted.");
  } finally { reader.releaseLock(); }

  let form: FormData;
  try {
    form = await new Response(Buffer.concat(chunks), { headers: { "Content-Type": request.headers.get("content-type")! } }).formData();
  } catch { return fail(400, "Could not read the upload."); }
  const file = form.get("file");
  if (!(file instanceof File)) return fail(400, "No image file was sent.");
  if (!file.size || file.size > MAX_BYTES) return fail(413, "Image is empty or larger than 10 MB.");
  if (!["image/png", "image/jpeg"].includes(file.type)) return fail(415, "Send a PNG or JPEG image.");

  if (mock) {
    if (mock === "fail") return fail(503, "Mock de-identification failure.");
    if (mock === "nothing") return Response.json({ status: "nothing_detected", mock: true }, { headers });
    if (!["success", "redacted", "slow"].includes(mock)) return fail(503, "Unknown DEID_MOCK mode.");
    if (mock === "slow") await new Promise(resolve => setTimeout(resolve, 8000));
    if (file.type !== "image/png") return fail(415, "Test mode expects a PNG crop.");
    return Response.json({
      status: "redacted", image: `data:image/png;base64,${Buffer.from(await file.arrayBuffer()).toString("base64")}`,
      regions_redacted: 0, mock: true,
    }, { headers });
  }

  // One total deadline covers sanitization, redaction, and reading both replies.
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(55_000)]);
  try {
    const input = new FormData();
    input.append("file", file, "ekg-capture.png");
    const sanitized = await fetch(`${sanitizer!.replace(/\/$/, "")}/uploads/sanitize`, {
      method: "POST", body: input, signal, cache: "no-store",
    });
    if (!sanitized.ok || sanitized.headers.get("content-type")?.split(";")[0] !== "image/png") {
      return fail(502, "Image sanitization failed. Nothing was sent for de-identification.");
    }
    const clean = await sanitized.blob();
    if (!clean.size || clean.size > MAX_BYTES) return fail(413, "The sanitized image exceeds the 10 MB processing limit.");
    const upload = new FormData();
    upload.append("file", clean, "ekg-sanitized.png");
    const upstream = await fetch(`${backend!.replace(/\/$/, "")}/deidentify`, {
      method: "POST", body: upload, signal, cache: "no-store",
    });
    if (!upstream.ok) {
      if (upstream.status === 422) {
        const blocked = await upstream.json();
        const code = blocked?.code;
        // Only our fixed wording crosses the boundary; never relay OCR/error text.
        if (typeof code === "string" && Object.hasOwn(blockedReasons, code)) {
          return fail(422, blockedReasons[code], code);
        }
      }
      return fail(502, "De-identification failed. No image was passed on.");
    }
    const data = await upstream.json();
    // Test backends cannot accidentally authorize real downstream processing.
    if (data?.status !== "redacted" || data.mock || typeof data.image !== "string" || !png.test(data.image) ||
        data.image.length > Math.ceil(MAX_BYTES / 3) * 4 + 22 ||
        !Number.isInteger(data.regions_redacted) || data.regions_redacted < 1) {
      return fail(502, "De-identification was not confirmed. No image was passed on.");
    }
    return Response.json({ status: "redacted", image: data.image, regions_redacted: data.regions_redacted }, { headers });
  } catch (error) {
    if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)) return fail(504, "De-identification timed out. No image was passed on.");
    return fail(502, "Could not reach the image privacy services. No image was passed on.");
  }
}
