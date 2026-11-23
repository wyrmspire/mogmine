// #176: the browser Supabase client for the `supabase` persistence adapter. Anon (publishable) key plus the
// signed-in session only; the service-role key is server-only and never imported here. Loaded lazily by
// `select.ts` and `components/useAuth.ts`, so the default `local` / `mock` modes never download the SDK.
// #182: sign-in uses the IMPLICIT flow (magic link, token in the URL hash), not the code-exchange flow. iPhone Mail
// opens links in a different browser from the one that asked for them, so a code verifier stored in this browser is
// lost and the link fails. The implicit flow needs no verifier: supabase-js reads `#access_token` from /login itself
// (`detectSessionInUrl`). This file is the ONLY `createClient` call in the app.
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SupabaseLike } from "./supabase-adapter.ts";

export function supabaseEnv(env: Record<string, string | undefined> = {
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
}): { url: string; anonKey: string } | null {
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  return url && anonKey ? { url, anonKey } : null;
}

let browserClient: SupabaseClient | null = null;

/** One real client per page load. Throws when the env vars are missing. */
export function getBrowserSupabaseClient(): SupabaseClient {
  if (browserClient) return browserClient;
  const env = supabaseEnv();
  if (!env) throw new Error("NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set for the supabase adapter.");
  browserClient = createClient(env.url, env.anonKey, {
    auth: { flowType: "implicit", detectSessionInUrl: true, persistSession: true, autoRefreshToken: true },
  });
  return browserClient;
}

/** The adapter's view of the same client. The adapter throws-to-`unavailable` when the env vars are missing. */
export function getBrowserSupabase(): SupabaseLike {
  return getBrowserSupabaseClient() as unknown as SupabaseLike;
}
