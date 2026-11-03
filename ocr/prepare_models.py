"""Explicit one-time model download; no patient input. Run from the repo root."""

import hashlib
import importlib.metadata
import json
import os
from pathlib import Path

from .runtime import DETECTION_MODEL, RECOGNITION_MODEL, model_options


def main():
    root = Path(__file__).resolve().parent / ".models"
    os.environ["PADDLE_PDX_CACHE_HOME"] = str(root)
    os.environ["PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK"] = "True"
    from paddleocr import PaddleOCR

    PaddleOCR(**model_options())
    files = {}
    for model in (DETECTION_MODEL, RECOGNITION_MODEL):
        directory = root / "official_models" / model
        if not directory.is_dir():
            raise RuntimeError("Expected model directory was not provisioned.")
        for path in sorted(directory.rglob("*")):
            if path.is_file() and ".cache" not in path.parts:
                with path.open("rb") as source:
                    digest = hashlib.file_digest(source, "sha256").hexdigest()
                files[path.relative_to(root).as_posix()] = {
                    "bytes": path.stat().st_size,
                    "sha256": digest,
                }
    manifest = {
        "packages": {name: importlib.metadata.version(name) for name in ("paddleocr", "paddlepaddle", "paddlex")},
        "models": [DETECTION_MODEL, RECOGNITION_MODEL], "files": files,
    }
    (root / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print("OCR models prepared; hashes recorded in ocr/.models/manifest.json")


if __name__ == "__main__":
    main()
