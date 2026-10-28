export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store" };
const MAX_BYTES = 10 * 1024 * 1024;

// Accept the same original canvas crop used for readability assessment. The
// service performs OCR in its own aligned coordinate frame, not on the preview.
export async function POST(request: Request) {
  const url = process.env.ECG_DIGITIZER_URL;
  if (!url) return Response.json({ error: "The digitizer service is not configured." }, { status: 503, headers });
  if (request.headers.get("content-type")?.split(";")[0] !== "image/png") {
    return Response.json({ error: "Send a PNG crop." }, { status: 415, headers });
  }
  const reader = request.body?.getReader();
  if (!reader) return Response.json({ error: "No image was sent." }, { status: 400, headers });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel();
        return Response.json({ error: "The digitizer accepts crops up to 10 MB." }, { status: 413, headers });
      }
      chunks.push(value);
    }
  } catch {
    return Response.json({ error: "Image upload interrupted." }, { status: 400, headers });
  } finally {
    reader.releaseLock();
  }
  if (!size) return Response.json({ error: "No image was sent." }, { status: 400, headers });
  try {
    const form = new FormData();
    form.append("image", new Blob([Buffer.concat(chunks)], { type: "image/png" }), "crop.png");
    const response = await fetch(`${url.replace(/\/$/, "")}/digitize`, {
      method: "POST", body: form, signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) return Response.json({ error: "The digitizer could not extract this scan. Check the service and crop." }, { status: 502, headers });
    const result = await response.json();
    const names = ["I", "II", "III", "aVR", "aVL", "aVF", "V1", "V2", "V3", "V4", "V5", "V6"];
    const leads = result?.leads;
    if (!leads || typeof leads !== "object" || Array.isArray(leads) || !Object.keys(leads).length ||
        result.units !== "mV" || !Number.isFinite(result.samplingRateHz) || result.samplingRateHz <= 0 ||
        Object.entries(leads).some(([name, samples]) => !names.includes(name) || !Array.isArray(samples) ||
          !samples.length || !samples.some((v: unknown) => typeof v === "number" && Number.isFinite(v)) ||
          samples.some((v: unknown) => v !== null && (typeof v !== "number" || !Number.isFinite(v))))) {
      return Response.json({ error: "The digitizer returned invalid waveform data." }, { status: 502, headers });
    }
    const verification = result.leadVerification;
    if (!verification || !["verified", "conflict", "needs_review"].includes(verification.status) ||
        Object.keys(leads).some(name => !["verified", "unverified", "conflict"].includes(verification.leads?.[name]?.status))) {
      result.leadVerification = { status: "needs_review", reason: "verification_missing_or_invalid", leads: {} };
    }
    const checks = result.leadVerification;
    // Derive the gate; never trust a stale/older service's requiresReview flag.
    result.requiresReview = checks.status !== "verified" ||
      Object.keys(leads).some(name => checks.leads?.[name]?.status !== "verified");
    if (result.requiresReview && checks.status === "verified") checks.status = "needs_review";
    // Presentation policy: either recognizer may supply a label, with local
    // Tesseract evidence preferred. Preserve the original samples and audit.
    const recognitionLeads: Record<string, { status: string; source: string | null; label: string | null }> = {};
    for (const name of Object.keys(leads)) {
      const check = checks.leads?.[name];
      const observed = check?.observedLabels;
      const tesseractLabel = ["verified", "conflict"].includes(check?.status) &&
        Array.isArray(observed) && observed.length === 1 && typeof observed[0] === "string"
        ? names.find(candidate => candidate.toUpperCase() === observed[0].toUpperCase()) : undefined;
      const modelSucceeded = result.modelRecognition?.status === "success" &&
        Array.isArray(result.modelRecognition.leads) && result.modelRecognition.leads.includes(name);
      recognitionLeads[name] = tesseractLabel
        ? { status: "success", source: "tesseract", label: tesseractLabel }
        : modelSucceeded
          ? { status: "success", source: "model", label: name }
          : { status: "needs_review", source: null, label: null };
    }
    result.recognition = {
      status: Object.values(recognitionLeads).some(item => item.status === "success") ? "success" : "needs_review",
      leads: recognitionLeads,
      scope: "At least one recognizer supplied a label. This is not confirmation of every waveform assignment.",
    };
    return Response.json(result, { headers });
  } catch (error) {
    if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)) {
      return Response.json({ error: "No scan result was received within 2 minutes. Please try again." }, { status: 504, headers });
    }
    return Response.json({ error: "Digitization or label verification is unavailable. Please try again." }, { status: 503, headers });
  }
}
