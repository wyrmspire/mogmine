"use client";
// #182: header sign-out for the `supabase` adapter. Renders nothing when the gate is off (local, mock).
import { isAuthGateOn } from "@/lib/auth/auth";
import { signOutToLogin } from "./useAuth";

// NEXT_PUBLIC_* values are inlined at build time, so this is a constant in the browser bundle.
const GATE_ON = isAuthGateOn(process.env.NEXT_PUBLIC_PERSISTENCE_ADAPTER);

export function SignOutButton() {
  if (!GATE_ON) return null;
  return (
    <button type="button" className="icon-button" style={{ minHeight: 44, minWidth: 44 }} aria-label="Sign out" title="Sign out" onClick={() => void signOutToLogin()}>
      <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4" /><path d="M15 8l4 4-4 4M19 12H9" /></svg>
    </button>
  );
}
