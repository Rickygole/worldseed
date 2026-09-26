import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

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

export const metadata: Metadata = {
  title: "WorldSeed - Key Bridge Region",
  description:
    "Don't predict the future. Simulate it. A counterfactual decision engine for emergency-response planning in the Key Bridge region of Baltimore.",
};

export const viewport: Viewport = {
  themeColor: "#0A0E14",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrains.variable} h-full`}>
      <body className="h-full">{children}</body>
    </html>
  );
}
