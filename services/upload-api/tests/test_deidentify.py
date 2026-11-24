"""Real sanitizer/cropping/HTTP mechanics with controlled OCR, not OCR accuracy."""

import base64
import io
import threading
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw, PngImagePlugin

from app.deidentify import create_app
from ocr.redact import crop_header
from tests.metadata_fixtures import MARKER, png_chunks

WIDTH, HEIGHT, GRID_TOP = 480, 400, 120


def page(grid_top=GRID_TOP, header=True):
    """A fake page: header text band on top, a light grid below it, and a black 'waveform'."""
    image = Image.new("RGB", (WIDTH, HEIGHT), "white")
    draw = ImageDraw.Draw(image)
    if header:
        draw.text((12, 12), "Patient: Synthetic", fill="black")
    if grid_top < HEIGHT:
        for x in range(0, WIDTH, 10):                       # vertical grid lines
            draw.line([(x, grid_top), (x, HEIGHT - 1)], fill=(200, 200, 200))
        for y in range(grid_top, HEIGHT, 10):               # horizontal grid lines
            draw.line([(0, y), (WIDTH - 1, y)], fill=(200, 200, 200))
    draw.line([(5, 280), (150, 250), (250, 290), (470, 270)], fill="black", width=2)
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


def decode(result):
    return base64.b64decode(result["image"].split(",")[1], validate=True)


def test_verified_output_is_a_cropped_png_with_clean_metadata():
    run, calls = engine_sequence([word()], [])
    with TestClient(create_app(lambda: run)) as client:
        assert client.get("/health").status_code == 200
        assert client.get("/ready").json()["status"] == "ready"
        response = post(client)
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    result = response.json()
    assert result["status"] == "redacted" and result["regions_redacted"] == 1
    data = decode(result)
    assert set(png_chunks(data)) == {b"IHDR", b"IDAT", b"IEND"}
    assert MARKER.encode() not in data
    with Image.open(io.BytesIO(data)) as output:
        assert output.width == WIDTH and not output.info
        top_cut = HEIGHT - output.height
        assert GRID_TOP <= top_cut <= GRID_TOP + 10        # the header band was removed
        pixels = np.asarray(output)
        assert np.array_equal(pixels, calls[0][top_cut:])   # kept rows are an exact copy of the upload
        assert np.array_equal(pixels, calls[1])             # the second OCR pass saw exactly this image


def test_footer_is_cropped_when_identifying_text_is_found_there():
    run, calls = engine_sequence([word(), word("SN 1234567", [10, 360, 150, 380])], [])
    with TestClient(create_app(lambda: run)) as client:
        response = post(client)
    assert response.status_code == 200 and response.json()["regions_redacted"] == 2
    with Image.open(io.BytesIO(decode(response.json()))) as output:
        pixels = np.asarray(output)
        assert output.height <= HEIGHT - GRID_TOP - (HEIGHT - 360)     # header AND footer removed
        # the kept rows are one exact slice of the upload, starting at the grid
        assert any(np.array_equal(pixels, calls[0][top:top + output.height])
                   for top in range(GRID_TOP, GRID_TOP + 10))


def test_cropping_does_not_depend_on_ocr_reading_the_header():
    # the first OCR pass is only a hint: unreadable header text must not stop the crop
    run, _ = engine_sequence([word(conf=0.2)], [])
    with TestClient(create_app(lambda: run)) as client:
        response = post(client)
    assert response.status_code == 200
    with Image.open(io.BytesIO(decode(response.json()))) as output:
        assert output.height < HEIGHT - GRID_TOP + 10


@pytest.mark.parametrize("first,second,code", [
    ([word()], [word()], "verification_failed"),                                        # identifying text still present
    ([word()], [word("Unknown residual text", [10, 70, 180, 90])], "uncertain_text"),   # unlisted readable text
    ([word()], RuntimeError(MARKER), "ocr_failed"),                                      # second pass crashed
    (RuntimeError(MARKER), None, "ocr_failed"),                                          # first pass crashed
])
def test_uncertain_or_failed_processing_never_returns_an_image(first, second, code):
    run, _ = engine_sequence(first, second)
    with TestClient(create_app(lambda: run)) as client:
        response = post(client)
    assert response.status_code == 422
    assert response.json()["code"] == code
    assert "image" not in response.json() and MARKER not in response.text


def test_unsure_word_that_reads_clearly_on_a_closer_look_blocks():
    unsure = word("Jane Doe", [10, 70, 100, 90], conf=0.3)
    clear = word("Jane", [0, 0, 40, 10], conf=0.9)               # the enlarged crop reads it clearly
    run, calls = engine_sequence([word()], [unsure], [clear])
    with TestClient(create_app(lambda: run)) as client:
        response = post(client)
    assert response.status_code == 422 and response.json()["code"] == "uncertain_text"
    assert len(calls) == 3 and "image" not in response.json()


def test_waveform_misread_as_unsure_text_is_not_a_block():
    unsure = word("AAAA", [10, 70, 60, 90], conf=0.47)
    run, calls = engine_sequence([word()], [unsure], [])          # a closer look finds nothing readable
    with TestClient(create_app(lambda: run)) as client:
        response = post(client)
    assert response.status_code == 200 and len(calls) == 3


def test_page_without_a_header_is_not_released():
    run, _ = engine_sequence([])
    with TestClient(create_app(lambda: run)) as client:
        response = post(client, page(grid_top=0, header=False))
    assert response.status_code == 422 and response.json()["code"] == "nothing_detected"
    assert "image" not in response.json()


def test_page_without_a_grid_fails_safe():
    run, _ = engine_sequence([])
    with TestClient(create_app(lambda: run)) as client:
        response = post(client, page(grid_top=HEIGHT))
    assert response.status_code == 422 and response.json()["code"] == "redaction_failed"
    assert "image" not in response.json()


@pytest.mark.parametrize("box", [[40, 30, 10, 10], [1000, 1000, 1100, 1100],
                                 [10, 10, 10, 10], [float("nan"), 1, 20, 20],
                                 [1, 1, float("inf"), 20], [False, 1, 20, 20]])
def test_bad_boxes_cannot_release_an_image(box):
    run, _ = engine_sequence([word(box=box)])
    with TestClient(create_app(lambda: run)) as client:
        response = post(client)
    assert response.status_code == 422 and "image" not in response.json()


def test_expected_ecg_text_survives_verification():
    lead = word("II", [10, 70, 25, 90])
    run, _ = engine_sequence([word(), lead], [lead])
    with TestClient(create_app(lambda: run)) as client:
        assert post(client).status_code == 200


def test_crop_failure_does_not_expose_values():
    output, info = crop_header(MARKER)                            # not an image: must fail safe
    assert output is None and info["status"] == "failed" and MARKER not in str(info)


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