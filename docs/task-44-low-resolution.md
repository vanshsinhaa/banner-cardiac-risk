# Task #44: Low-resolution handling

Part of user story #3, handling imperfect printouts.

## What we did

1. Put the minimum resolution numbers in one config file.
2. Wrote one function, `checkResolution(image)`, that says pass or fail.
3. Wired the check into the capture screen. It runs as soon as the photo
   loads. A failed check blocks the save and shows "Move closer".
4. Wrote tests for above, at, and below the limit.
5. Wrote an experiment script that downscales a sample image and compares
   bicubic and Lanczos upscaling. Given a folder, it runs the check on
   every photo in it.

Not built here, on purpose: blur and glare detection (#36), trace
extraction (#39, #40), and grid calibration.

## The files

| File | Job |
| --- | --- |
| `src/config/resolution.ts` | The threshold numbers. Nothing else. |
| `src/constants/captureMessages.ts` | Message text shown to the user. |
| `src/lib/checkResolution.ts` | The check itself. |
| `src/lib/checkResolution.test.ts` | Tests for the check. |
| `scripts/resolutionExperiment.ts` | The downscale and upscale experiment. |
| `src/components/EkgCaptureScreen.tsx` | Calls the check and shows the message. |

## How the logic works

### The thresholds

```ts
export const MIN_PIXELS_PER_MM = 8;
export const ASSUMED_PAGE_LONG_SIDE_MM = 297;
export const FALLBACK_MIN_PHOTO_LONG_SIDE_PX = 2376; // 297 x 8
```

The real measure we care about is **pixels per millimeter of grid paper**.
EKG paper has a 1 mm grid, and the trace has to be sharp enough to follow.
8 pixels per millimeter is a starting guess.

We cannot measure pixels per millimeter yet, because grid calibration does
not exist. So for now we use a stand-in: the **long side of the whole
photo in pixels**. We assume the photo shows at most one full page, 297 mm
on its long side (A4). 297 x 8 = 2376.

Both numbers are guesses to tune later.

**Why the whole photo and not the crop.** The first version checked the
width of the crop against 2000 pixels. That was wrong: cropping does not
change how many pixels cover one millimeter. A sharp photo cropped to one
short lead was rejected, and height was ignored. The photo size does not
have that problem.

**Which way the stand-in can be wrong.** If the photo shows less than a
full page (the user moved closer), the real resolution is higher than the
estimate. That is the safe direction. If the photo shows a lot of
background around the page, the real resolution is lower than the
estimate, and a weak photo can slip through. Calibration fixes that.

### The check

`checkResolution` takes an object describing the photo:

```ts
{ width: number, height: number, pixelsPerMm?: number }
```

`width` and `height` are the size of the whole photo, before cropping.

It returns:

```ts
{ pass, measure, measured, required, reason }
```

The logic is one decision:

- If `pixelsPerMm` is given, compare it with `MIN_PIXELS_PER_MM`.
- If it is not given, compare the longer of `width` and `height` with
  `FALLBACK_MIN_PHOTO_LONG_SIDE_PX`.

A photo exactly at the limit passes (`>=`).

`measure` tells you which of the two was used. `reason` is a short sentence
such as "Photo too small: 1500 pixels on its long side, need at least 2376."

**Why this shape:** when calibration is built, it only has to add
`pixelsPerMm` to the object it passes in. The capture screen and every
other caller stay the same. The function has no browser code, so the tests
and the experiment script can run it directly in Node.

### The capture screen

In `handleImageLoad`, as soon as the photo is on screen:

```ts
const resolution = checkResolution({ width: img.naturalWidth, height: img.naturalHeight });
setResolutionFailure(resolution.pass ? null : resolution);
```

If the check fails, the user sees "Move closer" with the reason under it,
and the "Confirm crop" button is disabled. `handleConfirmCrop` also
returns early, so no PNG is made and `onCapture` is never called.

The check runs once per photo. Moving the crop box cannot change the
result, so the message never goes out of date. The only way to clear it is
to retake the photo, which is also the only thing that fixes the problem.

### The camera

We did not change how the camera is opened. The screen uses a file input
with `capture="environment"`, which opens the phone's own camera app. That
app already takes the photo at the highest resolution the device allows,
and the browser gives no setting to ask for more. A live camera preview
(`getUserMedia`) would give video frames, which are smaller.

### The experiment

`scripts/resolutionExperiment.ts` has two modes.

Given one image:

1. Downscales the sample image to 100, 75, 50, and 25 percent, runs the
   check on each, and prints a table.
2. Takes each image that failed, upscales it back to the original size
   with bicubic and with Lanczos, and prints a second table.

Given a folder: runs the check on every photo at the same four scales and
prints one table, with the estimated pixels per millimeter. Files that
cannot be read as images are listed as skipped.

Important: every upscaled image passes the check, because the check only
counts pixels. Upscaling adds pixels but no new detail. So the check alone
cannot tell us whether upscaling helps. The real answer needs a trace
error number, and that needs trace extraction (#39, #40). The function
`traceError()` in the script is a marked stub for that.

Rule for the app: always run the check **before** any upscaling.

### Results on the real photos

Run on the photos in `public/camera-ecgs/` on main (PM-ECG-ID).

- 26 files. 18 are real photos. 8 are 2 bytes long and cannot be read.
- 15 photos are 4624 x 3468. 3 (Doogee) are 4160 x 3120.
- Estimated 15.6 and 14.0 pixels per millimeter.
- All 18 pass at 100 and 75 percent. All 18 fail at 50 and 25 percent.

So a full-size phone photo of a full page has roughly twice the pixels we
ask for. The check will mostly catch screenshots, resized images, and
photos sent through a messaging app.

A rough hand measurement on one Doogee photo gave about 12 pixels per
millimeter, against the estimate of 14. The page does not quite fill the
frame, so the stand-in reads a little high, as expected.

## How to run

```
npm test
npm run experiment -- path/to/ekg-photo.jpg
npm run experiment -- path/to/folder-of-photos
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
2. Is the 2376 pixel fallback right? It assumes the photo shows at most
   one full A4 page. A photo with a lot of background reads too high.
3. Does everyone have Node 22.6 or newer? If not, we switch to Vitest.
4. Eight files in `public/camera-ecgs/` on main are 2 bytes long. Do they
   need to be uploaded again?
5. Who supplies real sample EKG photos, and can they live in the repo?
6. Do we add a simple pixel-difference number to the experiment now, or
   wait for trace extraction?
7. Does the calibration task agree to pass `pixelsPerMm` into
   `checkResolution`?
8. Is "Move closer" the final wording? The retake prompt task reuses
   `captureMessages.ts`.
9. Do we keep the file input, or does the team want a live camera preview
   later? A live preview means lower resolution.
