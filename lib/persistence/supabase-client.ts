// #176: the browser Supabase client for the `supabase` persistence adapter. Anon (publishable) key plus the
// signed-in session only; the service-role key is server-only and never imported here. Loaded lazily by
// `select.ts`, so the default `local` / `mock` modes never download the SDK.
import { createClient } from "@supabase/supabase-js";
import type { SupabaseLike } from "./supabase-adapter.ts";

export function supabaseEnv(env: Record<string, string | undefined> = {
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
}): { url: string; anonKey: string } | null {
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  return url && anonKey ? { url, anonKey } : null;
}

let browserClient: SupabaseLike | null = null;

/** One client per page load. Throws when the env vars are missing; the adapter turns that into `unavailable`. */
export function getBrowserSupabase(): SupabaseLike {
  if (browserClient) return browserClient;
  const env = supabaseEnv();
  if (!env) throw new Error("NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set for the supabase adapter.");
  browserClient = createClient(env.url, env.anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  }) as unknown as SupabaseLike;
  return browserClient;
}
