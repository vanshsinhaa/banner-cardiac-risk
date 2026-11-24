# Manual labels and waveform regions

On `arsen/DoubleOCR`, the existing capture → privacy → parallel readability/digitization flow is unchanged. A digitizer response now carries a temporary manual-review session when the aligned coordinate frame and calibration are available.

After processing, click **Edit unrecognized leads**. The `/review-leads` page lists assignments that lack layout/Tesseract agreement. For each, enter a standard lead name, select the printed characters, and select exactly one complete waveform region. Both drag selection and numeric pixel-coordinate inputs are supported, with a preview of each selection. **Add a missing lead** handles a label omitted by the original extraction. Leads already confirmed by model/OCR agreement cannot be overwritten through this endpoint. Unconfirmed labels can be swapped in one submission.

**Process labels and waveform regions** calls the Next.js `/api/ecg/review` proxy, then the Python `/review-leads` endpoint. The server validates the whole batch and masks its cached, aligned neural signal-probability map to each selected waveform rectangle. It runs the existing `TrackedSignalExtractor` and fragment-merging step again on that map; it does not just rename old arrays. If the cached map does not yield one usable trace, it performs fresh neural segmentation on the selected image crop, restores that map to the original aligned pixel coordinates, and retries extraction. A region with no usable trace or multiple traces is rejected. It applies the existing mean-baseline, positive-up convention and 10 mm/mV calibration, resampling onto the original shared 5,000-sample time axis. Samples outside the selected interval remain null. Paper-speed-derived sample rate and untouched lead arrays are preserved.

The label rectangle records the visual evidence supplied by the user. The user's label is authoritative; OCR is not required to approve it again. Corrected assignments have `human_corrected` status, with original model/OCR evidence retained in `machineEvidence` and explicit `manualCorrections` coordinates. They are not reported as machine agreement.

After processing, `/review-leads/result` shows the original scan assessment and the updated waveforms. Every displayed lead still requires the existing final checkbox confirmation. The JSON download contains corrected values and the correction audit; it excludes the temporary session token and full aligned scan.

## All-lead graph editor in a new browser tab

The results screen has **View and edit all lead graphs (new tab)** above the scan image. It stays visible while extraction runs or fails, with an explanation, and enables once waveform data is returned. It opens `/lead-graphs` in a separate tab and displays every extracted lead label and its numerical graph, including leads whose labels were verified by the model and OCR. Each card has its current source image and an expandable waveform-region selector. Labels are fixed in this view; use the existing label-review flow for label corrections.

While extraction runs, a prominent spinner and **Scan processing is in progress** message explain that the lead-label scan portions and graphs will appear automatically, and that processing can take up to two minutes. The indicator stops on success or failure, even if the separate readability check is still running. A ready message appears when waveform results arrive. The status is announced to screen readers and the spinner respects reduced-motion preferences.

Open **Adjust waveform region for [lead]**, drag a rectangle on the aligned scan or enter its bounds, and click **Save graph regions**. Only changed leads are sent to the server. The new `waveform_regions` mode permits editing previously verified leads, requires each existing label to remain unchanged, and uses the same calibrated extraction/fallback pipeline. The original label crop is retained when available, so another label selection is not required. Untouched samples and the shared time axis remain unchanged; changed assignments carry human-correction evidence and require final confirmation again.

Successful saves refresh the numerical graphs in the editor and update the original results tab if it still displays that scan. Previous checkbox confirmations and downloads are cleared there. **Review and confirm saved results** opens the existing final-confirmation flow in the editor tab. Reset/discard controls affect unsaved selections only, and errors keep selections available.

The two tabs exchange snapshots using same-origin `postMessage`, checking the exact window reference and a random per-tab handshake ID. The graph tab retries the initial request every half-second for up to ten seconds to recover a missed message. The URL fragment contains only that ID, never the review capability token or image. No scan data is written to browser storage. Refreshing the graph tab can recover its latest snapshot while the original tab remains open; direct visits without a parent scan show an upload/recovery message. Popup blockers show an explanatory message and **Open lead graphs in this tab**, which carries the current result through React memory.

Concurrent saves still use server revisions. If another tab saved first, the stale editor offers **Reload latest result and discard selections**, which reads the authoritative server session without changing it. Expired sessions require uploading again.

The implementation is in `src/app/lead-graphs/page.tsx`, the shared entry button in `src/components/LeadGraphsButton.tsx`, the tab bridge in `src/components/ReviewSession.tsx`, the shared plot in `src/components/LeadTrace.tsx`, and the `waveform_regions` mode in `digitizer-service/manual_review.py` and `server.py`.

## Temporary state and limits

`ReviewSession` stores the current result in React layout memory across page navigation. It does not put image pixels in localStorage or sessionStorage. Refreshing the same-tab manual-label editor loses browser review state and presents an upload link; the separate graph tab can recover through its opener as described above. Cancel returns to the unchanged result.

`ReviewStore` holds aligned image pixels, a CPU signal map, calibration and the original result in memory for up to 20 minutes. Random bearer tokens are sent in JSON bodies, never in route URLs. The store retains at most four sessions and 128 MiB of image/map arrays; older sessions may be evicted. Timers remove expired sessions. Restarting the digitizer invalidates them. This local design assumes one digitizer worker; a multi-worker deployment would need a shared, access-controlled session store or sticky routing.

Correction batches are limited to 32 KiB and 12 entries. Duplicate target labels, invalid source names, out-of-image/nonfinite rectangles, replacing agreed leads, and stale revisions are rejected. A successful batch commits atomically. Errors leave form selections available. The model and review-session locks serialize extraction and protect shared state.

The new step does not bypass privacy processing. If neither the full-page nor the selected-crop segmentation identifies a usable waveform, the region produces an explicit extraction error. Unsupported dewarped/untraceable geometry leaves normal results available with a manual-review-unavailable message. This is label/region correction, not a validation of clinical waveform accuracy.

## Main files

- `src/components/ReviewSession.tsx`: navigation state, mounted by the root layout.
- `src/components/RegionSelector.tsx`: pointer and numeric rectangle selection and crop preview.
- `src/app/review-leads/page.tsx`: manual label/region form.
- `src/app/review-leads/result/page.tsx`: updated results and final confirmation.
- `src/components/LeadReview.tsx`: new entry link and human-correction display.
- `src/app/api/ecg/review/route.ts`: bounded correction proxy.
- `digitizer-service/manual_review.py`: session store, validation, calibrated extraction and atomic result construction.
- `digitizer-service/server.py`: session creation after digitization and correction HTTP endpoint.

## Local verification

Run `npm test`, `npm run lint`, and `npm run build`. Run digitizer tests with the upstream repository on `PYTHONPATH`, including `test_manual_review.py` and `test_service.py`. The service tests exercise the real upstream extractor on synthetic probability maps, without loading neural weights.

For browser integration, run `npm run dev` to start Next.js on port 3000 and the local digitizer on port 8000 (default `ECG_RESAMPLE_SIZE=1200`). Generate a fresh synthetic model result:

```sh
curl --max-time 180 -F image=@public/synthetic-ecgs/standard-12-lead.png \
  http://127.0.0.1:8000/digitize -o /tmp/manual-real-result.json
node scripts/verifyManualReview.mjs /path/to/playwright /tmp/manual-real-result.json
```

The browser script defaults to installed Chrome; `BROWSER_EXECUTABLE` can name another Chromium executable. It uses the real model result and real correction endpoint. Privacy/readability replies are isolated synthetic fixtures, so this test does not measure those OCR engines. It checks three corrected leads, nine unchanged leads, pointer and numeric selection, final checkboxes/download, mobile overflow and refresh recovery. Screenshots and a compact report go to ignored `.local-run/manual-review/`. Generate a fresh model session before rerunning after a successful correction, because revisions prevent stale edits.


For the all-lead graph browser regression, create another fresh model session and run:

```sh
node scripts/verifyLeadGraphs.mjs /path/to/playwright /tmp/manual-real-result.json
```

This test opens two actual browser tabs, verifies all 12 labels and graphs, changes a previously OCR-verified V1 region through the real extraction endpoint, and checks that the other 11 leads are unchanged. It also checks original-tab synchronization, cleared confirmations, stale concurrent saves, latest-result loading, refresh recovery, popup blocking, invalid selections, mobile layout, and confirmed JSON export. Privacy and readability responses are synthetic fixtures; their engines are not measured by this test. Reports and screenshots are in ignored `.local-run/lead-graphs/`.

`node scripts/verifyGraphAvailability.mjs /path/to/playwright` tests the disabled button during loading and extraction failure, recovery after retry, all 12 graphs in a separate tab, retry after a dropped handshake, and same-tab recovery when opening a popup returns null or throws. Its service results are controlled synthetic fixtures, so it needs only the development website. Both scripts accept `BROWSER_EXECUTABLE` to select a local Chromium browser.

## Development-only privacy bypass

When running `npm run dev`, **Testing only: continue without de-identification** appears on the crop screen, during the privacy check, and after a blocked privacy result. Clicking it explicitly sends the current crop to readability analysis and waveform digitization; if privacy is still running, that request is cancelled and any late reply is ignored. A failed privacy check never continues automatically.

The bypass uses a distinct `testing_bypass` capture status. The result and all lead-editing views show that identifying information was not removed; image downloads are named/labeled as test images. Numerical results, server review sessions, corrected results, and confirmed JSON exports retain `privacyStatus: "testing_bypass"`. The existing capture callback remains restricted to successful redaction. Choosing another scan clears the bypass state, and the normal crop button still follows the original privacy flow.

The button is absent from production builds (`npm run build` / `npm start`), and the web analysis/digitization routes reject the explicit bypass header outside development. This does not change the pre-existing direct digitizer API into an authenticated privacy-provenance system; the bypass gate controls this development workflow.

`scripts/verifyTestingBypass.mjs` tests direct crop bypass, continuing after rejection, cancelling an in-progress privacy request, scan reset, testing markers in new tabs/server cache/JSON export, and production UI/API lockout. It uses real local analysis and digitization for the blocked-result scenario, with a simulated privacy rejection; other race scenarios use controlled service fixtures. Run the development site on port 3000, a built production site on 3001, and the digitizer on 8000, then pass a Playwright installation path as the first script argument. Results are saved to ignored `.local-run/testing-bypass/`.
