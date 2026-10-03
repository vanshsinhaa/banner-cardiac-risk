# Task #44: Low-resolution handling

Part of user story #3, handling imperfect printouts.

## What we did

1. Put the minimum resolution numbers in one config file.
2. Wrote one function, `checkResolution(image)`, that says pass or fail.
3. Wired the check into the capture screen, right after the crop step.
   A failed check blocks the save and shows "Move closer".
4. Wrote tests for above, at, and below the limit.
5. Wrote an experiment script that downscales a sample image and compares
   bicubic and Lanczos upscaling.

Not built here, on purpose: blur and glare detection (#36), trace
extraction (#39, #40), and grid calibration.

## The files

| File | Job |
| --- | --- |
| `src/config/resolution.ts` | The two threshold numbers. Nothing else. |
| `src/constants/captureMessages.ts` | Message text shown to the user. |
| `src/lib/checkResolution.ts` | The check itself. |
| `src/lib/checkResolution.test.ts` | Tests for the check. |
| `scripts/resolutionExperiment.ts` | The downscale and upscale experiment. |
| `src/components/EkgCaptureScreen.tsx` | Calls the check and shows the message. |

## How the logic works

### The thresholds

```ts
export const MIN_PIXELS_PER_MM = 8;
export const FALLBACK_MIN_CROP_WIDTH_PX = 2000;
```

The real measure we care about is **pixels per millimeter of grid paper**.
EKG paper has a 1 mm grid, and the trace has to be sharp enough to follow.
8 pixels per millimeter is a starting guess.

We cannot measure pixels per millimeter yet, because grid calibration does
not exist. So for now we use a stand-in: the **width of the cropped image
in pixels**. The 2000 comes from simple math: a 10 second strip at 25 mm/s
is 250 mm wide, and 250 x 8 = 2000.

Both numbers are guesses to tune later.

### The check

`checkResolution` takes an object describing the image:

```ts
{ width: number, height: number, pixelsPerMm?: number }
```

and returns:

```ts
{ pass, measure, measured, required, reason }
```

The logic is one decision:

- If `pixelsPerMm` is given, compare it with `MIN_PIXELS_PER_MM`.
- If it is not given, compare `width` with `FALLBACK_MIN_CROP_WIDTH_PX`.

An image exactly at the limit passes (`>=`).

`measure` tells you which of the two was used. `reason` is a short sentence
such as "Image too small: 1500 pixels wide, need at least 2000."

**Why this shape:** when calibration is built, it only has to add
`pixelsPerMm` to the object it passes in. The capture screen and every
other caller stay the same. The function has no browser code, so the tests
and the experiment script can run it directly in Node.

### The capture screen

In `handleConfirmCrop`, after the crop is drawn to the canvas:

```ts
const resolution = checkResolution({ width: canvas.width, height: canvas.height });
if (!resolution.pass) {
  setResolutionFailure(resolution);
  return;
}
```

The early `return` is what blocks the save. The code below it (make the
PNG, show the result, call `onCapture`) never runs for a failed image. The
user stays on the crop screen and sees "Move closer" with the reason under
it. The message clears when they pick a new photo.

### The camera

We did not change how the camera is opened. The screen uses a file input
with `capture="environment"`, which opens the phone's own camera app. That
app already takes the photo at the highest resolution the device allows,
and the browser gives no setting to ask for more. A live camera preview
(`getUserMedia`) would give video frames, which are smaller.

### The experiment

`scripts/resolutionExperiment.ts` does two things:

1. Downscales the sample image to 100, 75, 50, and 25 percent, runs the
   check on each, and prints a table.
2. Takes each image that failed, upscales it back to the original size
   with bicubic and with Lanczos, and prints a second table.

Important: every upscaled image passes the check, because the check only
counts pixels. Upscaling adds pixels but no new detail. So the check alone
cannot tell us whether upscaling helps. The real answer needs a trace
error number, and that needs trace extraction (#39, #40). The function
`traceError()` in the script is a marked stub for that.

Rule for the app: always run the check **before** any upscaling.

## How to run

```
npm test
npm run experiment -- path/to/ekg-photo.jpg
```

Both need Node 22.6 or newer. They use Node's built-in test runner and
its TypeScript support, so no test library was added. Node prints an
"ExperimentalWarning" line; that is expected.

With no image path, the experiment draws a fake grid image so it still
runs. Use a real EKG photo for results that mean anything.

`sharp` was added as a dev dependency for the experiment. It was already
installed as part of Next.js.

## Open questions for the team

1. Is 8 pixels per millimeter right? It is a guess until trace extraction
   can measure error.
2. Is the 2000 pixel fallback right? It assumes the crop covers a full
   10 second strip. A crop of one short strip will be rejected.
3. Does everyone have Node 22.6 or newer? If not, we switch to Vitest.
4. Should the check look at height too? Right now it only looks at width.
5. Who supplies real sample EKG photos, and can they live in the repo?
6. Do we add a simple pixel-difference number to the experiment now, or
   wait for trace extraction?
7. Does the calibration task agree to pass `pixelsPerMm` into
   `checkResolution`?
8. Is "Move closer" the final wording? The retake prompt task reuses
   `captureMessages.ts`.
9. Do we keep the file input, or does the team want a live camera preview
   later? A live preview means lower resolution.
