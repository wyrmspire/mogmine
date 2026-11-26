// #190: device-side sync metadata (docs/26 §8). Three kinds of key per collection, all under `mogmine-sync-v1:`:
// - base: what the server is known to hold for one owner (fingerprints by id, plus ids whose remove was refused);
// - owner: the uid whose data this device cache holds;
// - orphan: a copy of another user's device data, kept out of sight when a different user signs in.
// The base also carries each row's server `updated_at` (R3-05), and the paged full-history read lives here.
// Reads tolerate garbage JSON (treated as missing). Writes that the browser refuses are kept in memory for the page.
import type { KeyValueStore } from "./local-adapter.ts";
import type { CollectionRepository, PersistError, PersistResult, RowMeta, UserId } from "./contract.ts";

export const SYNC_PREFIX = "mogmine-sync-v1";
/** Retry delays for unreachable-server failures: 5 s, 15 s, 30 s, then 60 s. */
export const BACKOFF_MS = [5_000, 15_000, 30_000, 60_000];

export interface SyncBase {
  owner: string | null;
  /** Record id to the fingerprint of the copy the server holds (or was last sent). */
  ids: Record<string, string>;
  /** Ids whose remove was refused (archive policy). Never re-added from the server, never retried. */
  gone: string[];
  /** Record id to the server's `updated_at` at the last pull or push: the `expectedUpdatedAt` of the next write. */
  updatedAt?: Record<string, string>;
}

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

export const emptyBase = (): SyncBase => ({ owner: null, ids: {}, gone: [], updatedAt: {} });

/** `localStorage` when it works; otherwise an in-memory map for this page load. Never throws. */
export function browserStorage(): KeyValueStore {
  const memory = new Map<string, string>();
  const device = () => (typeof localStorage === "undefined" ? null : localStorage);
  return {
    getItem(key) {
      try {
        const value = device()?.getItem(key) ?? null;
        if (value !== null) return value;
      } catch {
        // Blocked storage: fall through to memory.
      }
      return memory.get(key) ?? null;
    },
    setItem(key, value) {
      memory.set(key, value);
      try {
        device()?.setItem(key, value);
      } catch {
        // Blocked or full: the value lives in memory until the page closes.
      }
    },
  };
}

const baseKey = (key: string) => `${SYNC_PREFIX}:base:${key}`;
const ownerKey = (key: string) => `${SYNC_PREFIX}:owner:${key}`;
const orphanKey = (key: string, owner: string) => `${SYNC_PREFIX}:orphan:${key}:${owner}`;

function readJson(storage: KeyValueStore, key: string): unknown {
  const raw = storage.getItem(key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

/** The stored base, sanitized. Garbage reads as an empty base with no owner. */
export function readBase(storage: KeyValueStore, key: string): SyncBase {
  const value = readJson(storage, baseKey(key));
  if (!isRecord(value)) return emptyBase();
  const ids: Record<string, string> = {};
  if (isRecord(value.ids)) {
    for (const [id, fingerprintValue] of Object.entries(value.ids)) {
      if (typeof fingerprintValue === "string") ids[id] = fingerprintValue;
    }
  }
  const gone = Array.isArray(value.gone) ? value.gone.filter((id): id is string => typeof id === "string") : [];
  const updatedAt: Record<string, string> = {}; // absent in bases saved before R3-05: reads as `{}`
  if (isRecord(value.updatedAt)) {
    for (const [id, at] of Object.entries(value.updatedAt)) {
      if (typeof at === "string") updatedAt[id] = at;
    }
  }
  return { owner: typeof value.owner === "string" ? value.owner : null, ids, gone, updatedAt };
}

export function writeBase(storage: KeyValueStore, key: string, base: SyncBase): void {
  storage.setItem(baseKey(key), JSON.stringify(base));
}

/** The base for `owner`. A base saved for someone else is treated as empty. */
export function scopedBase(base: SyncBase, owner: string): SyncBase {
  return base.owner === owner ? base : { owner, ids: {}, gone: [], updatedAt: {} };
}

export function readDeviceOwner(storage: KeyValueStore, key: string): string | null {
  return storage.getItem(ownerKey(key)) || null;
}

export function writeDeviceOwner(storage: KeyValueStore, key: string, owner: string): void {
  storage.setItem(ownerKey(key), owner);
}

/** Keep another user's device records under their own key. An existing copy is never overwritten. */
export function keepOrphans(storage: KeyValueStore, key: string, deviceOwner: string, records: unknown[]): void {
  const slot = orphanKey(key, deviceOwner);
  if (storage.getItem(slot) === null) storage.setItem(slot, JSON.stringify(records));
}

/** The delay before retry number `attempt` (0-based), capped at the last entry of `BACKOFF_MS`. */
export function backoffDelay(attempt: number): number {
  return BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
}

/** Supabase PostgREST default `max-rows`. */
export const REMOTE_ROW_CAP = 1000;
/** Pages per pull: 50 × REMOTE_ROW_CAP = 50,000 rows per collection. Stops a buggy source from looping forever. */
export const MAX_PULL_PAGES = 50;

/**
 * Every row of one collection, page by page (`offset` steps of `REMOTE_ROW_CAP`). `maybeTruncated` means the pull
 * could not prove it saw the whole history: the page budget ran out, or a full page repeated rows already read
 * (a source that ignores `offset`, e.g. a filler mock). Duplicates are dropped, keeping first-seen order.
 * One read per page: `listStored` when the repository has it (each row's `updated_at` is the `expectedUpdatedAt` of
 * the next write to that row), else `list` with no metadata.
 */
/** A repository without `listStored`: the same rows, no metadata. */
const withoutMeta = <T>(result: PersistResult<T[]>): PersistResult<{ record: T; meta?: RowMeta }[]> =>
  result.ok ? { ok: true, value: result.value.map((record) => ({ record })) } : result;

export async function listAllRemote<T extends { id: string }>(
  repo: CollectionRepository<T>,
  owner: UserId,
): Promise<{ ok: true; value: { remote: T[]; updatedAt: Map<string, string>; maybeTruncated: boolean } } | { ok: false; error: PersistError }> {
  const byId = new Map<string, T>();
  const updatedAt = new Map<string, string>();
  let offset = 0;
  let pages = 0;
  let truncated = false;
  for (;;) {
    const query = { includeSamples: true, includeArchived: true, limit: REMOTE_ROW_CAP, offset };
    const page = repo.listStored ? await repo.listStored(owner, query) : withoutMeta(await repo.list(owner, query));
    if (!page.ok) return page;
    pages += 1;
    const rows = page.value;
    if (rows.length >= REMOTE_ROW_CAP && rows.every((row) => byId.has(row.record.id))) {
      truncated = true; // the same full page again: `offset` was ignored, so nothing more can be read
      break;
    }
    for (const { record, meta } of rows) {
      if (byId.has(record.id)) continue;
      byId.set(record.id, record);
      if (meta) updatedAt.set(record.id, meta.updated_at);
    }
    if (rows.length < REMOTE_ROW_CAP) break; // a short page is the last one
    if (pages >= MAX_PULL_PAGES) {
      truncated = true;
      break;
    }
    offset += REMOTE_ROW_CAP;
  }
  return { ok: true, value: { remote: [...byId.values()], updatedAt, maybeTruncated: truncated } };
}
