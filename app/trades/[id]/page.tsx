import type { Metadata } from "next";
import { Suspense } from "react";
import { TradeDetail } from "@/components/TradeDetail";

export const metadata: Metadata = { title: "Trade — MogMine" };

export default async function TradePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Suspense><TradeDetail id={id} /></Suspense>;
}
