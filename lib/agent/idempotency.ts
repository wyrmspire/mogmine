/** Durable, request-body-bound idempotency for agent POST creates. No token or prose is stored. */
export interface IdempotencyRecord {
  user_id: string;
  token_id: string | null;
  endpoint: string;
  idempotency_key: string;
  payload_hash: string;
  state: "in_flight" | "completed";
  status: number | null;
  response_body: unknown;
  created_at?: string;
}

export interface IdempotencyTable {
  select(columns: string): IdempotencyQuery;
  insert(row: Record<string, unknown>): PromiseLike<{ error: { message?: string } | null }>;
  update(row: Record<string, unknown>): IdempotencyMutation;
  delete(): IdempotencyMutation;
}

interface IdempotencyQuery {
  eq(column: string, value: string): IdempotencyQuery;
  maybeSingle(): PromiseLike<{ data: IdempotencyRecord | null; error: { message?: string } | null }>;
}

interface IdempotencyMutation extends PromiseLike<{ error: { message?: string } | null }> {
  eq(column: string, value: string): IdempotencyMutation;
}

const VALID_KEY = /^[\x21-\x7e]{1,128}$/;

export type IdempotencyKey = { key: string | null; error: string | null };

export function readIdempotencyKey(req: Request): IdempotencyKey {
  const header = req.headers.get("idempotency-key");
  if (header == null) return { key: null, error: null };
  const value = header.trim();
  return VALID_KEY.test(value)
    ? { key: value, error: null }
    : { key: null, error: "Idempotency-Key must contain 1–128 visible ASCII characters." };
}

export async function requestHash(endpoint: string, body: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify({ endpoint, body: body ?? null }));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function findIdempotent(
  table: IdempotencyTable,
  owner: string,
  endpoint: string,
  key: string,
): Promise<IdempotencyRecord | null> {
  const result = await table.select("user_id,token_id,endpoint,idempotency_key,payload_hash,state,status,response_body,created_at")
    .eq("user_id", owner).eq("endpoint", endpoint).eq("idempotency_key", key).maybeSingle();
  return result.error ? null : result.data;
}

export async function claimIdempotent(
  table: IdempotencyTable,
  record: Pick<IdempotencyRecord, "user_id" | "token_id" | "endpoint" | "idempotency_key" | "payload_hash">,
): Promise<{ claimed: true } | { claimed: false; existing: IdempotencyRecord | null }> {
  const result = await table.insert({ ...record, state: "in_flight", status: null, response_body: null });
  if (!result.error) return { claimed: true };
  return { claimed: false, existing: await findIdempotent(table, record.user_id, record.endpoint, record.idempotency_key) };
}

export async function completeIdempotent(
  table: IdempotencyTable,
  owner: string,
  endpoint: string,
  key: string,
  payloadHash: string,
  status: number,
  responseBody: unknown,
): Promise<boolean> {
  const result = await table.update({ state: "completed", status, response_body: responseBody })
    .eq("user_id", owner).eq("endpoint", endpoint).eq("idempotency_key", key)
    .eq("payload_hash", payloadHash).eq("state", "in_flight");
  return !result.error;
}

export async function releaseIdempotent(table: IdempotencyTable, owner: string, endpoint: string, key: string, payloadHash: string): Promise<void> {
  await table.delete().eq("user_id", owner).eq("endpoint", endpoint).eq("idempotency_key", key)
    .eq("payload_hash", payloadHash).eq("state", "in_flight");
}

/** Longer than any request can run, so an older claim was abandoned (crash, or the completion write failed). */
export const STALE_CLAIM_MS = 15 * 60_000;

export function isStaleClaim(record: IdempotencyRecord, nowMs: number): boolean {
  return record.state === "in_flight" && nowMs - Date.parse(record.created_at ?? "") > STALE_CLAIM_MS;
}

/** Drops one abandoned claim. `created_at` is matched so a newer claim on the same key is never removed. */
export async function releaseStaleIdempotent(table: IdempotencyTable, record: IdempotencyRecord): Promise<void> {
  await table.delete().eq("user_id", record.user_id).eq("endpoint", record.endpoint).eq("idempotency_key", record.idempotency_key)
    .eq("created_at", record.created_at ?? "").eq("state", "in_flight");
}
