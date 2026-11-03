"""Pinned PaddleOCR adapter. Model provisioning is separate from request handling."""

import os
from pathlib import Path

import numpy as np

DETECTION_MODEL = "PP-OCRv5_mobile_det"
RECOGNITION_MODEL = "en_PP-OCRv5_mobile_rec"


def model_options() -> dict:
    return {
        "device": "cpu",
        "text_detection_model_name": DETECTION_MODEL,
        "text_recognition_model_name": RECOGNITION_MODEL,
        "use_doc_orientation_classify": False,
        "use_doc_unwarping": False,
        "use_textline_orientation": False,
        "text_rec_score_thresh": 0.0,
        "enable_mkldnn": False,
        "cpu_threads": 2,
    }


def load_paddle():
    # Require local models: the running service must not start downloads.
    model_root = Path(__file__).resolve().parent / ".models" / "official_models"
    detection = os.environ.get("DEID_DETECTION_MODEL_DIR", str(model_root / DETECTION_MODEL))
    recognition = os.environ.get("DEID_RECOGNITION_MODEL_DIR", str(model_root / RECOGNITION_MODEL))
    if not all(Path(path).is_dir() for path in (detection, recognition)):
        raise RuntimeError("Local OCR models are missing.")
    os.environ.setdefault("PADDLE_PDX_CACHE_HOME", str(model_root.parent))
    os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")
    from paddleocr import PaddleOCR

    engine = PaddleOCR(**model_options(), text_detection_model_dir=detection,
                       text_recognition_model_dir=recognition)

    def run(image):
        # Paddle's ndarray input is BGR; output coordinates remain in crop pixels.
        pixels = np.asarray(image.convert("RGB"))[:, :, ::-1].copy()
        results = list(engine.predict(pixels))
        if len(results) != 1:
            raise ValueError("Unexpected OCR response.")
        data = results[0]
        if "res" in data:
            data = data["res"]
        texts, scores, polygons = data["rec_texts"], data["rec_scores"], data["rec_polys"]
        if not len(texts) == len(scores) == len(polygons) == len(data["dt_polys"]):
            raise ValueError("Incomplete OCR response.")
        words = []
        for text, score, polygon in zip(texts, scores, polygons):
            points = np.asarray(polygon)
            if points.shape != (4, 2) or not np.isfinite(points).all():
                raise ValueError("Invalid OCR coordinates.")
            low, high = points.min(axis=0), points.max(axis=0)
            words.append({"text": text, "conf": float(score),
                          "box": [float(low[0]), float(low[1]), float(high[0]), float(high[1])]})
        return words

    # Warm the actual predictor before the service becomes ready.
    from PIL import Image
    run(Image.new("RGB", (256, 128), "white"))
    return run
