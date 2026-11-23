// #182: sign-in for the `supabase` adapter. Pure logic only (no React, no SDK import) so it is testable in node.
// The browser client is passed in as `AuthClientLike`; `components/useAuth.ts` supplies the real one.
// Decided design (issue #182): email magic LINK over the implicit flow. No code-verifier flow, no typed code, no
// code-exchange call. Sign-ups are off (`shouldCreateUser: false`). The gate only runs in `supabase` mode.
// Allow-list: a signed-in user is allowed iff their own `mogmine_allowed_users` row is readable (RLS, docs/26 §7).
import { chooseAdapter } from "../persistence/select.ts";

export type AuthStatus = "off" | "loading" | "signed-out" | "checking" | "not-authorized" | "allowed" | "error";

interface AuthUserLike { id: string; email?: string | null }

export interface AuthClientLike {
  auth: {
    getSession(): Promise<{ data: { session: { user: AuthUserLike } | null }; error?: { message: string } | null }>;
    onAuthStateChange(cb: (event: string, session: { user: AuthUserLike } | null) => void): { data: { subscription: { unsubscribe(): void } } };
    signInWithOtp(args: { email: string; options: { shouldCreateUser: boolean; emailRedirectTo: string } }): Promise<{ error: { message: string; status?: number; code?: string } | null }>;
    signOut(): Promise<{ error: { message: string } | null }>;
  };
  from(table: string): { select(cols: string): { eq(col: string, v: string): { maybeSingle(): PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }> } } };
}

export const ALLOW_LIST_TABLE = "mogmine_allowed_users";

export const RATE_LIMIT_MESSAGE = "Too many sign-in emails. Supabase allows 2 an hour; try again later.";
export const NOT_SET_UP_MESSAGE = "That email isn't set up for MogMine.";
export const GENERIC_SEND_MESSAGE = "Couldn't send the sign-in link. Check your connection and try again.";
export const LINK_FAILED_MESSAGE = "That link expired or was already used. Send a new one.";

/** True only for the `supabase` adapter. `local`, `mock` and anything unknown keep the app open, as today. */
export function isAuthGateOn(rawAdapter: string | undefined | null): boolean {
  return chooseAdapter(rawAdapter) === "supabase";
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Trim and lowercase; null unless the value looks like `a@b.c`. */
export function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  return EMAIL_SHAPE.test(email) ? email : null;
}

export function loginRedirectUrl(origin: string): string {
  return `${origin.replace(/\/+$/, "")}/login`;
}

/** Friendly copy for a failed `signInWithOtp`. Never echoes the raw server text. */
export function signInErrorMessage(error: { message: string; status?: number; code?: string }): string {
  const text = `${error.message} ${error.code ?? ""}`;
  if (error.status === 429 || /rate[ _]limit|too many/i.test(text)) return RATE_LIMIT_MESSAGE;
  if (/signups? not allowed|user not found|otp_disabled|signup_disabled/i.test(text)) return NOT_SET_UP_MESSAGE;
  return GENERIC_SEND_MESSAGE;
}

/** Validates the email, then asks Supabase for a magic link. Sign-ups are never created from this page. */
export async function sendMagicLink(
  client: AuthClientLike,
  rawEmail: string,
  origin: string,
): Promise<{ ok: true; email: string } | { ok: false; message: string }> {
  const email = normalizeEmail(rawEmail);
  if (!email) return { ok: false, message: "Enter a valid email address." };
  try {
    const { error } = await client.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false, emailRedirectTo: loginRedirectUrl(origin) },
    });
    if (error) return { ok: false, message: signInErrorMessage(error) };
    return { ok: true, email };
  } catch {
    return { ok: false, message: GENERIC_SEND_MESSAGE };
  }
}

/**
 * True when a session event is for the user whose allow-list answer is already on screen (`checkedUid`). A token refresh
 * (or the initial session) for that same user keeps the answer, so AppShell is not unmounted and its unsaved state kept.
 * A signed-out event, or no answer yet, never counts as kept.
 */
export function keepsCheckedUser(checkedUid: string | null, session: { user: AuthUserLike } | null): boolean {
  return checkedUid !== null && session !== null && session.user.id === checkedUid;
}

/** `allowed` iff the signed-in user's own allow-list row is readable. Any failure is `error`, never `allowed`. */
export async function checkAllowed(client: AuthClientLike, uid: string): Promise<"allowed" | "not-authorized" | "error"> {
  try {
    const { data, error } = await client.from(ALLOW_LIST_TABLE).select("user_id").eq("user_id", uid).maybeSingle();
    if (error) return "error";
    return data ? "allowed" : "not-authorized";
  } catch {
    return "error";
  }
}

/** Friendly message for an `#error=...` hash (expired or reused magic link), otherwise null. */
export function parseAuthHashError(hash: string): string | null {
  const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  if (!params.get("error") && !params.get("error_code")) return null;
  return LINK_FAILED_MESSAGE;
}

export async function signOutUser(client: AuthClientLike): Promise<void> {
  try {
    await client.auth.signOut();
  } catch {
    // Signing out must still leave the page; the local session is cleared by the next load at worst.
  }
}
