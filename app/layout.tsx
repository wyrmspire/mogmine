import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { AppShell } from "@/components/AppShell";
import { AuthGate } from "@/components/AuthGate";
import "./globals.css";
import "./chart-polish.css";
import "./lab.css";
import "./review-day.css";
import "./levels.css";

// Loaded by next/font (self-hosted at build time, no runtime request to Google).
// globals.css builds --font-sans / --font-mono on top of these variables.
const inter = Inter({ subsets: ["latin"], display: "swap", variable: "--font-inter" });
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], display: "swap", variable: "--font-jetbrains-mono" });

export const metadata: Metadata = {
  title: "MogMine — Trade Review",
  description: "Chart-first futures trade review.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "MogMine", statusBarStyle: "black-translucent" },
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

// Page zoom stays enabled: it is an accessibility feature (UX-44).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#07080c",
};

// Applies the stored visual tuning before first paint, so a saved preset or palette never flashes.
const applyPrefs = `try{var p=JSON.parse(localStorage.getItem("mogmine-prefs-v1")||"{}"),r=document.documentElement;if(p.goldPreset)r.dataset.goldPreset=p.goldPreset;if(p.palette)r.dataset.palette=p.palette;if(typeof p.goldIntensity==="number")r.style.setProperty("--gold-intensity",p.goldIntensity);if(typeof p.boxOpacity==="number")r.style.setProperty("--position-box-opacity",p.boxOpacity)}catch(e){}`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-gold-preset="bullion" className={`${inter.variable} ${jetbrainsMono.variable}`} suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: applyPrefs }} /></head>
      <body><AuthGate><AppShell>{children}</AppShell></AuthGate></body>
    </html>
  );
}
