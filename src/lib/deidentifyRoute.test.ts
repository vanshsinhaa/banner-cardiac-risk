import assert from "node:assert/strict";
import { test } from "node:test";
import { POST } from "../app/api/deidentify/route.ts";

// ---------------------------------------------------------------------------
// These tests call the real route code with a FAKE fetch, so no service has to
// be running. The fake plays the two services the route talks to:
//   sanitizer  (UPLOAD_API_URL)     -> removes metadata, returns a PNG
//   printed-text service (DEID_BACKEND_URL) -> crops the header, returns JSON
// ---------------------------------------------------------------------------

const SANITIZER = "http://sanitizer.test";
const BACKEND = "http://backend.test";

// A tiny stand-in for the cropped image the printed-text service would return.
const croppedImage = "data:image/png;base64," + btoa("cropped-pixels-only");

// Builds the request the capture screen would send: a multipart form with one PNG named "file".
function uploadRequest(): Request {
  const form = new FormData();
  form.append("file", new File([new Uint8Array([1, 2, 3, 4])], "crop.png", { type: "image/png" }));
  return new Request("http://localhost/api/deidentify", { method: "POST", body: form });
}

// Runs one test with the environment variables set (or removed), then restores everything,
// so one test can never leak its settings or its fake fetch into another.
async function withServices(
  fakeFetch: (url: string) => Promise<Response> | Response,
  run: () => Promise<void>,
  env: { configured?: boolean } = {},
) {
  const previousFetch = globalThis.fetch;
  const previousEnv = { ...process.env };
  delete process.env.DEID_MOCK; // the whole point of #78: no test mode
  if (env.configured === false) {
    delete process.env.UPLOAD_API_URL;
    delete process.env.DEID_BACKEND_URL;
  } else {
    process.env.UPLOAD_API_URL = SANITIZER;
    process.env.DEID_BACKEND_URL = BACKEND;
  }
  globalThis.fetch = (async (input: RequestInfo | URL) => fakeFetch(String(input))) as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = previousFetch;
    process.env = previousEnv;
  }
}

// A sanitizer that works: returns a PNG with the right content type.
const sanitizerOk = () => new Response(new Uint8Array([9, 9, 9]), { headers: { "Content-Type": "image/png" } });

// ---------------------------------------------------------------------------
// RELEASED: the pipeline releases the page, the screen gets the cropped image
// ---------------------------------------------------------------------------
test("a released page returns the cropped image and no test-mode flag", async () => {
  await withServices(url => {
    if (url.startsWith(SANITIZER)) return sanitizerOk();
    return Response.json({ status: "redacted", image: croppedImage, regions_redacted: 1 });
  }, async () => {
    const response = await POST(uploadRequest());
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.status, "redacted");
    assert.equal(body.image, croppedImage); // the service's cropped image, not the original upload
    assert.equal(body.mock, undefined); // no mock flag, so the screen shows no TEST MODE banner
  });
});

// ---------------------------------------------------------------------------
// BLOCKED: every safe block code gives its own retake message and NO image
// ---------------------------------------------------------------------------
test("every blocked code returns its fixed retake message and no image", async () => {
  const codes = ["nothing_detected", "uncertain_text", "unsupported_pixels", "redaction_failed", "verification_failed", "ocr_failed"];
  for (const code of codes) {
    await withServices(url => {
      if (url.startsWith(SANITIZER)) return sanitizerOk();
      // The service text below pretends to contain patient details. It must never be relayed.
      return Response.json({ status: "failed", code, error: "LEAK Jane Doe MRN 123456", image: croppedImage }, { status: 422 });
    }, async () => {
      const response = await POST(uploadRequest());
      const body = await response.json();
      assert.equal(response.status, 422, code);
      assert.equal(body.code, code);
      assert.equal(body.image, undefined, `${code} must not return an image`);
      assert.ok(typeof body.error === "string" && body.error.length > 20, code);
      assert.ok(!JSON.stringify(body).includes("Jane Doe"), `${code} must not relay service text`);
    });
  }
});

test("an unknown block code fails safe with no image", async () => {
  await withServices(url => {
    if (url.startsWith(SANITIZER)) return sanitizerOk();
    return Response.json({ status: "failed", code: "something_new", error: "x" }, { status: 422 });
  }, async () => {
    const response = await POST(uploadRequest());
    const body = await response.json();
    assert.equal(response.status, 502);
    assert.equal(body.image, undefined);
  });
});

test("a result that is not a confirmed, non-test redaction is never released", async () => {
  const bad = [
    { status: "redacted", image: croppedImage, regions_redacted: 1, mock: true }, // test backend
    { status: "nothing_detected", image: croppedImage, regions_redacted: 1 }, // wrong status
    { status: "redacted", image: "data:text/html;base64,eA==", regions_redacted: 1 }, // not a PNG
    { status: "redacted", image: croppedImage, regions_redacted: 0 }, // nothing was done
  ];
  for (const reply of bad) {
    await withServices(url => (url.startsWith(SANITIZER) ? sanitizerOk() : Response.json(reply)), async () => {
      const response = await POST(uploadRequest());
      const body = await response.json();
      assert.equal(response.status, 502, JSON.stringify(reply));
      assert.equal(body.image, undefined);
    });
  }
});

// ---------------------------------------------------------------------------
// SERVICE DOWN / NOT CONFIGURED: the screen gets an error and releases nothing
// ---------------------------------------------------------------------------
test("a missing service configuration fails safe before any request is made", async () => {
  await withServices(() => assert.fail("fetch must not be called when not configured"), async () => {
    const response = await POST(uploadRequest());
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.equal(body.image, undefined);
  }, { configured: false });
});

test("the sanitizer being down releases nothing and never reaches the printed-text service", async () => {
  let backendCalled = false;
  await withServices(url => {
    if (url.startsWith(BACKEND)) backendCalled = true;
    throw new TypeError("fetch failed"); // what fetch throws when nothing is listening
  }, async () => {
    const response = await POST(uploadRequest());
    const body = await response.json();
    assert.equal(response.status, 502);
    assert.equal(body.image, undefined);
    assert.equal(backendCalled, false);
  });
});

test("the printed-text service being down releases nothing", async () => {
  await withServices(url => {
    if (url.startsWith(SANITIZER)) return sanitizerOk();
    throw new TypeError("fetch failed");
  }, async () => {
    const response = await POST(uploadRequest());
    const body = await response.json();
    assert.equal(response.status, 502);
    assert.equal(body.image, undefined);
  });
});

test("a timeout releases nothing and reports a timeout", async () => {
  await withServices(url => {
    if (url.startsWith(SANITIZER)) return sanitizerOk();
    throw new DOMException("timed out", "TimeoutError");
  }, async () => {
    const response = await POST(uploadRequest());
    const body = await response.json();
    assert.equal(response.status, 504);
    assert.equal(body.image, undefined);
  });
});