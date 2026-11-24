import { placeholderRiskScore } from "@/lib/riskScore/contract";

export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store" };

// Returns a risk score in the #76 contract. No validated model exists, so every
// response is the fixed placeholder with status "placeholder". The request only says
// which trace the score should be based on; no trace values are needed yet.
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Send JSON." }, { status: 400, headers });
  }
  const source = (body as { traceSource?: unknown } | null)?.traceSource;
  if (source !== "auto" && source !== "corrected") {
    return Response.json({ error: "traceSource must be auto or corrected." }, { status: 400, headers });
  }
  return Response.json(placeholderRiskScore(source, new Date().toISOString()), { headers });
}
