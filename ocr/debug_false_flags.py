"""
debug_false_flags.py - lists rows an engine flagged as identifying that do NOT sit on top of a real (ground-truth) fake identifier. 
These are the false alarms that lower precision.

"""

import json 
import sys

#Reuse the same box-math helpers the main script uses, so logicd matches exactly 
from ocr_compare import area, overlap 

#which engine to inspect (defaults to paddleocr if none typed)
engine = sys.argv[1] if len(sys.argv) > 1 else "paddleocr"

truth = json.load(open("samples/ground_truth.json"))
detections = json.load(open(f"results/{engine}_detections.json"))

for item in detections: 
    gt_boxes = [g["box"] for g in truth[item["image"]]["phi"]]
    for r in item["regions"]:
        if not r["identifying"]:
            continue    #only look at rows engine flagged
        #same rule scorer uses: flagged row must mostly sit on real identifier
        on_truth = any(overlap(r["box"], g) / area(r["box"]) >= 0.5 for g in gt_boxes)
        if not on_truth:
            print(item["image"], "|", r["text"], "|", r["box"])