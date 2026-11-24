# Package Prompt: `RS-2` — R Size in AccountSheet, Tune, RiskChips, and Trade Detail

- **Agent / Lane:** `swarm-1` (`L1 Risk`) · **Wave:** `2` · **Branch:** `swarm/RS-2`
- **Depends on:** `RS-1` (merged on `origin/main` before Wave 2 starts)

## 1. Goal

Expose per-account R size in the UI: let the trader set `r_size_cents` in `AccountSheet.tsx` (persisted via `lib/accounts-store.ts`), relabel Tune's global risk budget to `"Default R size"` (`lib/prefs.ts`), update `RiskChips.tsx` to offer `0.25R`, `0.5R`, and `1R` stops from the resolved R size, and mount a new `<RiskLine />` component on `TradeDetail.tsx` showing actual dollar risk, risk R, R-size source, and stated-vs-actual R (with full Shield privacy).

## 2. Read First (Required Context)

1. `AGENTS.md` (Invariant 5 no hardcoded gold hex, §4 `390×844` mobile & `tabular-nums`, §6.12 file-length rule for `components/TradeDetail.tsx`)
2. `docs/design-2026-11-24/04-r-size.md` (§3.2, §3.4, §3.5 `RiskChips` row, §4)
3. `docs/design-2026-11-24/90-work-packages.md` (`RS-2`)
4. `docs/design-2026-11-24/92-decisions-made-by-swarm.md` — **Chosen defaults locked for you:**
   - **D-A / Q-12:** Account R size in `AccountSheet`; Tune `prefs.riskBudgetUsd` is labelled `"Default R size"` (used for accounts without their own R size and unassigned trades, labelled `"default $250"` when non-Shield). Shield mode hides all `$` amounts (`Risk 0.29R · you said 0.25R`).

## 3. Writable Files (Strict Scope — Everything Else Read-Only)

- `components/AccountSheet.tsx` *(existing, ~127 lines)*
- `lib/accounts-store.ts` *(existing, ~165 lines — allow `r_size_cents` in `addAccount` and `updateAccount`)*
- `lib/prefs.ts` *(existing, ~121 lines — `getTuneRiskBudgetDisplay`)*
- `components/RiskChips.tsx` *(existing, ~53 lines)*
- `components/RiskLine.tsx` *(new)*
- `components/TradeDetail.tsx` *(existing, **~807 lines — grandfathered**: `<= 10` net lines to mount `<RiskLine />` and pass resolved R size to `<RiskChips />`; report before/after line counts)*
- `lib/__tests__/risk-line.test.ts` *(new)*
- `lib/__tests__/tune-prefs.test.ts` *(existing — update `"Risk budget"` label expectations to `"Default R size"`)*

## 4. Step-by-Step Implementation Plan

1. **Update `lib/accounts-store.ts` and `components/AccountSheet.tsx`:**
   - In `lib/accounts-store.ts`: add optional `r_size_cents?: number | null` to `addAccount` input and `updateAccount` patch (`Partial<Pick<TradingAccount, "name" | "starting_balance_cents" | "r_size_cents" | "rules" | "archived">>`).
   - In `components/AccountSheet.tsx`: add an optional field `"R size ($ — 1R in this account)"` (placeholder `"300"`, hint/empty = uses Default R size). Validate via `optional(rSizeText)` plus `[100, 10_000_000]` cents (`$1` to `$100,000`), and pass `r_size_cents` to `addAccount` / `updateAccount`.

2. **Update `lib/prefs.ts` (`getTuneRiskBudgetDisplay`):**
   - Non-Shield: `label: "Default R size ($ USD)"`, `inputAriaLabel: "Default R size in US dollars"`, `hint: "Used for accounts without their own R size and trades with no account (default $250)."`.
   - Shield: `label: "Default R size"`, `inputAriaLabel: "Default R size (hidden while Shield mode is on)"`, `hint: "Used for accounts without their own R size. Turn Shield mode off to change the dollar amount."`.

3. **Update `components/RiskChips.tsx`:**
   - Use multiples `[0.25, 0.5, 1]` of `budgetUsd` (where `budgetUsd` passed from `TradeDetail` is `resolvedRSize.cents / 100`).
   - Label each chip in R + points (+ `$` when `!hideMoney`): e.g. `0.25R · 15.00 pts` and `<small className="shield-hide">$75</small>` (all `tabular-nums`, `minHeight: 44`).

4. **Create `components/RiskLine.tsx` (pure formatter + client component):**
   - Export pure helper `formatRiskLine(trade: TradeRecord, rSize: ResolvedRSize, accountName: string | null, shield: boolean): { primary: string; sourceHint: string | null }` so unit tests can verify exact strings without a DOM!
   - Exact copy rules (`04-r-size.md` §3.4 & §6):
     - If no stop and no `stated_risk_r`: `primary = "No stop recorded"`.
     - With stop (e.g. Trade A: `$87.50` risk, `rSize = 30000` from account):
       - Non-Shield: `"Risk $87.50 · 0.29R of $300"` + (if `stated_r != null && differs`: `" · you said 0.25R ($75)"`, or if `stated_r != null && !differs`: `""`). If `rSize.source === "prefs"`, include `"default $250"` (`"Risk $87.50 · 0.35R of default $250"`).
       - Shield: **zero `$` signs anywhere** — `"Risk 0.29R"` + (if `stated_r != null && differs`: `" · you said 0.25R"`).
     - Tapping `"Set stated R"` / the risk line opens an inline 1-row quick editor (`0.25R`, `0.5R`, `1R`, custom input `0.01–10`, `Clear`) calling `updateTrade(trade.id, { stated_risk_r })` (`minHeight: 44`).

5. **Mount in `components/TradeDetail.tsx` (`<= 10` net lines):**
   - Resolve `const rSize = resolveRSize(trade, accountsState.accounts, prefs);` (using `useAccounts()`).
   - Mount `<RiskLine trade={trade} rSize={rSize} accountName={...} shield={renderPrivacy} />` in the trade summary/stop section and pass `budgetUsd={rSize.cents / 100}` to `<RiskChips />`.

## 5. Tests to Write (`lib/__tests__/risk-line.test.ts` + `lib/__tests__/tune-prefs.test.ts`)

1. `formatRiskLine` on Trade A at `$300` (`source: "account"`): `"Risk $87.50 · 0.29R of $300 · you said 0.25R ($75)"`.
2. `formatRiskLine` on Trade B at `$300` (`differs === false`): `"Risk $75 · 0.25R of $300"` (no redundant `"you said"` suffix).
3. `formatRiskLine` under Shield (`shield: true`): asserts `!/\$/.test(primary)` and `!/300|250|87\.5|75/.test(primary)` (`"Risk 0.29R · you said 0.25R"`).
4. `formatRiskLine` when account has no R size (`source: "prefs"`, `25000` cents): contains `"default $250"` when `!shield` and no `$` when `shield`.
5. No-stop trade: `"No stop recorded"` (or stated risk when `stated_risk_r` is set).
6. `accounts-store`: `addAccount` and `updateAccount` persist `r_size_cents: 30000` and clear to `null`.
7. Update `lib/__tests__/tune-prefs.test.ts` for `"Default R size"`.

## 6. Verification Commands

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run check:file-length
```
Also verify no horizontal overflow and `>= 44px` tap targets at `390×844` if headless Chrome is available.

## 7. Claim, Handoff & PR Steps

1. Claim atomically:
   ```bash
   git fetch origin
   git push origin origin/main:refs/heads/claim/RS-2
   ```
2. Write `notes/handoffs/2026-11-24-RS-2.md` with changed files, `TradeDetail.tsx` before/after line counts, and real command outputs.
3. Commit, push, and open PR:
   ```bash
   git add components/AccountSheet.tsx lib/accounts-store.ts lib/prefs.ts components/RiskChips.tsx components/RiskLine.tsx components/TradeDetail.tsx lib/__tests__/risk-line.test.ts lib/__tests__/tune-prefs.test.ts notes/handoffs/2026-11-24-RS-2.md
   git commit -m "feat(RS-2): account R size sheet field, Default R size label, RiskChips, and RiskLine"
   git push -u origin swarm/RS-2
   gh pr create --base main --title "[RS-2] R size in AccountSheet, Tune, RiskChips, and TradeDetail" --body-file notes/handoffs/2026-11-24-RS-2.md
   ```

## 8. What NOT to Do & Out-of-Scope Rule

- Do **NOT** switch header/feed/stats `rMultiple` to `resultR` yet (`RS-3a` and `RS-3b` do that in Waves 3–4).
- Do **NOT** edit `components/AddTradeSheet.tsx` (`RS-4` adds the entry-form Risk row in Wave 5).
- **STOP and leave a note** in the handoff if any out-of-scope file seems needed.

HARD RULES:
- Supabase: only `mogmine_`-prefixed objects. If a package truly needs a schema change, write the SQL migration file under `supabase/migrations/` in the PR, but DO NOT apply it yourself: NEVER run `supabase db push`, NEVER run `supabase migration repair`, never use psql against the project. Note "MIGRATION NEEDS APPLYING (apply_migration via Supabase MCP)" at the top of the handoff and PR body; code must degrade gracefully (local mode) until it is applied. Never touch `showmob_` tables, auth site_url or disable_signup settings.
- No data dumps (no exporting tables/journals/backups, no printcode full dumps committed).
- Never print, log, commit or echo secrets (.env*, tokens, keys). Do not cat env files.
- Never modify, delete or re-create Chris's real trade records or accounts (no calls to the live /api/v1 with real tokens, no Supabase writes). Use fixtures and unit tests.
- Stay inside this package's scope and its listed writable files. Out-of-scope need = stop and write it in the handoff.
- Never edit BOARD.md, NOTES.md, DECISIONS.md. Never merge PRs, never push to main, never force-push other branches, never touch other worktrees.
