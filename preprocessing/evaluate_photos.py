"""Report OCR coverage on local photos; this is not an accuracy benchmark."""

import argparse
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict
import json
import os
from pathlib import Path
import time

os.environ.setdefault("OMP_THREAD_LIMIT", "1")
import cv2

from preprocess import find_boundary, warp
from quality import check_scan_quality


def evaluate(path):
    start = time.monotonic()
    result = {"file": path.name}
    try:
        image = cv2.imread(str(path))
        if image is None:
            raise ValueError("Could not decode image")
        points = find_boundary(image)
        rectified = warp(image, points) if points is not None else image
        result.update(asdict(check_scan_quality(rectified)))
        result["boundary_found"] = points is not None
        result["shape"] = list(rectified.shape[:2])
    except (ValueError, RuntimeError, cv2.error) as exc:
        result["error"] = str(exc)
    result["seconds"] = round(time.monotonic() - start, 2)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("folder", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--workers", type=int, choices=range(1, 5), default=1)
    args = parser.parse_args()
    paths = sorted(p for p in args.folder.iterdir() if p.suffix.lower() in {".jpg", ".jpeg", ".png"})
    if not paths:
        parser.error("No JPEG or PNG images found")
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        results = list(pool.map(evaluate, paths))
    summary = {
        "images": len(results),
        "images_with_confirmed_labels": sum(bool(r.get("detected_leads")) for r in results),
        "passes": sum(r.get("accepted", False) for r in results),
        "errors": sum("error" in r for r in results),
        "note": "Detection counts are not recognition accuracy. No ground-truth labels were supplied.",
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps({"summary": summary, "images": results}, indent=2) + "\n")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
