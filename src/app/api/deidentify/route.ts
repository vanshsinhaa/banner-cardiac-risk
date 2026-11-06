// Browser -> metadata sanitizer (#48) -> de-identification backend (#51).
// Only an explicit redaction result may cross this boundary.
export const runtime = "nodejs";
const MAX_BYTES = 64 * 1024 * 1024;
const MAX_REQUEST_BYTES = MAX_BYTES + 64 * 1024;
const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const png = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/;
const blockedReasons: Record<string, string> = {
  nothing_detected: "Identifying text was not confirmed. Try a clearer image or adjust the crop.",
  uncertain_text: "Some printed text could not be verified safely. Try a clearer image or adjust the crop.",
  unsupported_pixels: "The privacy service needs an opaque PNG crop.",
  redaction_failed: "Identifying text could not be covered safely. Try another crop.",
  verification_failed: "The redacted image did not pass verification. Nothing was passed on.",
  ocr_failed: "The text check could not complete. Retry or check the OCR service.",
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
        return fail(413, "Image is larger than 64 MB.");
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
  if (!file.size || file.size > MAX_BYTES) return fail(413, "Image is empty or larger than 64 MB.");
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
    if (!clean.size || clean.size > MAX_BYTES) return fail(413, "The sanitized image exceeds the 64 MB processing limit.");
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
