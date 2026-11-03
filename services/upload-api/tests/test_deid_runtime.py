"""Exercise the version-sensitive Paddle adapter without loading neural weights."""

import sys
import types

import numpy as np
import pytest
from PIL import Image

from ocr.runtime import load_paddle


@pytest.mark.parametrize("result", [
    {"rec_texts": [], "rec_scores": [], "rec_polys": [], "dt_polys": [[[1, 1]]]},
    {"rec_texts": ["II"], "rec_scores": [0.9], "rec_polys": [[[1, 1]]], "dt_polys": [[[1, 1]]]},
])
def test_missing_recognition_or_bad_polygon_prevents_readiness(monkeypatch, tmp_path, result):
    monkeypatch.setenv("DEID_DETECTION_MODEL_DIR", str(tmp_path))
    monkeypatch.setenv("DEID_RECOGNITION_MODEL_DIR", str(tmp_path))
    monkeypatch.setitem(sys.modules, "paddleocr", types.SimpleNamespace(
        PaddleOCR=lambda **_kwargs: types.SimpleNamespace(predict=lambda _pixels: [result])))
    with pytest.raises(ValueError):
        load_paddle()


def test_adapter_uses_bgr_without_resizing_or_changing_coordinates(monkeypatch, tmp_path):
    monkeypatch.setenv("DEID_DETECTION_MODEL_DIR", str(tmp_path))
    monkeypatch.setenv("DEID_RECOGNITION_MODEL_DIR", str(tmp_path))
    inputs = []

    def predict(pixels):
        inputs.append(pixels)
        polygon = [[1, 2], [10, 2], [10, 8], [1, 8]]
        return [{"rec_texts": ["II"], "rec_scores": [0.9], "rec_polys": [polygon], "dt_polys": [polygon]}]

    monkeypatch.setitem(sys.modules, "paddleocr", types.SimpleNamespace(
        PaddleOCR=lambda **_kwargs: types.SimpleNamespace(predict=predict)))
    run = load_paddle()
    result = run(Image.new("RGB", (80, 50), (10, 20, 30)))
    assert inputs[-1].shape == (50, 80, 3)
    assert np.array_equal(inputs[-1][0, 0], [30, 20, 10])
    assert result == [{"text": "II", "conf": 0.9, "box": [1.0, 2.0, 10.0, 8.0]}]
