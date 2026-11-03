"""Separate OCR HTTP app; run from the repository root with the documented app-dir."""

import asyncio
import base64
import io
import logging
import threading
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from PIL import Image
from starlette.concurrency import run_in_threadpool

from app.main import UPLOAD_OPENAPI, read_image
from app.sanitize import MAX_UPLOAD_BYTES, SanitizationError, sanitize_image
from ocr.pipeline import POLICY_VERSION, PrivacyError, deidentify_image
from ocr.runtime import load_paddle

HEADERS = {"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"}
MESSAGES = {
    "nothing_detected": "Identifying text was not confirmed. Try a clearer image.",
    "uncertain_text": "Some printed text could not be verified safely. Try a clearer crop.",
    "unsupported_pixels": "Send an opaque RGB PNG crop.",
    "ocr_failed": "The text check could not complete. Retry or check the OCR service.",
    "redaction_failed": "Identifying text could not be covered safely.",
    "verification_failed": "The redacted image did not pass verification.",
}
logger = logging.getLogger("deidentify_api")


def failure(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse({"status": "nothing_detected" if code == "nothing_detected" else "failed",
                         "code": code, "error": message}, status_code=status, headers=HEADERS)


class _Output(io.BytesIO):
    def write(self, data):
        if self.tell() + len(data) > MAX_UPLOAD_BYTES:
            raise SanitizationError(413, "The processed PNG exceeds the 10 MB limit.")
        return super().write(data)


def process_upload(data: bytes, run_ocr) -> dict:
    clean = sanitize_image(data)
    if clean.source_format != "PNG":
        raise SanitizationError(415, "Send a metadata-sanitized PNG crop.")
    if len(clean.data) > MAX_UPLOAD_BYTES:
        raise SanitizationError(413, "The processed PNG exceeds the 10 MB limit.")
    with Image.open(io.BytesIO(clean.data)) as image:
        result = deidentify_image(image, run_ocr)
    with result.image, _Output() as output:
        result.image.save(output, format="PNG")
        # Reuse #48 on the final encoded artifact, not only the incoming upload.
        final = sanitize_image(output.getvalue())
    if final.width != clean.width or final.height != clean.height or len(final.data) > MAX_UPLOAD_BYTES:
        raise PrivacyError("verification_failed")
    return {"status": "redacted", "image": "data:image/png;base64," + base64.b64encode(final.data).decode("ascii"),
            "regions_redacted": result.regions_redacted}


def create_app(engine_factory=load_paddle, *, processing_timeout: float = 45.0) -> FastAPI:
    slot = threading.Lock()
    executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="deidentify")

    @asynccontextmanager
    async def lifespan(application):
        application.state.engine = None
        try:
            application.state.engine = await run_in_threadpool(engine_factory)
        except Exception:
            # Never interpolate an exception: engines can include input/model data.
            logger.warning("OCR unavailable; check installed dependencies and local model configuration.")
        try:
            yield
        finally:
            executor.shutdown(wait=False, cancel_futures=True)

    application = FastAPI(title="EKG printed-text de-identification", version="0.1.0", lifespan=lifespan)

    @application.exception_handler(HTTPException)
    async def upload_error(_request, error):
        # The reused upload reader emits fixed safe errors only.
        return failure(error.status_code, "invalid_upload", error.detail)

    @application.get("/health")
    async def health():
        return JSONResponse({"status": "ok"}, headers=HEADERS)

    @application.get("/ready")
    async def ready():
        if getattr(application.state, "engine", None) is None:
            return failure(503, "ocr_unavailable", "OCR is not ready. Check dependencies and local models.")
        return JSONResponse({"status": "ready", "policy_version": POLICY_VERSION}, headers=HEADERS)

    @application.post("/deidentify", openapi_extra=UPLOAD_OPENAPI)
    async def deidentify(request: Request):
        engine = getattr(application.state, "engine", None)
        if engine is None:
            return failure(503, "ocr_unavailable", "OCR is not ready. Check dependencies and local models.")
        if not slot.acquire(blocking=False):
            return failure(503, "busy", "The privacy service is busy. Try again shortly.")
        submitted = False

        def work(data):
            try:
                return process_upload(data, engine)
            finally:
                # A timed-out native call keeps the slot until it really finishes.
                slot.release()

        try:
            data = await asyncio.wait_for(read_image(request), timeout=5.0)
            future = asyncio.get_running_loop().run_in_executor(executor, work, data)
            submitted = True
            # Observe late failures after timeout/cancellation without logging data.
            future.add_done_callback(lambda done: done.exception() if not done.cancelled() else None)
            result = await asyncio.wait_for(asyncio.shield(future), timeout=processing_timeout)
            return JSONResponse(result, headers=HEADERS)
        except HTTPException:
            raise
        except SanitizationError as error:
            return failure(error.status_code, "invalid_image", str(error))
        except PrivacyError as error:
            return failure(422, error.code, MESSAGES[error.code])
        except TimeoutError:
            return failure(504, "timeout", "The privacy check timed out. No image was released.")
        except Exception:
            return failure(503, "processing_failed", "The privacy check could not complete. No image was released.")
        finally:
            if not submitted:
                slot.release()

    return application


app = create_app()
