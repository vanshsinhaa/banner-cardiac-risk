This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Project progress and Sprint 3

The [project tracker](project%20docs/TRACKER.md) records Vansh's work newest first,
with dated decisions, verification, and remaining team handoffs. Sprint 3 details:
[image metadata removal (#48)](project%20docs/task-48-metadata.md),
[key management (#52)](project%20docs/task-52-key-management.md), and
[reproducible instructor demo](project%20docs/verification-2026-10-26.md).

## EKG upload API prototype and CI

`services/upload-api/` holds a small Python (FastAPI) service that checks an
uploaded EKG photo is a real PNG or JPEG. It is separate from the Next.js app.
GitHub Actions (`.github/workflows/upload-api-ci.yml`) runs its tests on every
push and pull request, then builds its Docker image only if the tests pass.
It removes embedded metadata from accepted PNG/JPEG uploads before further
processing and can return the sanitized PNG. It does not remove printed patient
text, verify EKG content, or score risk. Setup, commands, and limits:
[services/upload-api/README.md](services/upload-api/README.md).

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
