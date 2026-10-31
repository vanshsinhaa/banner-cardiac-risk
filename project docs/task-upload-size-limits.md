# Image size limits: findings and proposed follow-up

Date: 2026-10-31. Owner: Vansh. Status: **documented proposal; limits unchanged**.

Review of the combined EKG app exposed the 10 MB file-size restriction. This note
records its purpose, the JPEG-to-PNG mismatch, and options before changing the
shared service contract.

## Current behavior

The code's "10 MB" means `10 * 1024 * 1024` bytes (10 MiB). This configurable
resource guard bounds upload traffic and helps control memory and processing
time. It does not measure image quality or establish an EKG algorithm requirement.
Integration preserved existing service caps; no runtime limits change in this note.

| Stage | Current guard |
| --- | --- |
| Browser file selection | 10 MiB original file |
| Browser crop/privacy/analysis payloads | 10 MiB processed PNG |
| Next.js privacy, readability, and digitizer routes | 10 MiB image; bounded multipart overhead where applicable |
| Python upload API | 10 MiB input, 50 million decoded pixels, 64 MiB sanitized PNG output |
| Next.js sanitizer handoff | Rejects sanitized PNG above 10 MiB despite the larger sanitizer output allowance |
| Python readability decoder | 10 MiB PNG, 24 million decoded pixels |
| Python digitizer | 10 MiB image |
| Local visual demo proxy | Mirrors 10 MiB; outside the published integration code |

A small JPEG can pass selection and exceed the processing cap after rebuilding
as PNG. The 24/50 megapixel mismatch also needs an end-to-end decision.

## Local measurements

Three repository JPEGs were decoded, orientation-corrected, and encoded as
full-resolution PNG using installed Sharp. These are **whole-image conversions**,
not measurements of a particular manually selected crop. No image was sent to
a remote service or silently resized.

| Image in `public/camera-ecgs/` | JPEG (MiB) | PNG (MiB) | Source dimensions |
| --- | ---: | ---: | --- |
| `photos_bents__img_17_page_0.jpeg` | 4.23 | 23.54 | 4624 x 3468 |
| `photos_doogee__img_11_page_0.jpeg` | 6.03 | 22.73 | 3120 x 4160; orientation applied on export |
| `photos_crumbles__img_14_page_0.jpeg` | 3.40 | 23.53 | 4624 x 3468 |

PNG preserves decoded pixels without another lossy JPEG encode; it cannot recover
information already lost in the source JPEG. Encoded bytes do not measure decoded
memory: 6000 x 4000 RGBA pixels alone occupy 96,000,000 bytes (about 91.6 MiB),
before worker copies and temporary buffers.

## Options and recommendation

| Option | Benefit | Cost / validation |
| --- | --- | --- |
| Raise all byte caps equally | Simple; preserves dimensions | Higher memory/network use; still conflates original and processed sizes |
| **Separate original and processed caps** | Fits photo input and larger lossless PNGs | Align every stage and benchmark memory/time; recommended direction |
| Improve lossless PNG compression/filtering | Can reduce bytes while preserving decoded pixels | More CPU; measure real camera photos, not only synthetic pages |
| Automatically resize or re-encode JPEG | Smaller transfers and processing | Changes image information; validate grid, thin traces, OCR and waveform fidelity first |

Proposed benchmark starting points: **32 MiB original files** and **64 MiB
processed PNGs**, plus explicit decoded-pixel/memory limits and timeouts.
These are provisional targets, not approved capacity guarantees or implemented
configuration. Keep the original-photo resolution check (#44).

Sharp distinguishes PNG compression/filtering from palette quantization:
[PNG options](https://sharp.pixelplumbing.com/api-output/#png).
Pixel limits are a separate control:
[input pixel limit](https://sharp.pixelplumbing.com/api-constructor/#new).

## Follow-up acceptance checks

1. Agree with Faith, Roberto and Arsen on original, processed, decoded-pixel and
   response budgets. Benchmark concurrent requests and browser/server base64 copies.
2. Name stage-specific configuration and align browser, all Next.js routes,
   Python services, multipart overhead, responses and the local demo.
3. Test ordinary phone photos, byte boundaries, excessive dimensions, misleading
   Content-Length and interrupted uploads. Reject excessive work before processing.
4. Compare dimensions and decoded pixels on lossless paths. Assess waveform,
   grid and OCR results separately before enabling JPEG conversion or downscaling.
5. Benchmark representative devices, peak memory and concurrency before fixing
   deployment limits; account for both 24 MP and 50 MP guards currently in use.
6. Show actual size, allowed size and failing stage. Explain when the original
   photo passed but the generated PNG exceeded its processing allowance.

Resolve or explicitly scope this follow-up before merging to main. It does not
block draft PR publication. The real de-identification backend, model validation,
canonical schema mapping and phone acceptance remain separate gates in
[the integration review](../docs/integration-review.md).
