"""
task (#60)

One repeatable command that answers: "after the team's de-identification pipeline runs, 
can any known fake identifier still be read?"

It tests the REAL pipeline, ocr/pipeline.py -> deidentify_image(), using the same pinned OCR models thes service uses (ocr/runtime.py).

For every synthetic image in samples/ there are three possible outcomes: 
    Released:   the pipeline returned a redacted image. We JUDGE it against samples/ground_truth.json (the answer key of where each fake identifier really is). 
                For each known identifier it checks: 
                    (a) COVERED: enough of its box is solid black
                    (b) READABLE: a fresh OCR pass finds no readable text inside it
                Failing either one means the identifier LEAKED.
    Blocked:    the pipeline refused (raised PrivacyError) and returned NO image. 
                Nothing can leak from that, so it is not a leak. It is reported with its reason code,
                becuase blocking everything is safe but not useful. 
    Error:      something unexpected crashed. counts as a failure. 

Control set: the same judge runs on the original images with  redaction skipped. Every control image must be falgged as a leak by the OCR check. 
If one is not, the checker itself can't be trusted. 

Exit codes: 0 = clean
            1 = leak or unexpected error
            2 = checker broken (a control did not leak, or the OCR models could not load) 

Run (from the REPO ROOT, with the venv active):
    python -m ocr.phi_leak_check

Output: ocr/leakcheck/report.json and ocr/leakcheck/report.md
"""

import json
import sys
from pathlib import Path 

import numpy as np
from PIL import Image 

#relative imports: ocr/ is now a package, so we import from  same folder. 
from .ocr_compare import area, overlap
from .pipeline import PrivacyError, deidentify_image 
from .redact import FILL, readable
from .runtime import load_paddle

#find folders relative to this file, so command works from anywhere
HERE = Path(__file__).resolve().parent
SAMPLES_DIR = HERE / "samples"
OUT_DIR = HERE / "leakcheck"

MIN_IMAGES = 16     #acceptance criteria: 16 synthetic images
COVER_MIN = 0.5     # at least this fraction of an identifier's box must be black
# The one identifier the earlier #49/#54 prototype missed (63 of 64 found).
# Kept here so the report always names it instead of hiding it.
KNOWN_EARLIER_MISS = {"image": "very_blurry_1.jpg", "line": "DOB: 02/23/1992"}

def black_fraction(pixels, box):
    # Fraction of the pixels inside `box` that are solid black (redaction fill)
    h, w = pixels.shape[:2]
    x0, y0, x1, y1 = box
    #clamp the box to image, since rotated images can have boxes near an edge
    x0, y0 = max(0, int(x0)), max(0, int(y0))
    x1, y1 = min(w, int(x1)), min(h, int(y1))
    if x1 <= x0 or y1 <= y0:
        return 0.0
    region = pixels[y0:y1, x0:x1]
    #a pixel is "black" if all 3 color channels equal fill color
    return float((region == np.array(FILL)).all(axis=2).mean())

def readable_words_in(words, box):
    #words from OCR pass that are readable and sit mostly inside `box`
    # "readable" is redact.py's own rule: confident, with 2+ letters or digits 
    return [
        w["text"] for w in words 
        if readable(w) and area(w["box"]) > 0
        and overlap(w["box"], box) / area(w["box"]) > 0.3
    ]


def judge(image, truth_items, run_ocr):
    #judge ONE image (released image, or untouched control) against the answer key. 
    # returns one result per known identifier

    pixels = np.asarray(image.convert("RGB"))
    words = run_ocr(image)
    results = []
    for item in truth_items:
        fraction = black_fraction(pixels, item["box"])
        left = readable_words_in(words, item["box"])
        covered = fraction >= COVER_MIN
        results.append({
            "identifier": item["text"],
            "black_fraction": round(fraction, 2),
            "covered": covered,
            "readable_text_left": left, 
            "leaked": (not covered) or bool (left),
        })
    return results

def main():
    truth = json.load(open(SAMPLES_DIR / "ground_truth.json"))
    names = sorted(truth)
    if len(names) < MIN_IMAGES: 
        print(f"ERROR: only {len(names)} images in ground_truth.json; need {MIN_IMAGES}+")
        return 2
    
    print("Loading the OCR models (this takes a moment)...")
    try:
        run_ocr = load_paddle()
    except Exception as e:
        print(f"ERROR: failed to load OCR models: {e}")
        print("See ocr/README.md for the model setup step, then run this again.")
        return 2
    
    per_image, controls = [], []
    for name in names:
        print(f"  checking {name} ...")
        original = Image.open(SAMPLES_DIR / name).convert("RGB")
        phi = truth[name]["phi"]
        entry = {"image": name, "variant": truth[name]["variant"], "known_identifiers": len(phi)}

        #MAIN RUN: real pipeline then independent judge 
        try:
            released = deidentify_image(original, run_ocr)
            ids = judge(released.image, phi, run_ocr)
            entry.update(outcome="released",reason = None, regions_redacted = released.regions_redacted, identifiers=ids, leaks=sum(i["leaked"] for i in ids))
        except PrivacyError as e:
            #pipeline blocked it and returned no image: safe, but reported
            entry.update(outcome="blocked", reason=e.code, identifiers=[], leaks=0)
        except Exception as e:
            #unexpeccted crash. record only error type, never details 
            entry.update(outcome="error", reason=type(e).__name__, identifiers=[], leaks=0)
        per_image.append(entry)

        #CONTROL: same judge on original, redaction skipped 
        try:
            ctrl_ids = judge(original, phi, run_ocr)
            #control must be caught by OCR half of the judge (readabletext found)
            #being "not black" alone would not prove the OCR check can actually detect a leak. 
            controls.append({
                "image": name,
                "identifiers": ctrl_ids,
                "flagged_by_ocr": any(i["readable_text_left"] for i in ctrl_ids),
            })
        except Exception as e:
            controls.append({
                "image": name,
                "identifiers": [],
                "flagged_by_ocr": False,
                "error": type(e).__name__,
            })
    # TOTALS 
    released = [e for e in per_image if e["outcome"] == "released"]
    blocked = [e for e in per_image if e["outcome"] == "blocked"]
    errors = [e for e in per_image if e["outcome"] == "error"]
    summary = {
        "images": len(names),
        "released": len(released),
        "blocked": len(blocked),
        "errors": len(errors),
        "identifiers_in_released_images": sum(len(e["identifiers"]) for e in released),
        "identifiers_leaked": sum(e["leaks"] for e in released),
       "identifiers_in_blocked_images": sum(e["known_identifiers"] for e in blocked),
        "control_images": len(controls),
        "control_images_not_flagged": [c["image"] for c in controls if not c["flagged_by_ocr"]],
    }

    #exit code
    if summary["control_images_not_flagged"]:
        #checker broken: a control that did not leak 
        exit_code = 2
    elif summary["identifiers_leaked"] or errors:
        #real leak or unexpected failure
        exit_code = 1
    else:
        exit_code = 0

    write_reports(summary, per_image, controls, exit_code)
    print_summary(summary, per_image, exit_code)
    return exit_code

def write_reports(summary, per_image, controls, exit_code):
    OUT_DIR.mkdir(exist_ok=True)
    with open(OUT_DIR / "report.json", "w") as f:
        json.dump({
            "summary": summary,
            "images": per_image,
            "controls": controls,
            "exit_code": exit_code,
        }, f, indent = 2)

    verdict = {0: "PASS", 1: "FAIL (leak or error)", 2: "CHECKER BROKEN"}[exit_code]
    lines = ["# PHI-leak check report", "",
             f"Result: **{verdict}** (exit code {exit_code})", "",
             f"- Images checked: {summary['images']} "
             f"(released {summary['released']}, blocked {summary['blocked']}, "
             f"errors {summary['errors']})",
             f"- Known fake identifiers in released images: {summary['identifiers_in_released_images']}",
             f"- Identifiers leaked (uncovered or still readable): {summary['identifiers_leaked']}",
             f"- Identifiers in blocked images (no image released): {summary['identifiers_in_blocked_images']}",
             f"- Control images (redaction skipped) not flagged as leaks: "
             f"{len(summary['control_images_not_flagged'])} of {summary['control_images']}", "",
             "## Leaks, by image and line", ""]

    found = False
    for e in per_image:
        for i in e["identifiers"]:
            if i["leaked"]:
                found = True
                why = "not covered" if not i["covered"] else "readable text left"
                lines.append(f"- `{e['image']}` ({e['variant']}): \"{i['identifier']}\" - {why} "
                             f"(black {i['black_fraction']:.0%}, read: {i['readable_text_left']})")
    lines.append("" if found else "- none")
    lines += ["", "## Blocked images (safe, but no usable output)", ""]
    blocked = [e for e in per_image if e["outcome"] == "blocked"]
    lines += [f"- `{e['image']}` ({e['variant']}): {e['reason']}" for e in blocked] or ["- none"]
    errs = [e for e in per_image if e["outcome"] == "error"]
    if errs:
        lines += ["", "## Unexpected errors", ""]
        lines += [f"- `{e['image']}`: {e['reason']}" for e in errs]
    #Name the known earlier miss and say what happens to it in THIS run
    miss = KNOWN_EARLIER_MISS
    now = next((e for e in per_image if e["image"] == miss["image"]), None)
    status = now["outcome"] if now else "not run"          # released / blocked / error
    reason = f" ({now['reason']})" if now and now.get("reason") else ""
    lines += ["", "## Known miss from the earlier #49/#54 results", "",
              f"- `{miss['image']}`: \"{miss['line']}\" was not found by the earlier "
              f"prototype (63 of 64). In this run the image's outcome is: {status}{reason}."]
    lines += ["", "## What was tested", "",
              "- Printed identifying text in image content, on synthetic EKG pages with fake "
              "identifiers (clean, blurry, rotated, low-contrast and similar variants), through "
              "the real pipeline (ocr/pipeline.py) with the pinned OCR models.",
              "- Control: the same checks on unredacted originals must report leaks.", "",
              "## What was NOT tested", "",
              "- Real patient photos or real EKG pages.",
              "- Handwriting.",
              "- Hidden metadata (EXIF and similar) and CSV or other outputs.",
              "- Identifiers the OCR cannot see at all; the answer key is only as good as "
              "the synthetic generator.", ""]
    (OUT_DIR / "report.md").write_text("\n".join(lines))

def print_summary(summary, per_image, exit_code):
    print("\n" + "=" * 60)
    print(f"Images: {summary['images']}  released: {summary['released']}  "
          f"blocked: {summary['blocked']}  errors: {summary['errors']}")
    print(f"Identifiers leaked: {summary['identifiers_leaked']} "
          f"of {summary['identifiers_in_released_images']} in released images")
    print(f"Control images not flagged: {len(summary['control_images_not_flagged'])} "
          f"of {summary['control_images']}")
    for e in per_image:
        if e["leaks"]:
            print(f"  LEAK:    {e['image']} ({e['leaks']} identifier(s))")
        elif e["outcome"] != "released":
            print(f"  {e['outcome'].upper():8} {e['image']} -> {e['reason']}")
    print({0: "PASS", 1: "FAIL (leak or unexpected error)",
           2: "CHECKER BROKEN (a control did not leak, or models missing)"}[exit_code])
    print("Reports written to ocr/leakcheck/report.md and report.json")


if __name__ == "__main__":
    sys.exit(main())

            

            