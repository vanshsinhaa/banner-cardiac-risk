# Task 61: capture-screen audit events

Each capture is recorded as timestamped events with a random capture ID and an
outcome. Events never contain image data, file names, text read from the image,
or error messages. Capture screen only: transmission and export logging belong
to the backend.

## Events

| event_type | When | outcome |
| --- | --- | --- |
| crop_confirmed | The person confirms the crop | success |
| deid_requested | The cropped image is sent for de-identification | success |
| deid_succeeded | The service confirms de-identification | success |
| deid_blocked | The service refuses, fails or times out, or the person cancels | blocked, with a reason |
| image_save_requested | The person clicks Save | success |

Fields: event_id, capture_id (one per confirmed crop; retries share it),
timestamp (ISO 8601), event_type, outcome, and reason on blocked events only.
Reasons: nothing_detected, uncertain_text, unsupported_pixels, ocr_failed,
redaction_failed, verification_failed, timeout, service_unavailable,
invalid_response, cancelled, unspecified.

## Why no patient data can get in

- src/lib/auditLog.ts builds events only from fixed lists plus random IDs. No
  parameter accepts free text, file names or image data.
- A reason is taken from the error's name, HTTP status and safe block code,
  never its message.
- src/app/api/audit/route.ts rejects any extra field or any value outside the lists.
- src/lib/auditLog.test.ts passes an error message full of fake identifiers
  from a synthetic sample, file names and image data through the logger and
  checks that none of it appears in any event.

## Where events go

Browser -> POST /api/audit -> checked, then written to the server log as an
AUDIT line, and forwarded to AUDIT_SINK_URL if it is set. The team has not yet
agreed on a permanent audit store: update once decided.

## If the audit log is unavailable

The capture continues. The screen shows a warning and the console shows a fixed
message. Events are kept in memory (up to 100) and resent, in order, with the
next event. A resent event can appear more than once in the server log with the
same event_id; the receiver should treat that as a duplicate. Team-agreed
behavior: continue with a warning. 

## Limits

- image_save_requested records the click. The browser does not report whether
  the download finished.
- Queued events are lost if the page is closed during an outage.
- Test previews (DEID_MOCK) are never logged as real results.
- Phone tests also worked 

## Run the tests

    npm test
    DEID_MOCK=fail npm run dev                          (AUDIT lines print in this terminal)
    AUDIT_SINK_URL=http://127.0.0.1:9 DEID_MOCK=fail npm run dev   (audit log down: warning shown)