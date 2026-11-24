# Package Prompt: `API-2a` — Vocabulary Endpoint, Derived Values, and List Filters

- **Agent / Lane:** `swarm-5` (`L5 Agent API`) · **Wave:** `2` · **Branch:** `swarm/API-2a`
- **Depends on:** `API-1`, `RS-1` (both merged on `origin/main` before Wave 2 starts)

## 1. Goal

Add `GET /api/v1/vocabulary` (`lib/agent/vocabulary.ts` + route) so agents read the owner's live playbooks, setup/execution tags, active accounts with resolved R sizes, contract specs, exit reasons, plan presets, and time rules instead of inventing names. Also support `?include=derived` on `trades` and `accounts` GET/list responses and query filters (`session_date`, `from`, `to`, `account_id`, `playbook_id`) on collection lists.

## 2. Read First (Required Context)

1. `AGENTS.md` (Guardrail 4 integer cents/ticks, Guardrail 11 derived values computed in code)
2. `docs/design-2026-11-24/07-agent-api.md` (§3.1, §3.5, §5, §6 bullets 2 & 3)
3. `docs/design-2026-11-24/04-r-size.md` (§3.1–§3.2)
4. `docs/design-2026-11-24/90-work-packages.md` (`API-2a`)
5. `docs/design-2026-11-24/92-decisions-made-by-swarm.md` (`D-A`, `D-B`, `Q-12`)

## 3. Writable Files (Strict Scope — Everything Else Read-Only)

- `lib/agent/vocabulary.ts` *(new)*
- `app/api/v1/vocabulary/route.ts` *(new)*
- `lib/agent/dispatch.ts` *(existing, ~92 lines)*
- `lib/agent/http.ts` *(existing, ~130 lines)*
- `lib/commands/journal-commands.ts` *(existing, ~330 lines)*
- `lib/agent/openapi.ts` *(existing, ~290 lines)*
- `lib/__tests__/agent-vocabulary.test.ts` *(new)*
- `lib/__tests__/agent-api.test.ts` *(existing)*
- `lib/__tests__/agent-openapi.test.ts` *(existing)*

*(Do NOT edit `lib/persistence/contract.ts` — keep `ListQuery` clean; implement the extended list filters as a read-only helper/options in `lib/commands/journal-commands.ts` and `lib/agent/http.ts`.)*

## 4. Step-by-Step Implementation Plan

1. **Create `lib/agent/vocabulary.ts` + `app/api/v1/vocabulary/route.ts`:**
   ```ts
   import type { JournalCommands } from "../commands/journal-commands.ts";

   export async function buildVocabulary(commands: JournalCommands): Promise<PersistResult<VocabularyPayload>>;
   ```
   - Exact JSON shape per `07-agent-api.md` §3.1:
     - `house_rules_version`: `HOUSE_RULES_VERSION` from `./house-rules.ts`.
     - `playbooks`: owner's stored playbooks via `commands.list("playbooks", { includeArchived: true })` (falling back to `PLAYBOOK_SEEDS` when empty), sorted active first then archived, mapped to `{ id, name, rules: checklist_rules.map((r) => r.label), archived }`.
     - `setup_tags`: `[...SETUP_TAGS]`, `execution_tags`: `[...EXECUTION_TAGS]` from `../playbooks.ts`.
     - `accounts`: **active only** (`includeArchived: false`), mapped to `{ id, name, r_size_cents: account.r_size_cents ?? defaultRSizeCents, r_size_source: account.r_size_cents != null ? "account" : "prefs" }`.
     - `default_r_size_cents`: `Math.round((prefs?.riskBudgetUsd ?? DEFAULT_PREFS.riskBudgetUsd) * 100)`.
     - `exit_reasons`: all `EXIT_REASONS` with human `effect` descriptions (`target`, `stop`, `trail`, `breakeven`, `manual`).
     - `symbols`: all `FUTURES_SPECS` entries `{ symbol, tick_size, point_value_usd }`.
     - `plan_presets`: from `lib/plans.ts` (`pre_globex`, `pre_market`, `pre_power_hour`, `pre_moc`, `pre_gap_fill`).
     - `time`: `{ display_zone: prefs?.timeZone ?? "America/Chicago", session_zone: "America/New_York", session_rollover_et: "18:00" }`.
   - Route `app/api/v1/vocabulary/route.ts`: wrap with `handleAgentRequest` (`scope: "read"`).

2. **Add filtered list & derived helpers in `lib/commands/journal-commands.ts`, `lib/agent/http.ts`, and `lib/agent/dispatch.ts`:**
   - In `lib/agent/http.ts`: parse `include=derived` (`parseIncludeDerived(searchParams): boolean`) and `AgentListFilters` (`session_date`, `from`, `to`, `account_id`, `playbook_id`). Validate `from`/`to` as valid ISO timestamps and `session_date` as `YYYY-MM-DD` (returning `422 invalid` if malformed).
   - In `lib/commands/journal-commands.ts`: add read-only method `listFiltered<K extends CollectionKey>(key: K, query?: ListQuery, filters?: AgentListFilters)` on `JournalCommands` that calls `repoFor(key).list(owner, { ...query, limit: filtersHasAny ? undefined : query?.limit })`, filters `trades` by `sessionDate(entry_time) === filters.session_date`, `Date.parse(entry_time) >= Date.parse(from)`, `<= Date.parse(to)`, `account_id`, `playbook_id` (and filters any collection with `session_date` field such as `plans` — and later `daily_reviews` — by `session_date`), then applies `limit`.
   - In `lib/agent/dispatch.ts`:
     - When `includeDerived` is `true` on `read` or `list` for `"trades"`: attach `derived: { pnl_cents, result_r, risk_cents, risk_r, r_size_cents: resolved.cents, r_size_source: resolved.source, stated_risk_r: trade.stated_risk_r ?? null, hold_seconds: isOpen(trade) ? null : holdSeconds(trade), session_date: sessionDate(trade.entry_time) }` using `resolveRSize`, `resultR`, `riskR`, `riskCents`, `pnlCents`. (Note: on `read`, `Stored<TradeRecord>` gains `derived` alongside `record` and `meta`; on `list`, each item in `data` gains `derived` or `{ ...trade, derived }` — document the exact shape in `openapi.ts`!)
     - When `includeDerived` is `true` on `read` or `list` for `"accounts"`: compute `accountSummary(account, allTrades, allChecks, nowIso)` and attach `derived: { balance_cents: summary.balance_cents, realized_cents: summary.realized_cents, adjustments_cents: summary.adjustments_cents, drawdown_cents: summary.drawdown_cents, closed_trades: summary.closedTrades, open_trades: summary.openTrades, from_journal_gross: true }`.
   - Document `/vocabulary`, `?include=derived`, and list filter parameters in `lib/agent/openapi.ts`.

## 5. Tests to Write (`lib/__tests__/agent-vocabulary.test.ts` + `lib/__tests__/agent-api.test.ts`)

1. `GET /api/v1/vocabulary`: returns seeded/custom playbooks (active first, archived flagged `archived: true`), omits archived accounts, reports `r_size_cents: 30000, r_size_source: "account"` on SIM Eval 50K and `25000, "prefs"` on an account with `r_size_cents: null`, and lists `"VWAP Hold"` under `setup_tags` (never `playbooks`).
2. `GET /records/trades/{id}?include=derived` and `GET /records/trades?include=derived`: matches Trade A (`pnl_cents: 61500, result_r: 2.05, risk_cents: 8750, risk_r: 0.2916..., r_size_cents: 30000`) and open trade (`pnl_cents: null, result_r: null`).
3. `GET /records/accounts/{id}?include=derived`: matches `accountSummary` balance and includes `from_journal_gross: true`.
4. List filters (`session_date`, `from`, `to`, `account_id`, `playbook_id`) filter accurately and reject malformed dates with `422`.

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
   git push origin origin/main:refs/heads/claim/API-2a
   ```
2. Write `notes/handoffs/2026-11-24-API-2a.md` with changed files, exported signatures, and real command outputs.
3. Commit, push, and open PR:
   ```bash
   git add lib/agent/vocabulary.ts app/api/v1/vocabulary/route.ts lib/agent/dispatch.ts lib/agent/http.ts lib/commands/journal-commands.ts lib/agent/openapi.ts lib/__tests__/agent-vocabulary.test.ts lib/__tests__/agent-api.test.ts lib/__tests__/agent-openapi.test.ts notes/handoffs/2026-11-24-API-2a.md
   git commit -m "feat(API-2a): /api/v1/vocabulary, ?include=derived, and trade list filters"
   git push -u origin swarm/API-2a
   gh pr create --base main --title "[API-2a] Vocabulary endpoint, derived values, and list filters" --body-file notes/handoffs/2026-11-24-API-2a.md
   ```

## 8. What NOT to Do & Out-of-Scope Rule

- Do **NOT** store `derived` fields into repositories.
- Do **NOT** add write-time warnings/refusals yet (`API-2b` does that in Wave 4).
- **STOP and leave a note** in the handoff if any out-of-scope file seems needed.

HARD RULES:
- Supabase: only `mogmine_`-prefixed objects. If a package truly needs a schema change, write the SQL migration file under `supabase/migrations/` in the PR, but DO NOT apply it yourself: NEVER run `supabase db push`, NEVER run `supabase migration repair`, never use psql against the project. Note "MIGRATION NEEDS APPLYING (apply_migration via Supabase MCP)" at the top of the handoff and PR body; code must degrade gracefully (local mode) until it is applied. Never touch `showmob_` tables, auth site_url or disable_signup settings.
- No data dumps (no exporting tables/journals/backups, no printcode full dumps committed).
- Never print, log, commit or echo secrets (.env*, tokens, keys). Do not cat env files.
- Never modify, delete or re-create Chris's real trade records or accounts (no calls to the live /api/v1 with real tokens, no Supabase writes). Use fixtures and unit tests.
- Stay inside this package's scope and its listed writable files. Out-of-scope need = stop and write it in the handoff.
- Never edit BOARD.md, NOTES.md, DECISIONS.md. Never merge PRs, never push to main, never force-push other branches, never touch other worktrees.
