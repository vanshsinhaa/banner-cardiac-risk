# Task #52 — Encryption key management and key rules

[Taiga task](https://tree.taiga.io/project/gshale-sprint-0-backlog/task/52),
story #11. Owner: Vansh. Reference implementation verified October 26, 2026.

## Decision

Keep deployment encryption keys in an organization-managed secret store, read
by the trusted service through workload identity and scoped permissions. The
deployment adapter supplies the store call; application code uses a small
versioned key-provider interface. This chooses the storage/access pattern
without assuming the team has chosen a cloud provider or web/native application.
It follows the separation of keys and data discussed in
[OWASP's storage guidance](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html).

The current service has no database or persistent uploads. This task therefore
provides key access, lifecycle enforcement, and the encryption handoff, not a
database-encryption feature. Application package encryption is task #50.

## Where keys live

| Context | Storage and access rule |
| --- | --- |
| Tests and instructor demo | Fresh random keys exist only in the running process. Nothing is written or printed. Tests never need a cloud account. |
| Local synthetic-data development | Generate ephemeral keys in memory, or inject a runtime-only `EKG_DEV_KEYRING_JSON` environment value from a local secret tool. Requires explicit `EKG_APP_ENV=development` or `test`. No `.env`, JSON key file, shell command containing a key, shared key, or production fallback. |
| Deployed backend | Organization-managed secret store. Workload identity reads one versioned keyring secret with least privilege; a separate operator identity changes it. The provider refreshes a validated snapshot on use at most every 300 seconds. Store SDK timeouts belong in the hosting adapter. |
| Browser application | Backend deployment keys stay on the service. Do not put them in JavaScript, public environment variables, localStorage, IndexedDB, or responses. TLS protects transport separately. |
| Future native offline data | Use a per-installation platform key/handle, never a shared backend deployment key. Port the lifecycle contract; implement platform cryptographic operations through Android Keystore/iOS Keychain APIs rather than exporting a device key into this Python byte-key adapter. Device enrollment/recovery remains a future design. |

For example, [Azure documents managed identity access to Key Vault](https://learn.microsoft.com/en-us/azure/key-vault/general/authentication).
This is a possible hosting adapter, not an installed or configured Azure service.
[Android Keystore](https://developer.android.com/privacy-and-security/keystore)
illustrates why a native implementation should keep a platform key opaque.
The installed Next.js 16.3.6 guides were read before implementation: variables
with `NEXT_PUBLIC_` are bundled for the browser and cannot hold these keys.

## Application interface

Reference code: `services/upload-api/app/key_management.py`.

```python
# Hosting integration supplies a function that reads a secret using workload
# identity and returns a parsed snapshot. No key values appear in this example.
provider = load_secret_store_provider(fetch_keyring_from_secret_store)

# Task #50 obtains a version once for a whole encryption operation.
version = provider.encryption_key()
# version.key_id is nonsecret; version.material remains inside trusted code.

# Decryption selects exactly the version recorded with the encrypted package.
old_version = provider.decryption_key(package_key_id)
```

The secret snapshot has exactly `active_key_id` and `versions`. Each version has
`key_id`, `key_b64`, `status`, `created_at`, and `encrypt_until`.
The base64 field is the secret, not encryption. It decodes strictly to 32 bytes.
Dates must include a timezone; write windows are at most 90 days. The store
adapter returns this object in memory; this document deliberately provides no
key-bearing JSON example or key-generation command that prints a secret.

`KeyVersion` validates its fields and hides material from `repr`; the keyring
rejects duplicate IDs/material, requires exactly one matching active key, and
contains at most 32 versions. IDs use 1-64 lowercase letters/digits/dots/dashes/
underscores and must be opaque, never patient identifiers. Do not serialize a
key dataclass or send it to telemetry: hiding `repr` does not prevent `asdict`,
debuggers, local-variable capture, or process-memory inspection from exposing it.

## Lifecycle rules implemented in code

| State or condition | New encryption | Historical decryption |
| --- | --- | --- |
| `active`, inside `[created_at, encrypt_until)` | Allowed | Allowed |
| `active`, write window ended | Denied | Allowed |
| `decrypt-only` | Denied | Allowed |
| `revoked`, unknown ID, or future creation date | Denied | Denied |
| Missing/invalid configuration | Denied | Denied |
| Secret store fails at initialization or refresh | Denied | Denied after the cached snapshot expires |

A refresh builds and validates a whole new immutable ring before replacing the
cached ring under a lock. Existing operations keep the single version they
already acquired. A warm process can use a snapshot for up to five minutes;
revocation propagates on its next key access at/after that boundary. A failed
refresh does not fall back to stale material. Emergency incidents may require
restarting/stopping workers to eliminate that delay and in-flight operations.

The 90-day write limit and five-minute refresh limit are project policy choices,
not legal requirements or guarantees of compliance. Actual production retention,
usage limits, alerts, and recovery must be agreed with the deployment owner.

## Rotation runbook

1. The key operator generates a new 256-bit random version in the managed store.
   Never reuse material with a new ID. Set UTC creation and write-end dates no
   more than 90 days apart; keep development/staging/production separate.
2. In one secret update, mark the prior active version `decrypt-only`, add the new
   `active` version, and change `active_key_id`. Keep old material for retained
   packages/backups. Changing the ID alone is not rotation.
3. Refresh or restart workers and verify new writes record the new ID. Decrypt a
   synthetic pre-rotation package with its original ID. Test each running service
   before reporting success. The local test/demo exercises this sequence.
4. Before removing an old version, inventory retained ciphertext and backups;
   migrate/re-encrypt anything that still needs it and verify recovery. If the
   32-version cap would be exceeded, complete retention/migration first rather
   than silently pruning historical keys.
5. On suspected compromise, stop affected writes, install fresh material, revoke
   the affected ID, refresh/stop workers, review access logs, and determine data
   exposure. Revocation blocks app use but cannot undo a key already copied by
   an attacker. Do not undo revocation just to make a restore pass.

Use store audit events for access/change/denial, scoped to operator/service
identity and opaque version IDs. Do not log secret values, payloads, environment
dumps, or patient information. Back up key material separately under managed
access controls, test restore using synthetic ciphertext, and record the owner
and evidence before deleting any version. These operational practices are based
on [OWASP key lifecycle guidance](https://cheatsheetseries.owasp.org/cheatsheets/Key_Management_Cheat_Sheet.html)
and [secrets management guidance](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html).
No real managed-store restore or scheduled rotation job was run in this session.

## Handoff to #50

Use a maintained authenticated-encryption library. The test/demo uses AES-256-GCM
with a fresh 12-byte random nonce and full authentication tag. Store a versioned
envelope containing a format version, algorithm, opaque key ID, nonce, and
ciphertext/tag; authenticate its identifying header as associated data. Never
reuse a nonce with a key, accept plaintext fallback, guess another key on failure,
or release plaintext before authentication succeeds. Nonces and key IDs are not
secret. A documented per-key usage cap belongs to the encryption consumer.
[Cryptography's AEAD reference](https://cryptography.io/en/latest/hazmat/primitives/aead/)
defines the nonce, tag, and associated-data behavior used by the demonstration.

The provider returns key material to trusted service memory. It is **not** a
non-exportable KMS/HSM implementation or full envelope encryption; a future KMS
wrap/unwrap adapter needs a matching consumer contract. CPython cannot guarantee
secure zeroization of immutable bytes, and environment variables/process memory
can be exposed to a privileged debugger. Disable sensitive crash/local-variable
capture in deployed processes.

Task #50 must instantiate a provider at startup and reject encryption operations
if it cannot initialize. The upload service does not initialize a provider yet
because its existing routes neither encrypt nor persist data. The tests verify
the handoff with real cryptographic operations; application payload encryption,
HTTPS, and encrypted storage are not claimed as implemented by #52.

## Acceptance and deployment remainder

Implemented: strict key validation, injected store boundary, safe local adapter,
bounded refresh, write expiry, historical key selection, revocation, no automatic
key generation/fallback, safe errors, runtime-only synthetic demo, and rotation/
tampering tests. See [verification](verification-2026-10-26.md).

Before deployment: select the actual hosting/store; implement its authenticated
SDK call with timeouts; assign service/operator roles and an operational owner;
configure secret creation/rotation/alerts/backup; run access-denial and restore
exercises; connect #50. These are concrete follow-ups, not cloud resources
silently assumed to exist.
