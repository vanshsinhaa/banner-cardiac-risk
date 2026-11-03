"""Independent real-stage smoke tests using the generated synthetic ECG only.

Direct numerical requests intentionally test the numerical services in isolation;
they are not evidence that privacy accepted this fixture or a model-ready record.
"""

from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
HTTP = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def request(url, data, multipart=False):
    if multipart:
        boundary = "synthetic-numerical-test"
        data = (f'--{boundary}\r\nContent-Disposition: form-data; name="image"; filename="synthetic.png"\r\n'
                'Content-Type: image/png\r\n\r\n').encode() + data + f"\r\n--{boundary}--\r\n".encode()
        content_type = f"multipart/form-data; boundary={boundary}"
    else:
        content_type = "image/png"
    started = time.monotonic()
    try:
        response = HTTP.open(urllib.request.Request(url, data, {"Content-Type": content_type}), timeout=150)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        value = json.load(response)
    return response.code, value, round(time.monotonic() - started, 2)


def main():
    data = (ROOT / "public/synthetic-ecgs/standard-12-lead.png").read_bytes()
    directory = ROOT / ".local-run/full-flow"
    directory.mkdir(parents=True, exist_ok=True)
    with ThreadPoolExecutor(2) as pool:
        readability = pool.submit(request, "http://127.0.0.1:3107/api/analyze", data)
        numerical = pool.submit(request, "http://127.0.0.1:8000/digitize", data, True)
        status, assessment, seconds = readability.result()
        result = {"readability": {"http": status, "seconds": seconds,
                  "status": assessment.get("status"), "detected_leads": assessment.get("detected_leads"),
                  "reasons": assessment.get("reasons"), "error": assessment.get("error")}}
        status, record, seconds = numerical.result()
        result["digitizer"] = {"http": status, "seconds": seconds, "units": record.get("units"),
            "samplingRateHz": record.get("samplingRateHz"), "requiresReview": record.get("requiresReview"),
            "assignment_status": record.get("leadVerification", {}).get("status"),
            "sample_counts": {key: len(samples) for key, samples in record.get("leads", {}).items()},
            "detail": record.get("detail")}
        if status == 200:
            (directory / "isolated-digitizer-result.json").write_text(json.dumps(record), encoding="utf-8")
    result["passed"] = result["readability"]["http"] == 200 and result["digitizer"]["http"] == 200
    (directory / "isolated-stage-summary.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2))
    raise SystemExit(0 if result["passed"] else 1)


if __name__ == "__main__":
    main()
