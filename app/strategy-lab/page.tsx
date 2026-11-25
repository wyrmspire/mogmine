import type { Metadata } from "next";
import { StrategyLabMark } from "@/components/StrategyLabMark";

export const metadata: Metadata = { title: "Strategy Lab — MogMine" };

// Mark a point, then read the Context Card for it (docs/design-2026-11-24/09 §12.1–§12.2).
export default function StrategyLabPage() {
  return (
    <main className="sl-page">
      <h1 className="sl-title">Strategy Lab</h1>
      <StrategyLabMark />
    </main>
  );
}
