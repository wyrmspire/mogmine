import type { Metadata } from "next";
import { Suspense } from "react";
import { ChallengeDetail } from "@/components/ChallengeDetail";

export const metadata: Metadata = { title: "Challenge — MogMine" };

export default async function ChallengeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <Suspense>
      <ChallengeDetail id={id} />
    </Suspense>
  );
}
