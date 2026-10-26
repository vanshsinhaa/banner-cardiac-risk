# EKG page-boundary capture

`EkgCaptureScreen` accepts `initialCorners?: Corners` and calls
`onCapture(dataUrl, details)` after a successful preview warp. A one-argument
callback still works. `dataUrl` is a PNG data URL; `details` is:

```ts
{
  corners: [topLeft, topRight, bottomRight, bottomLeft], // each { x, y }
  width: number,  // original photo's naturalWidth
  height: number, // original photo's naturalHeight
}
```

All coordinates use the full-resolution photo after the browser applies its
orientation tag, with the origin at the top-left. CSS dimensions never enter
the callback. The shared types, canonical ordering, and drag constraints live
in `src/lib/cropCorners.ts`. Handle identities stay stable during a drag;
the returned corners are canonically ordered on confirmation.

The initial proposal is read once when the photo loads. Missing proposals use
a 10% inset. Invalid, crossed, collinear, or out-of-bounds proposals use the same
inset and show an explanation. Proposals never override an edit mid-drag.
Moves clamp to the photo as a group; a move that would make a corner concave
or cross an edge is rejected, retaining the last valid position.

There are four independent corner handles. Midpoint/edge handles were removed
at the user's request to retain the four-corner model without linked handles.
Dragging inside moves the whole selection.

Arrow keys move a focused corner or whole selection by one source pixel;
Shift+arrow moves ten. Pointer drags are coalesced into animation frames, with
a final position flush on release. Additional pointers are ignored. Only the
110px loupe canvas is redrawn during a handle drag, at 2.5 times the displayed
image scale and sampled from the decoded original.

## Preview adapter and pixel convention

`src/components/capture/warpPreview.ts` is the single replaceable adapter. The
crop editor contains no warp or upload implementation. A backend integration
can replace this adapter with an original-photo-plus-corners request. Keep the
original photo available for that request; do not feed this preview PNG into a
second geometric warp.

Output width is the truncated longer top/bottom edge; height is the truncated
longer left/right edge. There is no display-sized cap or other downscaling.
The preview treats coordinates as pixel boundaries: destination corners are
`(0,0), (width,0), (width,height), (0,height)`, with sampling at pixel centers.
This resolves the endpoint ambiguity in favor of the required plain-crop
equivalence: integer axis-aligned crops, including their last rows/columns,
match a canvas crop byte-for-byte. Mapping corners instead to `width-1` and
`height-1` would stretch that crop by one pixel. Coordinate values passed to
the callback are unchanged by preview sampling.

The pure homography and bilinear sampler live in `src/lib/perspective.ts`.
The adapter runs resampling and PNG encoding in `warpPreview.worker.ts`.
Where worker canvases exist, it transfers a bitmap copied from the displayed
image. Otherwise it reads the source canvas once and transfers the pixel buffer;
`encodePng.ts` uses native streaming DEFLATE to encode lossless RGBA PNGs inside
the worker without an image library. This avoids WebKit's main-thread canvas
PNG-encoding stall. Worker resources are released on completion or cancellation.

Older browsers without workers or both encoding capabilities use row batches
with an approximately 8ms work budget. Their native canvas encoding can still
stall the UI; this compatibility path cannot guarantee the worker path's
responsiveness. Processing errors return to the same crop without increasing
the session count. A homography corrects a planar page's perspective; folds and
crumples in the supplied photos remain visible.

## Verification

Run `npm test`, `npx tsc --noEmit`, and `npm run lint`.
For optional browser checks, start the dev server, then use an existing
Playwright installation (no dependency was added to this project):

```text
node scripts/verifyCapture.mjs <path-to-playwright-package> chromium
node scripts/verifyCapture.mjs <path-to-playwright-package> webkit
```

`CAPTURE_TEST_URL` optionally overrides `http://localhost:3000`. Screenshots
are generated under `.next/capture-verification/`. The script exercises pointer
and keyboard movement, the loupe, viewport resizing, the resolution gate,
capture counting, cancelled selection, encoding failure recovery, and PNG
output. Chromium additionally exercises emulated touch events. It benchmarks
the actual adapter with full-photo selections and compares all output bytes
against the browser's decoded source. The eight two-byte JPEGs are ignored.

Observed locally on desktop, headless browsers, October 10, 2026:

| Orientation-applied photo size | Chromium | WebKit |
| --- | --- | --- |
| 4624 × 3468, bent/crumpled | about 1.6 s | about 2.0 s |
| 4160 × 3120, EXIF-rotated Doogee | about 1.6 s | about 1.9 s |

These are adapter times including canvas readback, worker warp, PNG
encoding, and data-URL conversion, with decoding completed beforehand.
The event loop continued ticking during processing, and full-photo comparisons
were byte-identical in both engines. The longest measured main-thread gaps were
about 90ms in Chromium and 190–435ms in WebKit (which reads the source pixels on
the main thread in this environment). Before worker encoding, WebKit paused for
2–3 seconds. These are desktop measurements, not phone
performance claims. Physical iOS/Android camera pickers, pen hardware, notches,
and memory/thermal behavior on phones still need device testing. No orientation
regression was observed on the supplied EXIF-rotated photo.
