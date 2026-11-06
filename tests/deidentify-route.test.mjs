import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../src/app/api/deidentify/route.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { POST } = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
const image = "data:image/png;base64," + Buffer.from("redacted pixels").toString("base64");
const request = (bytes = "original", type = "image/png") => {
  const form = new FormData();
  form.append("file", new Blob([bytes], { type }), "patient-filename.png");
  return new Request("http://localhost/api/deidentify", { method: "POST", body: form });
};
async function withEnv(run, overrides = {}) {
  const previousFetch = globalThis.fetch;
  const values = { NODE_ENV: "test", DEID_MOCK: undefined, UPLOAD_API_URL: "http://sanitizer", DEID_BACKEND_URL: "http://redactor", ...overrides };
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  try { await run(); } finally {
    globalThis.fetch = previousFetch;
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
}

test("only metadata-free pixels reach the redactor, with a fixed filename", async () => withEnv(async () => {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push(url);
    const file = options.body.get("file");
    assert.ok(options.signal);
    assert.equal(options.cache, "no-store");
    assert.notEqual(file.name, "patient-filename.png");
    if (url === "http://sanitizer/uploads/sanitize") return new Response("clean pixels", { headers: { "Content-Type": "image/png" } });
    assert.equal(await file.text(), "clean pixels");
    return Response.json({ status: "redacted", image, regions_redacted: 2 });
  };
  const response = await POST(request());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal((await response.json()).image, image);
  assert.deepEqual(calls, ["http://sanitizer/uploads/sanitize", "http://redactor/deidentify"]);
}));

test("sanitization failure stops before OCR and never returns an image", async () => withEnv(async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response("failure", { status: 422 }); };
  const response = await POST(request());
  assert.equal(response.status, 502);
  assert.equal(calls, 1);
  assert.equal((await response.json()).image, undefined);
}));

test("known backend blocks keep their safe reason without forwarding image or OCR text", async () => withEnv(async () => {
  globalThis.fetch = async url => url.includes("sanitize")
    ? new Response("clean pixels", { headers: { "Content-Type": "image/png" } })
    : Response.json({ code: "uncertain_text", error: "SYNTHETIC PRIVATE TEXT", image }, { status: 422 });
  const response = await POST(request());
  const data = await response.json();
  assert.equal(response.status, 422);
  assert.equal(data.code, "uncertain_text");
  assert.equal(data.image, undefined);
  assert.ok(!JSON.stringify(data).includes("SYNTHETIC PRIVATE TEXT"));
}));

test("unknown backend errors cannot choose displayed messages", async () => withEnv(async () => {
  for (const code of ["unknown", "__proto__", "constructor"]) {
    globalThis.fetch = async url => url.includes("sanitize")
      ? new Response("clean pixels", { headers: { "Content-Type": "image/png" } })
      : Response.json({ code, error: "SYNTHETIC PRIVATE TEXT", image }, { status: 422 });
    const response = await POST(request());
    assert.equal(response.status, 502);
    const data = await response.json();
    assert.equal(data.image, undefined);
    assert.ok(!JSON.stringify(data).includes("SYNTHETIC PRIVATE TEXT"));
  }
}));

test("nothing-detected, malformed, and mock upstream results stay blocked", async () => withEnv(async () => {
  for (const result of [{ status: "nothing_detected", image }, { status: "redacted", image, regions_redacted: 0 }, { status: "redacted", image, regions_redacted: 1, mock: true }, { status: "redacted", image: "javascript:alert(1)", regions_redacted: 1 }]) {
    globalThis.fetch = async url => url.includes("sanitize")
      ? new Response("clean", { headers: { "Content-Type": "image/png" } }) : Response.json(result);
    const response = await POST(request());
    assert.equal(response.status, 502);
    assert.equal((await response.json()).image, undefined);
  }
}));

test("production ignores development mocks and fails closed without the real services", async () => withEnv(async () => {
  globalThis.fetch = async () => assert.fail("Unconfigured service received pixels");
  const response = await POST(request());
  assert.equal(response.status, 503);
  assert.equal((await response.json()).image, undefined);
}, { NODE_ENV: "production", DEID_MOCK: "success", UPLOAD_API_URL: undefined, DEID_BACKEND_URL: undefined }));

test("development mock success is always marked as a mock", async () => withEnv(async () => {
  globalThis.fetch = async () => assert.fail("Mock should not contact services");
  assert.equal((await (await POST(request())).json()).mock, true);
}, { DEID_MOCK: "success" }));

test("timeout during service response body reading returns 504 without an image", async () => withEnv(async () => {
  globalThis.fetch = async () => ({ ok: true, headers: new Headers({ "Content-Type": "image/png" }), blob: async () => { throw new DOMException("Expired", "TimeoutError"); } });
  const response = await POST(request());
  assert.equal(response.status, 504);
  assert.equal((await response.json()).image, undefined);
}));

test("oversized and unsupported files never reach services", async () => withEnv(async () => {
  globalThis.fetch = async () => assert.fail("Invalid upload reached a service");
  assert.equal((await POST(request(new Uint8Array(64 * 1024 * 1024 + 1)))).status, 413);
  assert.equal((await POST(request("text", "text/plain"))).status, 415);
}));
