import type { Metadata } from "next";
import { ReviewScreen } from "@/components/ReviewScreen";

export const metadata: Metadata = { title: "Review — MogMine" };

export default function ReviewPage() {
  return <ReviewScreen />;
}
