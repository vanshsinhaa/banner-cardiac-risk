"""Write a synthetic EKG-style PNG for manual upload tests.

Usage (from services/upload-api):
    python scripts/make_synthetic_image.py synthetic_ekg.png

The picture is drawn in code. It is not a real EKG and has no patient data.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from tests.synthetic import synthetic_ekg_like_image  # noqa: E402

out = Path(sys.argv[1] if len(sys.argv) > 1 else "synthetic_ekg.png")
fmt = "JPEG" if out.suffix.lower() in (".jpg", ".jpeg") else "PNG"
out.write_bytes(synthetic_ekg_like_image(fmt, 1200, 600))
print(f"Wrote {out} ({fmt}, 1200x600)")
