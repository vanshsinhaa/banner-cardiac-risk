"""In-memory upload boundary. Embedded metadata removal precedes analysis."""

import logging
import uuid

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import Response
from starlette.concurrency import run_in_threadpool
from starlette.formparsers import MultiPartException, MultiPartParser

from app.sanitize import ALLOWED_FORMATS, MAX_UPLOAD_BYTES, SanitizationError, SanitizedImage, sanitize_image

# Extra room for the multipart wrapper (boundary lines, part headers).
MULTIPART_OVERHEAD_BYTES = 64 * 1024
MAX_REQUEST_BYTES = MAX_UPLOAD_BYTES + MULTIPART_OVERHEAD_BYTES

# Starlette writes file parts larger than 1 MB to a temp file on disk.
# Raise that threshold above our request cap so accepted uploads stay in memory.
MultiPartParser.spool_max_size = MAX_REQUEST_BYTES

# Same number as FALLBACK_MIN_PHOTO_LONG_SIDE_PX in src/config/resolution.ts
# (Taiga #44): 297 mm page long side x 8 pixels per mm. Keep the two in sync.
MIN_PHOTO_LONG_SIDE_PX = 297 * 8

logger = logging.getLogger("upload_api")

app = FastAPI(
    title="EKG Upload API (prototype)",
    version="0.2.0",
    description=(
        "Accepts one PNG or JPEG and removes embedded metadata before analysis. "
        "Accepting an image does not mean it contains an EKG. "
        "Printed identifiers remain. No waveform extraction or risk scoring happens here."
    ),
)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


# The request body is described by hand (openapi_extra) because the handler
# reads the form itself. That lets it reject oversized requests by their
# Content-Length before any of the body is parsed.
UPLOAD_OPENAPI = {
    "requestBody": {
        "required": True,
        "content": {
            "multipart/form-data": {
                "schema": {
                    "type": "object",
                    "required": ["file"],
                    "properties": {"file": {"type": "string", "format": "binary"}},
                }
            }
        },
    }
}


class _RequestTooLarge(MultiPartException):
    pass


async def read_image(request: Request) -> bytes:
    content_length = request.headers.get("content-length")
    if content_length is None:
        raise HTTPException(411, "Content-Length header is required.")
    if not content_length.isascii() or not content_length.isdigit():
        raise HTTPException(400, "Content-Length header is invalid.")
    normalized_length = content_length.lstrip("0") or "0"
    # Avoid converting an attacker-controlled, arbitrarily long integer.
    if len(normalized_length) > len(str(MAX_REQUEST_BYTES)) or int(normalized_length) > MAX_REQUEST_BYTES:
        raise HTTPException(413, too_large_message())
    if not request.headers.get("content-type", "").lower().startswith("multipart/form-data"):
        raise HTTPException(422, "Send the image as a multipart form field named 'file'.")

    async def limited_stream():
        # Enforce actual received bytes too: Content-Length is client input.
        received = 0
        async for chunk in request.stream():
            received += len(chunk)
            if received > MAX_REQUEST_BYTES:
                raise _RequestTooLarge("Request exceeds upload limit.")
            yield chunk

    try:
        form = await MultiPartParser(
            request.headers, limited_stream(), max_files=1, max_fields=1
        ).parse()
    except _RequestTooLarge:
        raise HTTPException(413, too_large_message()) from None
    except MultiPartException:
        raise HTTPException(400, "Send one image in a multipart field named 'file'.") from None
    try:
        upload = form.get("file")
        if upload is None or isinstance(upload, str):
            raise HTTPException(422, "Send the image as a multipart form field named 'file'.")

        data = await upload.read(MAX_UPLOAD_BYTES + 1)
        if len(data) == 0:
            raise HTTPException(400, "The uploaded file is empty.")
        if len(data) > MAX_UPLOAD_BYTES:
            raise HTTPException(413, too_large_message())

        return data
    finally:
        await form.close()


async def sanitized_upload(request: Request) -> tuple[SanitizedImage, int]:
    data = await read_image(request)
    try:
        # Decode/encode is CPU work; do not block the ASGI event loop.
        return await run_in_threadpool(sanitize_image, data), len(data)
    except SanitizationError as error:
        raise HTTPException(error.status_code, str(error)) from None


@app.post("/uploads", status_code=201, openapi_extra=UPLOAD_OPENAPI)
async def create_upload(request: Request) -> dict:
    image, source_size = await sanitized_upload(request)
    upload_id = str(uuid.uuid4())
    logger.info("upload sanitized id=%s format=PNG bytes=%d", upload_id, len(image.data))

    long_side = max(image.width, image.height)
    return {
        "upload_id": upload_id,
        "detected_format": image.source_format,
        "media_type": ALLOWED_FORMATS[image.source_format],
        "width": image.width,
        "height": image.height,
        "size_bytes": source_size,
        "sanitized_format": "PNG",
        "sanitized_media_type": image.media_type,
        "sanitized_size_bytes": len(image.data),
        "embedded_metadata_removed": True,
        "printed_identifiers_redacted": False,
        "resolution_check": {
            "long_side_px": long_side,
            "required_long_side_px": MIN_PHOTO_LONG_SIDE_PX,
            "meets_minimum": long_side >= MIN_PHOTO_LONG_SIDE_PX,
        },
        "stored": False,
        "ekg_verified": False,
        "note": "Embedded metadata removed. Printed identifiers remain. EKG content is not verified.",
    }


@app.post("/uploads/sanitize", openapi_extra=UPLOAD_OPENAPI, response_class=Response,
          responses={200: {"content": {"image/png": {"schema": {"type": "string", "format": "binary"}}}}})
async def sanitize_upload(request: Request) -> Response:
    """Integration boundary for #51: pass this PNG to OCR, never the original.

    No persistence or lookup ID. A fixed filename avoids forwarding patient IDs.
    """
    image, _ = await sanitized_upload(request)
    return Response(image.data, media_type=image.media_type, headers={
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": 'attachment; filename="ekg-sanitized.png"',
    })


def too_large_message() -> str:
    return f"File is larger than the {MAX_UPLOAD_BYTES // (1024 * 1024)} MB limit."
