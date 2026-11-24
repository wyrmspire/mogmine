# Package Prompt: `RS-1` — Per-Account R Size: Pure Model and Stored Fields

- **Agent / Lane:** `swarm-1` (`L1 Risk`) · **Wave:** `1` · **Branch:** `swarm/RS-1`
- **Depends on:** None (Wave 1 baseline)

## 1. Goal

Implement the pure per-account R-size math (`lib/r-size.ts`) and add the stored jsonb fields (`r_size_cents`, `stated_risk_r`, `risk_cents`) to `TradingAccount`, `TradeRecord`, `lib/store.ts`, and `lib/commands/journal-commands.ts` without switching any UI or stats consumers yet. Every existing test must continue to pass unchanged while the new R-size helpers and command-layer validations are verified.

## 2. Read First (Required Context)

1. `AGENTS.md` (especially Invariants 3 & 7, Guardrail 4 integer ticks/cents, and §6.12 file-length rule)
2. `docs/design-2026-11-24/04-r-size.md` (§1, §3.1–§3.4, §5 item 6, §6)
3. `docs/design-2026-11-24/90-work-packages.md` (`RS-1`)
4. `docs/design-2026-11-24/92-decisions-made-by-swarm.md` — **Chosen defaults locked for you:**
   - **D-A:** `1R` is a fixed dollar amount per account (e.g. `$300` = `30000` cents for SIM Eval 50K), independent of stop width. `resultR = gross P&L cents ÷ rSize.cents` (defined for any closed trade with computable P&L, even without a stop); `riskR = actual initial-stop dollars risked ÷ rSize.cents` (`null` without a stop or stated risk, never `0`).
   - **D-B:** Freeze `r_size_cents` on a trade when created, and re-freeze only when `account_id` changes. Legacy trades with `r_size_cents: null` resolve at read time via `trade → account → prefs`.
   - **Q-12 / Q-13:** Unassigned trades (`account_id: null`) or accounts with `r_size_cents: null` fall back to `prefs.riskBudgetUsd * 100` (`25000` cents default) with `source: "prefs"`. `stated_risk_r` lives on `TradeRecord` only.

## 3. Writable Files (Strict Scope — Everything Else Read-Only)

- `lib/r-size.ts` *(new)*
- `lib/accounts.ts` *(existing, ~270 lines)*
- `lib/trades.ts` *(existing, **1,163 lines — over 450-line target, grandfathered**: keep net growth near zero by placing math in `lib/r-size.ts`, and report before/after line counts in your handoff)*
- `lib/store.ts` *(existing)*
- `lib/commands/journal-commands.ts` *(existing, ~299 lines)*
- `lib/__tests__/r-size.test.ts` *(new)*

*(Note: Do NOT edit `lib/journal-backup.ts`; `DR-1a` owns it in Wave 1, and `parseTradeItem` already spreads `...rest` into `normalizeTrade`.)*

## 4. Step-by-Step Implementation Plan

1. **Create `lib/r-size.ts` (pure, no DOM/React/storage):**
   ```ts
   import type { TradingAccount } from "./accounts.ts";
   import type { Prefs } from "./prefs-sanitize.ts";
   import type { TradeRecord } from "./trades.ts";

   export type RSizeSource = "trade" | "account" | "prefs";
   export interface ResolvedRSize {
     cents: number;
     source: RSizeSource;
     account_id: string | null;
   }

   export const MIN_R_SIZE_CENTS = 100;        // $1.00
   export const MAX_R_SIZE_CENTS = 10_000_000; // $100,000.00
   export const DEFAULT_R_SIZE_CENTS = 25_000; // $250.00

   export function isValidRSizeCents(value: unknown): value is number; // Number.isInteger(v) && v >= 100 && v <= 10_000_000
   export function isValidStatedRiskR(value: unknown): value is number; // finite, > 0 && <= 10, at most 2 decimal places (Math.abs(Math.round(v * 100) - v * 100) < 1e-6)
   export function resolveRSize(
     trade: Pick<TradeRecord, "account_id"> & Partial<Pick<TradeRecord, "r_size_cents">>,
     accounts: readonly Pick<TradingAccount, "id" | "r_size_cents">[] = [],
     prefs?: Partial<Pick<Prefs, "riskBudgetUsd">> | null,
   ): ResolvedRSize;
   export function riskCents(
     trade: Pick<TradeRecord, "symbol" | "direction" | "entry_price" | "quantity" | "stop_loss_price"> &
       Partial<Pick<TradeRecord, "initial_stop_price">>,
   ): number | null;
   export function resultR(trade: TradeRecord, rSize: ResolvedRSize | number): number | null;
   export function riskR(
     trade: Pick<TradeRecord, "symbol" | "direction" | "entry_price" | "quantity" | "stop_loss_price"> &
       Partial<Pick<TradeRecord, "initial_stop_price" | "risk_cents" | "stated_risk_r">>,
     rSize: ResolvedRSize | number,
   ): number | null;
   export function riskComparison(
     trade: Pick<TradeRecord, "symbol" | "direction" | "entry_price" | "quantity" | "stop_loss_price"> &
       Partial<Pick<TradeRecord, "initial_stop_price" | "risk_cents" | "stated_risk_r">>,
     rSize: ResolvedRSize | number,
   ): { actual_r: number | null; stated_r: number | null; differs: boolean };
   ```
   - `riskCents`: compute integer cents from integer ticks using `riskStopPrice` (`initial_stop_price` when on risk side, else `stop_loss_price` when on risk side) × `tickValueCents` × `quantity`. Return `null` when no valid risk-side stop or invalid qty/symbol.
   - `resultR`: closed trade only (`exit_time != null && exit_price != null`); compute `pnlCents = Math.round(tradePnl(trade) * 100)` and return `pnlCents / cents` (or `null` when `tradePnl` is `null`). Works even when the trade has NO stop!
   - `riskR`: if `riskCents(trade)` is non-null, return `riskCents(trade)! / cents`; else if `trade.stated_risk_r != null`, return `trade.stated_risk_r`; else `null` (never `0`).
   - `riskComparison`: `actual_r = actualRiskCents != null ? actualRiskCents / cents : null`, `stated_r = trade.stated_risk_r ?? null`. `differs` is `true` only when BOTH `actual_r` and `stated_r` are non-null AND `Math.abs(actualRiskCents - stated_r * cents) >= Math.max(0.02 * cents, tickValueCents * quantity)`.

2. **Update `lib/accounts.ts`:**
   - Add `r_size_cents: number | null;` to `TradingAccount`.
   - In `makeAccount`, accept optional `r_size_cents?: number | null` and set `r_size_cents: isValidRSizeCents(input.r_size_cents) ? input.r_size_cents : null`.
   - In `sanitizeAccounts`, sanitize `r_size_cents`: keep if `isValidRSizeCents(account.r_size_cents)` (or finite positive integer in `[100, 10_000_000]`), else `null`.

3. **Update `lib/trades.ts`:**
   - Add `r_size_cents?: number | null;`, `stated_risk_r?: number | null;`, and `risk_cents?: number | null;` to `TradeRecord` (defaulting to `null` in `normalizeTrade`).
   - In `normalizeTrade`:
     - Sanitize `r_size_cents`: `isValidRSizeCents(raw.r_size_cents) ? raw.r_size_cents : null`.
     - Sanitize `stated_risk_r`: `isValidStatedRiskR(raw.stated_risk_r) ? Number(raw.stated_risk_r.toFixed(2)) : null`.
     - Always recompute `trade.risk_cents = riskCents(trade)` so `risk_cents` never drifts when `entry_price`, `initial_stop_price`, `stop_loss_price`, or `quantity` changes.
   - Extend `keepInitialStop` (or add `keepFrozenRSize` called right next to `keepInitialStop`) so restoring an older backup with `r_size_cents: null` never overwrites a non-null `existing.r_size_cents` on the same trade id.

4. **Update `lib/store.ts`:**
   - When `addTrade` / `addTradeAndFlush` saves a trade whose `r_size_cents == null`, freeze `r_size_cents` from `resolveRSize(trade, getAccountsState().accounts, getPrefs()).cents`.
   - When `updateTrade` changes `account_id` (`"account_id" in patch && patch.account_id !== existing.account_id`), re-freeze `r_size_cents` from the new account (or `prefs` if `null`).
   - In `replaceTrades`, preserve `existing.r_size_cents` when `incoming.r_size_cents == null` (via `keepInitialStop` / `keepFrozenRSize`).

5. **Update `lib/commands/journal-commands.ts`:**
   - In `accountParser`: validate `raw.r_size_cents` — if `raw.r_size_cents !== undefined && raw.r_size_cents !== null && !isValidRSizeCents(raw.r_size_cents)`, return `bad("Account R size must be whole cents between $1 and $100,000.")`.
   - In `parseTrade`:
     - If `raw.r_size_cents !== undefined && raw.r_size_cents !== null && !isValidRSizeCents(raw.r_size_cents)`, return `bad("Trade R size must be whole cents between $1 and $100,000.")`.
     - If `raw.stated_risk_r !== undefined && raw.stated_risk_r !== null && !isValidStatedRiskR(raw.stated_risk_r)`, return `bad("Stated risk R must be between 0.01 and 10 (up to 2 decimal places).")`.
     - **Refuse mismatched `risk_cents`:** before `normalizeTrade` overwrites `raw.risk_cents`, if `raw.risk_cents !== undefined` check `raw.risk_cents === riskCents(trade)` (including `null === null`); if it differs, return `bad("risk_cents is computed from entry, initial stop and quantity and did not match.")` (which maps to HTTP `422 invalid`).
     - In `commands.create("trades", raw)` and `commands.update("trades", id, patch)` (when `account_id` changes or on create when `r_size_cents == null`), freeze `r_size_cents` by reading `accounts` and `prefs` from `repos` when `parsed.value.r_size_cents == null` (or when `patch.account_id` changed)!

## 5. Tests to Write (`lib/__tests__/r-size.test.ts`)

Create `lib/__tests__/r-size.test.ts` using `node:test` and `node:assert/strict` covering:
1. **Golden table (`04-r-size.md` §1) at `$300` (`30000` cents), 1 MES (`$5/pt`):**
   - Trade A: `17.5 pt` stop (`$87.50` = `8750` cents), `stated_risk_r: 0.25`, P&L `+$615` (`123 pts`): `riskCents === 8750`, `riskR` ≈ `0.2917` (`0.29R`), `resultR === 2.05`, `riskComparison.differs === true`.
   - Trade B: `15.0 pt` stop (`$75.00` = `7500` cents), `stated_risk_r: 0.25`, P&L `−$75`: `riskCents === 7500`, `riskR === 0.25`, `resultR === -0.25`, `riskComparison.differs === false`.
   - Trade C: `12.0 pt` stop (`$60.00` = `6000` cents), `stated_risk_r: 0.25`, P&L `−$40` (`−8 pts`): `riskCents === 6000`, `riskR === 0.20`, `resultR` ≈ `-0.1333` (`−0.13R`), `riskComparison.differs === true`.
2. **Resolution fallback order:** `trade.r_size_cents` (`"trade"`) wins over `account.r_size_cents` (`"account"`), which wins over `prefs.riskBudgetUsd` (`"prefs"`, default `25000`). Changing account `r_size_cents` later does NOT change a trade with frozen `r_size_cents`.
3. **No-stop & open trade rules:** closed trade with `stop_loss_price: null, initial_stop_price: null` has `riskCents === null`, `riskR === null`, and non-null `resultR`; open trade has `resultR === null`.
4. **Recomputation:** `normalizeTrade` recomputes `risk_cents` when `entry_price`, `initial_stop_price`, or `quantity` changes.
5. **Command layer (`createJournalCommands`):**
   - Rejects client-supplied `risk_cents` that disagrees with computed value (`error.code === "invalid"`).
   - Rejects out-of-range `stated_risk_r` (`0`, `-0.25`, `10.5`, `0.125`) and fractional/out-of-range `r_size_cents`.
   - Freezes `r_size_cents` from the trade's account on `create("trades", ...)` and updates it only when `account_id` changes.
6. **Backup restore preservation:** `replaceTrades` keeps existing frozen `r_size_cents` when incoming trade has `r_size_cents: null`.

## 6. Verification Commands

Run all five commands from your worktree root and paste their real output into your handoff:
```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run check:file-length
```

## 7. Claim, Handoff & PR Steps

1. Claim atomically before starting:
   ```bash
   git fetch origin
   git push origin origin/main:refs/heads/claim/RS-1
   ```
   *(If this push fails, another agent already claimed `RS-1` — STOP immediately.)*
2. Work on branch `swarm/RS-1`. Write your handoff in `notes/handoffs/2026-11-24-RS-1.md` including:
   - Exact files changed and exported signatures added.
   - Before and after line count for `lib/trades.ts` (`1,163` before) with justification per `AGENTS.md` §6.12.
   - Real output of the 5 verification commands.
3. Commit, push, and open the PR (do NOT merge):
   ```bash
   git add lib/r-size.ts lib/accounts.ts lib/trades.ts lib/store.ts lib/commands/journal-commands.ts lib/__tests__/r-size.test.ts notes/handoffs/2026-11-24-RS-1.md
   git commit -m "feat(RS-1): per-account R size model, stored fields, and command checks"
   git push -u origin swarm/RS-1
   gh pr create --base main --title "[RS-1] Per-account R size: pure model and stored fields" --body-file notes/handoffs/2026-11-24-RS-1.md
   ```

## 8. What NOT to Do & Out-of-Scope Rule

- Do **NOT** switch `rMultiple` callers or UI screens in this package (`RS-2`, `RS-3a`, and `RS-3b` do that).
- Do **NOT** create a SQL migration (`accounts` and `trades` store `record jsonb`).
- Do **NOT** edit `lib/journal-backup.ts` (`DR-1a` owns it in Wave 1).
- **STOP and leave a note** in `notes/handoffs/2026-11-24-RS-1.md` if anything requires editing a file outside §3.

HARD RULES:
- Supabase: only `mogmine_`-prefixed objects. If a package truly needs a schema change, write the SQL migration file under `supabase/migrations/` in the PR, but DO NOT apply it yourself: NEVER run `supabase db push`, NEVER run `supabase migration repair`, never use psql against the project. Note "MIGRATION NEEDS APPLYING (apply_migration via Supabase MCP)" at the top of the handoff and PR body; code must degrade gracefully (local mode) until it is applied. Never touch `showmob_` tables, auth site_url or disable_signup settings.
- No data dumps (no exporting tables/journals/backups, no printcode full dumps committed).
- Never print, log, commit or echo secrets (.env*, tokens, keys). Do not cat env files.
- Never modify, delete or re-create Chris's real trade records or accounts (no calls to the live /api/v1 with real tokens, no Supabase writes). Use fixtures and unit tests.
- Stay inside this package's scope and its listed writable files. Out-of-scope need = stop and write it in the handoff.
- Never edit BOARD.md, NOTES.md, DECISIONS.md. Never merge PRs, never push to main, never force-push other branches, never touch other worktrees.
