"""First image-processing stage: decoded pixels in a new, metadata-free PNG.

This removes embedded information, not identifying text visible in the pixels.
No input filenames, tag values, or image bytes belong in logs or exceptions.
"""

import io
import warnings
from dataclasses import dataclass, field

from PIL import Image, ImageOps, UnidentifiedImageError

MAX_UPLOAD_BYTES = 10 * 1024 * 1024
MAX_IMAGE_PIXELS = 50_000_000
MAX_SANITIZED_BYTES = 64 * 1024 * 1024
ALLOWED_FORMATS = {"PNG": "image/png", "JPEG": "image/jpeg"}


class SanitizationError(ValueError):
    def __init__(self, status_code: int, message: str):
        super().__init__(message)
        self.status_code = status_code


@dataclass(frozen=True)
class SanitizedImage:
    data: bytes = field(repr=False)
    source_format: str
    width: int
    height: int
    media_type: str = "image/png"


class _BoundedOutput(io.BytesIO):
    def write(self, data: bytes) -> int:
        if self.tell() + len(data) > MAX_SANITIZED_BYTES:
            raise SanitizationError(413, "Sanitized image exceeds the output size limit.")
        return super().write(data)


def sanitize_image(data: bytes) -> SanitizedImage:
    """Accept one static PNG/JPEG, apply orientation, and rebuild from pixels.

    A fresh Image owns only pixels: EXIF/XMP/IPTC, PNG text, ICC, thumbnails,
    private chunks, and trailing bytes never enter its encoder. PNG avoids a
    second lossy JPEG encode. Callers must pass only the returned bytes onward.
    DICOM, animated PNG, PDF, and other containers fail closed.
    """
    if not data:
        raise SanitizationError(400, "The uploaded file is empty.")
    if len(data) > MAX_UPLOAD_BYTES:
        raise SanitizationError(413, "File is larger than the 10 MB limit.")
    if data[128:132] == b"DICM":
        raise SanitizationError(415, "DICOM is not supported. Send a PNG or JPEG export.")

    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(data), formats=list(ALLOWED_FORMATS)) as probe:
                source_format = probe.format
                if probe.width * probe.height > MAX_IMAGE_PIXELS:
                    raise SanitizationError(413, "Image has more than 50,000,000 pixels.")
                if getattr(probe, "n_frames", 1) != 1:
                    raise SanitizationError(415, "Animated or multi-frame images are not supported.")
                probe.verify()

            with Image.open(io.BytesIO(data), formats=list(ALLOWED_FORMATS)) as decoded:
                decoded.load()  # verify alone misses some truncated JPEGs
                ImageOps.exif_transpose(decoded, in_place=True)
                # Retain 16-bit grayscale precision. Palette transparency must
                # become pixels before its metadata is discarded.
                if decoded.mode in {"I;16", "I;16L", "I;16B"}:
                    mode = "I;16"
                else:
                    mode = "RGBA" if "A" in decoded.getbands() or "transparency" in decoded.info else "RGB"
                with decoded.convert(mode) as pixels:
                    with Image.new(mode, pixels.size) as clean:
                        clean.paste(pixels)
                        with _BoundedOutput() as output:
                            clean.save(output, format="PNG")
                            return SanitizedImage(output.getvalue(), source_format, clean.width, clean.height)
    except SanitizationError:
        raise
    except (Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise SanitizationError(413, "Image exceeds the safe pixel limit.") from None
    except UnidentifiedImageError:
        raise SanitizationError(415, "File is not a supported image. Send PNG or JPEG.") from None
    except (OSError, SyntaxError, ValueError, TypeError, OverflowError):
        raise SanitizationError(422, "Image data or embedded metadata is corrupt or incomplete.") from None
