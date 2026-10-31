# Integrate current capture UI with team pipeline

The team branches each integrate an older rectangular capture screen. This draft
combines them around the current four-corner screen, preserving each contributor's
history and porting camera, privacy, readability, and digitizer behavior into that
screen. It includes PRs #1–#5 and Arsen's lead-recognition branch.

Capture now gates saving/callbacks and analysis on metadata sanitization followed
by confirmed printed-text redaction. The digitizer combines Rob's sampling-rate
and T-wave work with Arsen's spatial lead audit; binary and multipart uploads both
return waveform JSON. Missing/invalid evidence remains marked for review.

Validation: 63 frontend/API tests, 112 upload API tests, 32 preprocessing tests,
13 spatial-verification tests, four signal-conversion tests, 11 redaction checks,
lint and production build passed. Synthetic browser evidence is recorded in
`docs/integration-review.md`. CI now runs frontend and lightweight Python checks.

**Keep draft:** the real de-identification HTTP backend is missing; real pinned
digitizer/OCR inference, phone testing, the 10 MB PNG policy, and the canonical
schema mapping need team confirmation. The app fails closed where privacy is not
confirmed. No risk scoring or model-ready export is enabled.

See `docs/integration-review.md` for source tips, conflict decisions, service
contracts and owner-specific merge gates. No teammate branch needs rewriting.
