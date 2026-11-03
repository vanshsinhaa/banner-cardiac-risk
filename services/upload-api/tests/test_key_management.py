"""Ephemeral random keys only. Nothing is printed, persisted, or sent externally."""

import base64
import json
import secrets
from dataclasses import replace
from datetime import datetime, timedelta, timezone

import pytest
from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.key_management import (KeyConfigurationError, KeyRing, KeyStatus,
    KeyUnavailableError, KeyVersion, SecretStoreKeyProvider, load_environment_provider, load_secret_store_provider)

NOW = datetime(2026, 10, 26, tzinfo=timezone.utc)


def version(key_id="demo-v1", status=KeyStatus.ACTIVE):
    return KeyVersion(key_id, secrets.token_bytes(32), status, NOW - timedelta(days=1), NOW + timedelta(days=89))


def snapshot():
    key = version()
    # Provider refresh tests use the real clock; keep their fixtures usable
    # regardless of when CI runs. Pure lifecycle boundary tests freeze NOW.
    current = datetime.now(timezone.utc)
    key = replace(key, created_at=current - timedelta(minutes=1),
                  encrypt_until=current + timedelta(days=89))
    return {"active_key_id": key.key_id, "versions": [{
        "key_id": key.key_id, "key_b64": base64.b64encode(key.material).decode(),
        "status": key.status.value, "created_at": key.created_at.isoformat(),
        "encrypt_until": key.encrypt_until.isoformat(),
    }]}


def test_active_key_round_trip_and_material_not_in_repr():
    key = version()
    provider = KeyRing(key.key_id, [key], clock=lambda: NOW)
    nonce = secrets.token_bytes(12)
    aad = b"banner-ekg:package:v1:demo-v1"
    encrypted = AESGCM(provider.encryption_key().material).encrypt(nonce, b"synthetic-data", aad)
    assert AESGCM(provider.decryption_key(key.key_id).material).decrypt(nonce, encrypted, aad) == b"synthetic-data"
    assert "material=" not in repr(key)
    assert base64.b64encode(key.material).decode() not in repr(provider)


def test_rotation_encrypts_with_new_key_and_decrypts_old_data():
    old = version()
    nonce = secrets.token_bytes(12)
    ciphertext = AESGCM(old.material).encrypt(nonce, b"synthetic-before-rotation", b"v1")
    new = version("demo-v2")
    ring = KeyRing(new.key_id, [replace(old, status=KeyStatus.DECRYPT_ONLY), new], clock=lambda: NOW)
    assert ring.encryption_key().key_id == "demo-v2"
    assert AESGCM(ring.decryption_key(old.key_id).material).decrypt(nonce, ciphertext, b"v1") == b"synthetic-before-rotation"
    with pytest.raises(InvalidTag):
        AESGCM(new.material).decrypt(nonce, ciphertext, b"v1")


@pytest.mark.parametrize("delta", [timedelta(days=-2), timedelta(days=89), timedelta(days=90)])
def test_future_or_expired_key_cannot_encrypt(delta):
    key = version()
    ring = KeyRing(key.key_id, [key], clock=lambda: NOW + delta)
    with pytest.raises(KeyUnavailableError):
        ring.encryption_key()


def test_expired_write_key_can_still_decrypt_history():
    key = version()
    ring = KeyRing(key.key_id, [key], clock=lambda: NOW + timedelta(days=100))
    assert ring.decryption_key(key.key_id) is key


@pytest.mark.parametrize("key_id", ["missing", "revoked-v1", "../secret", "", None, []])
def test_missing_revoked_or_invalid_key_never_falls_back(key_id):
    active = version()
    revoked = version("revoked-v1", KeyStatus.REVOKED)
    ring = KeyRing(active.key_id, [active, revoked], clock=lambda: NOW)
    with pytest.raises(KeyUnavailableError):
        ring.decryption_key(key_id)


@pytest.mark.parametrize("length", [0, 16, 24, 31, 33])
def test_non_256_bit_key_rejected(length):
    with pytest.raises(KeyConfigurationError):
        replace(version(), material=secrets.token_bytes(length))


def test_naive_dates_and_reversed_dates_rejected():
    key = version()
    with pytest.raises(KeyConfigurationError):
        replace(key, created_at=NOW.replace(tzinfo=None))
    with pytest.raises(KeyConfigurationError):
        replace(key, encrypt_until=key.created_at)


def test_duplicate_ids_and_reused_key_material_rejected():
    key = version()
    with pytest.raises(KeyConfigurationError):
        KeyRing(key.key_id, [key, replace(key, material=secrets.token_bytes(32))])
    with pytest.raises(KeyConfigurationError):
        KeyRing(key.key_id, [key, replace(key, key_id="demo-v2", status=KeyStatus.DECRYPT_ONLY)])


def test_ring_requires_one_matching_active_key():
    key = version()
    for keys in [[], [replace(key, status=KeyStatus.DECRYPT_ONLY)], [key, version("demo-v2")]]:
        with pytest.raises(KeyConfigurationError):
            KeyRing(key.key_id, keys)
    with pytest.raises(KeyConfigurationError):
        KeyRing("different", [key])


def test_secret_store_is_injected_and_failure_is_safe():
    payload = snapshot()
    ring = load_secret_store_provider(lambda: payload)
    assert ring.decryption_key("demo-v1").key_id == "demo-v1"

    def broken_store():
        raise RuntimeError("SYNTHETIC-SECRET-MUST-NOT-LEAK")

    with pytest.raises(KeyUnavailableError) as caught:
        load_secret_store_provider(broken_store)
    assert "SYNTHETIC-SECRET" not in str(caught.value)
    assert caught.value.__suppress_context__


@pytest.mark.parametrize("mode", [None, "", "production", "staging", "Production"])
def test_environment_adapter_requires_explicit_local_mode(mode):
    env = {"EKG_DEV_KEYRING_JSON": json.dumps(snapshot())}
    if mode is not None:
        env["EKG_APP_ENV"] = mode
    with pytest.raises(KeyConfigurationError):
        load_environment_provider(env)


def test_environment_adapter_reads_injected_runtime_secret():
    ring = load_environment_provider({"EKG_APP_ENV": "test", "EKG_DEV_KEYRING_JSON": json.dumps(snapshot())})
    assert len(ring.decryption_key("demo-v1").material) == 32


@pytest.mark.parametrize("invalid", [None, "", "not-json", "{", "[]", "{}", "null", "x" * 32_769],
                         ids=["missing", "empty", "text", "partial", "list", "object", "null", "oversized"])
def test_missing_or_malformed_environment_secret_fails_safely(invalid):
    env = {"EKG_APP_ENV": "test"}
    if invalid is not None:
        env["EKG_DEV_KEYRING_JSON"] = invalid
    with pytest.raises(KeyConfigurationError):
        load_environment_provider(env)


@pytest.mark.parametrize("field,value", [("key_b64", "SYNTHETIC-SECRET"), ("key_id", "SYNTHETIC-SECRET"),
    ("status", "SYNTHETIC-SECRET"), ("created_at", "SYNTHETIC-SECRET"), ("encrypt_until", None)])
def test_bad_secret_fields_do_not_appear_in_errors(field, value):
    payload = snapshot()
    payload["versions"][0][field] = value
    with pytest.raises(KeyConfigurationError) as caught:
        load_secret_store_provider(lambda: payload)
    assert "SYNTHETIC-SECRET" not in str(caught.value)
    assert caught.value.__suppress_context__


def test_write_window_exact_start_is_allowed_and_exact_end_is_denied():
    key = version()
    assert KeyRing(key.key_id, [key], clock=lambda: key.created_at).encryption_key() is key
    with pytest.raises(KeyUnavailableError):
        KeyRing(key.key_id, [key], clock=lambda: key.encrypt_until).encryption_key()


def test_future_historical_key_is_denied_and_naive_clock_fails_closed():
    key = version()
    with pytest.raises(KeyUnavailableError):
        KeyRing(key.key_id, [key], clock=lambda: NOW - timedelta(days=3)).decryption_key(key.key_id)
    with pytest.raises(KeyUnavailableError):
        KeyRing(key.key_id, [key], clock=lambda: NOW.replace(tzinfo=None)).encryption_key()


def test_write_window_longer_than_project_policy_is_rejected():
    key = version()
    with pytest.raises(KeyConfigurationError):
        replace(key, encrypt_until=key.created_at + timedelta(days=91))


def test_tampering_with_ciphertext_nonce_or_associated_data_is_detected():
    key = version()
    aes = AESGCM(key.material)
    nonce = secrets.token_bytes(12)
    aad = b"banner-ekg:package:v1:demo-v1"
    ciphertext = aes.encrypt(nonce, b"synthetic-only", aad)
    for changed_nonce, changed_ciphertext, changed_aad in [
        (nonce, bytes([ciphertext[0] ^ 1]) + ciphertext[1:], aad),
        (bytes([nonce[0] ^ 1]) + nonce[1:], ciphertext, aad),
        (nonce, ciphertext, b"banner-ekg:package:v1:demo-v2"),
    ]:
        with pytest.raises(InvalidTag):
            aes.decrypt(changed_nonce, changed_ciphertext, changed_aad)


def test_secret_store_refresh_installs_rotation_atomically():
    now = [0]
    payload = snapshot()
    calls = []
    def fetch():
        calls.append(True)
        return payload
    provider = SecretStoreKeyProvider(fetch, refresh_seconds=10, monotonic=lambda: now[0])
    assert provider.encryption_key().key_id == "demo-v1"
    old = payload["versions"][0].copy()
    old["status"] = "decrypt-only"
    new = snapshot()["versions"][0]
    new["key_id"] = "demo-v2"
    payload = {"active_key_id": "demo-v2", "versions": [old, new]}
    assert provider.encryption_key().key_id == "demo-v1"
    now[0] = 10
    assert provider.encryption_key().key_id == "demo-v2"
    assert provider.decryption_key("demo-v1").material == base64.b64decode(old["key_b64"])
    assert len(calls) == 2


def test_expired_secret_cache_does_not_hide_store_outage_and_can_recover():
    now = [0]
    payload = snapshot()
    def fetch():
        if now[0] == 10:
            raise OSError("SYNTHETIC-SECRET")
        return payload
    provider = SecretStoreKeyProvider(fetch, refresh_seconds=10, monotonic=lambda: now[0])
    assert provider.encryption_key()
    now[0] = 10
    with pytest.raises(KeyUnavailableError):
        provider.encryption_key()
    with pytest.raises(KeyUnavailableError):
        provider.decryption_key("demo-v1")
    now[0] = 11
    assert provider.encryption_key()


def test_revocation_takes_effect_on_next_refresh():
    now = [0]
    payload = snapshot()
    provider = SecretStoreKeyProvider(lambda: payload, refresh_seconds=1, monotonic=lambda: now[0])
    old = payload["versions"][0].copy()
    old["status"] = "revoked"
    new = snapshot()["versions"][0]
    new["key_id"] = "demo-v2"
    payload = {"active_key_id": "demo-v2", "versions": [old, new]}
    now[0] = 1
    with pytest.raises(KeyUnavailableError):
        provider.decryption_key("demo-v1")


@pytest.mark.parametrize("interval", [0, -1, 301, True, 1.5])
def test_refresh_interval_cannot_exceed_policy(interval):
    with pytest.raises(KeyConfigurationError):
        SecretStoreKeyProvider(lambda: snapshot(), refresh_seconds=interval)
