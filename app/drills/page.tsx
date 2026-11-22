import type { Metadata } from "next";
import { DrillScreen } from "@/components/DrillScreen";

export const metadata: Metadata = { title: "Drills — MogMine" };

export default function DrillsPage() {
  return <DrillScreen />;
}
