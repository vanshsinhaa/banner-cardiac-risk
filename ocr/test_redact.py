"""
task #54 

quick checks of the fail-safe rules in redact.py, using tiny made-up images
(no OCR needed, so it runs in a second).

Run: python test_redact.py
"""

import sys
import numpy as np
from PIL import Image
from redact import outside_unchanged, redact_image

failures = 0

def check(name, condition):
    #print PASS/FAIL for one check and remember failures.
    global failures
    print(("PASS " if condition else "FAIL ") + name)
    if not condition:
        failures += 1

page = np.full((200, 400, 3), 255, dtype=np.uint8)
page[150:160, 20:380] = 120
img = Image.fromarray(page)

#1. Normal case: one identifying region is covered, everything else is untouched
regions = [{"text": "MRN: 1234567", "box": [30, 20, 150, 50], "confidence": 0.9, "identifying": True}, 
           {"text": "Rate: 72 bpm", "box": [30, 70, 150, 100], "confidence": 0.9, "identifying": False}]
out, info = redact_image(img, regions)
check("redacted: status is 'redacted'", info["status"] == "redacted")
check("redacted: same size as the original", out.size == img.size)
check("redacted: covered area is solid black", (np.array(out)[25:45, 40:140] == 0).all())
check("redacted: pixels outside hte boxes unchanged (waveform bar included)", 
        outside_unchanged(img, out, info["boxes"]))
check("redacted: non-identifying text region is NOT covered", (np.array(out)[75:95, 40:150] == 255).all())

#2 nothing detected: image comes back unchanged, with a flag
out, info = redact_image(img, [])
check("nothing detected: status flag is set", info["status"] == "nothing_detected")
check("nothing detected: image is unchanged", (np.array(out) == page).all())

#3. Only non-identifying regions counts as nothing detected too 
out, info = redact_image(img, [regions[1]])
check("only non-identifying text: treated as nothing detected", info["status"] == "nothing_detected")

#4. Broken input: must FAIL SAFE (no image returned to pass on)
out, info = redact_image(img, [{"text": "x", "box": None, "confidence": 1, "identifying": True}])
check("bad region: status is 'failed'", info["status"] == "failed")
check("bad region: no image is returned", out is None)

#5. a box hanging off the edge of the image is clamped, not crash
out, info = redact_image(img, [{"text": "x", "box": [350, 150, 450, 250], "confidence": 1, "identifying": True}])
check("box past the edge: still redacts and keeps the size", info["status"] == "redacted" and out.size == img.size)

print(f"\n{'ALL CHECKS PASSED' if failures == 0 else str(failures) + ' CHECK(S) FAILED'}")
sys.exit(1 if failures else 0)
