# 26 — Persistence Contract and Database-Readiness Checklist

**Issue:** #173 · **Decision:** [D-012](../DECISIONS.md) · **Boundary:** [docs/22](22-development-mode-and-backend-boundary.md)  
**Status:** Contract (#173). Command layer (#174): `lib/commands/journal-commands.ts`. Local/mock adapter (#175): `lib/persistence/local-adapter.ts` and `lib/persistence/select.ts`, selected by `NEXT_PUBLIC_PERSISTENCE_ADAPTER`. Supabase adapter (#176): `lib/persistence/supabase-adapter.ts` over the `mogmine_` tables in `supabase/migrations/` (applied to `showmob-dev`, §7). Background sync of every journal store (#190 to #193, hardened in #194): §8. With `NEXT_PUBLIC_PERSISTENCE_ADAPTER=supabase` the device cache is still written first; the default stays `local`.

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
| `candles` | `Candle[]` | IndexedDB `mogmine` / `candles` | `mogmine_market_candles` | shared | shared_read | no | — | archive live; app adapter deferred (#70) |

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
| **Candles / archive** | Device cache stays IndexedDB, not in backups. Server archive uses `mogmine_market_candles` and `mogmine_market_coverage`; runs and unadjusted contract changes use `mogmine_market_archive_jobs` and `mogmine_market_rolls`. All are `shared_read`. | Owner approved #70 on 2026-11-26. The Databento `MES=F` 1m backfill covers session dates 2026-08-25 through 2026-11-24 and Yahoo continues it forward. Databento is authoritative: loading a covered session deletes its Yahoo rows first, including Yahoo-only minutes, and a database trigger prevents Yahoo from replacing an existing Databento bar. App archive-first reads remain deferred. |
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
- ~~**OD-2 enforcement** with shared auth users~~: resolved in #176 by `mogmine_allowed_users` (§7).
- Owner-gated and untouched: OD-52 (call-sheet UI), OD-55 (Yahoo `1m` coverage fallback), `#65` / OD-35 (session calendars), OD-5 (fills).

## 6. For the next issues

- **#174 command layer (built):** [`lib/commands/journal-commands.ts`](../lib/commands/journal-commands.ts) `createJournalCommands(repos, owner)` exposes `create` / `read` / `list` / `update` / `archive` / `remove` for every collection key and `readSingleton` / `writeSingleton` for the three singletons. It calls `JournalRepositories` only, validates every write with the existing sanitizers (money must be whole cents or a tick-valid price; a bad stop move rejects the whole trade), returns `PersistError`s and never throws for expected failures. Archive-policy types (`accounts`, `playbooks`) are archived, not removed; `remove` deletes `cascade_parent` children first. `candles` is not part of the command set. Tests: `lib/__tests__/journal-commands.test.ts`.
- **#175 local/mock adapter (done):** the adapter reads and writes the §3 device keys with the existing sanitizers and synthesizes `RowMeta` (see the adapter header). `NEXT_PUBLIC_PERSISTENCE_ADAPTER` picks `local` (default) / `mock` / `supabase` (stub, `unavailable`). The shared suite is `lib/__tests__/persistence-contract-suite.ts`.
- **#176 Supabase adapter (done):** see §7. The shared contract suite runs against it on a fake client (`lib/__tests__/fake-supabase.ts`).
- **#182 sign-in (built):** `/login` sends a magic link (`signInWithOtp`, `shouldCreateUser: false`) over the implicit flow, so the link also works when it opens in another browser (iPhone Mail). The gate runs only in `supabase` mode (`components/AuthGate.tsx`). A user gets in only when their own `mogmine_allowed_users` row is readable; otherwise "Not authorized" shows and AppShell never mounts. Sign-out is in the header. Supabase's built-in mailer allows 2 sign-in emails an hour; the screen says so.
- **#185a agent API (built):** `Authorization: Bearer mmk_…` → `mogmine_agent_tokens` looked up BY SHA-256 HASH with the service role (its only reads and writes, with `last_used_at` and the audit log) → the owner's session minted with admin `generateLink` + anon `verifyOtp` (no email sent), so RLS and the allow-list decide every journal row. Scopes: `read` for GET, `write` for other methods (`write` does not imply `read`). Rate limit 120 requests a minute per key, per server instance (best effort). One `mogmine_agent_audit` row per authenticated request. Routes: `/api/v1/me`; `/api/v1/records/[type]` (GET list, POST); `…/[id]` (GET, PATCH, DELETE); `…/[id]/archive` (POST); `/api/v1/singletons/[key]` (GET, PUT). Off unless `NEXT_PUBLIC_PERSISTENCE_ADAPTER=supabase`, the URL and anon key, and `SUPABASE_SERVICE_ROLE_KEY` are all set. Minting a session replaces any magic link the owner requested but has not opened, so the owner signs in on the phone before agent use. The session is cached for its lifetime (about an hour) and refreshed inside the last 2 minutes.
- **#185b agent keys and discovery (built):** `/settings/agent` (behind the #182 sign-in; a header key icon and an "Agent keys" link on the login screen). A key is created with a label and read-only or read-and-write scope, shown once in a setup block (base URL, spec URL, `Authorization: Bearer` header, key) for an assistant, Custom GPT Action or MCP config, and revoked from the list (revoke only; a revoked key never returns). The page also lists the last 20 agent requests. Public discovery: `GET /api/v1/openapi.json` (OpenAPI 3.1, generated from the route list and the registry enums, bearer auth declared, no data) and `GET /.well-known/mogmine.json` (base URL, spec URL, auth, scopes, version, and whether the API is on). Keys are created in the browser through RLS (`lib/agent/keys-client.ts`); the plaintext never reaches storage. See `lib/agent/openapi.ts`.
- **#190 shared sync layer and trade journal (built):** `lib/persistence/store-sync.ts` (§8). With `NEXT_PUBLIC_PERSISTENCE_ADAPTER=supabase` the trade journal is copied to `mogmine_trades` in the background. #191 to #194 extend this to every store (§8 table).

## 7. Supabase schema and access (#176)

**Migrations** (`supabase/migrations/`, applied to `showmob-dev` on 2026-11-23; file names are the applied versions):

| File | What |
| :--- | :--- |
| `20261123004734_mogmine_journal_v1.sql` | Allow-list, 13 journal tables, RLS, triggers, cascade backstop, `mogmine_replace_rows` |
| `20261123004804_mogmine_allowed_invoker.sql` | `mogmine_is_allowed()` runs as the caller (clears security advisor 0029) |
| `20261123004848_mogmine_journal_grants.sql` | Table grants for `authenticated` / `service_role` (this project gives new tables no DML by default) |
| `20261123021202_mogmine_agent_tokens.sql` | #185: `mogmine_agent_tokens` (SHA-256 hash only, scopes, revoke-only update) and `mogmine_agent_audit`; RLS, owner reads own rows; the service role only looks up by hash, sets `last_used_at` and writes the audit log |
| `20261126073815_mogmine_market_archive.sql` | #70: shared `mogmine_market_candles` and `mogmine_market_coverage`; forced RLS, authenticated read, service-role-only writes; Databento and Yahoo sources |
| `20261126081228_mogmine_market_source_precedence_and_rolls.sql` | #70 follow-up: immutable Databento-over-Yahoo precedence, archive-run log, and unadjusted contract-roll ledger; forced RLS, authenticated read, service-role-only writes |

**Tables.** `mogmine_allowed_users` plus one table per v1 row in §3: `mogmine_trades`, `mogmine_mood_records`, `mogmine_mood_candidates`, `mogmine_accounts`, `mogmine_balance_checks`, `mogmine_challenges`, `mogmine_playbooks`, `mogmine_plans`, `mogmine_drills`, `mogmine_calls`, `mogmine_prompt_dismissals` (collections: primary key `(user_id, id)`, `id text`), and the singletons `mogmine_user_prefs`, `mogmine_mood_registries` (primary key `user_id`). Every row has `user_id uuid references auth.users`, `record jsonb`, `created_at`, `updated_at`.

**Row shape.** `record` is the sanitized domain record (nested arrays stay inside it; fields a sanitizer passes through, e.g. via `normalizeTrade`, ride along as the jsonb catch-all). Query columns are `GENERATED ALWAYS ... STORED` from `record`, so they cannot drift: trades `symbol`, `status`, `entry_time`, `account_id`, `playbook_id`, `is_sample`; `trade_id` on mood records, drills, dismissals and calls; `account_id` on balance checks; `archived` on accounts and playbooks. `created_at` / `updated_at` are set by a trigger (millisecond precision, `created_at` cannot be rewritten).

**Access (OD-2).** RLS is on for every table. One policy per journal table, for `authenticated` only: `user_id = auth.uid() AND mogmine_is_allowed()`, on both `using` and `with check`. `mogmine_allowed_users` holds the owner's auth uid (seeded with SQL, not in a migration; signed-in users can read only their own row; only `service_role` / SQL can write it). `anon` has no privileges on any `mogmine_` table or function. A Showmob sign-up is a valid `auth.users` row, but it is not on the allow-list, so it sees and writes nothing.

**Adapter rules** (`lib/persistence/supabase-adapter.ts`):

- Owner: the session's `auth.uid()`. `demo-owner` is rewritten to it; any other owner lists nothing, `get` is `not_found`, writes are `forbidden`. A record claiming another `user_id` is `forbidden`.
- Every write and read goes through the device sanitizers (`sanitizeCollectionRecord` / `sanitizeSingletonRecord`); `derivedNeverStored` fields (and `candles`) are stripped before a write and recomputed on read.
- `expectedUpdatedAt` is a guarded `UPDATE ... WHERE updated_at = expected`; no row back is `conflict`. Omitted means last write wins (upsert).
- Cascades: the command layer deletes children by `parentId` first; an `after delete` trigger on trades and accounts is the backstop. Foreign keys between journal tables stay unenforced (restores may insert children first). `replaceAll` calls `mogmine_replace_rows` (one transaction, security invoker, `mogmine_` collection tables only, cascade backstop off for the restore).
- `prompt_library` is memory-only. Candles still use the device cache in the app; #70 now has a server archive, but wiring `CandleCacheRepository` to it is a later slice.
- Candle source precedence is not last-write-wins: Databento may replace Yahoo, but Yahoo must never replace Databento. A Databento session load deletes every Yahoo row in the complete Chicago session before upserting, so missing trade minutes stay missing instead of forming a mixed-source session. `mogmine_market_rolls` records unadjusted contract changes and their new-minus-old spread; chart/trade prices are never back-adjusted.
- Browser client: anon key + session only (`lib/persistence/supabase-client.ts`, loaded lazily). The service-role key is never used by the adapter.

**Applying a new MogMine migration.** This repo does not hold Showmob's 8 migrations, so `supabase db push` refuses ("remote migration versions not found locally") and suggests `migration repair`. **Never repair or squash Showmob's history.** Apply MogMine migrations with the Supabase MCP `apply_migration` (or the SQL editor), then save the file under the version it was recorded as (`supabase migration list --remote` on the VM shows it). Review first that the SQL touches only `mogmine_` objects (`lib/__tests__/persistence-supabase-adapter.test.ts` checks the files), and run the security advisor after. The VM CLI is linked to `vsasmtsifuylhfrrsrso`; its token lives in `~/.config/supabase/agent.env`, never in the repo.

**Turning it on** (not done in #176): set `NEXT_PUBLIC_PERSISTENCE_ADAPTER=supabase`, `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in a local `.env.local` or a Vercel preview, and sign in (#182). Production stays `local` until the owner decides.

## 8. Background sync of every store (#190 to #194)

Code: collections in [`lib/persistence/store-sync.ts`](../lib/persistence/store-sync.ts) (`createCollectionSync`, `getSyncSummary`); singletons in [`lib/persistence/singleton-sync.ts`](../lib/persistence/singleton-sync.ts) (`createSingletonSync`). Shared: [`sync-fingerprint.ts`](../lib/persistence/sync-fingerprint.ts), [`sync-storage.ts`](../lib/persistence/sync-storage.ts), [`sync-status.ts`](../lib/persistence/sync-status.ts). Each store wires its syncer(s) in `lib/<store>.ts`; the header reads the aggregate status through `components/useSyncSummary.ts` and `AppShell.tsx`.

### 8.1 What syncs

| Record type (`key`) | Device storage | Supabase | Reason |
| :--- | :--- | :--- | :--- |
| `trades` (real trades) | `mogmine-trades-v3` | **synced** `mogmine_trades` | The journal. |
| `trades` (samples, `is_sample`) | `mogmine-trades-v3` | **device-only** | Sample trades are fixtures, never the trader's data (`include: !is_sample`). |
| `mood_records` | `mogmine-mood-v1` `.records` | **synced** `mogmine_mood_records` | Scores are user data. Rows about sample trades stay on the device (`notOnSampleTrade`, #193 review). |
| `mood_candidates` | `mogmine-mood-v1` `.candidates` | **synced** `mogmine_mood_candidates` | Trader-facing "Add spoke?" state. |
| `mood_registry` | `mogmine-mood-v1` `.registry` | **synced** `mogmine_mood_registries` (singleton) | The spoke list; a spoke added on one device appears on the others (#194). |
| `mood` suggestions | `mogmine-mood-v1` `.suggestions` | **device-only, session-only** | Derived from notes (`derivedNeverStored`); kept for the session and the device cache, never sent. |
| `prefs` | `mogmine-prefs-v1` | **synced** `mogmine_user_prefs` (singleton) | Preferences follow the trader. |
| `accounts` | `mogmine-accounts-v1` `.accounts` | **synced** `mogmine_accounts` (archive policy) | Removes become archives on the server (`forbidden` remove → `gone`). |
| `balance_checks` | `mogmine-accounts-v1` `.checks` | **synced** `mogmine_balance_checks` | Removable; no foreign key, so any push order works. |
| `challenges` | `mogmine-challenges-v1` | **synced** `mogmine_challenges` | Definitions only; live progress is derived (never stored). |
| `playbooks` | `mogmine-playbooks-v1` | **synced** `mogmine_playbooks` (archive policy) | Untouched seed playbooks yield to the server copy (`pristine`, #192 review). |
| `plans` | `mogmine-plans-v1` | **synced** `mogmine_plans` | The planning sessions. |
| `drills` | `mogmine-drills-v1` | **synced** `mogmine_drills` | Answers are append-only; answers about sample trades stay on the device (#192 review). |
| `calls` | `mogmine-calls-v1` `.calls` | **synced** `mogmine_calls` | Calls about sample trades stay on the device (#193 review). |
| `prompt_dismissals` | `mogmine-calls-v1` `.dismissals` | **synced** `mogmine_prompt_dismissals` | Same rule as calls. |
| `prompt_library` | none (seeded in code) | **not synced** (memory-only, deferred) | Nothing customizes it yet (§4). |
| `candles` | IndexedDB `mogmine` / `candles` | **not synced** (device cache, #70) | Market data is re-fetched; the server archive is owner-gated (§4). |
| Sync metadata | `mogmine-sync-v1:*` | **device-only** | Per-device bookkeeping (§8.3). |

Derived values (call grades, `after_the_fact`, challenge progress, session review, P&L / R, mood suggestions) are never written (`derivedNeverStored`).

### 8.2 Rules

- **Device first.** The store writes its device key before anything else; the syncer runs after and only when the adapter is `supabase`. A failure of the device write wins the header status.
- **Fingerprint.** Stable JSON of the record without `user_id`, `candles` and `derivedNeverStored`, cyrb53 plus length. A record is dirty when its fingerprint differs from the base.
- **Collection merge (pull).** A clean local record takes the server copy. A dirty local record (edited since the server last saw it) is kept and pushed. A server delete is applied only to a clean record; a dirty record the server dropped is kept and sent again (no data loss). A local delete is pushed only when the server had the record. A refused remove (archive policy) is remembered in `gone` and never retried or re-added.
- **Singleton merge (pull).** The same rule for one value. A clean device copy takes the server copy; a dirty one is pushed. Where the store passes `unedited` (prefs, the mood registry: the starting values), a fresh device with no base adopts the server copy instead of overwriting it with defaults.
- **Last write wins.** Pushes send whole records with no `expectedUpdatedAt`. The base changes only after a confirmed write or read, so a push never loops.
- **Debounce and push order.** Changes are debounced 800 ms. Writes go first, then removes. A push stops at the first unreachable or unauthenticated answer.
- **1000-row cap guard.** PostgREST returns at most `REMOTE_ROW_CAP` (1000) rows. A full page may be cut short, so a missing row proves nothing: a full page never deletes a clean local record.
- **Orphan key.** When a different user signs in on the same device, that user's device records are copied to `mogmine-sync-v1:orphan:<key>:<uid>` (an existing copy is never overwritten). Orphans are never pushed and never shown.
- **Backoff.** Unreachable server: `pending`, retried after 5 s, 15 s, 30 s, then 60 s. Refused records (`invalid`): `error` with a count, retried on the next change or pull only, never in a loop.
- **Restore.** Every restore in the Tune screen (`replaceTrades`, `setPrefs`, `restoreMood`, `restoreAccounts`, `restoreChallenges`, `restorePlaybooks`, `restorePlans`, `restoreDrills`, `restoreCalls`) calls the matching syncer's `changed()`. The restored set is then the server's set (records not in the backup are removed, except archive-policy records and samples). `lib/__tests__/sync-restore-and-refresh.test.ts` pins this across every store.
- **Idempotence (#194).** Hydrating a store twice, calling `start()` twice, or pulling with nothing changed starts no new listener, makes no new write, and sends nothing. A token refresh for the same user keeps the auth answer (`keepsCheckedUser`), so AppShell is not unmounted.
- **Session expiry.** An `unauthenticated` answer sets the store to `signed-out`; device data stays. Edits made while signed out are kept, and go out after sign-in and the next pull.

### 8.3 Device sync metadata

Under `mogmine-sync-v1:`: `base:<key>` (what the server is known to hold, by id, plus refused removes), `owner:<key>` (the uid whose device data this cache holds) and `orphan:<key>:<uid>` (see §8.2). Garbage reads as missing.

### 8.4 Known gaps (for the owner)

From the #190 to #193 handoffs. None is fixed in #194; each is a behaviour decision.

1. **First sign-in, same id.** A device record this device has never synced is treated as dirty and overwrites the server copy (collections). For singletons, a device that customized its prefs or spokes before the first sign-in does the same. A newer server edit can be lost on a first upload.
2. **Orphan copies are never restored.** If A signs out, B signs in on the same device, and A signs in again, A's unsynced device-only edits stay under `orphan:<key>:<A>`.
3. **Refused removes are per device.** `gone` lives in device metadata; another device that still holds the id re-pushes it.
4. **Accounts restore.** Dropping an account from a backup leaves the server row active (archive policy). The fix is to push `archived: true`, not a remove.
5. **Playbook restore.** Dropping a playbook from a restore (or an untouched seed the device deleted) leaves the server row active; other devices keep it.
6. **Validation failures** stay in `error` until the record is edited.
7. **Cross-tab.** Trades, accounts, challenges, mood and playbooks take other tabs' device changes (a `storage` listener). Prefs, plans, drills and calls do not, so a second open tab can overwrite them later.
8. **Two tabs.** The base lives in `localStorage` and is shared by tabs. Pushes are idempotent, but a two-tab race is untested.
9. **Not browser-verified.** The header text and tooltip, and the offline banner, have not been checked at 390×844 against a real Supabase project (no network in the build agent).
