/*
Flow: capture screen (browser) -> this route -> Python de-identification backend

Why a route in the middle? The phone camera needs an https page, and browsers block an https page from calling a plain http server directly ("mixed content"). 
The browser only ever talks to this route; this route talks to the backend server-to-server, where those rules don't apply.

FAIL SAFE: every problem returns an error, never the original image.
*/

import { NextResponse } from "next/server";

//same 10 MB limit as the upload API
const MAX_BYTES = 10 * 1024 * 1024;
//a bit shorter than the screen's own timeout
const BACKEND_TIMEOUT_MS = 55_000;

//builds an error response in the one shape the screen expects
function fail(status: number, message: string) {
    return NextResponse.json({ status: "failed", error: message }, { status });
}

//TEST MODES (local development only): set DEID_MOCK in .env.local.
//These do NOT de-identify anything. They return the image unchanged with mock: true, and the screen 
//shows a "TEST MODE" warning, so nobody mistakes it for the real thing.
async function handleMock(mode: string, file: File) {
    if (mode === "fail") return fail(500, "mock failure (DEID_MOCK=fail).");
    if (mode === "slow") await new Promise((resolve) => setTimeout(resolve, 8000));
    const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
    const image = `data:${file.type};base64,${base64}`;
    if (mode === "nothing") {
        return NextResponse.json({ status: "nothing_detected", image, regions_redacted: 0, mock: true });
    }
    return NextResponse.json({ status: "redacted", image, regions_redacted: 0, mock: true });
}

export async function POST(request: Request) {
    //1. read uploaded form and check file 
    let form: FormData;
    try {
        form = await request.formData();
    } catch {
        return fail(400, "Could not read the upload.");
    }
    const file = form.get("file");
    if (file === null || typeof file === "string") return fail(400, "No image file was sent.");
    if (file.size === 0 || file.size > MAX_BYTES) return fail(413, "Image is empty or larger than 10 MB.");
    if (file.type != "image/jpeg" && file.type !== "image/png") return fail(415, "Send a JPEG or PNG image.");

    // 2. Test modes (ignored in production builds)
    const mock = process.env.DEID_MOCK;
    if (mock && process.env.NODE_ENV !== "production") return handleMock(mock, file);

    // 3. real backend. if it isn't configured, fail, never pass the image through
    const backend = process.env.DEID_BACKEND_URL;
    if (!backend) return fail(503, "De-identification service is not configured.");

    try {
        const upstream = await fetch(`${backend}/deidentify`, {
            method: "POST",
            body: form, 
            signal: AbortSignal.timeout(BACKEND_TIMEOUT_MS),
        });
        if (!upstream.ok) return fail(502, 'De-identification service returned ${upstream.status}.');
        const data = await upstream.json();
        //pass ononly fields screen understands 
        return NextResponse.json({ status: data.status, image: data.image, regions_redacted: data.regions_redacted });
    } catch {
        return fail(502, "Could not reach the de-identification service.");
    }


}