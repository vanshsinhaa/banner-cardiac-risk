"""Tests for the upload API.

Every test image is drawn here in code. No real EKGs, no patient data,
no downloaded datasets.
"""

import pytest
from fastapi.testclient import TestClient

from app.main import MAX_REQUEST_BYTES, MAX_UPLOAD_BYTES, MIN_PHOTO_LONG_SIDE_PX, app
from tests.synthetic import synthetic_ekg_like_image
from tests.metadata_fixtures import MARKER, png_chunks, tagged_image

client = TestClient(app)


def post_file(data: bytes, filename: str = "synthetic.png", content_type: str = "image/png"):
    return client.post("/uploads", files={"file": (filename, data, content_type)})


def test_health():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


@pytest.mark.parametrize("fmt, media_type", [("PNG", "image/png"), ("JPEG", "image/jpeg")])
def test_upload_synthetic_image(fmt, media_type):
    data = synthetic_ekg_like_image(fmt)
    response = post_file(data, f"synthetic.{fmt.lower()}", media_type)

    assert response.status_code == 201
    body = response.json()
    assert body["detected_format"] == fmt
    assert body["media_type"] == media_type
    assert (body["width"], body["height"]) == (600, 300)
    assert body["size_bytes"] == len(data)
    assert len(body["upload_id"]) == 36
    assert body["stored"] is False
    assert body["ekg_verified"] is False
    assert body["embedded_metadata_removed"] is True
    assert body["printed_identifiers_redacted"] is False
    assert body["sanitized_format"] == "PNG"
    # 600 px is far below the Taiga #44 minimum, so the check reports a fail.
    assert body["resolution_check"]["meets_minimum"] is False


def test_upload_ids_are_unique():
    data = synthetic_ekg_like_image("PNG", 50, 50)
    first = post_file(data).json()["upload_id"]
    second = post_file(data).json()["upload_id"]
    assert first != second


def test_resolution_check_passes_for_large_photo():
    # Synthetic image whose long side is exactly the minimum.
    data = synthetic_ekg_like_image("PNG", MIN_PHOTO_LONG_SIDE_PX, 100)
    body = post_file(data).json()
    assert body["resolution_check"]["long_side_px"] == MIN_PHOTO_LONG_SIDE_PX
    assert body["resolution_check"]["meets_minimum"] is True


def test_format_comes_from_bytes_not_filename():
    # JPEG bytes sent with a PNG name and PNG content type.
    data = synthetic_ekg_like_image("JPEG")
    response = post_file(data, "looks_like.png", "image/png")
    assert response.status_code == 201
    assert response.json()["detected_format"] == "JPEG"


def test_empty_upload_rejected():
    response = post_file(b"")
    assert response.status_code == 400
    assert "empty" in response.json()["detail"]


def test_non_image_rejected_even_with_image_name():
    response = post_file(b"this is plain text, not a picture", "fake.png", "image/png")
    assert response.status_code == 415


def test_valid_but_unsupported_format_rejected():
    response = post_file(synthetic_ekg_like_image("GIF"), "synthetic.gif", "image/gif")
    assert response.status_code == 415
    assert "PNG or JPEG" in response.json()["detail"]


def test_truncated_png_rejected():
    data = synthetic_ekg_like_image("PNG")
    response = post_file(data[: len(data) // 2])
    assert response.status_code == 422


def test_truncated_jpeg_rejected():
    data = synthetic_ekg_like_image("JPEG")
    response = post_file(data[: len(data) // 2], "synthetic.jpg", "image/jpeg")
    assert response.status_code == 422


def test_file_one_byte_over_limit_rejected():
    # Checked after parsing: the file part itself is too big.
    response = post_file(b"\0" * (MAX_UPLOAD_BYTES + 1))
    assert response.status_code == 413


def test_request_over_limit_rejected_before_parsing():
    # Checked from the Content-Length header, before the body is read.
    response = post_file(b"\0" * (MAX_REQUEST_BYTES + 1))
    assert response.status_code == 413


def test_missing_file_field_rejected():
    response = client.post("/uploads", data={"not_file": "x"})
    assert response.status_code == 422


def test_sanitized_bytes_endpoint_never_returns_metadata_or_filename(caplog):
    import logging
    with caplog.at_level(logging.INFO, logger="upload_api"):
        response = client.post("/uploads/sanitize", files={"file": (MARKER + ".jpg", tagged_image("JPEG", 6), "image/jpeg")})
        summary = post_file(tagged_image("JPEG"), MARKER + ".jpg", "image/jpeg")
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["content-disposition"] == 'attachment; filename="ekg-sanitized.png"'
    assert MARKER.encode() not in response.content
    assert MARKER not in str(response.headers) + summary.text + caplog.text
    assert set(png_chunks(response.content)) == {b"IHDR", b"IDAT", b"IEND"}
    assert "upload sanitized" in caplog.text


def test_resolution_uses_orientation_applied_dimensions():
    body = post_file(tagged_image("JPEG", 6)).json()
    assert (body["width"], body["height"]) == (30, 60)
    assert body["resolution_check"]["long_side_px"] == 60


def test_multiple_file_parts_rejected():
    data = synthetic_ekg_like_image("PNG", 10, 10)
    response = client.post("/uploads", files=[("file", ("one.png", data)), ("file", ("two.png", data))])
    assert response.status_code == 400


def test_fake_content_length_cannot_bypass_actual_request_cap():
    response = client.post("/uploads", content=b"x" * (MAX_REQUEST_BYTES + 1),
        headers={"content-type": "multipart/form-data; boundary=test", "content-length": "1"})
    assert response.status_code == 413


@pytest.mark.parametrize("value", ["-1", "invalid"])
def test_invalid_content_length_rejected(value):
    response = client.post("/uploads", content=b"", headers={"content-length": value})
    assert response.status_code == 400


def test_missing_content_length_rejected():
    from starlette.requests import Request
    import asyncio
    from fastapi import HTTPException
    from app.main import read_image
    request = Request({"type": "http", "headers": []})
    with pytest.raises(HTTPException) as caught:
        asyncio.run(read_image(request))
    assert caught.value.status_code == 411


def test_sanitization_failure_does_not_report_success(monkeypatch):
    from app import main
    from app.sanitize import SanitizationError
    def failure(_):
        raise SanitizationError(422, "Image could not be sanitized.")
    monkeypatch.setattr(main, "sanitize_image", failure)
    response = post_file(synthetic_ekg_like_image("PNG", 10, 10))
    assert response.status_code == 422
    assert "upload_id" not in response.json()


def test_upload_file_never_spools_to_disk(monkeypatch):
    import starlette.formparsers
    original = starlette.formparsers.SpooledTemporaryFile
    files = []
    def tracked_file(*args, **kwargs):
        file = original(*args, **kwargs)
        files.append(file)
        return file
    monkeypatch.setattr(starlette.formparsers, "SpooledTemporaryFile", tracked_file)
    # Valid image followed by discarded bytes, larger than Starlette's default 1 MB.
    response = post_file(synthetic_ekg_like_image("PNG", 10, 10) + b"x" * (2 * 1024 * 1024))
    assert response.status_code == 201
    assert files and all(file.closed and not file._rolled for file in files)


def test_sanitize_endpoint_has_binary_openapi_contract():
    spec = client.get("/openapi.json").json()
    response = spec["paths"]["/uploads/sanitize"]["post"]["responses"]["200"]
    assert "image/png" in response["content"]
