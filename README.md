This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## ECG digitizer backend skeleton

The capture screen submits the cropped image as multipart form data to
`POST /api/ecg/digitize`, using the `image` field. The endpoint accepts JPEG,
PNG, or WebP images up to 10 MB. Its response contract is defined by
`src/lib/ecg-digitizer/types.ts`: per-lead waveform samples, sampling rate in
Hz, and sample units in mV.

The integration adapter in `src/lib/ecg-digitizer/digitize.ts` is intentionally
unimplemented. It returns an explicit HTTP 501 until the team's digitizer is
connected; it does not invent ECG measurements. Replace that adapter with the
team's actual processing call. Uploaded images are not persisted by this
skeleton.

## ECG digitizer service setup

The digitizing itself is done by the open source
[Open-ECG-Digitizer](https://github.com/Ahus-AIM/Open-ECG-Digitizer), a Python
tool. `digitizer-service/server.py` wraps it in a small local API with one
endpoint, `POST /digitize`, meant to be called by the Next.js backend. The tool
is not included in this repo, so each developer clones it once.

Requirements: Python 3.12, git, and [Git LFS](https://git-lfs.com) (for the
model weights).

1. From the root of this repo, clone the tool at the version the service was
   tested with. The folder must be named `Open-ECG-Digitizer` and sit next to
   `digitizer-service/`:

   ```bash
   git clone https://github.com/Ahus-AIM/Open-ECG-Digitizer.git
   cd Open-ECG-Digitizer
   git checkout 97a1508
   ```

2. Download the model weights (about 110 MB):

   ```bash
   git lfs pull
   ```

3. Create the Python environment and install the packages:

   ```bash
   python3.12 -m venv .venv
   .venv/bin/pip install -r requirements.txt
   .venv/bin/pip install fastapi uvicorn python-multipart
   ```

4. Start the service. Run this from inside `Open-ECG-Digitizer/`:

   ```bash
   PYTORCH_ENABLE_MPS_FALLBACK=1 .venv/bin/python -m uvicorn server:app \
       --app-dir ../digitizer-service --host 127.0.0.1 --port 8000
   ```

   It is ready when it prints `Digitizer loaded on ...`.

5. Test it from the root of this repo:

   ```bash
   curl -F image=@public/camera-ecgs/photos_bents__img_17_page_0.jpeg \
       http://127.0.0.1:8000/digitize | head -c 300
   ```

   After about 10 seconds it should print JSON starting with `{"leads":{"I":[`.

Notes:

- The service picks an NVIDIA GPU if there is one, then an Apple Silicon GPU,
  then the CPU.
- `RESAMPLE_SIZE` in `server.py` caps the image's longest side at 2000 px. The
  tool's default of 3000 ran out of memory on an 18 GB laptop; raise it only on
  a machine with a dedicated GPU.
- For every digitized image the service saves a comparison plot to
  `digitizer-service/trace-plots/` (ignored by git): the original image, the
  straightened image, the detected trace pixels, and the digitized traces. Next
  to it, `<name>_t-waves.png` shows each lead's median beat with its T wave
  shaded and its peak marked (from `t_wave.py`; needs `neurokit2` in the
  digitizer's `.venv`). Set `SAVE_TRACE_PLOTS = False` in `server.py` to turn
  both off.
- The digitizer always returns 5000 samples per lead. The service works out the
  real sampling rate from the strip's measured width and the paper speed, which
  defaults to 25 mm/s. For a 50 mm/s printout, send `paper_speed=50` as a form
  field next to `image`, e.g.
  `curl -F image=@ecg.png -F paper_speed=50 http://127.0.0.1:8000/digitize`.
- The Next.js adapter in `src/lib/ecg-digitizer/digitize.ts` calls this service
  when `ECG_DIGITIZER_URL=http://127.0.0.1:8000` is set in `.env.local`.
- Open-ECG-Digitizer is licensed under CC BY-SA 4.0 and asks that its paper be
  cited; see its README.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
