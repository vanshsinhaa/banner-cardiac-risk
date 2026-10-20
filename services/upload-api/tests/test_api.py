"""Tests for the upload API.

Every test image is drawn here in code. No real EKGs, no patient data,
no downloaded datasets.
"""

import pytest
from fastapi.testclient import TestClient

from app.main import MAX_REQUEST_BYTES, MAX_UPLOAD_BYTES, MIN_PHOTO_LONG_SIDE_PX, app
from tests.synthetic import synthetic_ekg_like_image

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
    assert response.status_code == 401  # deliberately wrong: CI demo
    assert "empty" in response.json()["detail"]


def test_non_image_rejected_even_with_image_name():
    response = post_file(b"this is plain text, not a picture", "fake.png", "image/png")
    assert response.status_code == 415


def test_valid_but_unsupported_format_rejected():
    response = post_file(synthetic_ekg_like_image("GIF"), "synthetic.gif", "image/gif")
    assert response.status_code == 415
    assert "GIF" in response.json()["detail"]


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
