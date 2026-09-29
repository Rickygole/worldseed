import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import "./globals.css";

// All three faces are SIL OFL 1.1 and self-hosted by next/font (downloaded at build time, served from this origin).
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  display: "swap",
});

// Display face: big numbers and scene headlines only.
const grotesk = Space_Grotesk({
  variable: "--font-grotesk",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "WorldSeed - Key Bridge Region",
  description:
    "Don't predict the future. Simulate it. A counterfactual planning simulator for the Key Bridge region of Baltimore: remove a road link and see who is affected, computed in your browser on historical open data.",
};

export const viewport: Viewport = {
  themeColor: "#070B12",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrains.variable} ${grotesk.variable} h-full`}>
      <body className="h-full">{children}</body>
    </html>
  );
}
