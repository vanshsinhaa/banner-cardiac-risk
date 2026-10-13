// Resolution experiment for Taiga #44.
//
// Question: if a photo is below the minimum resolution, does upscaling help?
//
// Run with:  npm run experiment -- path/to/ekg-photo.jpg
//       or:  npm run experiment -- path/to/folder-of-photos
// With no path, the script draws a fake grid image so it still runs.
// Use a real EKG photo for results that mean anything.
// With a folder, it runs the check on every photo and prints one table.

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import sharp from "sharp";

import { ASSUMED_PAGE_LONG_SIDE_MM } from "../src/config/resolution.ts";
import { checkResolution } from "../src/lib/checkResolution.ts";

const SCALES = [100, 75, 50, 25];

// The two upscaling methods to compare. "cubic" is bicubic in sharp.
const UPSCALE_KERNELS = [
  { name: "bicubic", kernel: sharp.kernel.cubic },
  { name: "lanczos", kernel: sharp.kernel.lanczos3 },
];

// ---------------------------------------------------------------------
// STUB. Trace extraction (#39, #40) does not exist yet, so we cannot
// measure how far the digitized waveform drifts after resizing.
// When it exists: extract the trace from both images and return the
// average difference. Until then this returns null and the table shows
// "not available".
// ---------------------------------------------------------------------
function traceError(original: Buffer, candidate: Buffer): number | null {
  void original;
  void candidate;
  return null;
}

// Fake EKG paper: 1 mm grid lines and one zigzag line, at 10 pixels per mm.
// Only used when no image path is given.
async function makeSyntheticImage(): Promise<Buffer> {
  const width = 2500;
  const height = 1000;
  let points = "";
  for (let x = 0; x <= width; x += 50) {
    points += `${x},${x % 100 === 0 ? 400 : 600} `;
  }
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <defs>
        <pattern id="grid" width="10" height="10" patternUnits="userSpaceOnUse">
          <path d="M 10 0 L 0 0 0 10" fill="none" stroke="#e8a0a0" stroke-width="1"/>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="#fff"/>
      <rect width="100%" height="100%" fill="url(#grid)"/>
      <polyline points="${points}" fill="none" stroke="#000" stroke-width="2"/>
    </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

// Folder mode: run the check on every photo in a folder, at each scale.
// Only the image sizes are needed, so nothing is resized here.
async function runFolder(folderPath: string) {
  const files = readdirSync(folderPath)
    .filter((name) => /\.(jpe?g|png)$/i.test(name))
    .sort();

  const rows = [];
  const skipped: string[] = [];
  for (const file of files) {
    let width: number;
    let height: number;
    try {
      // autoOrient gives the size after the phone's orientation tag is applied.
      const meta = await sharp(join(folderPath, file)).metadata();
      width = meta.autoOrient.width;
      height = meta.autoOrient.height;
    } catch {
      skipped.push(file);
      continue;
    }

    const longSide = Math.max(width, height);
    const row: Record<string, string | number> = {
      file,
      width,
      height,
      // Same estimate the fallback check uses: the photo shows one full page.
      "est. px/mm": Number((longSide / ASSUMED_PAGE_LONG_SIDE_MM).toFixed(1)),
    };
    for (const scale of SCALES) {
      const result = checkResolution({
        width: Math.round((width * scale) / 100),
        height: Math.round((height * scale) / 100),
      });
      row[`${scale}%`] = result.pass ? "PASS" : "FAIL";
    }
    rows.push(row);
  }

  console.log(`Folder: ${folderPath}`);
  console.log(`${rows.length} photos checked, ${skipped.length} skipped (not readable as images)\n`);
  console.table(rows);
  if (skipped.length > 0) {
    console.log("\nSkipped files:");
    for (const file of skipped) console.log(`  - ${file}`);
  }
}

async function main() {
  const imagePath = process.argv[2];
  if (imagePath && statSync(imagePath).isDirectory()) {
    await runFolder(imagePath);
    return;
  }

  let original: Buffer;
  if (imagePath) {
    // rotate() with no angle applies the phone's orientation tag.
    original = await sharp(imagePath).rotate().png().toBuffer();
    console.log(`Sample image: ${imagePath}`);
  } else {
    original = await makeSyntheticImage();
    console.log("No image path given. Using a synthetic grid image.");
  }

  const meta = await sharp(original).metadata();
  const fullWidth = meta.width;
  const fullHeight = meta.height;
  console.log(`Original size: ${fullWidth} x ${fullHeight} pixels\n`);

  // Part 1: downscale and run the check at each size.
  const downscaleRows = [];
  const downscaled: { scale: number; buffer: Buffer; pass: boolean }[] = [];
  for (const scale of SCALES) {
    const width = Math.round((fullWidth * scale) / 100);
    const height = Math.round((fullHeight * scale) / 100);
    const buffer = await sharp(original).resize({ width, height, fit: "fill" }).png().toBuffer();
    const result = checkResolution({ width, height });
    downscaled.push({ scale, buffer, pass: result.pass });
    downscaleRows.push({
      "scale %": scale,
      width,
      height,
      result: result.pass ? "PASS" : "FAIL",
      measured: result.measured,
      required: result.required,
      reason: result.reason,
    });
  }
  console.log("Part 1: downscale, then check");
  console.table(downscaleRows);

  // Part 2: take each image that failed, upscale it back to the original
  // size, and compare the two methods.
  const upscaleRows = [];
  for (const item of downscaled) {
    if (item.pass) continue;
    for (const { name, kernel } of UPSCALE_KERNELS) {
      const buffer = await sharp(item.buffer)
        .resize({ width: fullWidth, height: fullHeight, fit: "fill", kernel })
        .png()
        .toBuffer();
      const result = checkResolution({ width: fullWidth, height: fullHeight });
      const error = traceError(original, buffer);
      upscaleRows.push({
        "from scale %": item.scale,
        method: name,
        width: fullWidth,
        height: fullHeight,
        "check after upscale": result.pass ? "PASS" : "FAIL",
        "trace error": error === null ? "not available (stub, needs #39/#40)" : error,
      });
    }
  }
  console.log("\nPart 2: upscale the failed images back to original size");
  if (upscaleRows.length === 0) {
    console.log("Nothing failed in part 1, so there is nothing to upscale.");
  } else {
    console.table(upscaleRows);
  }

  console.log(
    "\nNote: the check only counts pixels. Upscaling adds pixels but no new detail,\n" +
      "so 'check after upscale' does not show that upscaling helps. The trace error\n" +
      "column will answer that once trace extraction exists. In the app, always run\n" +
      "the check before any upscaling.",
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
