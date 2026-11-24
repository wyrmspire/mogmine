# Package Prompt: `RS-3a` — Switch Library Consumers to Account R

- **Agent / Lane:** `swarm-1` (`L1 Risk`) · **Wave:** `3` · **Branch:** `swarm/RS-3a`
- **Depends on:** `RS-1` (W1), `NAV-1` (W2), `UX-E` (W2)

## 1. Goal

Rename stop-width `rMultiple` → `riskMultiple` and `plannedR` → `plannedRewardRisk` in `lib/trades.ts` (retaining `@deprecated` aliases temporarily so untouched UI screens keep compiling until `RS-3b`), and switch all library consumers (`selectors`, `day-card`, `shareCard`, `drills`, `mood`, `describe`, `exit-efficiency`, `plan-vs-actual`) so everything labelled `"R"` reports account `resultR` (`gross P&L ÷ account R size`).

## 2. Read First (Required Context)

1. `AGENTS.md` (Guardrail 4, §6.12 file-length rule for `lib/trades.ts`, `lib/day-card.ts`, `lib/shareCard.ts`, `lib/mood.ts`)
2. `docs/design-2026-11-24/04-r-size.md` (§3.1, §3.5 table, §6)
3. `docs/design-2026-11-24/90-work-packages.md` (`RS-3a`)
4. `docs/design-2026-11-24/92-decisions-made-by-swarm.md` — **Chosen defaults locked for you:**
   - **D-A:** Everything labelled `"R"` in library outputs uses `resultR(trade, resolveRSize(trade, accounts, prefs))` (falling back cleanly via `resolveRSize(trade)` when callers only pass `trade`, using `trade.r_size_cents` → `getAccountsState().accounts` → `getPrefs()`, or optional `(accounts, prefs)` parameters!). Closed trades without a stop now have a valid `resultR` whenever `tradePnl(trade)` is computable. Stop-width ratios use `riskMultiple` / `plannedRewardRisk` and are shown as `× risk` or `R:R`, never `"R"`.
   - **D-C:** `isScratch` in `lib/trades.ts` **stays on the trade's own stop risk** (`max(0.1 * stopRiskTicks, 2)`), NOT account R.

## 3. Writable Files (Strict Scope — Everything Else Read-Only)

- `lib/trades.ts` *(**1,163 lines — grandfathered**: state before/after line counts)*
- `lib/selectors.ts` *(~360 lines)*
- `lib/day-card.ts` *(**504 lines — grandfathered**: state before/after line counts)*
- `lib/shareCard.ts` *(**627 lines — grandfathered**: state before/after line counts)*
- `lib/drills.ts` *(existing)*
- `lib/mood.ts` *(**895 lines — grandfathered**: state before/after line counts)*
- `lib/describe.ts` *(existing)*
- `lib/exit-efficiency.ts` *(existing)*
- `lib/plan-vs-actual.ts` *(existing)*
- `lib/__tests__/account-r-consumers.test.ts` *(new)*
- `lib/__tests__/running-stats.test.ts` *(existing)*
- `lib/__tests__/day-card.test.ts` *(existing)*
- `lib/__tests__/card-system.test.ts` *(existing)*
- `lib/__tests__/drills.test.ts` *(existing)*
- `lib/__tests__/mood.test.ts` *(existing)*
- `lib/__tests__/exit-efficiency.test.ts` *(existing)*
- `lib/__tests__/plan-vs-actual.test.ts` *(existing)*

*(Do NOT touch `lib/trade-marks.ts`, `lib/rstrip.ts`, or UI screen components — `RS-3b` handles those in Wave 4.)*

## 4. Step-by-Step Implementation Plan

1. **Update `lib/trades.ts`:**
   - Rename `export function rMultiple(...)` → `export function riskMultiple(...)` and `export function plannedR(...)` → `export function plannedRewardRisk(...)`, and `initialRMultiple` → `initialRiskMultiple` (keep `@deprecated export const rMultiple = riskMultiple; export const plannedR = plannedRewardRisk; export const initialRMultiple = initialRiskMultiple;` so `TradeDetail.tsx`, `TradeRow.tsx`, `ReviewScreen.tsx`, `DrillScreen.tsx`, `AddTradeSheet.tsx` compile cleanly in Wave 3!).
   - Keep `isScratch` unchanged (`D-C`).
   - Add convenience helper `tradeResultR(trade: TradeRecord, opts?: { accounts?: readonly Pick<TradingAccount, "id" | "r_size_cents">[]; prefs?: Partial<Pick<Prefs, "riskBudgetUsd">> | null }): number | null` (in `lib/r-size.ts`? Wait: `lib/r-size.ts` is read-only here; put the 4-line wrapper `accountResultR` or call `resultR(trade, resolveRSize(trade, opts?.accounts ?? getAccountsState().accounts, opts?.prefs ?? getPrefs()))` — NOTE: keep `lib/trades.ts` pure with no store imports! In pure modules `selectors.ts`, `day-card.ts`, `shareCard.ts`, `drills.ts`, `mood.ts`, `describe.ts`, `exit-efficiency.ts`, `plan-vs-actual.ts`, call `resultR(trade, resolveRSize(trade, opts?.accounts, opts?.prefs))` directly from `./r-size.ts`!).

2. **Switch the 8 library consumers (`04-r-size.md` §3.5):**
   - `lib/selectors.ts` (`dayStats`, `summarizeTrades`, `runningStats`): replace `rMultiple(trade)` with `resultR(trade, resolveRSize(trade, opts?.accounts, opts?.prefs))` (accept optional `{ accounts, prefs }` on `dayStats` / `runningStats` while defaulting cleanly to `resolveRSize(trade)`). Note: closed trades without a stop now contribute to `netR`/`totalR`/`withR`!
   - `lib/day-card.ts` (`buildDayCardData`): switch per-trade `r` and `netR` to `resultR(t, resolveRSize(t, opts?.accounts, opts?.prefs))`.
   - `lib/shareCard.ts` (`shareCardContent`): switch hero/outcome R to `resultR(trade, resolveRSize(trade, options?.accounts, options?.prefs))`.
   - `lib/drills.ts` & `lib/mood.ts` & `lib/describe.ts`: switch `rMultiple(trade)` to `resultR(trade, resolveRSize(trade))`.
   - `lib/exit-efficiency.ts`: keep the efficiency ratio unit-free (points/ticks captured ÷ MFE points/ticks), and switch the summary text R values (`"captured +2.05R of +2.60R available"`) to account R (`resultR` / MFE dollar P&L ÷ R size).
   - `lib/plan-vs-actual.ts`: switch R differences to account R (`dollar diff ÷ rSize`) and format the plan's reward:risk ratio using `plannedRewardRisk(trade)` as `"R:R 2.0:1"` (never `"2.0R"`).

## 5. Tests to Write (`lib/__tests__/account-r-consumers.test.ts` + updated existing tests)

1. `lib/__tests__/account-r-consumers.test.ts`:
   - Verifies `riskMultiple` equals the previous `rMultiple` on every sample fixture.
   - Verifies Trade A/B/C with `r_size_cents: 30000` produce account R (`+2.05R`, `−0.25R`, `−0.13R`) across `dayStats`, `runningStats`, `buildDayCardData`, `shareCardContent`, `drills`, `mood`, `describeTrade`, `calculateExitEfficiency`, and `derivePlanVsActual`.
   - Verifies a closed trade with **no stop** (`entry: 7000, exit: 7015, qty: 1 MES`, `+$75` at `$300` R size) reports `+0.25R` in `dayStats`, `runningStats`, and `shareCardContent`.
   - Verifies `isScratch` stays on trade's own stop risk (`D-C`).
2. Update any existing assertions in the 7 listed test files where fixtures previously asserted stop-width R (e.g. a `$150` win on `$250` default R size is `+0.6R` instead of `+2.0R` stop-width R), and **list every changed test assertion and why** in your handoff!

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
   git push origin origin/main:refs/heads/claim/RS-3a
   ```
2. Write `notes/handoffs/2026-11-24-RS-3a.md` listing changed files, before/after line counts for `lib/trades.ts`, `lib/day-card.ts`, `lib/shareCard.ts`, and `lib/mood.ts`, every updated test assertion with its math explanation, and real command outputs.
3. Commit, push, and open PR:
   ```bash
   git add -A
   git status   # verify ONLY files in §3 and notes/handoffs/2026-11-24-RS-3a.md are staged
   git commit -m "feat(RS-3a): switch library R consumers to account resultR; rename riskMultiple"
   git push -u origin swarm/RS-3a
   gh pr create --base main --title "[RS-3a] Switch library consumers to account R" --body-file notes/handoffs/2026-11-24-RS-3a.md
   ```

## 8. What NOT to Do & Out-of-Scope Rule

- Do **NOT** delete the `@deprecated` `rMultiple` / `plannedR` aliases yet (`RS-3b` removes them in Wave 4).
- Do **NOT** touch `lib/trade-marks.ts`, `lib/rstrip.ts`, or `components/*`.
- **STOP and leave a note** in the handoff if any out-of-scope file seems needed.

HARD RULES:
- Supabase: only `mogmine_`-prefixed objects. If a package truly needs a schema change, write the SQL migration file under `supabase/migrations/` in the PR, but DO NOT apply it yourself: NEVER run `supabase db push`, NEVER run `supabase migration repair`, never use psql against the project. Note "MIGRATION NEEDS APPLYING (apply_migration via Supabase MCP)" at the top of the handoff and PR body; code must degrade gracefully (local mode) until it is applied. Never touch `showmob_` tables, auth site_url or disable_signup settings.
- No data dumps (no exporting tables/journals/backups, no printcode full dumps committed).
- Never print, log, commit or echo secrets (.env*, tokens, keys). Do not cat env files.
- Never modify, delete or re-create Chris's real trade records or accounts (no calls to the live /api/v1 with real tokens, no Supabase writes). Use fixtures and unit tests.
- Stay inside this package's scope and its listed writable files. Out-of-scope need = stop and write it in the handoff.
- Never edit BOARD.md, NOTES.md, DECISIONS.md. Never merge PRs, never push to main, never force-push other branches, never touch other worktrees.
