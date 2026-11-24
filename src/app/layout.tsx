import type { Metadata } from "next";
import { IBM_Plex_Mono, Inter } from "next/font/google";
import "./globals.css";

// Inter for UI text (used by Abridge, Linear and most modern clinical dashboards);
// IBM Plex Mono for measurements, times and lead metadata.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: "EKG Capture",
  description: "Capture and crop an EKG strip.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} ${plexMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
