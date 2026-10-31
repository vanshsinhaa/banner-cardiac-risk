import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "EKG Capture",
  description: "Capture and crop an EKG strip.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
