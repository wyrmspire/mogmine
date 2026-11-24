# Package Prompt: `IN-2` — Globex VWAP with Small Overnight Gaps, from Session Start

- **Agent / Lane:** `swarm-3` (`L3 Chart look`) · **Wave:** `3` · **Branch:** `swarm/IN-2`
- **Depends on:** `IN-1` (W1), `RS-2` (W2)

## 1. Goal

Extend the day-candles window in `components/useTradeLevels.ts` to cover the full session (from `18:00 ET` Globex open through session close or now, while still cutting computed levels strictly at `entry_time`), and add `gapPolicy: "globex-tolerant"` to `computeSessionIndicators` (`lib/session-indicators.ts`, `lib/chart-indicators.ts`) so Globex VWAP draws with `"≈"` when `<= 3%` of overnight bars are missing, longest gap `<= 15 min`, and zero bars are missing after `09:30 ET`.

## 2. Read First (Required Context)

1. `AGENTS.md` (Invariant 3 `MES → MES=F`, Guardrail §3b-5 `America/New_York`, Guardrail §3b-8 never synthesize missing bars, §6.12 `TradeDetail.tsx`)
2. `docs/design-2026-11-24/03-indicators-and-levels.md` (§5 `VW-1` and `VW-2`)
3. `docs/design-2026-11-24/90-work-packages.md` (`IN-2`)
4. `docs/design-2026-11-24/92-decisions-made-by-swarm.md` — **Chosen default locked for you:**
   - **D-F:** `gapPolicy?: "complete" | "globex-tolerant"` (default `"complete"` so existing callers stay unchanged unless opting in). Under `"globex-tolerant"`:
     - RTH (`09:30 ET` onward): requires `0` missing bars (`complete: true`), drawn normally.
     - Globex (`18:00 ET` onward): draws when `missingBars <= Math.floor(expectedBars * 0.03)` (or `missingBars / expectedBars <= 0.03`), `longestGapMin <= 15`, AND `rthMissingBars === 0` (no missing expected bar at or after `today.rthOpen` up to `asOf`), setting `approximate: missingBars > 0`.

## 3. Writable Files (Strict Scope — Everything Else Read-Only)

- `lib/session-indicators.ts` *(existing, ~214 lines)*
- `lib/chart-indicators.ts` *(existing, ~57 lines)*
- `components/useTradeLevels.ts` *(existing, ~74 lines)*
- `components/TradeDetail.tsx` *(existing, **~815 lines — grandfathered**: `<= 5` net lines for View menu `"Globex VWAP · ≈ X min missing overnight"` & HUD `"≈"` prefix, plus passing `sessionCandles` from `useTradeLevels` to `tradeSessionVwap`; state before/after line count)*
- `lib/__tests__/session-indicators.test.ts` *(existing)*
- `lib/__tests__/chart-indicators.test.ts` *(existing)*

## 4. Step-by-Step Implementation Plan

1. **Update `lib/session-indicators.ts`:**
   - Add `export type GapPolicy = "complete" | "globex-tolerant";` and `gapPolicy?: GapPolicy;` on `SessionIndicatorOptions` (default `"complete"`).
   - Compute gap metrics on `anchored` window (`missingBars = expectedBars - presentBars`, `longestGapMin` = longest contiguous run of missing expected regular-trading bars in minutes, `rthMissingBars` = missing expected bars with `openTime >= today.rthOpen && openTime + barMs <= Math.min(today.rthClose, asOf)`).
   - Expose `{ ...anchored.coverage, missingBars, longestGapMin, rthMissingBars, approximate }` on `result.coverage.anchored`.
   - When `anchor === "globex"` and `gapPolicy === "globex-tolerant"` and `expectedBars > 0`: allow `vwap` calculation when `missingBars / expectedBars <= 0.03 && longestGapMin <= 15 && rthMissingBars === 0` (setting `approximate = missingBars > 0`). Keep `levels` (`pdh`, `pdl`, `onh`, `onl`, `poc`/`vah`/`val`) on strict completeness so level values never change!

2. **Update `lib/chart-indicators.ts`:**
   - Update `tradeSessionVwap` (or add `tradeSessionVwapReport` returning `{ points: { time: number; value: number }[]; approximate: boolean; missingBars: number; reason: string | null } | null`, keeping `tradeSessionVwap` compatible or updated alongside its callers) to pass `gapPolicy: anchor === "globex" ? "globex-tolerant" : "complete"`.
   - Never fabricate synthetic candles for missing minutes (`#28`).

3. **Update `components/useTradeLevels.ts` and `components/TradeDetail.tsx` (`<= 5` net lines in `TradeDetail.tsx`):**
   - In `useTradeLevels.ts`: fetch `today` window from `today.open` (`18:00 ET`) up to `Math.min(today.close, Date.now())` (instead of stopping at `entry_time`), expose `sessionCandles: readonly Candle[]` on `TradeLevelsState`, and **keep `tradeLevelReport(trade, prior, todayCutAtEntry)` filtering `today` candles to `bar.time < entryMs` (or existing cutoff in `tradeLevelReport`) so computed levels stay 100% identical to before!** (Enable fetching `sessionCandles` when `showLevels || vwapAnchor !== "off"`.)
   - In `TradeDetail.tsx`: pass merged `[...sessionCandles, ...tradeCandles]` (deduped by `bar.time`) into `tradeSessionVwapReport`; when `approximate` is `true`, show `"≈"` in the View menu (`"Session VWAP · ≈ 23 min missing overnight"`) and prefix `"VWAP ≈ "` in the crosshair HUD readout.

## 5. Tests to Write (`lib/__tests__/session-indicators.test.ts` + `lib/__tests__/chart-indicators.test.ts`)

1. **11/23 Globex gap pattern (`03` §5):** 1,380 expected 1m bars from `18:00 ET`, remove 23 overnight bars (`17:00–17:09 CT` = 10 bars, `18:17–18:28 CT` = 12 bars, `22:59 CT` = 1 bar; `23/1380 = 1.67% <= 3%`, longest gap `12 <= 15`, `0` RTH gaps):
   - Default `gapPolicy: "complete"` returns empty `vwap: []`.
   - `gapPolicy: "globex-tolerant"` returns non-empty `vwap`, `coverage.anchored.approximate === true`, `missingBars === 23`, `longestGapMin === 12`.
2. **Threshold rejections:**
   - `longestGapMin === 16` (16 consecutive overnight bars missing) → `vwap: []` (unavailable).
   - `missingBars > 3%` (`45 / 1380` scattered 1m gaps) → `vwap: []`.
   - **1 single missing bar at `09:45 ET` (RTH)** → `vwap: []` for BOTH `rth` and `globex`!
3. **Zero gaps:** `approximate === false`.
4. **Level invariance:** existing level tests produce identical `pdh`, `pdl`, `onh`, `onl`, `rth_*` values when `today` candles extend past `entry_time`.

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
   git push origin origin/main:refs/heads/claim/IN-2
   ```
2. Write `notes/handoffs/2026-11-24-IN-2.md` with changed files, `TradeDetail.tsx` before/after line counts, and real command outputs.
3. Commit, push, and open PR:
   ```bash
   git add lib/session-indicators.ts lib/chart-indicators.ts components/useTradeLevels.ts components/TradeDetail.tsx lib/__tests__/session-indicators.test.ts lib/__tests__/chart-indicators.test.ts notes/handoffs/2026-11-24-IN-2.md
   git commit -m "feat(IN-2): full-session VWAP window and Globex small-gap tolerance"
   git push -u origin swarm/IN-2
   gh pr create --base main --title "[IN-2] Globex VWAP with small overnight gaps from session start" --body-file notes/handoffs/2026-11-24-IN-2.md
   ```

## 8. What NOT to Do & Out-of-Scope Rule

- Do **NOT** fill missing minutes with synthetic bars or 5m fallback bars.
- Do **NOT** relax completeness for computed price levels (`PDH`/`PDL`/`ONH`/`ONL`).
- **STOP and leave a note** in the handoff if any out-of-scope file seems needed.

HARD RULES:
- Supabase: only `mogmine_`-prefixed objects. If a package truly needs a schema change, write the SQL migration file under `supabase/migrations/` in the PR, but DO NOT apply it yourself: NEVER run `supabase db push`, NEVER run `supabase migration repair`, never use psql against the project. Note "MIGRATION NEEDS APPLYING (apply_migration via Supabase MCP)" at the top of the handoff and PR body; code must degrade gracefully (local mode) until it is applied. Never touch `showmob_` tables, auth site_url or disable_signup settings.
- No data dumps (no exporting tables/journals/backups, no printcode full dumps committed).
- Never print, log, commit or echo secrets (.env*, tokens, keys). Do not cat env files.
- Never modify, delete or re-create Chris's real trade records or accounts (no calls to the live /api/v1 with real tokens, no Supabase writes). Use fixtures and unit tests.
- Stay inside this package's scope and its listed writable files. Out-of-scope need = stop and write it in the handoff.
- Never edit BOARD.md, NOTES.md, DECISIONS.md. Never merge PRs, never push to main, never force-push other branches, never touch other worktrees.
