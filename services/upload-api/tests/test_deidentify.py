"""Real sanitizer/masking/HTTP mechanics with controlled OCR, not OCR accuracy."""

import base64
import io
import threading
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw, PngImagePlugin

from app.deidentify import create_app
from ocr.redact import redact_image
from tests.metadata_fixtures import MARKER, png_chunks


def page(mode="RGB"):
    image = Image.new(mode, (240, 140), "white")
    draw = ImageDraw.Draw(image)
    draw.text((12, 12), "Patient: Synthetic", fill="black")
    draw.line([(5, 120), (90, 110), (120, 125), (230, 120)], fill="black", width=2)
    text = PngImagePlugin.PngInfo()
    text.add_text("PatientName", MARKER)
    output = io.BytesIO()
    image.save(output, format="PNG", pnginfo=text)
    return output.getvalue()


def word(text="Patient: Synthetic", box=None, conf=0.95):
    return {"text": text, "box": box if box is not None else [10, 10, 155, 35], "conf": conf}


def engine_sequence(*responses):
    calls = []

    def run(image):
        calls.append(np.asarray(image).copy())
        response = responses[len(calls) - 1]
        if isinstance(response, Exception):
            raise response
        return response

    return run, calls


def post(client, data=None):
    return client.post("/deidentify", files={"file": ("patient-filename.png", page() if data is None else data, "image/png")})


def test_verified_output_is_real_same_size_png_with_clean_metadata():
    run, calls = engine_sequence([word()], [])
    with TestClient(create_app(lambda: run)) as client:
        assert client.get("/health").status_code == 200
        assert client.get("/ready").json()["status"] == "ready"
        response = post(client)
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    result = response.json()
    assert result["status"] == "redacted" and result["regions_redacted"] == 1
    data = base64.b64decode(result["image"].split(",")[1], validate=True)
    assert set(png_chunks(data)) == {b"IHDR", b"IDAT", b"IEND"}
    assert MARKER.encode() not in data
    with Image.open(io.BytesIO(data)) as output:
        assert output.size == (240, 140) and not output.info
        pixels = np.asarray(output)
        assert (pixels[4:41, 4:161] == 0).all()
        assert np.array_equal(pixels[45:], calls[0][45:])
        assert np.array_equal(pixels, calls[1])


@pytest.mark.parametrize("first,second,code", [
    ([], None, "nothing_detected"),
    ([word("II")], None, "nothing_detected"),
    ([word("Jane Testcase")], None, "uncertain_text"),
    ([word(conf=0.2)], None, "uncertain_text"),
    ([word()], [word()], "verification_failed"),
    ([word()], [word("Unknown residual text", [10, 70, 180, 90])], "uncertain_text"),
    ([word()], RuntimeError(MARKER), "ocr_failed"),
    (RuntimeError(MARKER), None, "ocr_failed"),
])
def test_uncertain_or_failed_processing_never_returns_an_image(first, second, code):
    run, _ = engine_sequence(first, second)
    with TestClient(create_app(lambda: run)) as client:
        response = post(client)
    assert response.status_code == 422
    assert response.json()["code"] == code
    assert "image" not in response.json() and MARKER not in response.text


@pytest.mark.parametrize("box", [[40, 30, 10, 10], [1000, 1000, 1100, 1100],
                                 [10, 10, 10, 10], [float("nan"), 1, 20, 20],
                                 [1, 1, float("inf"), 20], [False, 1, 20, 20]])
def test_bad_boxes_cannot_report_redacted(box):
    image = Image.new("RGB", (240, 140), "white")
    output, info = redact_image(image, [{"identifying": True, "box": box}])
    assert output is None and info["status"] == "failed"
    run, _ = engine_sequence([word(box=box)])
    with TestClient(create_app(lambda: run)) as client:
        response = post(client)
    assert response.status_code == 422 and "image" not in response.json()


def test_expected_ecg_text_survives_verification():
    lead = word("II", [10, 70, 25, 90])
    run, _ = engine_sequence([word(), lead], [lead])
    with TestClient(create_app(lambda: run)) as client:
        assert post(client).status_code == 200


def test_mask_exception_does_not_expose_values():
    output, info = redact_image(Image.new("RGB", (30, 30)), [{"identifying": True, "box": MARKER}])
    assert output is None and MARKER not in str(info)


def test_unavailable_engine_is_not_ready_and_has_no_image(caplog):
    def broken():
        raise RuntimeError(MARKER)
    with TestClient(create_app(broken)) as client:
        assert client.get("/health").status_code == 200
        assert client.get("/ready").status_code == 503
        response = post(client)
    assert response.status_code == 503 and "image" not in response.json()
    assert MARKER not in caplog.text and "patient-filename" not in caplog.text


@pytest.mark.parametrize("data,status", [(b"bad image", 415), (b"", 400),
                                        (b"x" * (10 * 1024 * 1024 + 1), 413)],
                         ids=["corrupt", "empty", "oversized"])
def test_bad_uploads_do_not_run_ocr(data, status):
    run, calls = engine_sequence()
    with TestClient(create_app(lambda: run)) as client:
        response = post(client, data)
    assert response.status_code == status and not calls and "image" not in response.json()


def test_raw_jpeg_is_rejected_before_ocr():
    output = io.BytesIO()
    Image.new("RGB", (20, 20), "white").save(output, format="JPEG")
    run, calls = engine_sequence()
    with TestClient(create_app(lambda: run)) as client:
        response = post(client, output.getvalue())
    assert response.status_code == 415 and not calls


def test_missing_field_returns_safe_error():
    run, calls = engine_sequence()
    with TestClient(create_app(lambda: run)) as client:
        response = client.post("/deidentify", files={"wrong": ("a.png", page(), "image/png")})
    assert response.status_code == 422 and not calls and "image" not in response.json()


def test_timeout_holds_worker_slot_until_native_call_finishes():
    entered, release = threading.Event(), threading.Event()
    calls = 0

    def slow(_image):
        nonlocal calls
        calls += 1
        if calls == 1:
            entered.set()
            release.wait(timeout=5)
            return [word()]
        return []

    with TestClient(create_app(lambda: slow, processing_timeout=0.05)) as client:
        try:
            response = post(client)
            assert entered.is_set() and response.status_code == 504
            assert "image" not in response.json()
            assert post(client).json()["code"] == "busy"
        finally:
            release.set()


def test_parallel_request_is_rejected_without_second_ocr_call():
    entered, release = threading.Event(), threading.Event()
    run, calls = engine_sequence([word()], [])

    def slow(image):
        if not calls:
            entered.set()
            release.wait(timeout=5)
        return run(image)

    with TestClient(create_app(lambda: slow)) as client, ThreadPoolExecutor(1) as pool:
        future = pool.submit(post, client)
        try:
            assert entered.wait(timeout=3)
            response = post(client)
            assert response.status_code == 503 and response.json()["code"] == "busy"
        finally:
            release.set()
        assert future.result(timeout=3).status_code == 200
