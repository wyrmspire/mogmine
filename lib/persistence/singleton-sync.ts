// #191: the sync layer for one document per owner (prefs today; docs/26 §8). The same rules as store-sync.ts, for one
// value instead of a list: the device cache is always written first by the store; this layer copies the value to and
// from the Supabase singleton repository in the background. A clean device copy takes the server copy; a dirty one
// (edited since the server last saw it) is kept and pushed; nothing dirty is ever lost. Last write wins on push.
// Pure TypeScript: no React, no SDK import. The adapter comes from `getPersistence()` unless a test injects one.
import { getPersistence } from "./select.ts";
import type { KeyValueStore } from "./local-adapter.ts";
import type { PersistError, PersistenceAdapter, SingletonKey, SingletonRepository } from "./contract.ts";
import { fingerprint, notifySyncChanged, registerSyncEntry, remoteSyncEnabled } from "./store-sync.ts";
import type { SyncState } from "./store-sync.ts";
import { SYNC_PREFIX, backoffDelay, browserStorage, keepOrphans, readDeviceOwner, writeDeviceOwner } from "./sync-storage.ts";

export interface SingletonSyncOptions<T> {
  key: SingletonKey;
  /** The store's current value. Read at merge and push time, not when the syncer is created. */
  getLocal(): T;
  /** The store replaces its value with `next` and writes its device cache. */
  apply(next: T): void;
  /**
   * What a device that was never edited holds (prefs: the defaults). With no base for this owner yet, a local value
   * equal to this one counts as clean, so a fresh device adopts the server copy instead of overwriting it with defaults.
   */
  unedited?: T;
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

export interface SingletonSync {
  /** Call once at the end of the store's hydrate. No-op when disabled. Starts `pull()`. */
  start(): void;
  /** Call after every local change the store persists. Debounced push. */
  changed(): void;
  /** Fetch, merge and push. Safe to call repeatedly; in-flight calls are joined. */
  pull(): Promise<void>;
  /** Push now. True when nothing is left unsent. */
  flushNow(): Promise<boolean>;
  getState(): SyncState;
  /** Clear timers and listeners. */
  dispose(): void;
}

/**
 * Device metadata for one singleton: `{ owner, fp }`, the owner the base belongs to and the fingerprint the server is
 * known to hold. Same key space as store-sync's base (`mogmine-sync-v1:base:<key>`); singleton keys never collide with
 * collection keys, so the shapes do not meet. Garbage reads as no base.
 */
interface SingletonBase {
  owner: string | null;
  fp: string | null;
}

function readSingletonBase(storage: KeyValueStore, key: string): SingletonBase {
  const raw = storage.getItem(`${SYNC_PREFIX}:base:${key}`);
  if (raw === null) return { owner: null, fp: null };
  try {
    const value = JSON.parse(raw) as Partial<SingletonBase> | null;
    return {
      owner: typeof value?.owner === "string" ? value.owner : null,
      fp: typeof value?.fp === "string" ? value.fp : null,
    };
  } catch {
    return { owner: null, fp: null };
  }
}

function writeSingletonBase(storage: KeyValueStore, key: string, base: SingletonBase): void {
  storage.setItem(`${SYNC_PREFIX}:base:${key}`, JSON.stringify(base));
}

/** The fingerprint the server holds for `owner`. A base saved for someone else counts as none. */
function baseFingerprintFor(base: SingletonBase, owner: string): string | null {
  return base.owner === owner ? base.fp : null;
}

const SIGNED_OUT_MESSAGE = "Sign in to sync your journal.";
const FLUSH_BLOCKED = new Set<PersistError["code"]>(["unauthenticated", "unavailable", "unknown"]);
const PULL_IDLE_REFRESH_MS = 60_000;

interface Timer { handle: unknown; armed: boolean }

export function createSingletonSync<T>(options: SingletonSyncOptions<T>): SingletonSync {
  const { key } = options;
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

  const repoOf = (adapter: PersistenceAdapter) => adapter.repositories[key] as unknown as SingletonRepository<T>;
  const isoNow = () => new Date(now()).toISOString();

  function setState(status: SyncState["status"], message: string | null = null, lastSyncedAt = state.lastSyncedAt) {
    state = { status, message, lastSyncedAt };
    notifySyncChanged();
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
    const got = await repoOf(adapter).get(owner);
    if (disposed) return;
    if (!got.ok) {
      pullFailed(got.error);
      return;
    }

    const remote = got.value;
    const local = options.getLocal();
    const localFp = fingerprint(key, local);
    const baseFp = baseFingerprintFor(readSingletonBase(storage, key), owner);
    const deviceOwner = readDeviceOwner(storage, key);
    // Another user's device value: keep a copy under their id, never push it. The server value (if any) wins.
    const foreign = deviceOwner !== null && deviceOwner !== owner;
    if (foreign && deviceOwner !== null) keepOrphans(storage, key, deviceOwner, [local]);

    let next: T = local;
    // The fingerprint the server is known to hold after this pull. Equal to the local one means nothing to push.
    let serverFp: string | null = null;
    if (remote) {
      serverFp = fingerprint(key, remote.record);
      const unedited = options.unedited !== undefined ? fingerprint(key, options.unedited) : null;
      const clean = foreign || (baseFp !== null ? localFp === baseFp : unedited !== null && localFp === unedited);
      if (clean) next = remote.record;
    } else {
      // Nothing on the server. Keep the base for this owner: a first import has none, so the value is pushed; a value
      // set aside as another user's was marked as held here, so it stays on the device and is not pushed.
      serverFp = foreign ? localFp : baseFp;
    }
    if (fingerprint(key, next) !== localFp) options.apply(next);

    writeDeviceOwner(storage, key, owner);
    writeSingletonBase(storage, key, { owner, fp: serverFp });
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

  // ---- Push: one write when the local value differs from what the server is known to hold. ----------------------

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

    const local = options.getLocal();
    const localFp = fingerprint(key, local);
    if (baseFingerprintFor(readSingletonBase(storage, key), owner) === localFp) {
      setState("synced", null, isoNow());
      return true;
    }

    setState("syncing", null, state.lastSyncedAt);
    const result = await repoOf(adapter).put(owner, local); // last write wins: no expectedUpdatedAt
    if (disposed) return false;
    if (result.ok) {
      writeSingletonBase(storage, key, { owner, fp: localFp }); // what was sent, not what came back: never loops
      retryStep = 0;
      setState("synced", null, isoNow());
      return true;
    }
    const { error } = result;
    if (error.code === "unauthenticated") {
      setState("signed-out", SIGNED_OUT_MESSAGE);
    } else if (FLUSH_BLOCKED.has(error.code)) {
      setState("pending", error.message);
      scheduleRetry(() => void flushNow());
    } else {
      setState("error", error.message); // refused by the server: retried on the next change or pull, not in a loop
    }
    return false;
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
    if (!pulled) return Promise.resolve(false); // the first pull decides what to send; nothing goes out before it
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
    unregister();
    disposed = true;
    disarm(debounce);
    disarm(retryTimer);
    if (listening) {
      window.removeEventListener?.("online", onOnline);
      document.removeEventListener?.("visibilitychange", onVisibility);
      listening = false;
    }
  }

  const unregister = registerSyncEntry({ getState: () => state });
  return { start, changed, pull, flushNow, getState: () => state, dispose };
}
