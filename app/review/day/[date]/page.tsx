import type { Metadata } from "next";
import { Suspense } from "react";
import { DayReviewScreen } from "@/components/DayReviewScreen";

export const metadata: Metadata = { title: "Day review — MogMine" };

export default async function DayReviewPage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  return <Suspense><DayReviewScreen date={date} /></Suspense>;
}
