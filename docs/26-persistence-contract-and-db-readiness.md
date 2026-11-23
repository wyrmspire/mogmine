# 26 — Persistence Contract and Database-Readiness Checklist

**Issue:** #173 · **Decision:** [D-012](../DECISIONS.md) · **Boundary:** [docs/22](22-development-mode-and-backend-boundary.md)  
**Status:** Contract (#173). Local/mock adapter (#175): `lib/persistence/local-adapter.ts` and `lib/persistence/select.ts`, selected by `NEXT_PUBLIC_PERSISTENCE_ADAPTER`. No migration, no UI change. The UI stores still read the device keys directly.

Code: [`lib/persistence/contract.ts`](../lib/persistence/contract.ts) (types) and [`lib/persistence/registry.ts`](../lib/persistence/registry.ts) (this checklist as data, pinned by `lib/__tests__/persistence-contract.test.ts`). When this page and the registry disagree, fix both in one PR.

## 1. Shared-project rules (D-012)

- MogMine shares the Supabase project `showmob-dev` (ref `vsasmtsifuylhfrrsrso`). The paused `mogmine` project is not used.
- Every MogMine table, storage path and function is prefixed `mogmine_`. MogMine never creates, alters, reads or writes a `showmob_` table. `isMogmineTable()` is the check.
- Auth users are shared with Showmob. A Showmob sign-up is a valid `auth.users` row, so RLS must key on `user_id = auth.uid()`; nothing may assume "every user is a MogMine user". OD-2 (one allow-listed user, sign-ups off) still applies to MogMine data access.
- Migrations live in `supabase/migrations/` and are applied with the Supabase CLI on the VM. Smoke-test Showmob after any shared migration (docs/22).

## 2. Contract shape

| Piece | Meaning |
| :--- | :--- |
| `CollectionRepository<T>` | Many rows per owner: `list`, `get`, `put` (whole-record upsert), `remove`, `replaceAll` (backup restore). |
| `SingletonRepository<T>` | One document per owner: `get` (null before first write), `put`. Prefs, mood registry, prompt library. |
| `CandleCacheRepository` | Shared market data keyed by string: `get`, `put`. Not owned by a user. |
| `JournalRepositories` | The full set, one repository per `RecordTypeKey`. #175 and #176 implement exactly this. |
| `PersistResult<T>` / `PersistError` | Adapters return results, never throw for expected failures. Codes: `not_found`, `conflict`, `invalid`, `unauthenticated`, `forbidden`, `unavailable`, `unknown`. |
| `Stored<T>` / `RowMeta` | The record plus `user_id`, `created_at`, `updated_at`. Postgres owns these server-side; device adapters synthesize them. |
| `WriteOptions.expectedUpdatedAt` | Optional optimistic concurrency. Omitted = last write wins (v1 default, single user). |

Identity and ownership rules:

1. **Ids are client-generated strings.** Seeds and samples use non-UUID ids (`seed:cut`, demo trade ids), so `id` columns are `text`, primary key `(user_id, id)`.
2. **Every `mogmine_` row has a `user_id uuid not null references auth.users`.** Types whose domain shape lacks `user_id` (`MoodRecord`, `MoodSpokeCandidate`, `MoodSpokeRegistry`, `BalanceCheck`, `Prefs`) are `stamped`: the adapter writes the column, the domain type does not change.
3. **`demo-owner` maps to `auth.uid()` on import.** Device records carry `DEFAULT_OWNER_USER_ID`; the Supabase adapter rewrites it to the signed-in user and refuses (`forbidden`) any other foreign `user_id`.
4. **Timestamps are ISO-8601 UTC strings** in the domain and `timestamptz` in Postgres. Domain timestamps (`entry_time`, `made_at`, `recorded_at`…) are data; `RowMeta` timestamps are bookkeeping and never replace them.
5. **Derived values are never written** (`derivedNeverStored` per type): call grades and `after_the_fact`, mood suggestions, session review, live challenge progress, account balance, trade-document views, P&L / R / MAE / MFE.
6. **Samples are rows like any other** with `is_sample = true` (trades) and are excluded from statistics by callers (`ListQuery.includeSamples`), never by the adapter silently.

## 3. Checklist per record type

RLS `own` = select/insert/update/delete all require `user_id = auth.uid()`. `shared_read` = authenticated select; writes via service role only.

| Type (`key`) | Domain type | Device storage today | Planned table | Owner | RLS | Backup | Delete | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `trades` | `TradeRecord` | `mogmine-trades-v3` | `mogmine_trades` | `user_id` | own | yes | hard | v1 |
| `mood_records` | `MoodRecord` | `mogmine-mood-v1` `.records` | `mogmine_mood_records` | stamped | own | yes | with trade | v1 |
| `mood_candidates` | `MoodSpokeCandidate` | `mogmine-mood-v1` `.candidates` | `mogmine_mood_candidates` | stamped | own | yes | hard | v1 |
| `mood_registry` | `MoodSpokeRegistry` | `mogmine-mood-v1` `.registry` | `mogmine_mood_registries` | stamped | own | yes | — | v1 (singleton) |
| `prefs` | `Prefs` | `mogmine-prefs-v1` | `mogmine_user_prefs` | stamped | own | yes | — | v1 (singleton) |
| `accounts` | `TradingAccount` | `mogmine-accounts-v1` `.accounts` | `mogmine_accounts` | `user_id` | own | yes | archive | v1 |
| `balance_checks` | `BalanceCheck` | `mogmine-accounts-v1` `.checks` | `mogmine_balance_checks` | stamped | own | yes | with account | v1 |
| `challenges` | `ChallengeDefinition` | `mogmine-challenges-v1` | `mogmine_challenges` | `user_id` | own | yes | hard | v1 |
| `playbooks` | `Playbook` / `PlaybookRule` | `mogmine-playbooks-v1` | `mogmine_playbooks` | `user_id` | own | yes | archive | v1 |
| `plans` | `PlanningSession` / `PlanRevision` / `PlannedLevel` | `mogmine-plans-v1` | `mogmine_plans` | `user_id` | own | yes | hard | v1 |
| `drills` | `DrillRecord` | `mogmine-drills-v1` | `mogmine_drills` | `user_id` | own | yes | with trade | v1 |
| `calls` | `DiscretionCall` | `mogmine-calls-v1` `.calls` | `mogmine_calls` | `user_id` | own | yes | hard | v1 (storage only; UI is OD-52) |
| `prompt_dismissals` | `PromptDismissal` | `mogmine-calls-v1` `.dismissals` | `mogmine_prompt_dismissals` | `user_id` | own | yes | with trade | v1 |
| `prompt_library` | `PromptLibraryV1` / `ReviewPrompt` | none (seeded in code) | `mogmine_prompt_libraries` | `user_id` | own | no | — | deferred |
| `candles` | `Candle[]` | IndexedDB `mogmine` / `candles` | `mogmine_market_candles` | shared | shared_read | no | — | deferred (#70) |

Migration notes for #176:

- Nested arrays stay on the parent row as `jsonb` in v1: trade `stop_moves`, `checklist_state`, `quick_tags` (`text[]`), plan `levels` and `revisions`, playbook `checklist_rules`, call `reasons` / `trigger` / `rule`, mood `scores` / `evidence`. Splitting them into child tables waits for a query that needs it (no abstraction before the third repetition).
- Trade notes stay on `mogmine_trades`; docs/06's separate `trade_notes` table is not built in v1.
- Foreign keys (`account_id`, `playbook_id`, `trade_id`, `plan_session_id`) are composite `(user_id, id)` references or unenforced in v1; "with parent" deletes become `on delete cascade` only where the row is meaningless without the parent (mood records, balance checks, drills, dismissals). Calls keep `trade_id` nullable and survive a trade delete.
- Keep the device sanitizers (`sanitizeCall`, `normalizeTrade`, …) as the single validator: adapters run them on read and write, so Supabase rows and localStorage rows obey the same rules.
- Backup files (`JournalBackup`, version 1) keep working unchanged and remain the device ↔ server migration path: export on device, `replaceAll` per type on the server.

## 4. Explicit persist-or-defer decisions

| Item | Decision | Reason |
| :--- | :--- | :--- |
| **Partials** (`PartialExit`, `PartialTarget`, `lib/partials.ts`) | **Deferred.** When a UI records them, they become optional `TradeRecord` fields `partial_exits?: PartialExit[]` and `partial_targets?: PartialTarget[]`, stored as `jsonb` on `mogmine_trades`, using the `lib/partials.ts` shapes unchanged. | Avoids a third shape. A fills ledger (below) would supersede `partial_exits` and is owner-gated by OD-5. |
| **Prompt library** | **Deferred.** Seeded in code; the contract has a singleton repository for it. Persist when a prompt editor ships. | Nothing customizes it yet; storing the seed would freeze it and block seed upgrades. |
| **Candles / archive** | Device cache stays IndexedDB, not in backups. Server archive is `mogmine_market_candles`, `mogmine_market_coverage`, `mogmine_market_archive_jobs` (#70 / docs/10), `shared_read`. **Deferred, owner-gated.** | #70 / PR #71 is not merged here. |
| `executions` / fills ledger | **Deferred** (`mogmine_executions`). | OD-5 is open; not closed here. |
| `trade_candles` | **Out of v1.** Replaced by the shared candle archive keyed by symbol/timeframe/time, not per trade. | docs/06 warning: per-trade copies duplicate bars. |
| `trade_companion_charts` | **Deferred** (`mogmine_trade_companion_charts`). | No companion-chart attachment UI yet. |
| `session_levels` | **Deferred.** Planned levels already live on `mogmine_plans`; computed PDH/PDL/ON levels stay derived from candles. | Avoid a second source of levels. Session calendars stay `#65` / OD-35. |
| `economic_events` | **Out of v1.** | No feed chosen. |
| `ai_reviews` | **Deferred** (`mogmine_ai_reviews`). | AI review engine not built. |
| Trade Card / chart snapshot files | **Deferred.** Storage bucket `mogmine-cards`, object path `<user_id>/…`, owner-only policies. | Cards render on device today. |
| `user_preferences` | **v1** as `mogmine_user_prefs` (the `prefs` singleton). | — |

Computed, never stored: session review, challenge results while live, call grades, `after_the_fact`, mood suggestions, trade-document marks and views, P&L / R.

## 5. Open questions (not decided here)

- **Conflict policy across devices.** v1 is last-write-wins; `expectedUpdatedAt` exists for when two devices edit the same trade.
- **Sample trades on the server.** Store them per user (current plan) or seed them client-side only? Affects backup size and statistics filters.
- **OD-2 enforcement** with shared auth users: an allow-list table (`mogmine_allowed_users`) or a claim on the user. Needed before #176 exposes data.
- Owner-gated and untouched: OD-52 (call-sheet UI), OD-55 (Yahoo `1m` coverage fallback), `#65` / OD-35 (session calendars), OD-5 (fills).

## 6. For the next issues

- **#174 command layer:** call `JournalRepositories` only; validate with the existing sanitizers before `put`; surface `PersistError.message` to the trader.
- **#175 local/mock adapter (done):** the adapter reads and writes the §3 device keys with the existing sanitizers and synthesizes `RowMeta` (see the adapter header). `NEXT_PUBLIC_PERSISTENCE_ADAPTER` picks `local` (default) / `mock` / `supabase` (stub, `unavailable`). The shared suite is `lib/__tests__/persistence-contract-suite.ts`.
- **#176 Supabase adapter:** one migration per table in §3 marked v1, all `mogmine_`, RLS on every table before data, shared contract tests run against both adapters.
