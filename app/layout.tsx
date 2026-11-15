import type { Metadata, Viewport } from "next";
import { AppShell } from "@/components/AppShell";
import "./globals.css";

export const metadata: Metadata = {
  title: "MogMine — Trade Review",
  description: "Chart-first futures trade review.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "MogMine", statusBarStyle: "black-translucent" },
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
    <html lang="en" data-gold-preset="bullion" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: applyPrefs }} /></head>
      <body><AppShell>{children}</AppShell></body>
    </html>
  );
}
