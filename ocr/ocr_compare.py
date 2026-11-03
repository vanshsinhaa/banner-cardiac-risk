"""runs Tesseract, EasyOCR and PaddleOCR on the SAME synthetic images, flags text
that looks like patient-identifying info, and scores each enging against the 
ground truth from make_synthetic_samples.py.

Run:    python ocr_compare.py (all 3 engines)
        python ocr_compare.py --engines tesseract (just one)
Out:    results/summary.json, results/<engine>_detections.json, 
        results/annotated/<engine>/*.png (boxes drawn on images)"""

import argparse
import difflib
import json
import re
import time
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

SAMPLES_DIR = Path("samples")
RESULTS_DIR = Path("results")

# ENGINE WRAPPERS
# Every wrapper returns the same shape: a list of 
#   {"text": str, "box": [x0, y0, x1, y1], "conf":0..1}
# so the rest of the script doesn't care which engine produced it. 
# Each engine is imported INSIDE its function so that a missing/broken install 
# of one engine doesn't stop the others from running.

def make_tesseract():
    import pytesseract
    from pytesseract import Output

    def run(path):
        data = pytesseract.image_to_data(Image.open(path), output_type=Output.DICT)
        out = []
        for i, text in enumerate(data["text"]):
            text = text.strip()
            conf = float(data["conf"][i])
            if not text or conf < 0:        #tesseract uses -1 for "not a word"
                continue
            x0, y0 = data["left"][i], data["top"][i]
            out.append({
                "text": text, 
                "box": [float(x0), float(y0), float(x0 + data["width"][i]), float(y0 + data["height"][i])],
                "conf": conf / 100.0,       #tesseract confidence is 0-100
            })
        return out
    return run

def make_easyocr():
    import easyocr

    #loading model is slow, so do it once, not one per image 
    reader = easyocr.Reader(["en"], gpu=False)

    def run(path):
        out = []
        for points, text, conf in reader.readtext(str(path)):
            xs = [p[0] for p in points]     #EasyOCR gives 4 corner points 
            ys = [p[1] for p in points]
            out.append({"text": text, "box": [float(min(xs)), float(min(ys)), float(max(xs)), float(max(ys))],
                        "conf": float(conf)})
        return out
    return run

def make_paddleocr():
    from paddleocr import PaddleOCR
    #turn off extra document-straightening steps to compare plain OCR 
    ocr = PaddleOCR(use_doc_orientation_classify=False, 
                    use_doc_unwarping=False,
                    use_textline_orientation=False)
    def run(path):
        out = []
        for res in ocr.predict(str(path)):
            data = res["res"] if "res" in res else res #result layout differs slightly between versions 
            polys = data.get("rec_polys", data.get("dt_polys"))
            for text, score, poly in zip(data["rec_texts"], data["rec_scores"], polys):
                pts = np.array(poly)
                x0, y0 = pts.min(axis=0)
                x1, y1 = pts.max(axis=0)
                out.append({"text": text, "box": [float(x0), float(y0), float(x1), float(y1)],
                            "conf": float(score)})
        return out
    return run

FACTORIES = {"tesseract": make_tesseract, "easyocr": make_easyocr, "paddleocr": make_paddleocr}

# GROUP WORDS INTO ROWS 
# Engines split line different (Tesseract gives single words, EasyOCR gives phrases). 
# Merging boxes that sit on the same row makes the comparison fair and lets "Patient:
# and "Jane Testcase" be judged together as one line.

def merge_rows(detections):
    rows = []
    for d in sorted(detections, key=lambda d: (d["box"][1] + d["box"][3]) / 2):
        cy = (d["box"][1] + d["box"][3]) / 2
        h = d["box"][3] - d["box"][1]
        if rows:
            last = rows[-1]
            last_cy = (last["box"][1] + last["box"][3]) / 2
            last_h = last["box"][3] - last["box"][1]
            if abs(cy - last_cy) <= 0.5 * max(h, last_h):   
                last["parts"].append(d)
                last["box"] = [min(last["box"][0], d["box"][0]), min(last["box"][1], d["box"][1]),
                               max(last["box"][2], d["box"][2]), max(last["box"][3], d["box"][3])]
                continue
        rows.append({"box": list(d["box"]), "parts": [d]})
    merged = []
    for r in rows:
        parts = sorted(r["parts"], key=lambda p: p["box"][0])
        merged.append({
            "text": " ".join(p["text"] for p in parts), 
            "box": r["box"],
            "conf": sum(p["conf"] for p in parts) / len(parts),
        })
    return merged

#DECIDE WHICH TEXT LOOKS LIKE PATIENT-IDENTIFYING INFO 
#simple rule-absed first pass (labels + patterns). real pages will need more rules 

PHI_PATTERNS = [
    re.compile(r"\b(patient|name|mrn|dob|birth|ssn|phone|tel|address|acct|account)\b", re.I), #labels
    re.compile(r"\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b"),
    re.compile(r"\(?\d{3}\)?[-.\s]*\d{3}[-.\s]\d{4}"),
    re.compile(r"\b\d{6,}\b"),
]

def looks_identifying(text):
    return any(p.search(text) for p in PHI_PATTERNS)

# SCORING 

def area(b):
    return max(0.0, b[2] -b[0]) * max(0.0, b[3] - b[1])

def overlap(a, b):
    """Area where two boxes overlap"""
    return area([max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3])])

def score_image(rows, truth_items):
    flagged = [r for r in rows if r["flagged"]]
    found, sims, missed = 0, [], []
    for g in truth_items:
        # which flagged row overlaps this ground-truth box the most
        best = max(flagged, key=lambda r: overlap(r["box"], g["box"]), default=None)
        if best and overlap(best["box"], g["box"]) / area(g["box"]) >= 0.5:
            found += 1
            sims.append(difflib.SequenceMatcher(None, g["text"].lower(), best["text"].lower()).ratio())
        else:
            missed.append(g["text"])

    #flagged row is true positive if ti mostly sits on top of ground-truth box
    true_flags = sum(1 for r in flagged
                     if any(overlap(r["box"], g["box"]) / min(area(r["box"]), area(g["box"])) >= 0.5 for g in truth_items))
    return {"gt_total": len(truth_items), "gt_found": found, "flagged": len(flagged), "flagged_true": true_flags, "sims": sims, "missed": missed}

def draw_boxes(image_path, rows, truth_items, out_path):
    """Green = where fake info really is, red = flagged as identifying, blue = other text"""

    img = Image.open(image_path).convert("RGB")
    d = ImageDraw.Draw(img)
    for g in truth_items:
        d.rectangle(g["box"], outline=(0, 160, 0), width=2)
    for r in rows:
        d.rectangle(r["box"], outline=(220, 0, 0) if r["flagged"] else (80, 80, 225), width=3 if r["flagged"] else 1)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    img.save(out_path)

# MAIN
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--engines", nargs="+", default=["tesseract", "easyocr", "paddleocr"])
    args = parser.parse_args()

    truth = json.load(open(SAMPLES_DIR / "ground_truth.json"))
    names = sorted(truth)
    summary = {}

    for engine in args.engines: 
        print(f"\n=== {engine} ===")
        try: 
            run = FACTORIES[engine]()
        except Exception as e:      # not installed / failed to load: skip, keep going 
            print(f"  could not start {engine}: {e}")
            continue
            
        run(SAMPLES_DIR / names[0])   #warm-up so model loading isn't counted in timing

        totals = {"gt_total":0, "gt_found": 0, "flagged": 0, "flagged_true": 0, "sims": [], "seconds": 0.0}
        by_variant = {}
        handoff = []
        for name in names:
            start = time.perf_counter()
            raw = run(SAMPLES_DIR / name)
            totals["seconds"] += time.perf_counter() - start

            rows = merge_rows(raw)
            for r in rows:
                r["flagged"] = looks_identifying(r["text"])
            s = score_image(rows, truth[name]["phi"])
            for k in ("gt_total", "gt_found", "flagged", "flagged_true"):
                totals[k] += s[k]
            totals["sims"] += s["sims"]
            v = by_variant.setdefault(truth[name]["variant"], [0, 0])
            v[0] += s["gt_found"]
            v[1] += s["gt_total"]

            draw_boxes(SAMPLES_DIR / name, rows, truth[name]["phi"], RESULTS_DIR / "annotated" / engine / f"{Path(name).stem}.png")
            handoff.append({"image": name, "missed": s["missed"], "regions": [
                {"text": r["text"], "box": [round(c, 1) for c in r["box"]],
                 "confidence": round(r["conf"], 3), "identifying": r["flagged"]} for r in rows]})
        
        recall = totals["gt_found"] / totals["gt_total"]
        precision = totals["flagged_true"] / totals["flagged"] if totals["flagged"] else 0.0
        summary[engine] = {
            "recall": round(recall, 3), "precision": round(precision, 3),
            "text_similarity": round(sum(totals["sims"]) / len(totals["sims"]), 3) if totals["sims"] else 0.0,
            "seconds_per_image": round(totals["seconds"] / len(names), 2),
            "recall_by_variant": {k: f"{a}/{b}" for k, (a, b) in by_variant.items()},
        }
        RESULTS_DIR.mkdir(exist_ok=True)
        with open(RESULTS_DIR / f"{engine}_detections.json", "w") as f:
            json.dump(handoff, f, indent=2)
        
    with open(RESULTS_DIR / "summary.json", "w") as f:
        json.dump(summary, f, indent=2)

    print("\n" + "=" * 70)
    print(f"{'engine':<11}{'recall':>8}{'precision':>11}{'text sim':>10}{'sec/img':>9}")
    for e, s in summary.items():
        print(f"{e:<11}{s['recall']:>8.2f}{s['precision']:>11.2f}{s['text_similarity']:>10.2f}{s['seconds_per_image']:>9.2f}")
    print("\nRecall by condition (found/total fake identifiers):")
    for e, s in summary.items():
        print(f" {e}: {s['recall_by_variant']}")

if __name__ == "__main__":
    main()
