// Server only. Never import from a "use client" file.
// #185a: resolves `Authorization: Bearer mmk_…` to its owner and gives the request a data client that acts AS that owner
// (docs/26 §6). The service role is used for exactly three things: look a token up BY HASH, mint the owner's session
// (admin generateLink + anon verifyOtp, no email is sent), and write `last_used_at` and the audit row. It never reads or
// writes a journal table, so RLS and the allow-list still decide every journal row.
import { createClient } from "@supabase/supabase-js";
import { chooseAdapter } from "../persistence/select.ts";
import type { DbError, SupabaseLike } from "../persistence/supabase-adapter.ts";
import { agentError } from "./http.ts";
import type { AgentErrorCode, AgentResponse, RateLimiter } from "./http.ts";
import { hasScope, hashAgentToken, parseBearer, requiredScope } from "./tokens.ts";
import type { AgentScope } from "./tokens.ts";

/** One query on a table, as the service-role client is used here: filters, then a single row or a write. */
export interface AgentQuery<T = unknown> extends PromiseLike<{ data: T | null; error: DbError | null }> {
  eq(column: string, value: string): AgentQuery<T>;
  maybeSingle(): PromiseLike<{ data: T | null; error: DbError | null }>;
}

export interface AgentTable {
  select(columns: string): AgentQuery<TokenRow>;
  update(patch: Record<string, unknown>): AgentQuery;
  insert(row: Record<string, unknown>): PromiseLike<{ error: DbError | null }>;
}

export interface TokenRow {
  id: string;
  user_id: string;
  scopes: string[];
  revoked_at: string | null;
}

interface AuthAdminLike {
  getUserById(id: string): PromiseLike<{ data: { user: { email?: string | null } | null } | null; error: { message: string } | null }>;
  generateLink(args: { type: "magiclink"; email: string }): PromiseLike<{
    data: { properties?: { hashed_token?: string } | null } | null;
    error: { message: string } | null;
  }>;
}

/** The service-role client, narrowed to what this module calls. */
export interface AdminLike {
  from(table: string): AgentTable;
  auth: { admin: AuthAdminLike };
}

export interface AgentSession {
  access_token: string;
  refresh_token: string;
  /** Epoch seconds. Missing means unknown: the session is then treated as expired and minted again. */
  expires_at?: number;
}

/** The anon client, narrowed to the two session calls. Its own session is never used for journal data. */
export interface AnonAuthLike {
  auth: {
    verifyOtp(args: { token_hash: string; type: "magiclink" }): PromiseLike<{ data: { session: AgentSession | null } | null; error: { message: string } | null }>;
    refreshSession(args: { refresh_token: string }): PromiseLike<{ data: { session: AgentSession | null } | null; error: { message: string } | null }>;
  };
}

/** A data client that sends the owner's access token, so RLS applies. */
export type UserDataClient = Pick<SupabaseLike, "from" | "rpc">;

export interface AgentEnv {
  url?: string;
  anonKey?: string;
  serviceKey?: string;
  adapter?: string;
}

/** Injectable for tests. `defaultAgentDeps()` builds the real clients from `process.env`. */
export interface AgentServerDeps {
  env: AgentEnv;
  admin: AdminLike;
  anon: AnonAuthLike;
  userClient(accessToken: string): UserDataClient;
  now(): number;
}

/** Identity of a key that resolved to an owner (enough to audit its requests). */
export interface AgentIdentity {
  userId: string;
  tokenId: string;
  scopes: string[];
}

export type AgentAuth =
  | { ok: true; ctx: AgentIdentity & { db: SupabaseLike } }
  | (AgentResponse & { ok: false; code: AgentErrorCode; identity?: AgentIdentity });

/** Off unless the server runs the supabase adapter AND has all three keys. Mock/local mode is off by default. */
export function agentEnabled(env: AgentEnv): boolean {
  return chooseAdapter(env.adapter) === "supabase" && !!env.url && !!env.anonKey && !!env.serviceKey;
}

const AUTH_OPTIONS = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } as const;
const SESSION_MARGIN_MS = 120_000;
const UNKNOWN_KEY = "This agent key is not valid.";

/** Real clients from the environment. Null when the API is off (the handler then answers 503). */
export function defaultAgentDeps(): AgentServerDeps | null {
  const env: AgentEnv = {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL?.trim(),
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim(),
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY?.trim(),
    adapter: process.env.NEXT_PUBLIC_PERSISTENCE_ADAPTER,
  };
  if (!agentEnabled(env)) return null;
  const url = env.url as string;
  const anonKey = env.anonKey as string;
  const serviceKey = env.serviceKey as string;
  return {
    env,
    admin: createClient(url, serviceKey, { auth: AUTH_OPTIONS }) as unknown as AdminLike,
    anon: createClient(url, anonKey, { auth: AUTH_OPTIONS }) as unknown as AnonAuthLike,
    userClient(accessToken) {
      const client = createClient(url, anonKey, {
        auth: AUTH_OPTIONS,
        global: { headers: { Authorization: `Bearer ${accessToken}` } },
      });
      return {
        from: ((table: string) => client.from(table)) as unknown as UserDataClient["from"],
        rpc: ((fn: string, args: Record<string, unknown>) => client.rpc(fn, args)) as unknown as UserDataClient["rpc"],
      };
    },
    now: () => Date.now(),
  };
}

// ---- owner sessions -------------------------------------------------------------------------------------------------
// One cached session per owner. Never shared across owners. Minting a session replaces any magic link the owner
// requested but has not opened yet, so the owner signs in on the phone before agents use the key.

interface CachedSession {
  accessToken: string;
  refreshToken: string;
  expiresAtMs: number;
}

const sessions = new Map<string, CachedSession>();
const minting = new Map<string, Promise<CachedSession | null>>();

function toCached(session: AgentSession): CachedSession {
  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    // No expiry from the server: treat the session as already due, so it is minted again rather than trusted.
    expiresAtMs: (session.expires_at ?? 0) * 1000,
  };
}

async function refreshed(deps: AgentServerDeps, refreshToken: string): Promise<CachedSession | null> {
  try {
    const result = await deps.anon.auth.refreshSession({ refresh_token: refreshToken });
    const session = result.data?.session;
    return result.error || !session ? null : toCached(session);
  } catch {
    return null;
  }
}

async function minted(deps: AgentServerDeps, userId: string): Promise<CachedSession | null> {
  try {
    const user = await deps.admin.auth.admin.getUserById(userId);
    const email = user.data?.user?.email;
    if (user.error || !email) return null;
    const link = await deps.admin.auth.admin.generateLink({ type: "magiclink", email });
    const hashed = link.data?.properties?.hashed_token;
    if (link.error || !hashed) return null;
    const verified = await deps.anon.auth.verifyOtp({ token_hash: hashed, type: "magiclink" });
    const session = verified.data?.session;
    return verified.error || !session ? null : toCached(session);
  } catch {
    return null;
  }
}

async function ownerSession(deps: AgentServerDeps, userId: string): Promise<CachedSession | null> {
  const cached = sessions.get(userId);
  if (cached && cached.expiresAtMs - deps.now() > SESSION_MARGIN_MS) return cached;
  const pending = minting.get(userId);
  if (pending) return pending;
  const task = (async () => {
    const next = (cached && (await refreshed(deps, cached.refreshToken))) || (await minted(deps, userId));
    if (next) sessions.set(userId, next);
    return next;
  })();
  minting.set(userId, task);
  try {
    return await task;
  } finally {
    minting.delete(userId);
  }
}

/** Tests only. Clears every cached owner session. */
export function __resetAgentSessionCache(): void {
  sessions.clear();
  minting.clear();
}

// ---- authentication -------------------------------------------------------------------------------------------------

function denied(code: AgentErrorCode, message: string, identity?: AgentIdentity, headers: Record<string, string> = {}): AgentAuth {
  const { status, body } = agentError(code, message, headers);
  return { ok: false, status, body, headers, code, identity };
}

/** Bearer → hash → rate limit → lookup by hash → scope → owner session. Every failure is a response, never a throw. */
export async function authenticateAgent(req: Request, deps: AgentServerDeps, limiter: RateLimiter): Promise<AgentAuth> {
  const token = parseBearer(req.headers.get("authorization"));
  if (!token) {
    return denied("unauthenticated", "Send your agent key as `Authorization: Bearer mmk_…`.", undefined, {
      "WWW-Authenticate": 'Bearer realm="mogmine"',
    });
  }
  const hash = await hashAgentToken(token);
  const limit = limiter.take(hash);
  if (!limit.ok) {
    return denied("rate_limited", "Too many requests from this key. Wait and try again.", undefined, {
      "Retry-After": String(limit.retryAfterSec),
    });
  }
  const lookup = await deps.admin.from("mogmine_agent_tokens")
    .select("id,user_id,scopes,revoked_at")
    .eq("token_hash", hash)
    .maybeSingle();
  if (lookup.error) return denied("unavailable", "Could not check this agent key. Try again.");
  const row = lookup.data;
  // Unknown and revoked get the same answer, so a probe learns nothing about which keys exist.
  if (!row || row.revoked_at) {
    return denied("unauthenticated", UNKNOWN_KEY, undefined, { "WWW-Authenticate": 'Bearer realm="mogmine"' });
  }
  const identity: AgentIdentity = { userId: row.user_id, tokenId: row.id, scopes: Array.isArray(row.scopes) ? row.scopes : [] };
  const needed: AgentScope = requiredScope(req.method);
  if (!hasScope(identity.scopes, needed)) return denied("forbidden", "This key is read-only.", identity);

  const session = await ownerSession(deps, identity.userId);
  if (!session) return denied("unavailable", "Could not open the owner's session. Try again.", identity);

  const client = deps.userClient(session.accessToken);
  const db: SupabaseLike = {
    auth: { getSession: async () => ({ data: { session: { user: { id: identity.userId } } } }) },
    from: (table) => client.from(table),
    rpc: (fn, args) => client.rpc(fn, args),
  };
  return { ok: true, ctx: { ...identity, db } };
}

/**
 * Best-effort bookkeeping: `last_used_at` and one audit row. Never throws and never changes the response.
 * Both writes are filtered by token id AND owner, so the service role cannot touch another owner's key.
 */
export async function recordAgentUse(
  deps: AgentServerDeps,
  identity: AgentIdentity,
  entry: { method: string; path: string; status: number; outcome: string; recordType?: string; recordId?: string },
): Promise<void> {
  try {
    await deps.admin.from("mogmine_agent_tokens")
      .update({ last_used_at: new Date(deps.now()).toISOString() })
      .eq("id", identity.tokenId)
      .eq("user_id", identity.userId);
  } catch {
    // Ignored: bookkeeping must not fail the request.
  }
  try {
    await deps.admin.from("mogmine_agent_audit").insert({
      user_id: identity.userId,
      token_id: identity.tokenId,
      method: entry.method,
      path: entry.path.slice(0, 300),
      record_type: entry.recordType ?? null,
      record_id: entry.recordId ? entry.recordId.slice(0, 200) : null,
      status: entry.status,
      outcome: entry.outcome.slice(0, 40),
    });
  } catch {
    // Ignored, as above.
  }
}
