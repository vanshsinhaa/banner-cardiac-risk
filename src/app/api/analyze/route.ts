import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

export const runtime = "nodejs";

const MAX_BYTES = 10 * 1024 * 1024;
const headers = { "Cache-Control": "no-store" };

function runAnalysis(input: Buffer): Promise<string> {
  const folder = path.join(process.cwd(), "preprocessing");
  const venv = path.join(folder, "venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  const python = process.env.ECG_PYTHON || (existsSync(venv) ? venv : "python3");
  return new Promise((resolve, reject) => {
    const child = execFile(python, ["-B", path.join(folder, "analyze.py")], {
      timeout: 120_000,
      maxBuffer: 112 * 1024 * 1024,
      // Also constrain images decoded by OpenCV itself.
      env: { ...process.env, OPENCV_IO_MAX_IMAGE_PIXELS: "24000000", OMP_THREAD_LIMIT: "1" },
    }, (error, stdout) => error ? reject(error) : resolve(stdout));
    child.stdin?.on("error", reject);
    child.stdin?.end(input);
  });
}

export async function POST(request: Request) {
  if (request.headers.get("content-type")?.split(";")[0] !== "image/png") {
    return Response.json({ error: "Send a PNG crop." }, { status: 415, headers });
  }
  // Enforce the limit while reading, even without a Content-Length header.
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
        return Response.json({ error: "The crop exceeds 10 MB. Choose a smaller image." }, { status: 413, headers });
      }
      chunks.push(value);
    }
  } catch {
    return Response.json({ error: "The image upload was interrupted. Try again." }, { status: 400, headers });
  } finally {
    reader.releaseLock();
  }
  if (!size) return Response.json({ error: "No image was sent." }, { status: 400, headers });

  try {
    const result = JSON.parse(await runAnalysis(Buffer.concat(chunks)));
    const status = result.error ? (result.kind === "invalid_image" ? 400 : 503) : 200;
    return Response.json(result, { status, headers });
  } catch (error) {
    if (error && typeof error === "object" && "killed" in error && error.killed) {
      return Response.json({ error: "No scan result was received within 2 minutes. Please try again." }, { status: 504, headers });
    }
    return Response.json({
      error: "The image check could not complete. Make sure the Python dependencies and Tesseract are installed, then retry. The server allows 2 minutes per check.",
    }, { status: 503, headers });
  }
}
