import type { Metadata } from "next";
import { TuneScreen } from "@/components/TuneScreen";

export const metadata: Metadata = { title: "Tune — MogMine" };

export default function TunePage() {
  return <TuneScreen />;
}
