# Package Prompt: `RS-3b` — Switch Screens, Ruler, and R Strip to Account R; Remove Aliases

- **Agent / Lane:** `swarm-1` (`L1 Risk`) · **Wave:** `4` · **Branch:** `swarm/RS-3b`
- **Depends on:** `RS-3a` (W3), `SM-2` (W3), `IN-2` (W3)

## 1. Goal

Complete the transition to account R across the UI and chart display list: switch `TradeDetail.tsx`, `TradeRow.tsx`, `ReviewScreen.tsx`, `DrillScreen.tsx`, and `AddTradeSheet.tsx` preview lines to `resultR` / `plannedRewardRisk`, keep the R ruler (`lib/trade-marks.ts`) and R strip (`lib/rstrip.ts`) spaced at multiples of the trade's own stop risk while labelling them in account R (`+0.25R`, `+0.50R`, …), and remove the deprecated `rMultiple` / `plannedR` / `initialRMultiple` aliases from `lib/trades.ts`.

## 2. Read First (Required Context)

1. `AGENTS.md` (§4 `tabular-nums`, §6.12 file-length rule for `lib/trades.ts`, `lib/trade-marks.ts`, `components/TradeDetail.tsx`)
2. `docs/design-2026-11-24/04-r-size.md` (§3.1, §3.5 table — especially the `R ruler` and `R strip` rows!)
3. `docs/design-2026-11-24/90-work-packages.md` (`RS-3b`)
4. `docs/design-2026-11-24/92-decisions-made-by-swarm.md` (`D-A`, `D-C`)

## 3. Writable Files (Strict Scope — Everything Else Read-Only)

- `lib/trades.ts` *(**grandfathered** — delete deprecated aliases; state before/after line counts)*
- `lib/trade-marks.ts` *(**grandfathered** — state before/after line counts)*
- `lib/rstrip.ts` *(existing, ~169 lines)*
- `components/TradeDetail.tsx` *(**grandfathered** — `<= 10` net lines; state before/after line counts)*
- `components/TradeRow.tsx` *(existing)*
- `components/ReviewScreen.tsx` *(existing)*
- `components/DrillScreen.tsx` *(existing)*
- `components/AddTradeSheet.tsx` *(existing — switch the 2 preview calls from `rMultiple`/`plannedR` to `resultR`/`plannedRewardRisk` formatted as `R:R`)*
- `lib/__tests__/r-ruler.test.ts` *(existing)*
- `lib/__tests__/rstrip.test.ts` *(existing)*
- `lib/__tests__/core.test.ts`, `lib/__tests__/open-trade.test.ts`, `lib/__tests__/validation.test.ts`, `lib/__tests__/honest-box.test.ts`, `lib/__tests__/r-trailed-stop.test.ts`, `lib/__tests__/initial-stop.test.ts`, `lib/__tests__/trade-document.test.ts`, `lib/__tests__/hindsight.test.ts`, `lib/__tests__/stop-moves.test.ts` *(update imports of `rMultiple` → `riskMultiple`, `plannedR` → `plannedRewardRisk`, `initialRMultiple` → `initialRiskMultiple` where testing stop-width math)*

## 4. Step-by-Step Implementation Plan

1. **Update R Ruler in `lib/trade-marks.ts` (`04` §3.5):**
   - Accept optional `accountRiskR?: number | null` (the trade's initial risk in account R, e.g. `0.25` when risking `$75` on a `$300` account, defaulting to `1` only when `accountRiskR == null`) on `BuildMarksOptions`.
   - Keep line geometry spaced at each whole multiple `k = 1, 2, ...` of `initialRisk = Math.abs(plannedEntry - plannedStop)` (so visual spacing never collapses!), and format each ruler label as `formatR(k * (options.accountRiskR ?? 1))` (using 2 decimals when fractional like `+0.25R`, `+0.5R`, `+0.75R`, or clean `formatR` helper; e.g. on a `0.25R` risk trade: `+0.25R`, `+0.50R` / `+0.5R`, `+0.75R`, `+1.0R`).
   - Also update planned target zone label (`target.planned_r`): when `options.accountRiskR != null`, label target in account R (`TP +0.50R`) or `R:R` (`TP 2.0×`) consistently!

2. **Update `lib/rstrip.ts` (`04` §3.5):**
   - Keep `rStripLayout` normalized 0–1 geometry on the trade's own stop–target span unchanged.
   - Update `rStripCaption(trade, layout, accountRSizeCents?)`: compute `exitR` and `planR` in account R (`dollar offset ÷ rSizeCents` when `rSizeCents` is supplied, else `resolveRSize(trade).cents`) so captions read e.g. `"Ran to plan, exit +0.50R, plan +0.50R"` on a `0.25R` trade with 2:1 target!

3. **Switch UI screens:**
   - `components/TradeDetail.tsx`: compute `r = resultR(trade, rSize)` for header R, pass `accountRiskR={riskR(trade, rSize)}` into `buildMarks(...)`, and pass `rSize.cents` to `<RStrip />` if needed (or `RStrip` resolves via `useAccounts()`/`usePrefs()` — wait: `RStrip.tsx` is read-only unless `rstrip.ts` resolves via `trade.r_size_cents`! Since `TradeRecord.r_size_cents` is stored on the trade (`RS-1`), `resolveRSize(trade)` in `lib/rstrip.ts` works purely from `trade`!).
   - `components/TradeRow.tsx`, `components/ReviewScreen.tsx`, `components/DrillScreen.tsx`: replace `rMultiple(trade)` with `resultR(trade, resolveRSize(trade, accounts, prefs))` (reading `useAccounts()` and `usePrefs()`).
   - `components/AddTradeSheet.tsx`: replace `plannedR` with `plannedRewardRisk` (displayed as `R:R ${plan.toFixed(1)}:1`) and `rMultiple` with `resultR` against the selected account's resolved R size.

4. **Remove deprecated aliases in `lib/trades.ts`:**
   - Delete `export const rMultiple`, `export const plannedR`, and `export const initialRMultiple` from `lib/trades.ts`.
   - Update the 9 unit test files that directly test `lib/trades.ts`'s stop-width ratio functions to import `riskMultiple`, `plannedRewardRisk`, and `initialRiskMultiple`.
   - Verify with `grep -rn "\brMultiple\b" app components lib/trades.ts` (must return 0 matches; note `DayCardTrade.rMultiple` / `Partials.rMultiple` struct field names in `day-card.ts` / `partials.ts` are fine if already typed, or check that no function symbol `rMultiple` remains in `lib/trades.ts`, `app/`, or `components/`).

## 5. Tests to Write (`lib/__tests__/r-ruler.test.ts` + `lib/__tests__/rstrip.test.ts`)

1. `r-ruler.test.ts`: a `0.25R` risk trade (`$75` risk on `$300` R size, `accountRiskR: 0.25`) with a `3×` stop-width target generates ruler lines at `1×`, `2×`, `3×` stop distance labelled `+0.25R`, `+0.5R` (or `+0.50R`), `+0.75R`.
2. `rstrip.test.ts`: `rStripCaption` on a `0.25R` trade (`r_size_cents: 30000`) reports account R in caption while `rStripLayout` marker coordinates stay identical.
3. Include `grep -rn "\brMultiple\b" app components lib/trades.ts` output in your handoff proving zero remaining callers.

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
   git push origin origin/main:refs/heads/claim/RS-3b
   ```
2. Write `notes/handoffs/2026-11-24-RS-3b.md` with changed files, before/after line counts for `lib/trades.ts`, `lib/trade-marks.ts`, and `components/TradeDetail.tsx`, `grep` output confirming alias removal, and real command outputs.
3. Commit, push, and open PR:
   ```bash
   git add -A
   git status   # verify ONLY files in §3 and notes/handoffs/2026-11-24-RS-3b.md are staged
   git commit -m "feat(RS-3b): switch screens, R ruler, and R strip to account R; remove rMultiple aliases"
   git push -u origin swarm/RS-3b
   gh pr create --base main --title "[RS-3b] Switch screens, ruler, and R strip to account R; remove aliases" --body-file notes/handoffs/2026-11-24-RS-3b.md
   ```

## 8. What NOT to Do & Out-of-Scope Rule

- Do **NOT** add the Risk chip row to `AddTradeSheet.tsx` yet (`RS-4` does that in Wave 5).
- Do **NOT** edit `lib/partials.ts` (`partials.ts` is read-only).
- **STOP and leave a note** in the handoff if any out-of-scope file seems needed.

HARD RULES:
- Supabase: only `mogmine_`-prefixed objects. If a package truly needs a schema change, write the SQL migration file under `supabase/migrations/` in the PR, but DO NOT apply it yourself: NEVER run `supabase db push`, NEVER run `supabase migration repair`, never use psql against the project. Note "MIGRATION NEEDS APPLYING (apply_migration via Supabase MCP)" at the top of the handoff and PR body; code must degrade gracefully (local mode) until it is applied. Never touch `showmob_` tables, auth site_url or disable_signup settings.
- No data dumps (no exporting tables/journals/backups, no printcode full dumps committed).
- Never print, log, commit or echo secrets (.env*, tokens, keys). Do not cat env files.
- Never modify, delete or re-create Chris's real trade records or accounts (no calls to the live /api/v1 with real tokens, no Supabase writes). Use fixtures and unit tests.
- Stay inside this package's scope and its listed writable files. Out-of-scope need = stop and write it in the handoff.
- Never edit BOARD.md, NOTES.md, DECISIONS.md. Never merge PRs, never push to main, never force-push other branches, never touch other worktrees.
