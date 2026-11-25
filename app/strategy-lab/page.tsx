import type { Metadata } from "next";
import { Suspense } from "react";
import { StrategyLabWorkspace } from "@/components/StrategyLabWorkspace";

export const metadata: Metadata = { title: "Strategy Lab — MogMine" };

// useSearchParams inside StrategyLabWorkspace needs a Suspense boundary so /strategy-lab prerenders cleanly.
export default function StrategyLabPage() {
  return (
    <main className="sl-page">
      <h1 className="sl-title">Strategy Lab</h1>
      <Suspense fallback={<div className="sl-skeleton" role="status" aria-label="Loading Strategy Lab" />}>
        <StrategyLabWorkspace />
      </Suspense>
    </main>
  );
}
