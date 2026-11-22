import type { Metadata } from "next";
import { PlaybookBinder } from "@/components/PlaybookBinder";

export const metadata: Metadata = { title: "Playbooks — MogMine" };

export default function PlaybooksPage() {
  return <PlaybookBinder />;
}
