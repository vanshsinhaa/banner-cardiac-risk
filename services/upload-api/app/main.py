"""EKG image upload API prototype (CI/CD competency demo).

Scope, on purpose:
- Checks that an upload is a real PNG or JPEG and reports basic metadata.
- Does NOT check that the image shows an EKG.
- Does NOT remove identifying information, extract waveforms, or score risk.
- Does NOT store images. Bytes stay in memory for one request and are dropped.
"""

import io
import logging
import uuid
import warnings

from fastapi import FastAPI, HTTPException, Request
from PIL import Image, UnidentifiedImageError
from starlette.formparsers import MultiPartParser

# Largest image file we accept, in bytes. 10 MB covers a typical phone photo
# of a printed EKG (about 2-6 MB as JPEG) with room to spare.
MAX_UPLOAD_BYTES = 10 * 1024 * 1024

# Extra room for the multipart wrapper (boundary lines, part headers).
MULTIPART_OVERHEAD_BYTES = 64 * 1024
MAX_REQUEST_BYTES = MAX_UPLOAD_BYTES + MULTIPART_OVERHEAD_BYTES

# Starlette writes file parts larger than 1 MB to a temp file on disk.
# Raise that threshold above our request cap so accepted uploads stay in memory.
MultiPartParser.spool_max_size = MAX_REQUEST_BYTES

# Stop very large pixel counts ("decompression bombs") before decoding.
# 50 megapixels is well above any phone camera photo we expect.
MAX_IMAGE_PIXELS = 50_000_000
Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS

# Pillow format name -> media type we report back.
ALLOWED_FORMATS = {"PNG": "image/png", "JPEG": "image/jpeg"}

# Same number as FALLBACK_MIN_PHOTO_LONG_SIDE_PX in src/config/resolution.ts
# (Taiga #44): 297 mm page long side x 8 pixels per mm. Keep the two in sync.
MIN_PHOTO_LONG_SIDE_PX = 297 * 8

logger = logging.getLogger("upload_api")

app = FastAPI(
    title="EKG Upload API (prototype)",
    version="0.1.0",
    description=(
        "Accepts one PNG or JPEG image and returns basic metadata. "
        "Accepting an image does not mean it contains an EKG. "
        "No de-identification, waveform extraction, or risk scoring happens here."
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


@app.post("/uploads", status_code=201, openapi_extra=UPLOAD_OPENAPI)
async def create_upload(request: Request) -> dict:
    content_length = request.headers.get("content-length")
    if content_length is None:
        raise HTTPException(411, "Content-Length header is required.")
    if not content_length.isdigit():
        raise HTTPException(400, "Content-Length header is invalid.")
    if int(content_length) > MAX_REQUEST_BYTES:
        raise HTTPException(413, too_large_message())

    form = await request.form(max_files=1, max_fields=1)
    try:
        upload = form.get("file")
        if upload is None or isinstance(upload, str):
            raise HTTPException(422, "Send the image as a multipart form field named 'file'.")

        data = await upload.read(MAX_UPLOAD_BYTES + 1)
        if len(data) == 0:
            raise HTTPException(400, "The uploaded file is empty.")
        if len(data) > MAX_UPLOAD_BYTES:
            raise HTTPException(413, too_large_message())

        image_format, width, height = inspect_image(data)
    finally:
        await form.close()

    upload_id = str(uuid.uuid4())
    # Log only metadata. Never log file names or image bytes.
    logger.info("upload accepted id=%s format=%s bytes=%d", upload_id, image_format, len(data))

    long_side = max(width, height)
    return {
        "upload_id": upload_id,
        "detected_format": image_format,
        "media_type": ALLOWED_FORMATS[image_format],
        "width": width,
        "height": height,
        "size_bytes": len(data),
        "resolution_check": {
            "long_side_px": long_side,
            "required_long_side_px": MIN_PHOTO_LONG_SIDE_PX,
            "meets_minimum": long_side >= MIN_PHOTO_LONG_SIDE_PX,
        },
        "stored": False,
        "ekg_verified": False,
        "note": "Image format was checked. Content was not checked for an EKG.",
    }


def inspect_image(data: bytes) -> tuple[str, int, int]:
    """Return (format, width, height) from the bytes themselves.

    The file name and the client's Content-Type are ignored on purpose:
    both are set by the client and are easy to fake.
    """
    try:
        with warnings.catch_warnings():
            # Treat Pillow's "image is very large" warning as an error.
            warnings.simplefilter("error", Image.DecompressionBombWarning)

            with Image.open(io.BytesIO(data)) as probe:
                image_format = probe.format
                if image_format not in ALLOWED_FORMATS:
                    raise HTTPException(
                        415, f"Unsupported image format: {image_format}. Send PNG or JPEG."
                    )
                width, height = probe.size

            # verify() catches truncated or damaged files. It needs a fresh open.
            with Image.open(io.BytesIO(data)) as checker:
                checker.verify()

            # Full decode catches damage verify() misses (for example, cut-off JPEG data).
            with Image.open(io.BytesIO(data)) as decoder:
                decoder.load()
    except HTTPException:
        raise
    except (Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise HTTPException(413, f"Image has more than {MAX_IMAGE_PIXELS:,} pixels.")
    except UnidentifiedImageError:
        raise HTTPException(415, "File is not a recognized image. Send PNG or JPEG.")
    except (OSError, SyntaxError, ValueError):
        raise HTTPException(422, "Image data is corrupt or incomplete.")

    return image_format, width, height


def too_large_message() -> str:
    return f"File is larger than the {MAX_UPLOAD_BYTES // (1024 * 1024)} MB limit."
