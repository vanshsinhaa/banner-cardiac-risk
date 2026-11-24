"""
task (#60), updated for header/footer CROPPING (#77)

One repeatable command that answers: "after the team's de-identification pipeline runs,
can any known fake identifier still be read?"

It tests the REAL pipeline, ocr/pipeline.py -> deidentify_image(), using the same pinned OCR
models the service uses (ocr/runtime.py).

For every synthetic image in samples/ there are three possible outcomes:
    Released:   the pipeline returned a cropped image. We JUDGE it against samples/ground_truth.json
                (the answer key of where each fake identifier really is). For each known identifier:
                    (a) REMOVED: it lies fully inside the rows the pipeline cut off, or
                    (b) NOT READABLE: a fresh OCR pass finds no readable text where it was.
                An identifier that is neither (a) nor (b) LEAKED.
    Blocked:    the pipeline refused (raised PrivacyError) and returned NO image. Nothing can leak
                from that, so it is not a leak. It is reported with its reason code, because
                blocking everything is safe but not useful.
    Error:      something unexpected crashed. Counts as a failure.

Control set: the same judge runs on the original images with nothing removed. Every control image
must be flagged as a leak by the OCR check. If one is not, the checker itself can't be trusted.

Exit codes: 0 = clean
            1 = leak or unexpected error
            2 = checker broken (a control did not leak, the OCR models could not load, or
                nothing was released, so there was nothing to judge)

Run (from the REPO ROOT, with the venv active):
    python -m ocr.phi_leak_check

Output: ocr/leakcheck/report.json and ocr/leakcheck/report.md
"""

import json
import sys
from collections import Counter
from pathlib import Path

from PIL import Image

# relative imports: ocr/ is a package, so we import from the same folder
from .ocr_compare import area, overlap
from .pipeline import PrivacyError, deidentify_image
from .redact import readable
from .runtime import load_paddle

# find folders relative to this file, so the command works from anywhere
HERE = Path(__file__).resolve().parent
SAMPLES_DIR = HERE / "samples_cropping"
OUT_DIR = HERE / "leakcheck"

MIN_IMAGES = 16     # acceptance criteria: 16 synthetic images
# The one identifier the earlier #49/#54 prototype missed (63 of 64 found).
# Kept here so the report always names it instead of hiding it.
KNOWN_EARLIER_MISS = None


def readable_words_in(words, box):
    # words from the OCR pass that are readable and sit mostly inside `box`
    # "readable" is redact.py's own rule: confident, with 2+ letters or digits
    return [
        w["text"] for w in words
        if readable(w) and area(w["box"]) > 0
        and overlap(w["box"], box) / area(w["box"]) > 0.3
    ]


def judge(image, truth_items, run_ocr, top_cut, bottom_cut, original_height):
    """
    Judge ONE image (a released crop, or an untouched control) against the answer key.
    top_cut / bottom_cut = rows the pipeline removed from the top / bottom (0 and 0 for a control).
    Boxes in the answer key are in ORIGINAL image coordinates.
    Returns one result per known identifier.
    """
    words = run_ocr(image)
    kept_end = original_height - bottom_cut        # first original row that was cut off the bottom
    results = []
    for item in truth_items:
        x0, y0, x1, y1 = item["box"]
        # fully removed = entirely inside the rows cut off the top, or the rows cut off the bottom
        removed = y1 <= top_cut or y0 >= kept_end
        # a cut that passes through the identifier leaves a fragment; the OCR check decides below
        partly = (not removed) and (y0 < top_cut or y1 > kept_end)
        # the cropped image starts at original row top_cut, so shift the box up by top_cut
        shifted = [x0, y0 - top_cut, x1, y1 - top_cut]
        left = [] if removed else readable_words_in(words, shifted)
        results.append({
            "identifier": item["text"],
            "fully_removed": removed,
            "partly_removed": partly,
            "readable_text_left": left,
            "leaked": bool(left),
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
        phi = [p for p in truth[name]["phi"] if p["box"][3] < original.height / 2]   # header identifiers only
        entry = {"image": name, "variant": truth[name]["variant"], "known_identifiers": len(phi)}

        # MAIN RUN: real pipeline, then an independent judge
        try:
            released = deidentify_image(original, run_ocr)
            ids = judge(released.image, phi, run_ocr, released.top_cut, released.bottom_cut, original.height)
            entry.update(outcome="released", reason=None, top_cut=released.top_cut,
                         bottom_cut=released.bottom_cut, identifiers=ids,
                         leaks=sum(i["leaked"] for i in ids))
        except PrivacyError as e:
            # pipeline blocked it and returned no image: safe, but reported
            entry.update(outcome="blocked", reason=e.code, identifiers=[], leaks=0)
        except Exception as e:
            # unexpected crash. record only the error type, never details
            entry.update(outcome="error", reason=type(e).__name__, identifiers=[], leaks=0)
        per_image.append(entry)

        # CONTROL: the same judge on the original, nothing removed
        try:
            ctrl_ids = judge(original, phi, run_ocr, 0, 0, original.height)
            # the control must be caught by the OCR half of the judge (readable text found);
            # "not removed" alone would not prove the OCR check can actually detect a leak
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
    released_names = {e["image"] for e in released}
    summary = {
        "images": len(names),
        "released": len(released),
        "blocked": len(blocked),
        "blocked_by_reason": dict(Counter(e["reason"] for e in blocked)),
        "errors": len(errors),
        "identifiers_in_released_images": sum(len(e["identifiers"]) for e in released),
        "identifiers_fully_removed": sum(i["fully_removed"] for e in released for i in e["identifiers"]),
        "identifiers_leaked": sum(e["leaks"] for e in released),
        "identifiers_in_blocked_images": sum(e["known_identifiers"] for e in blocked),
        "control_images": len(controls),
        # a control matters only for images whose released output we actually judged
        "control_images_not_flagged": [c["image"] for c in controls
                                       if not c["flagged_by_ocr"] and c["image"] in released_names],
        # originals OCR can't read even before processing: nothing to judge, and none were released
        "controls_unreadable_not_released": [c["image"] for c in controls
                                             if not c["flagged_by_ocr"] and c["image"] not in released_names],    }

    # exit code
    if summary["control_images_not_flagged"] or not released:
        # checker broken: a control that did not leak, or nothing was released to judge
        exit_code = 2
    elif summary["identifiers_leaked"] or errors:
        # a real leak or an unexpected failure
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
        }, f, indent=2)

    verdict = {0: "PASS", 1: "FAIL (leak or error)",
               2: "CHECKER BROKEN (a control did not leak, models missing, or nothing released)"}[exit_code]
    lines = ["# PHI-leak check report", "",
             f"Result: **{verdict}** (exit code {exit_code})", "",
             f"- Images checked: {summary['images']} "
             f"(released {summary['released']}, blocked {summary['blocked']}, "
             f"errors {summary['errors']})",
             f"- Known fake identifiers in released images: {summary['identifiers_in_released_images']}",
             f"- Of those, fully inside the removed rows: {summary['identifiers_fully_removed']}",
             f"- Identifiers leaked (still readable in the released image): {summary['identifiers_leaked']}",
             f"- Identifiers in blocked images (no image released): {summary['identifiers_in_blocked_images']}",
             f"- Controls of released images not flagged as leaks: "
             f"{len(summary['control_images_not_flagged'])} of {summary['released']}",
             f"- Controls OCR cannot read even before processing (all blocked, none released): "
             f"{len(summary['controls_unreadable_not_released'])}", "",             
             f"{len(summary['control_images_not_flagged'])} of {summary['control_images']}", "",
             "## Leaks, by image and line", ""]

    found = False
    for e in per_image:
        for i in e["identifiers"]:
            if i["leaked"]:
                found = True
                why = "readable text left" + (" (the cut went through it)" if i["partly_removed"] else "")
                lines.append(f"- `{e['image']}` ({e['variant']}): \"{i['identifier']}\" - {why} "
                             f"(read: {i['readable_text_left']})")
    lines.append("" if found else "- none")
    if not summary["released"]:
        lines += ["", "Nothing was released, so there was nothing to judge."]
    lines += ["", "## Blocked images (safe, but no usable output)", ""]
    blocked = [e for e in per_image if e["outcome"] == "blocked"]
    lines += [f"- `{e['image']}` ({e['variant']}): {e['reason']}" for e in blocked] or ["- none"]
    if blocked:
        lines += ["", "Blocked by reason: " + ", ".join(f"{k} x{v}" for k, v in summary["blocked_by_reason"].items())]
    errs = [e for e in per_image if e["outcome"] == "error"]
    if errs:
        lines += ["", "## Unexpected errors", ""]
        lines += [f"- `{e['image']}`: {e['reason']}" for e in errs]
    # Name the known earlier miss (only applies to the original sample set)
    miss = KNOWN_EARLIER_MISS
    if miss:
        now = next((e for e in per_image if e["image"] == miss["image"]), None)
        status = now["outcome"] if now else "not run"          # released / blocked / error
        reason = f" ({now['reason']})" if now and now.get("reason") else ""
        lines += ["", "## Known miss from the earlier #49/#54 results", "",
                  f"- `{miss['image']}`: \"{miss['line']}\" was not found by the earlier "
                  f"prototype (63 of 64). In this run the image's outcome is: {status}{reason}."]
    lines += ["", "## What was tested", "",
              "- Printed identifying text in image content, on synthetic EKG pages with fake "
              "identifiers (clean, blurry, rotated, low-contrast and similar variants), through "
              "the real pipeline (ocr/pipeline.py) with the pinned OCR models. The pipeline crops "
              "the header (footer is out of scope for now) off the image.",
              "- Each known identifier must lie fully inside the removed rows, or have no readable "
              "text left in the released image.",
              "- Pages the crop cannot be applied to are blocked: no image is released. They are "
              "listed above with their reason code.",
              "- Control: the same checks on unredacted originals must report leaks.", "",
              "## What was NOT tested", "",
              "- Real patient photos or real EKG pages (this script has no answer key for them).",
              "- Handwriting.",
              "- Hidden metadata (EXIF and similar) and CSV or other outputs.",
              "- Footer cropping (the synthetic pages have no footer; it is covered by unit tests).",
              "- Identifiers the OCR cannot see at all; the answer key is only as good as "
              "the synthetic generator.", ""]
    (OUT_DIR / "report.md").write_text("\n".join(lines))


def print_summary(summary, per_image, exit_code):
    print("\n" + "=" * 60)
    print(f"Images: {summary['images']}  released: {summary['released']}  "
          f"blocked: {summary['blocked']}  errors: {summary['errors']}")
    print(f"Identifiers leaked: {summary['identifiers_leaked']} "
          f"of {summary['identifiers_in_released_images']} in released images "
          f"({summary['identifiers_fully_removed']} fully inside the removed rows)")
    print(f"Control images not flagged: {len(summary['control_images_not_flagged'])} "
          f"of {summary['control_images']}")
    for e in per_image:
        if e["leaks"]:
            print(f"  LEAK:    {e['image']} ({e['leaks']} identifier(s))")
        elif e["outcome"] != "released":
            print(f"  {e['outcome'].upper():8} {e['image']} -> {e['reason']}")
    print({0: "PASS", 1: "FAIL (leak or unexpected error)",
           2: "CHECKER BROKEN (a control did not leak, models missing, or nothing released)"}[exit_code])
    print("Reports written to ocr/leakcheck/report.md and report.json")


if __name__ == "__main__":
    sys.exit(main())