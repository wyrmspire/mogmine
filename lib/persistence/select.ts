// #175: picks the persistence adapter from `NEXT_PUBLIC_PERSISTENCE_ADAPTER` (`local`, `mock`, `supabase`).
// Missing, empty or `local/mock` keeps today's device behaviour. `supabase` (#176) uses the `mogmine_` tables on
// `showmob-dev` with the signed-in session; it never silently falls back to the device. Without
// NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY (or a session) its calls return `unavailable` /
// `unauthenticated`.
import { createLocalAdapter, createMemoryCandleStore, createMemoryKeyValueStore } from "./local-adapter.ts";
import { createSupabaseAdapter } from "./supabase-adapter.ts";
import type { SupabaseLike } from "./supabase-adapter.ts";
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
  message: "Journal storage is unavailable. Switch NEXT_PUBLIC_PERSISTENCE_ADAPTER to local or mock.",
  cause: "adapter-unavailable",
};

/** Every repository answers `unavailable`. Kept for callers and tests that need a closed adapter. */
export function createUnavailableAdapter(): PersistenceAdapter {
  const fail = async () => ({ ok: false as const, error: UNAVAILABLE });
  const collection = { list: fail, get: fail, put: fail, remove: fail, replaceAll: fail };
  const singleton = { get: fail, put: fail };
  return {
    kind: "supabase" satisfies AdapterKind,
    repositories: {
      trades: collection, mood_records: collection, mood_candidates: collection, accounts: collection,
      balance_checks: collection, challenges: collection, playbooks: collection, plans: collection,
      drills: collection, calls: collection, prompt_dismissals: collection, daily_reviews: collection,
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
  /** Supabase client for the `supabase` choice. Defaults to the lazily loaded browser client (anon key + session). */
  supabase?: SupabaseLike | (() => Promise<SupabaseLike>);
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
  if (choice === "supabase") {
    const client = deps.supabase ?? (() => import("./supabase-client.ts").then((module) => module.getBrowserSupabase()));
    return createSupabaseAdapter({ client, candles: deps.candles ?? deviceCandles });
  }
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
