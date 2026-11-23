// #175: picks the persistence adapter from `NEXT_PUBLIC_PERSISTENCE_ADAPTER` (`local`, `mock`, `supabase`).
// Missing, empty or `local/mock` keeps today's device behaviour. `supabase` is a stub until #176: every call
// returns `unavailable`, so nothing silently falls back to the device while a Supabase choice is configured.
import { createLocalAdapter, createMemoryCandleStore, createMemoryKeyValueStore } from "./local-adapter.ts";
import type { CandleStore, KeyValueStore } from "./local-adapter.ts";
import type { AdapterKind, PersistError, PersistenceAdapter } from "./contract.ts";
import { idbGet, idbSet } from "../idb.ts";

export type AdapterChoice = "local" | "mock" | "supabase";

export function chooseAdapter(raw: string | undefined | null): AdapterChoice {
  const value = (raw ?? "").trim().toLowerCase();
  if (value === "mock") return "mock";
  if (value === "supabase") return "supabase";
  return "local"; // "", "local", "local/mock", or anything unknown: today's behaviour.
}

const UNAVAILABLE: PersistError = {
  code: "unavailable",
  message: "Supabase persistence is not built yet (#176). Switch NEXT_PUBLIC_PERSISTENCE_ADAPTER to local or mock.",
  cause: "supabase-adapter-not-built",
};

/** Every repository answers `unavailable`. Used only while the Supabase adapter (#176) is not built. */
export function createUnavailableAdapter(): PersistenceAdapter {
  const fail = async () => ({ ok: false as const, error: UNAVAILABLE });
  const collection = { list: fail, get: fail, put: fail, remove: fail, replaceAll: fail };
  const singleton = { get: fail, put: fail };
  return {
    kind: "supabase" satisfies AdapterKind,
    repositories: {
      trades: collection, mood_records: collection, mood_candidates: collection, accounts: collection,
      balance_checks: collection, challenges: collection, playbooks: collection, plans: collection,
      drills: collection, calls: collection, prompt_dismissals: collection,
      mood_registry: singleton, prefs: singleton, prompt_library: singleton,
      candles: { get: fail, put: fail },
    } as unknown as PersistenceAdapter["repositories"],
    currentOwner: async () => null,
  };
}

export interface AdapterDeps {
  /** Device key-value store. Defaults to `localStorage` (blocked storage makes calls return `unavailable`). */
  store?: KeyValueStore;
  /** Device candle cache. Defaults to the IndexedDB helper in `lib/idb.ts`. */
  candles?: CandleStore;
}

const deviceStore: KeyValueStore = {
  getItem: (key) => localStorage.getItem(key),
  setItem: (key, value) => localStorage.setItem(key, value),
};

const deviceCandles: CandleStore = {
  get: (key) => idbGet(key),
  set: (key, value) => idbSet(key, value),
};

export function createAdapter(choice: AdapterChoice, deps: AdapterDeps = {}): PersistenceAdapter {
  if (choice === "supabase") return createUnavailableAdapter();
  if (choice === "mock") {
    return createLocalAdapter({ kind: "mock", store: createMemoryKeyValueStore(), candles: createMemoryCandleStore() });
  }
  return createLocalAdapter({ kind: "local", store: deps.store ?? deviceStore, candles: deps.candles ?? deviceCandles });
}

let active: PersistenceAdapter | null = null;

/** The adapter the app uses. Chosen once per page load from `NEXT_PUBLIC_PERSISTENCE_ADAPTER`. */
export function getPersistence(): PersistenceAdapter {
  if (!active) active = createAdapter(chooseAdapter(process.env.NEXT_PUBLIC_PERSISTENCE_ADAPTER));
  return active;
}
