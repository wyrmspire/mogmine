// #192: shared helpers for the per-store sync tests. A device shim (localStorage + window) so a store can hydrate in
// Node, manual timers so nothing fires on its own, and read-only views of the fake Supabase server.
import { createMemoryCandleStore, createMemoryKeyValueStore } from "../persistence/local-adapter.ts";
import type { KeyValueStore } from "../persistence/local-adapter.ts";
import { createSupabaseAdapter } from "../persistence/supabase-adapter.ts";
import type { PersistenceAdapter } from "../persistence/contract.ts";
import type { FakeSupabase } from "./fake-supabase.ts";

export const UID = "11111111-2222-4333-8444-555555555555";
export const NOW = Date.parse("2026-11-23T12:00:00.000Z");

/** A timer queue that never fires by itself. `fire()` runs what is pending, as the debounce would after a change. */
export function manualTimers() {
  const timers: { fn: () => void; cancelled: boolean }[] = [];
  return {
    setTimer: (fn: () => void) => {
      const timer = { fn, cancelled: false };
      timers.push(timer);
      return timer;
    },
    clearTimer: (handle: unknown) => {
      (handle as { cancelled: boolean }).cancelled = true;
    },
    live: () => timers.filter((timer) => !timer.cancelled),
    fire: () => {
      for (const timer of timers.splice(0)) if (!timer.cancelled) timer.fn();
    },
  };
}

/** The fake client is pure promises, so one macrotask later every pending push has finished. */
export const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Install `localStorage` and `window` on the global object. Returns the raw map behind the device storage. */
export function installDevice(): Map<string, string> {
  const memory = new Map<string, string>();
  const device = {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => {
      memory.set(key, value);
    },
    removeItem: (key: string) => {
      memory.delete(key);
    },
    clear() {
      memory.clear();
    },
    key: () => null,
    length: 0,
  };
  Object.defineProperty(globalThis, "localStorage", { configurable: true, writable: true, value: device });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    writable: true,
    value: { localStorage: device, addEventListener() {}, removeEventListener() {} },
  });
  return memory;
}

export function removeDevice() {
  Reflect.deleteProperty(globalThis, "window");
  Reflect.deleteProperty(globalThis, "localStorage");
}

/** The sync options a store test passes to its `configure…SyncForTests` hook. */
export function storeSyncOptions(fake: FakeSupabase, enabled = true) {
  const timers = manualTimers();
  const storage: KeyValueStore = createMemoryKeyValueStore();
  const adapter = adapterFor(fake);
  return {
    timers,
    storage,
    options: {
      enabled,
      adapter: () => adapter,
      storage,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      debounceMs: 800,
      now: () => NOW,
    },
  };
}

export function adapterFor(fake: FakeSupabase): PersistenceAdapter {
  return createSupabaseAdapter({ client: fake, candles: createMemoryCandleStore() });
}

/** A server row's record as the fake database holds it, or undefined. */
export function serverRecord(fake: FakeSupabase, table: string, id: string): Record<string, unknown> | undefined {
  const row = (fake.tables.get(table) ?? []).find((item) => item.user_id === UID && item.id === id);
  return row?.record as Record<string, unknown> | undefined;
}

export function serverIds(fake: FakeSupabase, table: string): string[] {
  return (fake.tables.get(table) ?? []).filter((row) => row.user_id === UID).map((row) => String(row.id)).sort();
}

/** Every call that changed the server (reads are `select`). */
export function writesOf(fake: FakeSupabase): string[] {
  return fake.calls.filter((call) => !call.startsWith("select"));
}
