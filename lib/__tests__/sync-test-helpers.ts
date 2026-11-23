// #191: helpers shared by the sync tests (no network, no React). Not a test file: node:test runs `*.test.ts` only.
import type { FakeSupabase } from "./fake-supabase.ts";

/** A manual timer queue: nothing fires until the test says so. */
export function manualTimers() {
  const timers: { fn: () => void; ms: number; cancelled: boolean }[] = [];
  return {
    setTimer: (fn: () => void, ms: number) => {
      const timer = { fn, ms, cancelled: false };
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

/**
 * Install a memory `localStorage` and a minimal `window` on globalThis, as a browser would have them. Returns the
 * backing map and an `uninstall` to remove both. No `document`, so the store's browser listeners stay off.
 */
export function installDevice(seed: Record<string, string> = {}) {
  const memory = new Map(Object.entries(seed));
  const device = {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => { memory.set(key, value); },
    removeItem: (key: string) => { memory.delete(key); },
    clear() { memory.clear(); },
    key: () => null,
    length: 0,
  };
  Object.defineProperty(globalThis, "localStorage", { configurable: true, writable: true, value: device });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    writable: true,
    value: { localStorage: device, addEventListener() {}, removeEventListener() {} },
  });
  return {
    memory,
    uninstall() {
      Reflect.deleteProperty(globalThis, "window");
      Reflect.deleteProperty(globalThis, "localStorage");
    },
  };
}

/** Every call that changed the server (reads are `select`). */
export const writesOf = (fake: FakeSupabase) => fake.calls.filter((call) => !call.startsWith("select"));

/** The raw rows of one `mogmine_` table in the fake server. */
export const rowsIn = (fake: FakeSupabase, table: string) => fake.tables.get(table) ?? [];

/** Let every pending microtask (the in-memory fake answers with promises only) run. */
export const settle = () => new Promise((resolve) => setImmediate(resolve));
