import { notFound } from "next/navigation";
import WaveValidationDemo from "@/components/WaveValidationDemo";

// Development-only demo of the #64 validator. Not available in production builds.
export default function WaveValidationPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <WaveValidationDemo />;
}
