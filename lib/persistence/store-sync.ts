// #190: the sync layer every journal store shares (docs/26 §8). The device cache is always written first by the
// store; this layer copies a collection to and from the Supabase adapter in the background. Pure TypeScript: no React,
// no SDK import. The adapter comes from `getPersistence()` unless a test injects one.
//
// Merge rules (see the pull algorithm below): a clean local record takes the server copy; a dirty one (edited since the
// server last saw it) is kept and pushed; a record the server dropped is dropped locally only when it was clean;
// nothing dirty is ever lost. Last write wins on push (no expectedUpdatedAt).
import { getPersistence, chooseAdapter } from "./select.ts";
import type { KeyValueStore } from "./local-adapter.ts";
import type { CollectionKey, CollectionRepository, PersistError, PersistenceAdapter } from "./contract.ts";
import { fingerprint } from "./sync-fingerprint.ts";
import {
  backoffDelay, browserStorage, keepOrphans, readBase, readDeviceOwner, scopedBase, writeBase, writeDeviceOwner,
} from "./sync-storage.ts";
import type { SyncBase } from "./sync-storage.ts";

export { fingerprint };

export type SyncStatus = "off" | "signed-out" | "syncing" | "synced" | "pending" | "error";
export interface SyncState {
  status: SyncStatus;
  message: string | null;
  lastSyncedAt: string | null;
}

export interface CollectionSyncOptions<T extends { id: string }> {
  key: CollectionKey;
  /** The store's current in-memory list. Read at merge and push time, not when the syncer is created. */
  getLocal(): readonly T[];
  /** The store replaces its list with `next` and writes its device cache. */
  apply(next: T[]): void;
  /** Records that sync. Default: all. Trades: `!trade.is_sample`. */
  include?(record: T): boolean;
  adapter?(): PersistenceAdapter;
  /** Device sync metadata. Default: `localStorage`, or memory when storage is blocked. */
  storage?: KeyValueStore;
  /** Default: `remoteSyncEnabled()`. */
  enabled?: boolean;
  /** Default 800 ms. */
  debounceMs?: number;
  now?(): number;
  setTimer?(fn: () => void, ms: number): unknown;
  clearTimer?(handle: unknown): void;
}

export interface CollectionSync {
  /** Call once at the end of the store's hydrate. No-op when disabled. Starts `pull()`. */
  start(): void;
  /** Call after every local mutation the store persists. Debounced push. */
  changed(): void;
  /** Fetch, merge and push. Safe to call repeatedly; in-flight calls are joined. */
  pull(): Promise<void>;
  /** Push now. True when nothing is left unsent. */
  flushNow(): Promise<boolean>;
  getState(): SyncState;
  /** Clear timers and listeners, and leave the registry. */
  dispose(): void;
}

/** True when the adapter choice (argument or `NEXT_PUBLIC_PERSISTENCE_ADAPTER`) is `supabase`. */
export function remoteSyncEnabled(raw?: string | null): boolean {
  return chooseAdapter(raw ?? process.env.NEXT_PUBLIC_PERSISTENCE_ADAPTER) === "supabase";
}

// ---- Aggregate status for the header. Worst status wins. -----------------------------------------------------------

const RANK: Record<SyncStatus, number> = { off: 0, synced: 1, "signed-out": 2, syncing: 3, pending: 4, error: 5 };
const OFF: SyncState = { status: "off", message: null, lastSyncedAt: null };
const registry = new Set<{ getState(): SyncState }>();
const listeners = new Set<() => void>();
let summary: SyncState | null = null;

function computeSummary(): SyncState {
  let worst = OFF;
  let lastSyncedAt: string | null = null;
  for (const entry of registry) {
    const state = entry.getState();
    if (state.lastSyncedAt && (!lastSyncedAt || state.lastSyncedAt > lastSyncedAt)) lastSyncedAt = state.lastSyncedAt;
    if (RANK[state.status] > RANK[worst.status]) worst = state;
  }
  return { status: worst.status, message: worst.message, lastSyncedAt };
}

/** Cached so `useSyncExternalStore` sees a stable value until something changes. */
function refresh() {
  summary = computeSummary();
  listeners.forEach((listener) => listener());
}

export function getSyncSummary(): SyncState {
  if (!summary) summary = computeSummary();
  return summary;
}

export function subscribeSync(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Lets another syncer kind (singleton-sync) join the header summary. Returns the unregister function. */
export function registerSyncEntry(entry: { getState(): SyncState }): () => void {
  registry.add(entry);
  refresh();
  return () => { registry.delete(entry); refresh(); };
}

/** Tell the summary that a registered entry changed its state. */
export const notifySyncChanged = (): void => refresh();

export function resetSyncRegistryForTests(): void {
  registry.clear();
  refresh();
}

/** Records of the same key match when their fingerprints match, in any order. */
function sameRecords<T extends { id: string }>(key: CollectionKey, a: readonly T[], b: readonly T[]): boolean {
  if (a.length !== b.length) return false;
  const byId = new Map(b.map((record) => [record.id, fingerprint(key, record)]));
  return a.every((record) => byId.get(record.id) === fingerprint(key, record));
}

const SIGNED_OUT_MESSAGE = "Sign in to sync your journal.";
const FLUSH_BLOCKED = new Set<PersistError["code"]>(["unauthenticated", "unavailable", "unknown"]);
const PULL_IDLE_REFRESH_MS = 60_000;
/** Supabase PostgREST default `max-rows`. */
export const REMOTE_ROW_CAP = 1000;

interface Timer { handle: unknown; armed: boolean }

export function createCollectionSync<T extends { id: string }>(options: CollectionSyncOptions<T>): CollectionSync {
  const { key } = options;
  const include = options.include ?? (() => true);
  const storage = options.storage ?? browserStorage();
  const enabled = options.enabled ?? remoteSyncEnabled();
  const adapterOf = options.adapter ?? getPersistence;
  const debounceMs = options.debounceMs ?? 800;
  const now = options.now ?? Date.now;
  const setTimer = options.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = options.clearTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));

  let state: SyncState = { status: enabled ? "syncing" : "off", message: null, lastSyncedAt: null };
  let disposed = false;
  let started = false;
  let listening = false;
  let pulled = false;
  let pulledOwner: string | null = null;
  let lastPullAt = 0;
  let pulling: Promise<void> | null = null;
  let flushing: Promise<boolean> | null = null;
  let flushAgain = false;
  let retryStep = 0;
  const debounce: Timer = { handle: undefined, armed: false };
  const retryTimer: Timer = { handle: undefined, armed: false };
  const entry = { getState: () => state };

  const repoOf = (adapter: PersistenceAdapter) => adapter.repositories[key] as unknown as CollectionRepository<T>;

  function setState(status: SyncStatus, message: string | null = null, lastSyncedAt = state.lastSyncedAt) {
    state = { status, message, lastSyncedAt };
    refresh();
  }

  function arm(timer: Timer, run: () => void, ms: number) {
    if (timer.armed) clearTimer(timer.handle);
    timer.armed = true;
    timer.handle = setTimer(() => {
      timer.armed = false;
      if (!disposed) run();
    }, ms);
  }

  function disarm(timer: Timer) {
    if (timer.armed) clearTimer(timer.handle);
    timer.armed = false;
  }

  /** Backoff retry for an unreachable server. One retry at a time; the delay grows until a success. */
  function scheduleRetry(run: () => void) {
    if (retryTimer.armed) return;
    const delay = backoffDelay(retryStep);
    retryStep += 1;
    arm(retryTimer, run, delay);
  }

  // ---- Pull: fetch, merge against the base, apply, then push what is still local. --------------------------------

  function pullFailed(error: PersistError) {
    if (error.code === "unauthenticated") setState("signed-out", SIGNED_OUT_MESSAGE);
    else if (error.code === "unavailable") {
      setState("pending", error.message);
      scheduleRetry(() => void pull());
    } else {
      setState("error", error.message);
      if (error.code === "unknown") scheduleRetry(() => void pull());
    }
  }

  async function pullOnce(): Promise<void> {
    const adapter = adapterOf();
    const owner = await adapter.currentOwner();
    if (disposed) return;
    if (!owner) {
      setState("signed-out", SIGNED_OUT_MESSAGE);
      return;
    }
    setState("syncing", null, state.lastSyncedAt);
    const listed = await repoOf(adapter).list(owner, { includeSamples: true, includeArchived: true });
    if (disposed) return;
    if (!listed.ok) {
      pullFailed(listed.error);
      return;
    }

    const remote = listed.value;
    // PostgREST caps a response at `max-rows` (1000 on Supabase by default). A full page may be truncated, so it
    // must never be read as "the server deleted the rest" (no local record is dropped on such a pull).
    const maybeTruncated = remote.length >= REMOTE_ROW_CAP;
    const current = options.getLocal();
    const base = scopedBase(readBase(storage, key), owner);
    const deviceOwner = readDeviceOwner(storage, key);
    let local: readonly T[] = current;
    if (deviceOwner && deviceOwner !== owner) {
      // Another user's device data: keep a copy, never push it, never show it. Only non-syncing records stay.
      keepOrphans(storage, key, deviceOwner, current.filter((record) => include(record)));
      local = current.filter((record) => !include(record));
    }
    writeDeviceOwner(storage, key, owner);

    const baseIds = new Map(Object.entries(base.ids));
    const gone = new Set(base.gone);
    const localIds = new Set(local.map((record) => record.id));
    const remoteById = new Map(remote.map((record) => [record.id, record]));
    const merged = new Map<string, T>();
    const next = new Map<string, string>();
    const track = (record: T) => {
      if (include(record) && !gone.has(record.id)) next.set(record.id, fingerprint(key, record));
    };

    for (const record of local) {
      const id = record.id;
      if (!include(record) || gone.has(id)) {
        merged.set(id, record); // samples and refused removes: kept as they are, never pushed
        continue;
      }
      const remoteRecord = remoteById.get(id);
      const dirty = fingerprint(key, record) !== baseIds.get(id);
      if (remoteRecord) {
        merged.set(id, dirty ? record : remoteRecord);
        track(remoteRecord);
      } else if (baseIds.has(id) && !dirty && !maybeTruncated) {
        // The server had it, no longer does, and this device has no edits: deleted on another device. Drop it.
        // Not when the list may be cut short by the server row cap: then a missing row proves nothing.
      } else {
        merged.set(id, record); // never synced, or edited since: keep and push
      }
    }
    for (const record of remote) {
      const id = record.id;
      if (gone.has(id) || localIds.has(id)) continue;
      if (baseIds.has(id)) {
        track(record); // deleted here while offline: keep it deleted; the push sends the remove
        continue;
      }
      merged.set(id, record);
      track(record);
    }
    const savedBase: SyncBase = { owner, ids: Object.fromEntries(next), gone: [...gone] };
    writeBase(storage, key, savedBase);
    const result = [...merged.values()];
    if (!sameRecords(key, current, result)) options.apply(result);

    pulled = true;
    pulledOwner = owner;
    lastPullAt = now();
    retryStep = 0;
    await flushNow();
  }

  function pull(): Promise<void> {
    if (!enabled || disposed) return Promise.resolve();
    if (!pulling) {
      pulling = pullOnce()
        .catch(() => pullFailed({ code: "unknown", message: "Something went wrong syncing the journal." }))
        .finally(() => {
          pulling = null;
        });
    }
    return pulling;
  }

  // ---- Push: diff the local list against the base and send only the difference. ---------------------------------

  /** One pass: writes first, then removes. Stops at the first unreachable or unauthenticated answer. */
  async function flushOnce(): Promise<boolean> {
    const adapter = adapterOf();
    const owner = await adapter.currentOwner();
    if (disposed) return false;
    if (!owner) {
      setState("signed-out", SIGNED_OUT_MESSAGE);
      return false;
    }
    if (owner !== pulledOwner) {
      void pull(); // a different user is signed in than the one this cache was pulled for
      return false;
    }

    const base = scopedBase(readBase(storage, key), owner);
    const ids = new Map(Object.entries(base.ids));
    const gone = new Set(base.gone);
    const syncable = options.getLocal().filter((record) => include(record));
    const present = new Set(syncable.map((record) => record.id));
    const writes = syncable.filter((record) => !gone.has(record.id) && ids.get(record.id) !== fingerprint(key, record));
    const removes = [...ids.keys()].filter((id) => !present.has(id));
    if (writes.length === 0 && removes.length === 0) {
      setState("synced", null, new Date(now()).toISOString());
      return true;
    }

    setState("syncing", null, state.lastSyncedAt);
    const repo = repoOf(adapter);
    let failed = 0;
    let blocked: PersistError | null = null;
    try {
      for (const record of writes) {
        const result = await repo.put(owner, record); // last write wins: no expectedUpdatedAt
        if (disposed) return false;
        if (result.ok) {
          ids.set(record.id, fingerprint(key, record)); // what was sent, not what came back: never loops
          continue;
        }
        if (FLUSH_BLOCKED.has(result.error.code)) {
          blocked = result.error;
          break;
        }
        failed += 1;
      }
      if (!blocked) {
        for (const id of removes) {
          const result = await repo.remove(owner, id);
          if (disposed) return false;
          if (result.ok || result.error.code === "not_found") {
            ids.delete(id);
          } else if (result.error.code === "forbidden") {
            ids.delete(id); // archive policy: the server keeps the row, so it is never retried or re-added
            gone.add(id);
          } else if (FLUSH_BLOCKED.has(result.error.code)) {
            blocked = result.error;
            break;
          } else {
            failed += 1;
          }
        }
      }
    } finally {
      writeBase(storage, key, { owner, ids: Object.fromEntries(ids), gone: [...gone] });
    }

    if (blocked) {
      if (blocked.code === "unauthenticated") setState("signed-out", SIGNED_OUT_MESSAGE);
      else {
        setState("pending", blocked.message);
        scheduleRetry(() => void flushNow());
      }
      return false;
    }
    if (failed > 0) {
      setState("error", `${failed} ${failed === 1 ? "record couldn't" : "records couldn't"} sync`);
      return false;
    }
    retryStep = 0;
    setState("synced", null, new Date(now()).toISOString());
    return true;
  }

  /** Runs passes until no `changed()` arrived during one. A call during a pass joins it and asks for one more. */
  async function runFlushes(): Promise<boolean> {
    try {
      let clean = false;
      do {
        flushAgain = false;
        clean = await flushOnce();
      } while (flushAgain && !disposed);
      return clean;
    } finally {
      flushing = null;
    }
  }

  function flushNow(): Promise<boolean> {
    if (!enabled || disposed) return Promise.resolve(true); // nothing to send
    if (!pulled) return Promise.resolve(false); // the first pull computes the diff; nothing goes out before it
    if (flushing) {
      flushAgain = true;
      return flushing;
    }
    flushing = runFlushes().catch(() => {
      setState("pending", "Could not reach the journal server. Try again.");
      scheduleRetry(() => void flushNow());
      return false;
    });
    return flushing;
  }

  function changed() {
    if (!enabled || disposed || !pulled) return;
    arm(debounce, () => void flushNow(), debounceMs);
  }

  // ---- Browser listeners: come back online, and pick up edits from other devices after a while away. ----------

  const onOnline = () => {
    if (pulled) void flushNow();
    else void pull();
  };
  const onVisibility = () => {
    if (document.visibilityState === "visible" && pulled && now() - lastPullAt > PULL_IDLE_REFRESH_MS) void pull();
  };

  function start() {
    if (!enabled || disposed || started) return;
    started = true;
    if (typeof window !== "undefined" && typeof document !== "undefined") {
      window.addEventListener("online", onOnline);
      document.addEventListener("visibilitychange", onVisibility);
      listening = true;
    }
    void pull();
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    disarm(debounce);
    disarm(retryTimer);
    if (listening) {
      window.removeEventListener?.("online", onOnline);
      document.removeEventListener?.("visibilitychange", onVisibility);
      listening = false;
    }
    registry.delete(entry);
    refresh();
  }

  registry.add(entry);
  refresh();
  return { start, changed, pull, flushNow, getState: () => state, dispose };
}
