"""Run only while the local digitizer is deliberately stopped by the operator."""

import json
from pathlib import Path
import urllib.error
import urllib.request

root = Path(__file__).resolve().parents[1]
http = urllib.request.build_opener(urllib.request.ProxyHandler({}))
image = (root / "public/synthetic-ecgs/standard-12-lead.png").read_bytes()
request = urllib.request.Request("http://127.0.0.1:3107/api/ecg/digitize", image,
                                 {"Content-Type": "image/png"})
try:
    response = http.open(request, timeout=10)
except urllib.error.HTTPError as error:
    response = error
with response:
    body = json.load(response)
assert response.code == 503, "A missing digitizer must report unavailable"
assert "error" in body and "leads" not in body and "image" not in body
for url in ("http://127.0.0.1:8001/health", "http://127.0.0.1:8002/ready"):
    with http.open(url, timeout=5) as reply:
        assert reply.status == 200
summary = {"passed": True, "digitizer_http": response.code,
           "no_waveforms_returned": True, "privacy_services_healthy": True}
directory = root / ".local-run/full-flow"
directory.mkdir(parents=True, exist_ok=True)
(directory / "digitizer-outage.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
print(json.dumps(summary))
