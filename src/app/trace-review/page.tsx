import type { Metadata } from "next";
import TraceOverlayEditor from "@/components/trace/TraceOverlayEditor";
import type { EcgDigitizationResult } from "@/lib/ecg-digitizer/types";
import demo from "@/lib/traceOverlay/fixtures/demo-digitization.json";

export const metadata: Metadata = {
  title: "Trace review demo",
  description: "Review and correct a detected EKG trace on synthetic data.",
};

// Demo route for #75 that does not need the digitizer service running. The image and
// samples are the team's synthetic fixture (scripts/makeFullFlowFixture.py and
// scripts/makeTraceReviewFixture.py) with a few deliberate digitizer mistakes in
// leads I, aVF and V2. No patient data.
export default function TraceReviewDemoPage() {
  return (
    <main>
      <p style={{ margin: "16px 16px 0", padding: "8px 12px", borderRadius: 6, background: "rgba(245, 158, 11, 0.15)" }}>
        Demo with synthetic data. Leads I, aVF and V2 contain deliberate detection errors to correct.
      </p>
      <TraceOverlayEditor imageSrc="/synthetic-ecgs/standard-12-lead.png"
        digitization={demo as unknown as EcgDigitizationResult} captureId="demo-synthetic-0001" />
    </main>
  );
}
