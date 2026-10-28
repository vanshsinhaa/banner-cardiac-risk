"""
takes the text regions that the OCR prototype found and flagged as identifying, covers each one with a solid black box, 
and saves a new image of the same size. Then it checks its own work:
1. same size, and every pixel OUTSIDE the black boxes is unchanged 
    (so the waveform and grid are untouched)
2. the image is run through OCR again, and no readable text may remain inside
    the covered areas, and nothing identifying may be found anywhere else

Fail-safe rules:
- nothing detected -> image returned unchanged, with a "nothing_detected" flag
- redaction fails -> NO output image is written, status "failed" 

Run:    python redact.py
        python redact.py --detections results/tesseract_detections.json
Out:    redacted/*.png and redacted/redaction_report.json
"""

import argparse
import json
from pathlib import Path 

import numpy as np
from PIL import Image 

#reuse helpers from task 49 prototype so both tasks use identical logic
from ocr_compare import FACTORIES, area, looks_identifying, merge_rows, overlap

SAMPLES_DIR = Path("samples")
OUT_DIR = Path("redacted")
PAD = 6     #extra pixels around each box so whole word is covered
FILL = (0,0,0)      #solid black 

def padded_boxes(regions, width, height):
    #turn 'identifying' regions into integer pixel boxes, padded and kept inside image
    boxes = []
    for r in regions:
        if not r["identifying"]:
            continue
        x0, y0, x1, y1 = r["box"]
        boxes.append([max(0, int(x0 - PAD)), max(0, int(y0 - PAD)),
                    min(width, int(x1+PAD)),  min(height, int(y1 + PAD))])
    return boxes 

"""
Returns (new_image_or_none, info).
    status "redacted"           ->  new image with the regions covered
    status "nothing_detected"   ->  copy of the orignial, unchanged (flagged)
    status "failed"             ->  none: the caller must NOT pass anything on
"""
def redact_image(img, regions):
    try: 
        boxes = padded_boxes(regions, img.width, img.height)
        if not boxes:
            return img.copy(), {"status": "nothing_detected", "boxes": []}
        #image as a grid of pixel values 
        arr = np.array(img.convert("RGB"))  
        for x0, y0, x1, y1 in boxes:
            # paint rectangle solid black 
            arr[y0:y1, x0:x1] = FILL
        return Image.fromarray(arr), {"status": "redacted", "boxes": boxes}
    #anything unexpected -> fail safe 
    except Exception as e:
        return None, {"status": "failed", "error": str(e), "boxes": []}


def outside_unchanged(original, redacted, boxes):
    #True if sizes match and every pixel outside black boxes is identical.
    a = np.array(original.convert("RGB"))
    b = np.array(redacted.convert("RGB"))
    if a.shape != b.shape:
        return False
    #True = pixel should be unchanged
    keep = np.ones(a.shape[:2], dtype=bool)
    for x0, y0, x1, y1 in boxes:
        keep[y0:y1, x0:x1] = False
    return bool((a[keep] == b[keep]).all())


def truth_coverage(truth_items, boxes):
    #synthetic images only: how many of the real fake identifiers sit under a black box?
    covered = sum(1 for g in truth_items if any(overlap(g["box"], b) / area(g["box"]) >= 0.5 for b in boxes))
    return covered, len(truth_items)

def readable(word):
    #count word as readable if OCR is fairly sure of it and it has 2+ letters/digits
    return word["conf"] >= 0.5 and sum(ch.isalnum() for ch in word["text"]) >= 2

def verify_with_ocr(run_ocr, image_path, boxes):
    #run ocr on the redacted image. returns (text leftinside boxes, identifying rows left anywhere).
    words = run_ocr(image_path)
    inside = [w["text"] for w in words 
              if readable(w) and area(w["box"]) > 0
              and any(overlap(w["box"], b) / area(w["box"]) > 0.3 for b in boxes)]
    still_flagged = [r["text"] for r in merge_rows(words) if looks_identifying(r["text"])]
    return inside, still_flagged

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--detections", default="results/paddleocr_detections.json")
    parser.add_argument("--verify-engine", default="paddleocr", choices=list(FACTORIES))
    args = parser.parse_args()

    detections = json.load(open(args.detections))
    #where the fake identifiers really are 
    truth = json.load(open(SAMPLES_DIR / "ground_truth.json"))
    OUT_DIR.mkdir(exist_ok=True)
    #engine used for the second look
    run_ocr = FACTORIES[args.verify_engine]()
    
    report = []
    for item in detections:
        name = item["image"]
        original = Image.open(SAMPLES_DIR / name).convert("RGB")
        redacted, info = redact_image(original, item["regions"])
        entry = {"image": name, "status": info["status"], "boxes_covered": len(info["boxes"])}

        if redacted is None:
            entry["error"] = info["error"]
            report.append(entry)
            continue
        
        #PNG = lossless, no JPEG smudging
        out_path = OUT_DIR / f"{Path(name).stem}.png"
        redacted.save(out_path)
        entry["output"] = str(out_path)
        entry["identifiers_covered"], entry["identifiers_total"] = truth_coverage(truth[name]["phi"], info["boxes"])
        entry["same_size"] = redacted.size == original.size
        entry["outside_unchanged"] = outside_unchanged(original, redacted, info["boxes"])
        inside, still = verify_with_ocr(run_ocr, out_path, info["boxes"])
        entry["text_left_in_boxes"] = inside
        entry["identifying_left_anywhere"] = still 
        entry["passed"] = (entry["same_size"] and entry["outside_unchanged"] and not inside and not still)
        if info["status"] == "nothing_detected":
            entry["flag"] = "no identifying text detected; imagereturn unchanged"
            #needs human look, never silently "clean"
            entry["passed"] = False
        report.append(entry)

    with open(OUT_DIR / "redaction_report.json", "w") as f:
        json.dump(report, f, indent=2)

    #summary
    n = len(report)
    print(f"\nProcessed {n} images (detections: {args.detections}, re-check engine: {args.verify_engine})")
    print(f"    redacted:           {sum(e['status'] == 'redacted' for e in report)}")
    print(f"    nothing detected:   {sum(e['status'] == 'nothing_detected' for e in report)}")
    print(f"    failed:             {sum(e['status'] == 'failed' for e in report)}")
    print(f"    passed all checks:  {sum(e.get('passed', False) for e in report)}/{n}")
    cov = sum(e.get("identifiers_covered", 0) for e in report)
    tot = sum(e.get("identifiers_total", 0) for e in report)
    print(f" fake identifiers covered: {cov}/{tot}")
    for e in report:
        if not e.get("passed", False):
            print(f"    NOT PASSED: {e['image']} -> {e['status']}"
                  f"    | text left in boxes: {e.get('text_left_in_boxes')}"
                  f"    | identifying left: {e.get('identifying_left_anywhere')}")
            

if __name__ == "__main__":
    main()

