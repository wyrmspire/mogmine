// #185b: the browser side of agent keys (docs/26 §6). Browser-safe: no service role, no SDK import; the caller passes the
// signed-in client in. Reads and writes only `mogmine_agent_tokens` and `mogmine_agent_audit`, through RLS, with the
// column grants of the #185a migration: the browser never selects `*` or `token_hash`.
// The plaintext key is returned to the caller once and is never stored, logged or put in a row.
import { AGENT_TOKEN_PATTERN, generateAgentToken, hashAgentToken } from "./tokens.ts";
import type { AgentScope } from "./tokens.ts";

export const AGENT_KEY_COLUMNS = "id,user_id,label,token_prefix,scopes,created_at,last_used_at,revoked_at";
export const AUDIT_COLUMNS = "id,at,method,path,record_type,record_id,status,outcome";
const KEYS_TABLE = "mogmine_agent_tokens";
const AUDIT_TABLE = "mogmine_agent_audit";
const KEY_LIST_LIMIT = 100;

export interface AgentKeyRow {
  id: string;
  user_id: string;
  label: string;
  token_prefix: string;
  scopes: AgentScope[];
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export interface AuditRow {
  id: string;
  at: string;
  method: string;
  path: string;
  record_type: string | null;
  record_id: string | null;
  status: number;
  outcome: string;
}

export interface DbResult<T> {
  data: T | null;
  error: { message: string; code?: string } | null;
}

/** The slice of the supabase-js query builder this module uses. The browser client satisfies it. */
export interface KeysClientLike {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): {
        order(column: string, options: { ascending: boolean }): {
          limit(count: number): PromiseLike<DbResult<unknown[]>>;
        };
      };
    };
    insert(row: Record<string, unknown>): {
      select(columns: string): { single(): PromiseLike<DbResult<unknown>> };
    };
    update(patch: Record<string, unknown>): {
      eq(column: string, value: string): {
        eq(column: string, value: string): { select(columns: string): PromiseLike<DbResult<unknown[]>> };
      };
    };
  };
}

const CREATE_FAILED = "Couldn't create the key. Check your connection and try again.";
const LOAD_FAILED = "Couldn't load your keys. Check your connection and try again.";
const REVOKE_FAILED = "Couldn't revoke the key. Check your connection and try again.";
const AUDIT_FAILED = "Couldn't load recent activity. Check your connection and try again.";
const LABEL_RULE = "Give the key a label of 1 to 60 characters.";

/** Trim, collapse runs of spaces, and keep 1 to 60 characters (the same rule as the database check). Null otherwise. */
export function cleanLabel(raw: string): string | null {
  const label = raw.trim().replace(/\s+/g, " ");
  const length = Array.from(label).length;
  return length >= 1 && length <= 60 ? label : null;
}

/** `read` is read only; `read-write` carries both scopes. A key never carries write alone. */
export function scopesFor(choice: "read" | "read-write"): AgentScope[] {
  return choice === "read" ? ["read"] : ["read", "write"];
}

export type CreateKeyResult = { ok: true; token: string; row: AgentKeyRow } | { ok: false; message: string };

/**
 * Mints a key: generate the token, store only its SHA-256 hash and display prefix, and return the plaintext to the caller.
 * A bad label answers before anything is sent to the database.
 */
export async function createAgentKey(
  db: KeysClientLike,
  userId: string,
  label: string,
  choice: "read" | "read-write",
): Promise<CreateKeyResult> {
  const cleaned = cleanLabel(label);
  if (!cleaned) return { ok: false, message: LABEL_RULE };
  const { token, prefix } = generateAgentToken();
  if (!AGENT_TOKEN_PATTERN.test(token)) return { ok: false, message: CREATE_FAILED };
  const tokenHash = await hashAgentToken(token);
  try {
    const { data, error } = await db
      .from(KEYS_TABLE)
      .insert({ user_id: userId, label: cleaned, token_hash: tokenHash, token_prefix: prefix, scopes: scopesFor(choice) })
      .select(AGENT_KEY_COLUMNS)
      .single();
    if (error || !data) return { ok: false, message: CREATE_FAILED };
    return { ok: true, token, row: data as AgentKeyRow };
  } catch {
    return { ok: false, message: CREATE_FAILED };
  }
}

/** The owner's keys, newest first, revoked ones included. */
export async function listAgentKeys(db: KeysClientLike, userId: string): Promise<{ ok: true; rows: AgentKeyRow[] } | { ok: false; message: string }> {
  try {
    const { data, error } = await db
      .from(KEYS_TABLE)
      .select(AGENT_KEY_COLUMNS)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(KEY_LIST_LIMIT);
    if (error) return { ok: false, message: LOAD_FAILED };
    return { ok: true, rows: (data ?? []) as AgentKeyRow[] };
  } catch {
    return { ok: false, message: LOAD_FAILED };
  }
}

/** Sets `revoked_at` only. The row is filtered by id AND owner. Revoking is one-way (the policy allows nothing else). */
export async function revokeAgentKey(db: KeysClientLike, userId: string, id: string, nowIso: string): Promise<{ ok: boolean; message?: string }> {
  try {
    // Read the id back: an update RLS filtered to zero rows is not an error, but nothing was revoked.
    const { data, error } = await db.from(KEYS_TABLE).update({ revoked_at: nowIso }).eq("id", id).eq("user_id", userId).select("id");
    if (error || !Array.isArray(data) || data.length !== 1) return { ok: false, message: REVOKE_FAILED };
    return { ok: true };
  } catch {
    return { ok: false, message: REVOKE_FAILED };
  }
}

/** The owner's most recent agent requests, newest first. */
export async function listRecentAudit(
  db: KeysClientLike,
  userId: string,
  limit = 20,
): Promise<{ ok: true; rows: AuditRow[] } | { ok: false; message: string }> {
  try {
    const { data, error } = await db
      .from(AUDIT_TABLE)
      .select(AUDIT_COLUMNS)
      .eq("user_id", userId)
      .order("at", { ascending: false })
      .limit(limit);
    if (error) return { ok: false, message: AUDIT_FAILED };
    return { ok: true, rows: (data ?? []) as AuditRow[] };
  } catch {
    return { ok: false, message: AUDIT_FAILED };
  }
}
