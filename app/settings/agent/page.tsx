import type { Metadata } from "next";
import { AgentKeysScreen } from "@/components/AgentKeysScreen";

export const metadata: Metadata = { title: "Agent keys — MogMine" };

// #185b: behind AuthGate like every page. With `local` or `mock` it shows that the Supabase adapter is needed.
export default function AgentKeysPage() {
  return <AgentKeysScreen />;
}
