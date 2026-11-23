"use client";
// #185b: header link to /settings/agent. Renders nothing when the gate is off (local, mock), like SignOutButton.
import Link from "next/link";
import { isAuthGateOn } from "@/lib/auth/auth";

// NEXT_PUBLIC_* values are inlined at build time, so this is a constant in the browser bundle.
const GATE_ON = isAuthGateOn(process.env.NEXT_PUBLIC_PERSISTENCE_ADAPTER);

export function AgentKeysLink() {
  if (!GATE_ON) return null;
  return (
    <Link href="/settings/agent" className="icon-button" style={{ minHeight: 44, minWidth: 44 }} aria-label="Agent keys" title="Agent keys">
      <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="7.5" cy="15.5" r="4" /><path d="M10.5 12.5L20 3M16 7l3 3M14 9l2 2" /></svg>
    </Link>
  );
}
