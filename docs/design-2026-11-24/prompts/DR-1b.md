# Package Prompt: `DR-1b` — Daily Reviews in Supabase, Sync, and the Agent API

- **Agent / Lane:** `swarm-4` (`L4 Review & days`) · **Wave:** `3` · **Branch:** `swarm/DR-1b`
- **Depends on:** `DR-1a` (W1), `API-2a` (W2)
- **Migration:** `needs_migration: true` — **Put `"MIGRATION NEEDS APPLYING (apply_migration via Supabase MCP)"` at the very top of your handoff and PR body! NEVER run `supabase db push` or apply it yourself.**

## 1. Goal

Register `daily_reviews` in the persistence contract (`contract.ts`, `registry.ts`, `local-adapter.ts`, `supabase-adapter.ts`, `select.ts`), add the additive `mogmine_daily_reviews` SQL migration under `supabase/migrations/`, wire background `createCollectionSync` into `lib/daily-review-store.ts` (degrading gracefully in local mode or when the table is not yet applied), and validate `daily_reviews` in `lib/commands/journal-commands.ts` (returning `409 conflict` with the existing id on duplicate `(session_date, account_id)`), which automatically exposes `/api/v1/records/daily_reviews`.

## 2. Read First (Required Context)

1. `AGENTS.md` (Invariant 7 `user_id`, Guardrail §3b-2 RLS on every table, `D-012` `mogmine_` prefix only on shared `showmob-dev`)
2. `docs/design-2026-11-24/06-daily-review-and-review-cards.md` (§2 rule 5, §2.1 persistence)
3. `docs/design-2026-11-24/90-work-packages.md` (`DR-1b`)
4. `supabase/migrations/20261123004734_mogmine_journal_v1.sql` and `supabase/migrations/20261123004848_mogmine_journal_grants.sql` (exact RLS, trigger, grant, and `mogmine_replace_rows` patterns!)
5. `docs/design-2026-11-24/92-decisions-made-by-swarm.md` (`Q-3`)

## 3. Writable Files (Strict Scope — Everything Else Read-Only)

- `supabase/migrations/20261124120000_mogmine_daily_reviews.sql` *(new — write file ONLY, NEVER apply!)*
- `lib/persistence/contract.ts` *(existing)*
- `lib/persistence/registry.ts` *(existing)*
- `lib/persistence/local-adapter.ts` *(existing)*
- `lib/persistence/supabase-adapter.ts` *(existing)*
- `lib/persistence/select.ts` *(existing)*
- `lib/daily-review-store.ts` *(existing — add `createCollectionSync`)*
- `lib/commands/journal-commands.ts` *(existing)*
- `lib/__tests__/daily-review-persistence.test.ts` *(new)*
- `lib/__tests__/fake-supabase.ts` *(existing)*
- `lib/__tests__/journal-commands.test.ts` *(existing)*
- `lib/__tests__/persistence-contract.test.ts` *(existing)*
- `lib/__tests__/persistence-local-adapter.test.ts` *(existing)*
- `lib/__tests__/persistence-supabase-adapter.test.ts` *(existing)*

## 4. Step-by-Step Implementation Plan

1. **Write `supabase/migrations/20261124120000_mogmine_daily_reviews.sql` (DO NOT APPLY):**
   - Create `public.mogmine_daily_reviews`:
     - `user_id uuid not null default auth.uid() references auth.users (id) on delete cascade`
     - `id text not null check (length(id) between 1 and 200)`
     - `record jsonb not null check (jsonb_typeof(record) = 'object' and record->>'id' = id)`
     - `session_date text not null generated always as (record->>'session_date') stored`
     - `account_id text generated always as (record->>'account_id') stored`
     - `created_at timestamptz not null default now()`, `updated_at timestamptz not null default now()`
     - `primary key (user_id, id)`
   - Unique index for `(session_date, account_id)` per user:
     `create unique index mogmine_daily_reviews_scope_idx on public.mogmine_daily_reviews (user_id, session_date, coalesce(account_id, ''));`
   - Enable RLS, `revoke all on table public.mogmine_daily_reviews from anon;`, `grant select, insert, update, delete on table public.mogmine_daily_reviews to authenticated, service_role;`, create policy `mogmine_daily_reviews_own` using/with check `user_id = (select auth.uid()) and (select public.mogmine_is_allowed())`, attach `mogmine_daily_reviews_touch` trigger (`public.mogmine_touch_row()`).
   - Update `public.mogmine_replace_rows(p_table text, p_rows jsonb)` via `create or replace function` to include `'mogmine_daily_reviews'` in its `p_table` allow-list (mirroring lines 353–377 of `20261123004734_mogmine_journal_v1.sql`).

2. **Register `daily_reviews` across `lib/persistence/*`:**
   - `contract.ts`: import `DailyReview` from `../daily-review.ts` and add `daily_reviews: DailyReview;` to `CollectionRecordTypes`.
   - `registry.ts`: add `{ key: "daily_reviews", domainType: "DailyReview, ReviewPoint", module: "lib/daily-review.ts, lib/daily-review-store.ts", deviceKey: "mogmine-daily-reviews-v1", table: "mogmine_daily_reviews", ownership: "user_id", ...own, readiness: "v1", inBackup: true, deletePolicy: "hard", derivedNeverStored: ["totals", "cards"], notes: "One per (session_date, account_id); trade_ids explicit." }`.
   - `local-adapter.ts`: add `daily_reviews: { storageKey: "mogmine-daily-reviews-v1", read: sanitizeDailyReviews, write: (_blob, items) => items }` to `SLOTS` and `daily_reviews: collection("daily_reviews")` to `repositories`.
   - `supabase-adapter.ts`: add `daily_reviews: {}` to `COLLECTION_COLUMNS` and `daily_reviews: collection("daily_reviews")` to `repositories`. Also ensure a missing-table PostgREST error (`42P01` / `PGRST205`) maps to `"unavailable"` in `mapDbError` so unapplied migrations degrade gracefully!
   - `select.ts`: add `daily_reviews: collection` to `createUnavailableAdapter`.

3. **Wire remote sync in `lib/daily-review-store.ts`:**
   - Follow `lib/plans-store.ts` (`#192`): use `createCollectionSync<DailyReview>({ key: "daily_reviews", getLocal: ..., apply: ... })`, start in `hydrateDailyReviews()`, call `.changed()` on local mutations, and add `configureDailyReviewsSyncForTests`!

4. **Update `lib/commands/journal-commands.ts`:**
   - Add `daily_reviews` parser to `COLLECTION_PARSERS` (validating `id`, `session_date` `YYYY-MM-DD`, `lesson.length <= 500`, `points` valid with `text.length <= 500`, `recorded_at` valid ISO).
   - In `commands.create("daily_reviews", raw)` (and `commands.update` if `(session_date, account_id)` changes): check existing `daily_reviews` for matching `(session_date, account_id ?? null)`; if another record already covers that scope, return `fail("conflict", \`A daily review for \${parsed.value.session_date} already exists (\${clash.id}).\`, "daily_reviews", clash.id)` (`409` with the existing id!).

## 5. Tests to Write (`lib/__tests__/daily-review-persistence.test.ts` + existing suites)

1. Update `fake-supabase.ts`, `journal-commands.test.ts`, `persistence-contract.test.ts`, `persistence-local-adapter.test.ts`, and `persistence-supabase-adapter.test.ts` to include `daily_reviews`.
2. In `lib/__tests__/daily-review-persistence.test.ts`:
   - Verify `COLLECTION_KEYS` in `lib/agent/http.ts` automatically includes `"daily_reviews"`.
   - Test `dispatchAgentRoute` for `POST /records/daily_reviews` (`201`), `GET /records/daily_reviews?session_date=2026-11-23` (`200`), `GET /records/daily_reviews/{id}` (`200`), `PATCH`, and `DELETE`.
   - Test duplicate `(session_date, account_id)` returns `409 conflict` naming the existing review id.
   - Test `derivedNeverStored` (`totals`, `cards`) rejected with `403 forbidden`.
   - Test migration SQL file asserts only `mogmine_` names and zero `showmob_` touches, and test graceful local fallback when Supabase returns `unavailable`.

## 6. Verification Commands

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run check:file-length
```

## 7. Claim, Handoff & PR Steps

1. Claim atomically:
   ```bash
   git fetch origin
   git push origin origin/main:refs/heads/claim/DR-1b
   ```
2. **FIRST LINE OF `notes/handoffs/2026-11-24-DR-1b.md` MUST BE:**
   `> **MIGRATION NEEDS APPLYING (apply_migration via Supabase MCP):** supabase/migrations/20261124120000_mogmine_daily_reviews.sql`
   Include changed files and real command outputs.
3. Commit, push, and open PR:
   ```bash
   git add -A
   git status   # verify ONLY files in §3 and notes/handoffs/2026-11-24-DR-1b.md are staged
   git commit -m "feat(DR-1b): persist daily_reviews in adapters, sync, command layer, and SQL migration"
   git push -u origin swarm/DR-1b
   gh pr create --base main --title "[DR-1b] Daily reviews in Supabase, sync, and Agent API" --body-file notes/handoffs/2026-11-24-DR-1b.md
   ```

## 8. What NOT to Do & Out-of-Scope Rule

- **NEVER** run `supabase db push`, `supabase migration repair`, or `psql`!
- Do **NOT** touch any `showmob_` object in SQL.
- **STOP and leave a note** in the handoff if any out-of-scope file seems needed.

HARD RULES:
- Supabase: only `mogmine_`-prefixed objects. If a package truly needs a schema change, write the SQL migration file under `supabase/migrations/` in the PR, but DO NOT apply it yourself: NEVER run `supabase db push`, NEVER run `supabase migration repair`, never use psql against the project. Note "MIGRATION NEEDS APPLYING (apply_migration via Supabase MCP)" at the top of the handoff and PR body; code must degrade gracefully (local mode) until it is applied. Never touch `showmob_` tables, auth site_url or disable_signup settings.
- No data dumps (no exporting tables/journals/backups, no printcode full dumps committed).
- Never print, log, commit or echo secrets (.env*, tokens, keys). Do not cat env files.
- Never modify, delete or re-create Chris's real trade records or accounts (no calls to the live /api/v1 with real tokens, no Supabase writes). Use fixtures and unit tests.
- Stay inside this package's scope and its listed writable files. Out-of-scope need = stop and write it in the handoff.
- Never edit BOARD.md, NOTES.md, DECISIONS.md. Never merge PRs, never push to main, never force-push other branches, never touch other worktrees.
