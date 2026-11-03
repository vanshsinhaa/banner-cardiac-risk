"""Real HTTP smoke check using only the repository's synthetic OCR corpus.

This is focused service acceptance, not the complete #60/#65 verification suite.
No fixture truth is sent to detection. Exit nonzero for a leak, broken service or
failure of the designated clear input to produce output.
"""

import argparse
import base64
import io
import json
import math
from pathlib import Path
import struct
import time
import urllib.error
import urllib.request

import numpy as np
from PIL import Image, PngImagePlugin

ROOT = Path(__file__).resolve().parents[1]
MARKER = "SYNTHETIC-HTTP-METADATA-CONTROL"
HTTP = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def upload(url, data):
    boundary = "synthetic-deid-smoke-boundary"
    body = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="synthetic.png"\r\n'
            'Content-Type: image/png\r\n\r\n').encode() + data + f"\r\n--{boundary}--\r\n".encode()
    request = urllib.request.Request(url, body, {"Content-Type": f"multipart/form-data; boundary={boundary}"})
    try:
        with HTTP.open(request, timeout=65) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as response:
        return response.code, response.read()


def check_output(data, original, truth):
    offset, chunks = 8, []
    assert data[:8] == b"\x89PNG\r\n\x1a\n"
    while offset < len(data):
        size = struct.unpack(">I", data[offset:offset + 4])[0]
        chunks.append(data[offset + 4:offset + 8])
        offset += size + 12
    assert offset == len(data) and set(chunks) == {b"IHDR", b"IDAT", b"IEND"}
    assert MARKER.encode() not in data
    with Image.open(io.BytesIO(data)) as output:
        assert not output.info and output.size == original.size
        pixels = np.asarray(output.convert("RGB"))
    for item in truth["phi"]:
        x0, y0, x1, y1 = item["box"]
        region = pixels[max(0, math.floor(y0)):math.ceil(y1), max(0, math.floor(x0)):math.ceil(x1)]
        assert region.size and (region == 0).all(), "Known synthetic identifier not fully covered"
    # These corpus pages deliberately place their synthetic identifiers in the header.
    waveform_start = int(original.height * 0.6)
    assert np.array_equal(pixels[waveform_start:], np.asarray(original.convert("RGB"))[waveform_start:])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--privacy-url", default="http://127.0.0.1:8002/deidentify")
    parser.add_argument("--sanitizer-url", default="http://127.0.0.1:8001/uploads/sanitize")
    parser.add_argument("--all", action="store_true")
    parser.add_argument("--report", type=Path, help="Optional UTF-8 JSON report path.")
    args = parser.parse_args()
    truth = json.loads((ROOT / "ocr/samples/ground_truth.json").read_text())
    names = sorted(truth) if args.all else ["clean_1.jpg", "very_blurry_1.jpg"]
    report, failed = [], False
    for name in names:
        started = time.monotonic()
        try:
            with Image.open(ROOT / "ocr/samples" / name) as original:
                original.load()
                tagged = io.BytesIO()
                info = PngImagePlugin.PngInfo()
                info.add_text("PatientName", MARKER)
                original.save(tagged, "PNG", pnginfo=info)
                status, sanitized = upload(args.sanitizer_url, tagged.getvalue())
                assert status == 200, "Metadata service did not accept fixture"
                status, raw = upload(args.privacy_url, sanitized)
                response = json.loads(raw)
                if status == 422 and "image" not in response:
                    result = {"case": name, "outcome": "blocked", "code": response.get("code", "unconfirmed")}
                    if name.startswith("clean_"):
                        failed = True
                else:
                    assert status == 200 and response["status"] == "redacted"
                    assert response["regions_redacted"] > 0 and not response.get("mock")
                    assert response["image"].startswith("data:image/png;base64,")
                    data = base64.b64decode(response["image"].split(",", 1)[1], validate=True)
                    check_output(data, original, truth[name])
                    result = {"case": name, "outcome": "verified_output", "identifiers_checked": len(truth[name]["phi"])}
        except Exception:
            failed = True
            result = {"case": name, "outcome": "error_or_leak"}
        result["seconds"] = round(time.monotonic() - started, 2)
        report.append(result)
    summary = json.dumps({"passed": not failed, "cases": report}, indent=2)
    if args.report:
        args.report.write_text(summary + "\n", encoding="utf-8")
    print(summary)
    raise SystemExit(1 if failed else 0)


if __name__ == "__main__":
    main()
