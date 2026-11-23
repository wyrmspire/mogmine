"use client";
// #182: the sign-in state for the `supabase` adapter. With any other adapter the hook returns `off` and never
// imports the Supabase SDK, so `local` and `mock` render exactly as before. The SDK is loaded with a dynamic import
// only when the gate is on.
import { useCallback, useEffect, useState } from "react";
import { checkAllowed, isAuthGateOn, signOutUser } from "@/lib/auth/auth";
import type { AuthClientLike, AuthStatus } from "@/lib/auth/auth";

// NEXT_PUBLIC_* values are inlined at build time, so this is a constant in the browser bundle.
const GATE_ON = isAuthGateOn(process.env.NEXT_PUBLIC_PERSISTENCE_ADAPTER);
const ENV_MESSAGE = "Sign-in isn't configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.";
const CHECK_MESSAGE = "Couldn't check sign-in. Check your connection and try again.";

let clientPromise: Promise<AuthClientLike> | null = null;

/** The one browser client, typed for the auth code. A failed load is not cached, so a later call can retry. */
export function getAuthClient(): Promise<AuthClientLike> {
  if (!clientPromise) {
    clientPromise = import("@/lib/persistence/supabase-client")
      .then((module) => module.getBrowserSupabaseClient() as unknown as AuthClientLike)
      .catch((error: unknown) => {
        clientPromise = null;
        throw error;
      });
  }
  return clientPromise;
}

type SessionLike = { user: { id: string; email?: string | null } } | null;

/** Signs out, then leaves for /login. Shared by the header button, the login screen and NotAuthorized. */
export async function signOutToLogin(): Promise<void> {
  try {
    await signOutUser(await getAuthClient());
  } catch {
    // Leave anyway: /login shows the signed-out form.
  }
  window.location.replace("/login"); // full reload; the signed-in page stays out of history
}

export interface AuthState {
  status: AuthStatus;
  email: string | null;
  /** Friendly message for the `error` status. */
  message: string | null;
}

const SIGNED_OUT: AuthState = { status: "signed-out", email: null, message: null };

export function useAuth(): AuthState & { retry(): void } {
  const [state, setState] = useState<AuthState>(() => ({ status: GATE_ON ? "loading" : "off", email: null, message: null }));
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!GATE_ON) return;
    let alive = true;
    let latest = 0; // only the newest allow-list check may write state
    let unsubscribe: (() => void) | null = null;

    const apply = async (client: AuthClientLike, session: SessionLike) => {
      const token = ++latest;
      if (!session) {
        if (alive) setState(SIGNED_OUT);
        return;
      }
      const email = session.user.email ?? null;
      if (alive) setState({ status: "checking", email, message: null });
      const result = await checkAllowed(client, session.user.id);
      if (!alive || token !== latest) return;
      setState({ status: result, email, message: result === "error" ? CHECK_MESSAGE : null });
    };

    const load = async () => {
      let client: AuthClientLike;
      try {
        client = await getAuthClient();
      } catch {
        if (alive) setState({ status: "error", email: null, message: ENV_MESSAGE });
        return;
      }
      if (!alive) return;
      const { data } = client.auth.onAuthStateChange((_event, session) => {
        void apply(client, session);
      });
      unsubscribe = () => data.subscription.unsubscribe();
      try {
        const { data: result, error } = await client.auth.getSession();
        if (!alive) return;
        if (error) {
          setState({ status: "error", email: null, message: CHECK_MESSAGE });
          return;
        }
        await apply(client, result.session);
      } catch {
        if (alive) setState({ status: "error", email: null, message: CHECK_MESSAGE });
      }
    };

    void load();
    return () => {
      alive = false;
      unsubscribe?.();
    };
  }, [attempt]);

  const retry = useCallback(() => {
    setState({ status: "loading", email: null, message: null });
    setAttempt((value) => value + 1);
  }, []);

  return { ...state, retry };
}
