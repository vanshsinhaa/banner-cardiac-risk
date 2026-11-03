"""Reproducible instructor demo: synthetic image, ephemeral keys, no files."""

import io
import json
import secrets
import sys
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from pathlib import Path

# Support `python scripts/sprint3_demo.py` from the service directory.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from fastapi.testclient import TestClient
from PIL import Image, ImageOps, PngImagePlugin

from app.key_management import KeyRing, KeyStatus, KeyUnavailableError, KeyVersion
from app.main import app


def main():
    marker = "SYNTHETIC-DEMO-NOT-A-PATIENT"
    image = Image.new("RGB", (80, 40), "white")
    image.putpixel((5, 10), (0, 0, 0))
    exif = Image.Exif()
    exif[0x010E] = marker
    exif[0x0112] = 6
    text = PngImagePlugin.PngInfo()
    text.add_itxt("XML:com.adobe.xmp", marker)
    source = io.BytesIO()
    image.save(source, format="PNG", exif=exif, pnginfo=text)
    with TestClient(app) as client:
        response = client.post("/uploads/sanitize", files={"file": ("synthetic.png", source.getvalue())})
    assert response.status_code == 200
    assert marker.encode() not in response.content
    assert response.headers["cache-control"] == "no-store"
    with Image.open(io.BytesIO(response.content)) as clean:
        assert not clean.info and not clean.getexif()
        assert clean.tobytes() == ImageOps.exif_transpose(Image.open(io.BytesIO(source.getvalue()))).tobytes()

    now = datetime.now(timezone.utc)
    old = KeyVersion("demo-v1", secrets.token_bytes(32), KeyStatus.ACTIVE, now, now + timedelta(days=90))
    ring = KeyRing(old.key_id, [old])
    nonce = secrets.token_bytes(12)
    aad = b"banner-ekg:demo:v1:demo-v1"
    ciphertext = AESGCM(ring.encryption_key().material).encrypt(nonce, b"synthetic-package", aad)
    new = KeyVersion("demo-v2", secrets.token_bytes(32), KeyStatus.ACTIVE, now, now + timedelta(days=90))
    rotated = KeyRing(new.key_id, [replace(old, status=KeyStatus.DECRYPT_ONLY), new])
    assert rotated.encryption_key().key_id == "demo-v2"
    assert AESGCM(rotated.decryption_key(old.key_id).material).decrypt(nonce, ciphertext, aad) == b"synthetic-package"
    revoked = KeyRing(new.key_id, [replace(old, status=KeyStatus.REVOKED), new])
    try:
        revoked.decryption_key(old.key_id)
        raise AssertionError("Revocation was not enforced")
    except KeyUnavailableError:
        pass
    try:
        AESGCM(old.material).decrypt(nonce, bytes([ciphertext[0] ^ 1]) + ciphertext[1:], aad)
        raise AssertionError("Tampering was not detected")
    except InvalidTag:
        pass
    print(json.dumps({
        "task_48": {"embedded_metadata_removed": True, "orientation_and_pixels_preserved": True,
                    "response_not_cacheable": True, "printed_identifiers_redacted": False},
        "task_52": {"aes_256_gcm_handoff": "passed", "rotation_preserves_old_decryption": True,
                    "revocation_denied": True, "tampering_rejected": True},
        "keys_written_or_printed": False, "real_patient_data_used": False,
    }, indent=2))


if __name__ == "__main__":
    main()
