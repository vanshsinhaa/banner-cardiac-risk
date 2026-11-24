# Risk score display and review flow UX (Taiga #76, #75 redesign)

Story (#76): Dr. Chen wants the percentage risk score front and center in a clean,
MDCalc-style calculator layout, with a plain-language explanation of the
contributing factors below it, so she can read it quickly and defend it in a chart
note or to a patient.

## Flow

`Review trace → Confirm → Risk score`. A stepper at the top shows each step with a
number or check mark and its text, so color is never the only cue. The
research-use notice appears on every step.

1. **Review trace.** One lead at a time, zoomed to a 2.5 s window. The minimap shows
   where on the page you are. Each lead is marked "✓ Lead looks correct" and the
   progress bar counts checked leads. *Continue* unlocks once all leads are checked.
2. **Confirm.** Thumbnails of every lead, tagged "As detected" or "Corrected · n",
   with an *Edit* link on each. *Save trace and calculate risk* saves the
   correction, then requests the score.
3. **Risk score.** The score card (below), with *Back to trace review*.

Open it from the capture result (**Review trace and see risk score**) or at
`/trace-review`, the synthetic demo.

## Score card (`src/components/risk/RiskScoreCard.tsx`)

Order, top to bottom:

| Element | Why |
| --- | --- |
| Tags: *Research use only*, *Placeholder value* | Status visible before the number |
| "Estimated 10-year cardiac event risk" | Time horizon shown with the number (Fagerlin step 10) |
| **12%**, 56–80px, tabular numerals | Largest text on screen (task #76); whole numbers only, no false precision |
| Band chip: icon + "Intermediate risk" | Text and icon shape, not color alone (GOV.UK pattern) |
| "About 12 in 100 people…" | Absolute risk with a fixed denominator (Fagerlin; IPDAS) |
| 10×10 icon array + band scale | Pictographs are understood faster than charts; the scale shows where the result sits |
| "What drove this result" | Plain-language factors with ↑/↓ and "Raises risk"/"Lowers risk" text |
| "How this was calculated" (collapsed) | Model version, trace used (corrected or auto), time, cut-offs; detail collapsible (CDS Hooks) |
| Research-use notice | Persistent, never behind a toggle |

Visual choices:
- The card is neutral (white or dark surface). Only the band chip, a 4px leading
  edge and the dots take the band color, following MDCalc's "more white" redesign.
- The spacing scale is 4/8/12/16/24/32/48px.
- The tokens are in `src/app/globals.css` and are shared by the capture screen,
  the review flow and the score card (see "Visual system" below).
- Every text/background pair, light and dark, was checked at ≥ 4.5:1 contrast
  (WCAG AA).

## Visual system (2026-11-24 restyle)

Feedback: the app looked generic ("vibecoded") and the capture and review screens
did not look like one product. Changes:

- **Type.** Inter for UI text and IBM Plex Mono for measurements, ids, times and
  step counters, loaded with `next/font` in `src/app/layout.tsx`. Before this the
  pages fell back to Arial because `--font-geist-sans` was never defined.
- **Palette ("clinical slate").** Cool grey neutrals, one signal-blue accent
  (`#0a5bd3` light, `#4d8dff` dark), green only for "checked", amber only for the
  research notice, and band colours only on the score. This follows the calm,
  single-accent look of clinical review tools (Philips IntelliSpace ECG, GE MUSE)
  and modern clinical apps (Abridge, Eko). These are reference points for the
  general style; no layouts or assets were copied.
- **App bar.** `src/components/shell/AppBar.tsx` is a dark navy product bar
  (mark, product name, section, status chips, exit action) used on both the
  capture and review screens.
- **Surfaces.** 12px card radius, 8px controls, hairline borders and light shadows.
  The editor card has a header, an instruction strip, the canvas, a legend and a
  footer toolbar.
- **Trace colour.** The editable trace is now blue, which stands out from the red
  grid of printed EKG paper better than orange did.
- **Lead picker.** Four columns that match the printed 3×4 page
  (I aVR V1 V4 / II aVL V2 V5 / III aVF V3 V6).

## Data contract (`src/lib/riskScore/contract.ts`)

`POST /api/risk-score` with `{ traceSource: "auto" | "corrected" }` returns
`RiskScoreResult`:

- `schema` and `status` (`placeholder` | `validated`)
- `riskPercent` and `horizonYears`
- `band` and `factors[]` (each with `label`, `value`, `effect` and `explanation`)
- `modelVersion`, `traceSource` and `generatedAt`

Today it always returns a fixed placeholder: 12%, 10 years, with illustrative
factor values based on the #72–#74 metrics. A real model only has to return the
same shape. The band cut-offs (<5, 5–7.5, 7.5–20, ≥20%) borrow the familiar ASCVD
categories as placeholders until the model has calibrated bands.

## Trace editor changes (feedback: nodes too small, UI confusing)

- **One lead, zoomed.** Points are about 30px apart on screen instead of 8px. The
  10 s rhythm strip pages through 2.5 s windows.
- **Handles.** Drawn at 14px and grabbed anywhere within 22px of the pointer (a
  44px target; WCAG 2.5.8 requires at least 24px). The nearest point wins, so no
  exact hit is needed. Hover enlarges the point and adds a halo, and the cursor
  changes to grab, grabbing or add.
- **Adding points.** Click within 16px of the line.
- **Line accuracy.** The blue line is drawn from the full-resolution samples,
  so it sits on the printed waveform. The dashed line is the original detection.
- **Instructions.** A strip above the canvas says what to do in the current state.
- **Toolbar.** Undo, Redo (Ctrl+Z / Ctrl+Shift+Z, also logged), Delete point and
  Reset lead.
- **Hidden by default.** Alignment sliders sit under "Line not on top of the
  waveform?" and the edit log under "Change history".

## Sources

Read for this design:
- [WCAG 2.2 Understanding 2.5.8 Target Size (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)
- [CDS Hooks 2.0: card summary, indicator, collapsible detail](https://cds-hooks.hl7.org/2.0/)
- [GOV.UK Design System: warning text](https://design-system.service.gov.uk/components/warning-text/)
- [Fagerlin, Zikmund-Fisher & Ubel, "Helping patients decide: ten steps to better risk communication"](https://pmc.ncbi.nlm.nih.gov/articles/PMC3218625)
- [MDCalc blog: "Nipped and tucked", frontend update](https://blog.mdcalc.com/post/mdcalc-nipped-and-tucked-our-biggest-frontend-update-in-years)

Seen only as search summaries, so treat them as supporting evidence:
- the IPDAS Chapter C guidance on consistent denominators
- a 2014 Annals of Internal Medicine review of risk formats
- a 2024 Medical Decision Making study on icon-array color

The specific pixel sizes (64px number, 44px targets) are common design-system
conventions, not taken from MDCalc.

## Limits

- The score is a placeholder. The UI labels it as such in two places.
- The factor values are illustrative, not measured from the trace.
- Light mode was checked with contrast calculations. The browser walkthrough was
  done in dark mode.
