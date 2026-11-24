# Package Prompt: `SM-1` — Stop Touches and MAE Only After the Entry Bar

- **Agent / Lane:** `swarm-2` (`L2 Trade truth`) · **Wave:** `2` · **Branch:** `swarm/SM-1`
- **Depends on:** `FB-1` (merged on `origin/main` before Wave 2 starts)

## 1. Goal

Enforce the post-entry excursion rule (`R-POST-1`..`R-POST-5`): the entry bar itself (whether stated at `:00` seconds or shifted via `FB-1`'s `matchFill`) is **never** counted as an inside bar for MAE/MFE or stop/target-touch findings. When the entry bar's pre-fill range crossed the stop, emit no chart flag and no amber warning — emit only a quiet (`tone: "quiet"`) explanatory Data notes line (`D-H`).

## 2. Read First (Required Context)

1. `AGENTS.md` (Guardrail §3b-5 session math, §6.12 file-length rule for `lib/trades.ts`)
2. `docs/design-2026-11-24/05-stops-mae-fills.md` (§1.1–§1.3, §5 row A)
3. `docs/design-2026-11-24/90-work-packages.md` (`SM-1`)
4. `docs/design-2026-11-24/92-decisions-made-by-swarm.md` — **Chosen defaults locked for you:**
   - **D-H:** When the entry bar's range crossed the working stop at entry (`bar.low <= stop` for LONG or `bar.high >= stop` for SHORT), emit a quiet Data notes line: `"The entry bar traded past the stop before your fill. That is not counted as a stop touch."` (`tone: "quiet"`, no chart flag).
   - **D-I:** When `FB-1` matched the entry fill to a shifted bar, "the entry bar" excluded by `R-POST-1` is that matched entry bar.

## 3. Writable Files (Strict Scope — Everything Else Read-Only)

- `lib/session.ts` *(existing, ~178 lines)*
- `lib/trades.ts` *(existing, **~1,163 lines — grandfathered**: touch `excursions` + import ONLY; zero other edits; report before/after line counts)*
- `lib/trade-bar-validation.ts` *(existing, ~400 lines)*
- `lib/data-notes.ts` *(existing, ~110 lines)*
- `lib/__tests__/post-entry.test.ts` *(new)*
- `lib/__tests__/trade-observer.test.ts` *(existing — update any `:00`-second fixture goldens and document each in handoff)*
- `lib/__tests__/data-notes.test.ts` *(existing)*
- `lib/__tests__/trade-document.test.ts` *(existing — only if a `:00`-entry fixture golden changes)*

## 4. Step-by-Step Implementation Plan

1. **Add `insideBarTimes` to `lib/session.ts` (`R-POST-1`, `R-POST-5`):**
   ```ts
   /**
    * Open times of bars strictly after the entry bar and fully before/at the exit.
    * Unlike `expectedInsideBarTimes` (kept unchanged for market-data coverage), the bar containing `entry`
    * (`floor(entry / barMs) * barMs`) is NEVER included, even when `entry` has `:00` seconds.
    */
   export function insideBarTimes(entry: number, exit: number, barMs: number, symbol?: string): number[];
   ```
   - Start `let time = Math.floor(entry / barMs) * barMs + barMs;` and collect `time` while `time + barMs <= exit` when `isRegularTradingBarInterval(symbol, time, barMs)` is true.
   - Leave `expectedInsideBarTimes` untouched (`lib/market-data/coverage.ts` relies on it).

2. **Update `lib/trades.ts` (`excursions` only):**
   - Import `insideBarTimes` from `./session.ts`.
   - In `excursions(trade, candles, barMinutes)`: replace `expectedInsideBarTimes(entry, exit, barMs, trade.symbol)` with `insideBarTimes(entry, exit, barMs, trade.symbol)` and filter `bar.time > Math.floor(entry / barMs) * barMs && bar.time + barMs <= exit`.
   - Keep `excursionsFromBars` unchanged (when `< 2` inside bars remain, it returns `null` per `R-POST-2`).

3. **Update `lib/trade-bar-validation.ts` (`validateTradeAgainstBars` and `observeTrade`):**
   - In `validateTradeAgainstBars`: use `insideBarTimes(entry, exit, barMs, trade.symbol)` and exclude `entryBarTime` from `completed` (`bar.time >= entryBarTime + barMs && bar.time + barMs <= exit`).
   - In `observeTrade`:
     - Use `insideBarTimes(from, to, barMs, symbol)` for `expected` and `inside` on each position window (where `from` uses the `FB-1` matched entry bar time when shifted, per `D-I`!). Also on open trades, filter `bar.time >= Math.floor(from / barMs) * barMs + barMs`.
     - Check whether the entry bar itself (`barsByTime.get(effectiveEntryBarTime)`) crossed the active stop at entry (`stopTouched(direction, activeStopAtEntry.price, entryBar)`). Expose `entryBarPassedStop?: boolean` on `ObservedTrade` (do NOT push a `TradeBarFinding` onto `findings`, so `buildFindingMarks` draws zero flags on the chart!).

4. **Update `lib/data-notes.ts` (`D-H`):**
   - Accept optional `entryBarPassedStop?: boolean` on `DataNoteInput` (or read from `ObservedTrade` if passed; keep `DataNoteInput` backward-compatible with `entryBarPassedStop?: boolean`).
   - When `input.entryBarPassedStop === true`, append `{ id: "entry_bar_passed_stop", text: "The entry bar traded past the stop before your fill. That is not counted as a stop touch.", tone: "quiet" }`.
   - Ensure `hasUntrustedDataNote` stays `false` for this note (`tone: "quiet"`).

## 5. Tests to Write (`lib/__tests__/post-entry.test.ts`)

1. **Trade A pattern (`05` §1.1 & §5 row A):** LONG entry `7137.00` at `07:55:00 CT` (`2026-11-23T13:55:00Z`), stop `7119.50`, `07:55` 1m bar has `low: 7083.75, high: 7142.00`, subsequent bars `07:56`..`08:29` stay `>= 7125.00`, exit at `08:30:00 CT`:
   - `observeTrade` has **zero** `stop_traded_through` findings.
   - `excursions` and `observeTrade.excursions` report `maePrice: 7125.00` (never `7083.75`).
   - `observeTrade.entryBarPassedStop === true`, and `collectDataNotes` includes `"The entry bar traded past the stop before your fill. That is not counted as a stop touch."` with `tone: "quiet"`.
2. **`:30`-second entry (`07:55:30`):** identical post-entry behavior.
3. **SHORT mirror:** entry `7400.00` at `09:30:00`, stop `7410.00`, `09:30` bar `high: 7418.00`, later inside bars `<= 7404.00` → zero `stop_traded_through`, `maePrice: 7404.00`, `entryBarPassedStop === true`.
4. **Short hold (`< 2` inside bars after excluding entry bar):** `excursions` returns `null`, zero stop touch.
5. **Shifted entry (`FB-1` + `SM-1`):** entry logged `14:14:00` shifted to `14:13:00` bar whose pre-fill range crossed stop → `14:13` bar excluded, `14:14` bar IS an inside bar and checked!
6. Re-run all 7 `fixtures/trades/ex-*.json` tests; list every updated golden expectation and why in your handoff.

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
   git push origin origin/main:refs/heads/claim/SM-1
   ```
2. Write `notes/handoffs/2026-11-24-SM-1.md` with changed files, `lib/trades.ts` before/after line counts, any updated fixture golden assertions + reasons, and real command outputs.
3. Commit, push, and open PR:
   ```bash
   git add lib/session.ts lib/trades.ts lib/trade-bar-validation.ts lib/data-notes.ts lib/__tests__/post-entry.test.ts lib/__tests__/trade-observer.test.ts lib/__tests__/data-notes.test.ts lib/__tests__/trade-document.test.ts notes/handoffs/2026-11-24-SM-1.md
   git commit -m "fix(SM-1): measure stop touches and MAE strictly after the entry bar"
   git push -u origin swarm/SM-1
   gh pr create --base main --title "[SM-1] Stop touches and MAE only after the entry bar" --body-file notes/handoffs/2026-11-24-SM-1.md
   ```

## 8. What NOT to Do & Out-of-Scope Rule

- Do **NOT** change `expectedInsideBarTimes` (`lib/market-data/coverage.ts` uses it).
- Do **NOT** touch anything in `lib/trades.ts` outside `excursions` and its `insideBarTimes` import.
- **STOP and leave a note** in the handoff if any out-of-scope file seems needed.

HARD RULES:
- Supabase: only `mogmine_`-prefixed objects. If a package truly needs a schema change, write the SQL migration file under `supabase/migrations/` in the PR, but DO NOT apply it yourself: NEVER run `supabase db push`, NEVER run `supabase migration repair`, never use psql against the project. Note "MIGRATION NEEDS APPLYING (apply_migration via Supabase MCP)" at the top of the handoff and PR body; code must degrade gracefully (local mode) until it is applied. Never touch `showmob_` tables, auth site_url or disable_signup settings.
- No data dumps (no exporting tables/journals/backups, no printcode full dumps committed).
- Never print, log, commit or echo secrets (.env*, tokens, keys). Do not cat env files.
- Never modify, delete or re-create Chris's real trade records or accounts (no calls to the live /api/v1 with real tokens, no Supabase writes). Use fixtures and unit tests.
- Stay inside this package's scope and its listed writable files. Out-of-scope need = stop and write it in the handoff.
- Never edit BOARD.md, NOTES.md, DECISIONS.md. Never merge PRs, never push to main, never force-push other branches, never touch other worktrees.
