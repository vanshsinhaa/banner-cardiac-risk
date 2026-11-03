# Continue development on another device

Working branch: **`vansh/bannerwork`** (slash). The old `vansh-bannerwork`
(hyphen) remote is a different branch. Use the slash branch for this work.

## Get the saved work

For a fresh checkout:

```powershell
git clone --branch vansh/bannerwork https://github.com/vanshsinhaa/banner-cardiac-risk.git
Set-Location banner-cardiac-risk
```

For an existing clone, first run `git status` and preserve any local edits. With
a clean working tree:

```powershell
git fetch origin
git switch vansh/bannerwork
git pull --ff-only
```

If the local slash branch does not exist, use
`git switch --track origin/vansh/bannerwork` after fetching.

## Start the capture app

Use Node.js 22 (the saved work was checked on 22.9.0). From the repository root:

```powershell
npm ci
npm run dev
```

Open http://localhost:3000. This is the capture/crop preview. It is not yet wired
to the Python privacy pipeline. To check the frontend:

```powershell
npm test
npm run lint
npx tsc --noEmit
npm run build
```

## Start the upload API and test Sprint 3

Use Python 3.12. In another terminal, from the repository root:

```powershell
Set-Location services/upload-api
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m pytest -v
.\.venv\Scripts\python.exe scripts/sprint3_demo.py
.\.venv\Scripts\python.exe -m uvicorn app.main:app --port 8000
```

Open http://127.0.0.1:8000/docs. The root `/` has no homepage; a 404 there is
expected. `/health` returns a small status response.

- `POST /uploads` returns a JSON report, not an image.
- `POST /uploads/sanitize` returns the actual sanitized PNG.
- `synthetic_ekg.png` in the service directory is a generated, non-patient sample
  for manual uploads. Tests/demo create additional deliberately tagged fixtures.
- For #52 alone, run
  `.\.venv\Scripts\python.exe -m pytest -v tests/test_key_management.py`.

On macOS/Linux, create the environment with `python3.12 -m venv .venv` and use
`.venv/bin/python` in place of `.\.venv\Scripts\python.exe`.

Dependencies, virtual environments, build outputs, and local `.env` files are
not in Git and must be recreated on the other device. No private environment
values or live encryption keys are needed for the local tests/demo. Optional
`DEV_ORIGINS` is only needed when allowing a particular tunnel/dev hostname.

## Resume after standup

Read [TRACKER.md](TRACKER.md) first. Current implementation and evidence:
[task #48](task-48-metadata.md), [task #52](task-52-key-management.md),
[verification](verification-2026-10-26.md), and
[capture notes](../docs/ekg-capture.md).

Record the actual team decisions after the meeting:

1. DICOM scope: PNG/JPEG only, selected DICOM images, or numerical ECG waveform
   objects. Current DICOM rejection is not DICOM sanitization.
2. Faith's #51 endpoint/data contract and where #48 precedes OCR/redaction.
3. The key-provider handoff to Talgat's #50, the intended secret store, and
   client/server encryption expectations. Upload encryption is not implemented.
4. New tasks, owners, and acceptance checks agreed at standup.

Do not mark those decisions or integrations completed before they happen.
