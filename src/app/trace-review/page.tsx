import type { Metadata } from "next";
import ReviewFlow from "@/components/review/ReviewFlow";
import type { EcgDigitizationResult } from "@/lib/ecg-digitizer/types";
import demo from "@/lib/traceOverlay/fixtures/demo-digitization.json";

export const metadata: Metadata = {
  title: "EKG review demo",
  description: "Review a detected EKG trace and see the placeholder risk score, on synthetic data.",
};

// Demo of the review flow (#75 trace review, #76 risk score) that does not need the
// digitizer service. The image and samples are the team's synthetic fixture
// (scripts/makeFullFlowFixture.py, scripts/makeTraceReviewFixture.py) with deliberate
// detection errors in leads I, aVF and V2. No patient data.
export default function TraceReviewDemoPage() {
  return (
    <ReviewFlow imageSrc="/synthetic-ecgs/standard-12-lead.png"
      digitization={demo as unknown as EcgDigitizationResult} captureId="demo-synthetic-0001"
      demoNote="Synthetic data. Leads I, aVF and V2 contain deliberate detection errors to correct." />
  );
}
