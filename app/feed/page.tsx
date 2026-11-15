import type { Metadata } from "next";
import { Suspense } from "react";
import { FeedScreen } from "@/components/FeedScreen";

export const metadata: Metadata = { title: "Feed — MogMine" };

export default function FeedPage() {
  return <Suspense><FeedScreen /></Suspense>;
}
