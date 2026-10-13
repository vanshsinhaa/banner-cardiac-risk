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

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Automatic preprocessing and OCR after cropping

Install the local Python dependencies and Tesseract once (macOS):

```bash
python3 -m venv preprocessing/venv
preprocessing/venv/bin/python -m pip install -r preprocessing/requirements.txt
brew install tesseract
npm ci
npm run dev
```

Open http://localhost:3000, select an image containing all 12 lead labels, adjust
its crop, and choose **Confirm crop & check**. The app shows a loading state,
then Passed, Failed (resolution/contrast), or Needs review (incomplete OCR),
confirmed/uncertain labels, and the processed image.
**Check unavailable** means processing/OCR could not complete; retry after
checking the server setup. Save downloads the processed image when available.

The local `POST /api/analyze` route sends the PNG to `preprocessing/analyze.py`
using a Python subprocess. Images travel through memory/stdin; this endpoint
does not persist them. It finds a page boundary and rectifies it if possible,
runs several bounded OCR passes before lighting enhancement, corrects reading
orientation, and then normalizes lighting. Without a
boundary it uses the manual crop and still normalizes lighting. It never upscales
a crop to pass the minimum-resolution threshold.

The default check requires all 12 labels, a short side of at least 600 pixels,
OCR confidence of at least 70 and label height of at least 10 pixels. Passing
establishes label readability only, not waveform accuracy or a medical result.

The route uses `preprocessing/venv/bin/python` (or `venv/Scripts/python.exe` on
Windows), falling back to `python3`. Set `ECG_PYTHON` to override the executable.
Tesseract must be on the server's PATH. Restart Next.js after changing setup.
The app needs a Node server with Python/OpenCV/Tesseract installed; this local
subprocess integration is not a static-site or Edge deployment.

Requests are limited to 48 MB and 24 million decoded pixels, accommodating the
supplied full-resolution phone photos without upscaling or discarding labels. The server stops
processing after 45 seconds; the browser allows 60 seconds for the request.

Validation:

```bash
preprocessing/venv/bin/python -B -m unittest discover -s preprocessing -p 'test_*.py' -v
npm run lint
npm run build
```

Unit tests mock OCR for deterministic pass/fail checks. For a manual check, try
a full ECG, a crop smaller than 600 pixels on one side (Failed), and a crop
missing labels (Needs review). Use Adjust crop to retry and Capture another for a new
image. Confirm the saved image matches the displayed processed result.

The default crop now selects the whole photo to preserve edge labels. The OCR
coverage evaluation and remaining limitations are documented in
`preprocessing/README.md`; **none of the supplied 50 photos yet meets the strict
all-12-label automatic-pass criterion**. Needs review does not mean a bad scan,
and it does not bypass the downstream acceptance gate.
