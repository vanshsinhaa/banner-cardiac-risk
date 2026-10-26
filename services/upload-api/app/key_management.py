"""Versioned key access for #52. No web/native SDK or encryption implementation.

Production code injects a secret-store snapshot. The environment adapter is
explicitly development/test only. No provider generates a missing key.
"""

import base64
import binascii
import json
import os
import re
import threading
import time
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Protocol

KEY_BYTES = 32  # AES-256; payload encryption belongs to task #50.
MAX_KEY_VERSIONS = 32
MAX_WRITE_WINDOW = timedelta(days=90)  # Project policy; not a regulatory claim.
_KEY_ID = re.compile(r"[a-z0-9][a-z0-9._-]{0,63}\Z")


class KeyConfigurationError(ValueError):
    """Safe to display: messages must never include input values."""


class KeyUnavailableError(RuntimeError):
    """Stop the operation; never fall back to plaintext or another key."""


class KeyStatus(str, Enum):
    ACTIVE = "active"
    DECRYPT_ONLY = "decrypt-only"
    REVOKED = "revoked"


def _aware(value: datetime) -> bool:
    return isinstance(value, datetime) and value.tzinfo is not None and value.utcoffset() is not None


@dataclass(frozen=True)
class KeyVersion:
    key_id: str
    material: bytes = field(repr=False)
    status: KeyStatus
    created_at: datetime
    encrypt_until: datetime

    def __post_init__(self):
        if not isinstance(self.key_id, str) or not _KEY_ID.fullmatch(self.key_id):
            raise KeyConfigurationError("Key ID must be an opaque identifier of 1-64 safe characters.")
        if not isinstance(self.material, bytes) or len(self.material) != KEY_BYTES:
            raise KeyConfigurationError("Key material must be exactly 32 random bytes.")
        if not isinstance(self.status, KeyStatus):
            raise KeyConfigurationError("Key status is invalid.")
        if not _aware(self.created_at) or not _aware(self.encrypt_until) or self.created_at >= self.encrypt_until:
            raise KeyConfigurationError("Key dates must be timezone-aware and ordered.")
        if self.encrypt_until - self.created_at > MAX_WRITE_WINDOW:
            raise KeyConfigurationError("Encryption write window cannot exceed 90 days.")


class KeyProvider(Protocol):
    def encryption_key(self) -> KeyVersion:
        """Current unexpired write key, or a safe failure."""
        ...

    def decryption_key(self, key_id: str) -> KeyVersion:
        """Exact historical version, unless missing, future-dated, or revoked."""
        ...


class KeyRing:
    """Validated immutable snapshot. Rotation installs an entirely new ring.

    Expiry prevents new encryption; it does not destroy historical decryption.
    A revoked key is denied for both operations. No key material in repr.
    """

    def __init__(self, active_key_id: str, versions: Sequence[KeyVersion], *,
                 clock: Callable[[], datetime] = lambda: datetime.now(timezone.utc)):
        if not 1 <= len(versions) <= MAX_KEY_VERSIONS or not all(isinstance(v, KeyVersion) for v in versions):
            raise KeyConfigurationError("Keyring must contain 1-32 validated key versions.")
        if len({v.key_id for v in versions}) != len(versions):
            raise KeyConfigurationError("Duplicate key versions are not allowed.")
        if len({v.material for v in versions}) != len(versions):
            raise KeyConfigurationError("Rotation must use new key material.")
        self._versions = {v.key_id: v for v in versions}
        active = [v for v in versions if v.status is KeyStatus.ACTIVE]
        if len(active) != 1 or active[0].key_id != active_key_id:
            raise KeyConfigurationError("Exactly one active version must match the active key ID.")
        self._active_key_id = active_key_id
        self._clock = clock

    def _now(self) -> datetime:
        now = self._clock()
        if not _aware(now):
            raise KeyUnavailableError("Key clock must provide a timezone-aware time.")
        return now

    def encryption_key(self) -> KeyVersion:
        key = self._versions[self._active_key_id]
        if not key.created_at <= self._now() < key.encrypt_until:
            raise KeyUnavailableError("Active encryption key is outside its write window.")
        return key

    def decryption_key(self, key_id: str) -> KeyVersion:
        if not isinstance(key_id, str) or not _KEY_ID.fullmatch(key_id):
            raise KeyUnavailableError("Requested decryption key is unavailable.")
        key = self._versions.get(key_id)
        if key is None or key.status is KeyStatus.REVOKED or self._now() < key.created_at:
            raise KeyUnavailableError("Requested decryption key is unavailable.")
        return key


def _parse_snapshot(snapshot: object) -> KeyRing:
    """Strict secret-manager payload. Schema errors suppress input-bearing traces."""
    try:
        if not isinstance(snapshot, dict) or set(snapshot) != {"active_key_id", "versions"}:
            raise ValueError
        records = snapshot["versions"]
        if not isinstance(records, list) or not 1 <= len(records) <= MAX_KEY_VERSIONS:
            raise ValueError
        versions = []
        for item in records:
            if not isinstance(item, dict) or set(item) != {"key_id", "key_b64", "status", "created_at", "encrypt_until"}:
                raise ValueError
            encoded = item["key_b64"]
            if not isinstance(encoded, str) or len(encoded) != 44:
                raise ValueError
            material = base64.b64decode(encoded, validate=True)
            if base64.b64encode(material).decode("ascii") != encoded:
                raise ValueError
            versions.append(KeyVersion(
                key_id=item["key_id"], material=material, status=KeyStatus(item["status"]),
                created_at=datetime.fromisoformat(item["created_at"]),
                encrypt_until=datetime.fromisoformat(item["encrypt_until"]),
            ))
        return KeyRing(snapshot["active_key_id"], versions)
    except (ValueError, TypeError, KeyError, binascii.Error, OverflowError):
        raise KeyConfigurationError("Invalid keyring snapshot; check schema, versions, dates, and 32-byte base64 keys.") from None


def _read_secret_store(fetch_snapshot: Callable[[], object]) -> KeyRing:
    try:
        snapshot = fetch_snapshot()
    except Exception:
        raise KeyUnavailableError("Secret store is unavailable; encryption is disabled.") from None
    return _parse_snapshot(snapshot)


class SecretStoreKeyProvider:
    """Refresh a complete ring at most every five minutes, on the next use.

    The hosting adapter supplies authentication and network timeouts. A failed
    refresh denies the operation, rather than using an expired cached snapshot.
    Each operation receives one immutable version across a concurrent rotation.
    """

    def __init__(self, fetch_snapshot: Callable[[], object], *, refresh_seconds: int = 300,
                 monotonic: Callable[[], float] = time.monotonic):
        if type(refresh_seconds) is not int or not 1 <= refresh_seconds <= 300:
            raise KeyConfigurationError("Secret-store refresh interval must be 1-300 seconds.")
        self._fetch_snapshot = fetch_snapshot
        self._refresh_seconds = refresh_seconds
        self._monotonic = monotonic
        self._lock = threading.Lock()
        self._ring = _read_secret_store(fetch_snapshot)
        self._expires_at = monotonic() + refresh_seconds

    def _current(self) -> KeyRing:
        with self._lock:
            if self._monotonic() >= self._expires_at:
                ring = _read_secret_store(self._fetch_snapshot)
                self._ring = ring
                self._expires_at = self._monotonic() + self._refresh_seconds
            return self._ring

    def encryption_key(self) -> KeyVersion:
        return self._current().encryption_key()

    def decryption_key(self, key_id: str) -> KeyVersion:
        return self._current().decryption_key(key_id)


def load_secret_store_provider(fetch_snapshot: Callable[[], object]) -> KeyProvider:
    """Initialize the production-facing provider; no vendor or credentials here."""
    return SecretStoreKeyProvider(fetch_snapshot)


def load_environment_provider(environment: Mapping[str, str] | None = None) -> KeyProvider:
    """Local synthetic-data adapter; never a production secret storage choice.

    Inject EKG_DEV_KEYRING_JSON at process startup, not via an .env/config file.
    Tests and demos generate ephemeral keys in memory, never in source code.
    """
    env = os.environ if environment is None else environment
    if env.get("EKG_APP_ENV") not in {"development", "test"}:
        raise KeyConfigurationError("Environment key provider is restricted to explicit development/test mode.")
    encoded = env.get("EKG_DEV_KEYRING_JSON")
    if not isinstance(encoded, str) or len(encoded) > 32_768:
        raise KeyConfigurationError("Development keyring is missing or too large.")
    try:
        snapshot = json.loads(encoded)
    except (ValueError, TypeError, RecursionError):
        raise KeyConfigurationError("Development keyring is not valid JSON.") from None
    return _parse_snapshot(snapshot)
