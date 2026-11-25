import type { Metadata } from "next";
import { Suspense } from "react";
import { PlaybookLab } from "@/components/PlaybookLab";

export const metadata: Metadata = { title: "Playbook Lab — MogMine" };

// useSearchParams needs a Suspense boundary for static rendering; the Lab shows its own loading state.
export default function PlaybookLabPage() {
  return (
    <Suspense fallback={<div className="page lab-page" role="status" aria-label="Loading playbook lab"><div className="skeleton" style={{ height: 320 }} aria-hidden="true" /></div>}>
      <PlaybookLab />
    </Suspense>
  );
}
