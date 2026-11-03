"""Synthetic metadata and pixel tests; no real identifiers or patient images."""

import io
import struct
import zlib

import pytest
from PIL import Image, IptcImagePlugin

from app import sanitize
from app.sanitize import SanitizationError, sanitize_image
from tests.synthetic import synthetic_ekg_like_image
from tests.metadata_fixtures import MARKER, png_chunks, tagged_image


@pytest.mark.parametrize("fmt", ["PNG", "JPEG"])
def test_all_metadata_is_removed_and_pixels_are_preserved(fmt):
    source = tagged_image(fmt)
    assert MARKER.encode() in source
    clean = sanitize_image(source)
    assert MARKER.encode() not in clean.data
    assert set(png_chunks(clean.data)) == {b"IHDR", b"IDAT", b"IEND"}
    with Image.open(io.BytesIO(source)) as original, Image.open(io.BytesIO(clean.data)) as output:
        assert original.getexif()[0x010E] == MARKER
        assert original.getexif().get_ifd(0x8825)
        if fmt == "JPEG":
            assert IptcImagePlugin.getiptcinfo(original)[(2, 5)] == MARKER.encode()
        assert output.info == {}
        assert not output.getexif()
        assert output.convert("RGB").tobytes() == original.convert("RGB").tobytes()
    assert clean.source_format == fmt
    assert clean.media_type == "image/png"
    assert (clean.width, clean.height) == (60, 30)
    assert "data=" not in repr(clean)


@pytest.mark.parametrize("fmt", ["PNG", "JPEG"])
@pytest.mark.parametrize("orientation", range(1, 9))
def test_all_exif_orientations_are_baked_into_pixels(fmt, orientation):
    source = tagged_image(fmt, orientation)
    clean = sanitize_image(source)
    with Image.open(io.BytesIO(source)) as original, Image.open(io.BytesIO(clean.data)) as output:
        operations = {2: Image.Transpose.FLIP_LEFT_RIGHT, 3: Image.Transpose.ROTATE_180,
                      4: Image.Transpose.FLIP_TOP_BOTTOM, 5: Image.Transpose.TRANSPOSE,
                      6: Image.Transpose.ROTATE_270, 7: Image.Transpose.TRANSVERSE,
                      8: Image.Transpose.ROTATE_90}
        expected = original.convert("RGB")
        if orientation != 1:
            expected = expected.transpose(operations[orientation])
        assert output.size == expected.size
        assert output.tobytes() == expected.tobytes()
        assert not output.getexif()


@pytest.mark.parametrize("mode", ["1", "L", "LA", "RGB", "RGBA", "P", "I;16"])
def test_color_transparency_and_16_bit_grayscale(mode):
    image = Image.new(mode, (4, 3))
    if mode == "P":
        image.putpalette([255, 0, 0] * 256)
        image.info["transparency"] = 0
    elif mode == "I;16":
        image.putpixel((1, 1), 50_000)
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    source = buffer.getvalue()
    clean = sanitize_image(source)
    with Image.open(io.BytesIO(source)) as original, Image.open(io.BytesIO(clean.data)) as output:
        if mode == "I;16":
            assert output.mode == "I;16"
            assert output.getpixel((1, 1)) == 50_000
        else:
            assert output.convert("RGBA").tobytes() == original.convert("RGBA").tobytes()


def test_cmyk_jpeg_converts_without_second_lossy_encode():
    buffer = io.BytesIO()
    Image.new("CMYK", (4, 3), (20, 40, 60, 10)).save(buffer, format="JPEG")
    source = buffer.getvalue()
    with Image.open(io.BytesIO(source)) as original, Image.open(io.BytesIO(sanitize_image(source).data)) as output:
        assert output.tobytes() == original.convert("RGB").tobytes()


def test_animated_png_rejected():
    buffer = io.BytesIO()
    Image.new("RGB", (10, 10), "red").save(buffer, format="PNG", save_all=True,
        append_images=[Image.new("RGB", (10, 10), "blue")], duration=100, loop=0)
    with pytest.raises(SanitizationError) as caught:
        sanitize_image(buffer.getvalue())
    assert caught.value.status_code == 415


@pytest.mark.parametrize("source", [b"\0" * 128 + b"DICM" + MARKER.encode(), b"%PDF-1.7", b"not an image"])
def test_unsupported_containers_fail_closed(source):
    with pytest.raises(SanitizationError) as caught:
        sanitize_image(source)
    assert caught.value.status_code == 415
    assert MARKER not in str(caught.value)


def test_exact_pixel_cap_is_enforced_before_decode(monkeypatch):
    monkeypatch.setattr(sanitize, "MAX_IMAGE_PIXELS", 100)
    with pytest.raises(SanitizationError) as caught:
        sanitize_image(synthetic_ekg_like_image("PNG", 11, 10))
    assert caught.value.status_code == 413


def test_output_size_is_bounded(monkeypatch):
    monkeypatch.setattr(sanitize, "MAX_SANITIZED_BYTES", 32)
    with pytest.raises(SanitizationError) as caught:
        sanitize_image(synthetic_ekg_like_image("PNG", 10, 10))
    assert caught.value.status_code == 413


def test_unknown_private_png_chunk_does_not_survive():
    source = synthetic_ekg_like_image("PNG", 10, 10)
    payload = MARKER.encode()
    private = b"prIv" + payload
    chunk = struct.pack(">I", len(payload)) + private + struct.pack(">I", zlib.crc32(private))
    clean = sanitize_image(source[:33] + chunk + source[33:])
    assert MARKER.encode() not in clean.data
    assert set(png_chunks(clean.data)) == {b"IHDR", b"IDAT", b"IEND"}


def test_sanitizing_twice_is_pixel_identical():
    first = sanitize_image(tagged_image("JPEG", 6))
    second = sanitize_image(first.data)
    assert first.data == second.data
