// #173: the database-readiness checklist as data (docs/26 §3). One entry per record type in `contract.ts`.
// Tests pin the shared-project rules (D-012): every table is `mogmine_`-prefixed and nothing names `showmob_`.
// #176 reads this to write migrations; #175 reads `deviceKey` to wrap the existing stores without moving data.
import type { RecordTypeKey } from "./contract.ts";

/** D-012: every MogMine table, bucket path and function in the shared `showmob-dev` project carries this prefix. */
export const MOGMINE_TABLE_PREFIX = "mogmine_";
/** D-012: never altered, read or written by MogMine. */
export const FORBIDDEN_TABLE_PREFIX = "showmob_";
/** The shared Supabase project (D-012). The paused `mogmine` project is not used. */
export const SUPABASE_PROJECT_REF = "vsasmtsifuylhfrrsrso";

export type Ownership =
  | "user_id" // the domain record carries `user_id` today (Invariant 7)
  | "stamped" // the domain record lacks `user_id`; the adapter stamps the row's `user_id` column
  | "shared"; // market data: not owned; authenticated read, service-role write

export type Readiness =
  | "v1" // gets a `mogmine_` table in #176
  | "deferred" // has a planned table, built when its feature needs it (reason in `notes`)
  | "out_of_v1"; // not stored in v1

export interface RecordContract {
  key: RecordTypeKey;
  /** Domain type(s) and the module that owns sanitizing. */
  domainType: string;
  module: string;
  /** localStorage key or IndexedDB location today; null when not device-persisted. */
  deviceKey: string | null;
  table: string;
  ownership: Ownership;
  /** RLS rule #176 must create. `own` = `user_id = auth.uid()` for select/insert/update/delete. */
  rls: "own" | "shared_read";
  readiness: Readiness;
  /** Included in `JournalBackup` today. */
  inBackup: boolean;
  /** `archive`: no hard delete; old rows are still referenced. `cascade_parent`: deleted with the parent row. */
  deletePolicy: "hard" | "archive" | "cascade_parent";
  /** Parent record type when the row belongs to another (`ListQuery.parentId`). */
  parent?: RecordTypeKey;
  /** Fields that are computed and must never be written as columns. */
  derivedNeverStored: readonly string[];
  notes: string;
}

const own = { rls: "own" as const };

export const RECORD_CONTRACTS: readonly RecordContract[] = [
  { key: "trades", domainType: "TradeRecord", module: "lib/trades.ts, lib/store.ts", deviceKey: "mogmine-trades-v3", table: "mogmine_trades", ownership: "user_id", ...own, readiness: "v1", inBackup: true, deletePolicy: "hard",
    derivedNeverStored: ["candles", "net_pnl", "r_multiple", "hold_seconds", "mae_price", "mfe_price"],
    notes: "Notes, tags, checklist_state, stop_moves stay on the row (jsonb / text[]); no separate trade_notes table in v1. Partials deferred: see docs/26 §4." },
  { key: "mood_records", domainType: "MoodRecord", module: "lib/mood.ts, lib/mood-store.ts", deviceKey: "mogmine-mood-v1#records", table: "mogmine_mood_records", ownership: "stamped", ...own, readiness: "v1", inBackup: true, deletePolicy: "cascade_parent", parent: "trades",
    derivedNeverStored: ["suggestions"], notes: "Suggestions are session-only and stay out of storage and backups." },
  { key: "mood_candidates", domainType: "MoodSpokeCandidate", module: "lib/mood.ts, lib/mood-store.ts", deviceKey: "mogmine-mood-v1#candidates", table: "mogmine_mood_candidates", ownership: "stamped", ...own, readiness: "v1", inBackup: true, deletePolicy: "hard",
    derivedNeverStored: [], notes: "" },
  { key: "mood_registry", domainType: "MoodSpokeRegistry", module: "lib/mood.ts, lib/mood-store.ts", deviceKey: "mogmine-mood-v1#registry", table: "mogmine_mood_registries", ownership: "stamped", ...own, readiness: "v1", inBackup: true, deletePolicy: "hard",
    derivedNeverStored: [], notes: "Singleton per user (primary key user_id); spokes as jsonb." },
  { key: "prefs", domainType: "Prefs", module: "lib/prefs.ts", deviceKey: "mogmine-prefs-v1", table: "mogmine_user_prefs", ownership: "stamped", ...own, readiness: "v1", inBackup: true, deletePolicy: "hard",
    derivedNeverStored: [], notes: "docs/06 `user_preferences`. Singleton per user; whole Prefs as jsonb so new prefs need no migration." },
  { key: "accounts", domainType: "TradingAccount", module: "lib/accounts.ts, lib/accounts-store.ts", deviceKey: "mogmine-accounts-v1#accounts", table: "mogmine_accounts", ownership: "user_id", ...own, readiness: "v1", inBackup: true, deletePolicy: "archive",
    derivedNeverStored: ["balance"], notes: "Balance is derived from starting balance + trades + checks (docs/21)." },
  { key: "balance_checks", domainType: "BalanceCheck", module: "lib/accounts.ts, lib/accounts-store.ts", deviceKey: "mogmine-accounts-v1#checks", table: "mogmine_balance_checks", ownership: "stamped", ...own, readiness: "v1", inBackup: true, deletePolicy: "cascade_parent", parent: "accounts",
    derivedNeverStored: [], notes: "" },
  { key: "challenges", domainType: "ChallengeDefinition", module: "lib/challenges.ts, lib/challenge-store.ts", deviceKey: "mogmine-challenges-v1", table: "mogmine_challenges", ownership: "user_id", ...own, readiness: "v1", inBackup: true, deletePolicy: "hard",
    derivedNeverStored: [], notes: "`final` is stored once at end (frozen history); live progress is computed, never stored." },
  { key: "playbooks", domainType: "Playbook, PlaybookRule", module: "lib/playbooks.ts, lib/playbooks-store.ts", deviceKey: "mogmine-playbooks-v1", table: "mogmine_playbooks", ownership: "user_id", ...own, readiness: "v1", inBackup: true, deletePolicy: "archive",
    derivedNeverStored: [], notes: "checklist_rules jsonb, ordered." },
  { key: "plans", domainType: "PlanningSession, PlanRevision, PlannedLevel", module: "lib/plans.ts, lib/plans-store.ts", deviceKey: "mogmine-plans-v1", table: "mogmine_plans", ownership: "user_id", ...own, readiness: "v1", inBackup: true, deletePolicy: "hard",
    derivedNeverStored: [], notes: "After-session review is computed. levels and revisions jsonb on the row in v1 (revisions are append-only history)." },
  { key: "drills", domainType: "DrillRecord", module: "lib/drills.ts, lib/drills-store.ts", deviceKey: "mogmine-drills-v1", table: "mogmine_drills", ownership: "user_id", ...own, readiness: "v1", inBackup: true, deletePolicy: "cascade_parent", parent: "trades",
    derivedNeverStored: [], notes: "" },
  { key: "calls", domainType: "DiscretionCall", module: "lib/calls.ts, lib/calls-store.ts", deviceKey: "mogmine-calls-v1#calls", table: "mogmine_calls", ownership: "user_id", ...own, readiness: "v1", inBackup: true, deletePolicy: "hard",
    derivedNeverStored: ["grade", "after_the_fact"], notes: "docs/25 §7. Call-sheet UI stays OD-52; storage only." },
  { key: "prompt_dismissals", domainType: "PromptDismissal", module: "lib/calls.ts, lib/calls-store.ts", deviceKey: "mogmine-calls-v1#dismissals", table: "mogmine_prompt_dismissals", ownership: "user_id", ...own, readiness: "v1", inBackup: true, deletePolicy: "cascade_parent", parent: "trades",
    derivedNeverStored: [], notes: "" },
  { key: "prompt_library", domainType: "PromptLibraryV1, ReviewPrompt", module: "lib/discretionary-prompts.ts", deviceKey: null, table: "mogmine_prompt_libraries", ownership: "user_id", ...own, readiness: "deferred", inBackup: false, deletePolicy: "hard",
    derivedNeverStored: [], notes: "Seeded in code; nothing customizes it yet. Persist (singleton jsonb) when a prompt editor ships." },
  { key: "candles", domainType: "Candle[]", module: "lib/idb.ts, lib/candles.ts", deviceKey: "indexeddb:mogmine/candles", table: "mogmine_market_candles", ownership: "shared", rls: "shared_read", readiness: "deferred", inBackup: false, deletePolicy: "hard",
    derivedNeverStored: [], notes: "Device cache stays IndexedDB. Server archive is #70 (with mogmine_market_coverage, mogmine_market_archive_jobs), owner-gated." },
];

export function contractFor(key: RecordTypeKey): RecordContract {
  const found = RECORD_CONTRACTS.find((entry) => entry.key === key);
  if (!found) throw new Error(`No persistence contract for ${key}`);
  return found;
}

/** True only for names a MogMine migration or query may touch (D-012). */
export function isMogmineTable(name: string): boolean {
  return name.startsWith(MOGMINE_TABLE_PREFIX) && !name.startsWith(FORBIDDEN_TABLE_PREFIX) && /^[a-z0-9_]+$/.test(name);
}
