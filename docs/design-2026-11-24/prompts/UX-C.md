# Package Prompt: `UX-C` — Future Dates Refused and Far-Off Prices Warned

- **Agent / Lane:** `swarm-1` (`L1 Risk`) · **Wave:** `6` · **Branch:** `swarm/UX-C`
- **Depends on:** `RS-4` (W5), `SM-3` (W5)

## 1. Goal

Prevent tomorrow-dated typos and alert on impossible contract prices (`02-ux.md` §2.3 `UX-09`): refuse future-dated `entry_time` (`> now + 5 min`) or `exit_time` (`> now + 5 min`) as a validation error in `lib/trades.ts`, `lib/entry-form.ts`, `components/AddTradeSheet.tsx`, and `lib/commands/journal-commands.ts` (`422`), and display a non-blocking warning in `AddTradeSheet.tsx` when a typed entry or exit price sits `> 1%` outside the loaded day's candle range.

## 2. Read First (Required Context)

1. `AGENTS.md` (Guardrail `B-12` trader's fill is the fact — Yahoo gaps never block saving a price, §6.12 `lib/trades.ts` & `AddTradeSheet.tsx` line counts)
2. `docs/design-2026-11-24/02-ux.md` (§2.3 Future dates and impossible prices)
3. `docs/design-2026-11-24/90-work-packages.md` (`UX-C`)
4. `docs/design-2026-11-24/92-decisions-made-by-swarm.md` — **Chosen defaults locked for you:**
   - **Q-10:** **Refuse** future-dated entries and exits (form inline error + `422 invalid` in `journal-commands.ts`); **warn only** (saving still allowed!) when a typed price is `> 1%` outside `[dayLow, dayHigh]` of loaded day bars.
   - **Q-11:** Future clock-skew allowance is **5 minutes** (`FUTURE_ALLOWANCE_MS = 5 * 60_000`).

## 3. Writable Files (Strict Scope — Everything Else Read-Only)

- `lib/trades.ts` *(**grandfathered** — add pure `FUTURE_ALLOWANCE_MS` + `validateTradeTimes` / `priceOutOfRangeWarning`; keep net growth minimal and state before/after line counts)*
- `lib/entry-form.ts` *(existing)*
- `components/AddTradeSheet.tsx` *(existing — MUST stay `<= 450` lines!)*
- `lib/commands/journal-commands.ts` *(existing)*
- `lib/__tests__/future-and-range-validation.test.ts` *(new)*

## 4. Step-by-Step Implementation Plan

1. **Add time & price-range helpers in `lib/trades.ts` (or `lib/entry-form.ts` to keep `lib/trades.ts` compact!):**
   ```ts
   export const FUTURE_ALLOWANCE_MS = 5 * 60_000;

   export function validateFutureTimes(
     entryMs: number,
     exitMs: number | null,
     nowMs = Date.now(),
     zone = "America/Chicago",
   ): { entry?: string; exit?: string };

   export function checkPriceAgainstDayRange(
     price: number | null,
     symbol: string,
     dayBars: readonly Pick<Candle, "low" | "high">[],
   ): string | null;
   ```
   - `validateFutureTimes`:
     - If `Number.isFinite(entryMs) && entryMs > nowMs + FUTURE_ALLOWANCE_MS`: return `{ entry: \`This entry is in the future (\${formattedInZone}). Check the date.\` }`.
     - If `exitMs != null && Number.isFinite(exitMs) && exitMs > nowMs + FUTURE_ALLOWANCE_MS`: return `{ exit: \`This exit is in the future (\${formattedInZone}). Check the date.\` }`.
   - `checkPriceAgainstDayRange`:
     - If `price == null || !Number.isFinite(price) || dayBars.length === 0`: return `null`.
     - Let `dayLow = Math.min(...dayBars.map((b) => b.low))`, `dayHigh = Math.max(...dayBars.map((b) => b.high))`.
     - If `price < dayLow * 0.99 || price > dayHigh * 1.01`: return `\`\${formatPrice(price, symbol)} is far from where \${canonicalSymbol(symbol) ?? symbol} traded that day (\${formatPrice(dayLow, symbol)}–\${formatPrice(dayHigh, symbol)}). Typo?\``.

2. **Wire into `lib/commands/journal-commands.ts`:**
   - Accept optional `now?: () => number` in `createJournalCommands(repos, owner, opts?: { now?: () => number })` (default `Date.now`) so tests are deterministic.
   - In `parseTrade`: call `validateFutureTimes(entryAt, trade.status === "open" ? null : exitAt, now())`; if `entry` or `exit` error is present, return `bad(err)` (`422 invalid`).

3. **Wire into `lib/entry-form.ts` and `components/AddTradeSheet.tsx`:**
   - In `AddTradeSheet.tsx`, store the `day.candles` already fetched by the bar-finder `loadDayCandles` effect in local state (`dayBars`).
   - Run `validateFutureTimes(entry.getTime(), isOpenDraft || !exit ? null : exit.getTime(), Date.now(), zone)` and assign any error to `errors.entryClock` / `errors.exitClock` (blocking form submit).
   - Run `checkPriceAgainstDayRange` for `entryPrice` and `exitPrice` against `dayBars`; render a non-blocking `.banner.warn` / `.hint` warning when non-null while **still allowing form submission**! Keep `AddTradeSheet.tsx <= 450` lines.

## 5. Tests to Write (`lib/__tests__/future-and-range-validation.test.ts`)

1. Entry dated tomorrow (`2026-11-25T15:10:00Z` when `now` is `2026-11-24T15:00:00Z`): refused by `validateFutureTimes` (`"This entry is in the future ... Check the date."`) and rejected with `invalid` (`422`) by `createJournalCommands.create("trades", ...)` and `update("trades", ...)`.
2. Entry at `now + 4 minutes`: allowed (inside `5 min` clock-skew allowance, `Q-11`); entry at `now + 6 minutes`: refused.
3. Closed trade with valid past entry and future `exit_time` (`now + 10 min`): refused; open trade (`exit_time: null`) with `entry_time` at `now + 1 min`: allowed.
4. `checkPriceAgainstDayRange`: `4866.25` on an MES day with bars `[6935.00, 7410.00]` returns `"4866.25 is far from where MES traded that day (6935.00–7410.00). Typo?"`, while `createJournalCommands.create("trades", ...)` with `4866.25` on a past date **succeeds** (warning only, never blocks save).
5. `checkPriceAgainstDayRange`: `6900.00` (`0.5%` below `6935.00`) returns `null`; empty `dayBars` returns `null`.

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
   git push origin origin/main:refs/heads/claim/UX-C
   ```
2. Write `notes/handoffs/2026-11-24-UX-C.md` with changed files, `lib/trades.ts` before/after line counts and `AddTradeSheet.tsx` line count (`<= 450`), and real command outputs.
3. Commit, push, and open PR:
   ```bash
   git add lib/trades.ts lib/entry-form.ts components/AddTradeSheet.tsx lib/commands/journal-commands.ts lib/__tests__/future-and-range-validation.test.ts notes/handoffs/2026-11-24-UX-C.md
   git commit -m "feat(UX-C): refuse future trade timestamps and warn on out-of-range prices"
   git push -u origin swarm/UX-C
   gh pr create --base main --title "[UX-C] Refuse future trade dates and warn on far-off prices" --body-file notes/handoffs/2026-11-24-UX-C.md
   ```

## 8. What NOT to Do & Out-of-Scope Rule

- Do **NOT** block saving a trade because of an out-of-range price (`Q-10`: warn only).
- Do **NOT** let `AddTradeSheet.tsx` exceed 450 lines.
- **STOP and leave a note** in the handoff if any out-of-scope file seems needed.

HARD RULES:
- Supabase: only `mogmine_`-prefixed objects. If a package truly needs a schema change, write the SQL migration file under `supabase/migrations/` in the PR, but DO NOT apply it yourself: NEVER run `supabase db push`, NEVER run `supabase migration repair`, never use psql against the project. Note "MIGRATION NEEDS APPLYING (apply_migration via Supabase MCP)" at the top of the handoff and PR body; code must degrade gracefully (local mode) until it is applied. Never touch `showmob_` tables, auth site_url or disable_signup settings.
- No data dumps (no exporting tables/journals/backups, no printcode full dumps committed).
- Never print, log, commit or echo secrets (.env*, tokens, keys). Do not cat env files.
- Never modify, delete or re-create Chris's real trade records or accounts (no calls to the live /api/v1 with real tokens, no Supabase writes). Use fixtures and unit tests.
- Stay inside this package's scope and its listed writable files. Out-of-scope need = stop and write it in the handoff.
- Never edit BOARD.md, NOTES.md, DECISIONS.md. Never merge PRs, never push to main, never force-push other branches, never touch other worktrees.
