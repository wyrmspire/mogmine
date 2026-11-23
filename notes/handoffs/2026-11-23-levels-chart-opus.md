# Handoff: levels, chart render, R, efficiency, sync label, market-data errors (2026-11-23, Opus)

Base `origin/main` `b3f96ce`. Six stacked local branches, each branched from the one before. Nothing pushed.
The analysis written before any code is `notes/handoffs/2026-11-23-levels-chart-opus-analysis.md` (first commit
on `fix/levels-labels`). Where this handoff differs from the analysis, this file is right (noted per branch).

| # | Branch | Head | Diff vs previous |
| :- | :--- | :--- | :--- |
| 1 | `fix/levels-labels` | `3d9720a` | 11 files, +501 / −38 (includes the 190-line analysis doc) |
| 2 | `fix/levels-missing` | `260c805` | 7 files, +224 / −22 |
| 3 | `fix/r-initial-stop` | `befb80d` | 9 files, +143 / −36 |
| 4 | `fix/efficiency-plan-vs-actual` | `d943f6c` | 5 files, +175 / −51 |
| 5 | `fix/sync-save-label` | `dbab21b` | 7 files, +146 / −35 |
| 6 | `fix/market-data-graceful` | `07e5bd9` + this handoff | 7 files, +218 / −52 |

No stored record shape, sanitizer, migration or sync path changed in any branch. Nothing new is synced.

## 1. `fix/levels-labels`: right-edge pills

**Cause.** `stackLabels` already ran every paint at real pixels, so it did follow zoom and resize. It was asked to
stack every pill with no cap, no priority and no limit on drift, one pill per exact tick, and it knew nothing of the
trade's own prices. Ten pills in ~140 pts became a column of pills far from their prices with crossing leaders.

**Changed.**
- `lib/level-pills.ts` (new): `tradeAnchors` (key level, entry, SL, initial SL when it differs, TP), `levelPills`
  (lines within `MERGE_TICKS` = 4 ticks share one pill; a line within 4 ticks of a trade price folds into that
  trade tag; rank: trade prices, then planned levels, then computed levels by distance from entry), `levelsSummary`.
  Label: price of the most important member, same-tick members joined with ` / ` (LV-09, unchanged), near-tick members
  with ` · ` (UX-21). Example: `7340.75 PDC · Globex open · 3 PM close`, `Key 7389.75 · PDH · RTH high`.
- `lib/label-stack.ts`: `layoutPills` caps at 8 pills and at half the pane's rows, and drops the least important pill
  that had to move while any pill would sit more than 2.5 rows from its price. Still import-free.
- `components/SessionLevelsPrimitive.ts`: draws ranked pills via `layoutPills` each paint; rays of a dropped pill
  draw at 0.3 alpha (were 0.8); trade-price tags are outlined in their tone colour (risk/profit/entry/muted tokens).
  `update()` takes optional pills (defaults to one per line, so the Chrome check still loads it with one shim).
- `components/TradeChart.tsx`: passes pills (only when levels are on; Drill/Playbook/Review charts pass no levels and
  draw no tags). `components/useTradeLevels.ts`: `summary`. `components/TradeDetail.tsx`: tooltip lists every level.
- `scripts/check-session-levels.mjs`: now passes ranked pills and asserts the cap (≤ 8 drawn, nearest kept, farthest
  dropped, ≥ 15 rays still drawn). It asserted all 17 pills before, i.e. the crowding.
- `docs/24` LV-2 row: pill layout note.

**Tests.** `lib/__tests__/level-pills.test.ts` (9): merge threshold, the Thursday cluster, anchors first and absorbing
PDH/RTH high, no initial-SL tag when the stop never moved, summary lists every price, cap / no overlap / max drift,
least-important crowded pill dropped first, a taller pane keeps more pills, offscreen pills dropped.
`node scripts/check-session-levels.mjs` passes in headless Chrome (pills drawn: 8, minGap 17 px, rays 16).

## 2. `fix/levels-missing`: "18 shown · 6 missing"

**Which six and why** (as in the analysis, and the same as `OD-55` measured): PDH, PDL, ONH, ONL (Yahoo 1m leaves
overnight minutes out; extremes need whole bars, docs/24 §5) and Wk high/low (the loader only fetches the prior session
and today, so from Wednesday the week can never be complete). The PDH/PDL/PDC/ONH/ONL pills on the Thursday chart were
the planning session's typed levels. **Correct by spec; the copy was the problem.** I did not build OD-55 (b) (5m
fallback) because it is an open owner decision.

**Changed.** `lib/level-withheld.ts` (new): `withheldReasons` (from the coverage LV-1 already returns: `gaps` with a
bar count, `no-bars`, `not-loaded`, `needs-1m`, `not-yet`), `withheldText`, `levelsStatusText`, `levelsTitle`.
`lib/chart-levels.ts`: `tradeLevelReport` (`tradeLevels` now wraps it). `lib/levels.ts`: exports `levelLabel`.
`useTradeLevels` returns `withheld` instead of `missing`. View row: `18 shown · 6 withheld`, and under it, visible on
touch: `Withheld: PDH, PDL: Yahoo skipped 3 bars (prior session) · ONH, ONL: … · Wk high, Wk low: earlier sessions
this week not loaded`. `TradeDetail.tsx` lost its local `levelsStatus`. `docs/24` LV-2 row updated.

**Tests.** `lib/__tests__/level-withheld.test.ts` (6): the sim Thursday with gaps (exact drawn set and reasons),
whole windows withhold only the week, Tuesday has the whole week, 5m gives no 3 PM close, entry at the Globex open is
"not formed", the View status and tooltip.

## 3. `fix/r-initial-stop`: R with a trailed stop

**Changed.** `lib/trades.ts`: `riskStopPrice` (initial stop when on the risk side, else the current stop when it is,
else null); `stopRiskTicks` uses it, so `rMultiple`, `initialRiskUsd`, `plannedR`, `isScratch` and every screen that
calls them follow (header, feed row, review, stats in `selectors.ts`, day/share cards, drills, mood, describe).
`plannedR` no longer needs `stop_loss_price` to be set. `lib/rstrip.ts`: `stripStop` uses the same rule for the 1R
axis (it used the current stop by absolute distance). `lib/risk-text.ts` (new) `stopHistoryText`: "Initial stop
7444.00, set 09:50 · stop trailed to 7350.00" (or "widened"), shown whenever the two differ (it needed
`initial_stop_set_at`, which API-written trades may lack); with no initial stop and a stop past the entry it says
why R is blank. `docs/16` R-10: follow-up note, **pending owner confirmation** (R-10 said "do not change what
`rMultiple` returns … a separate decision").

**Tests.** `lib/__tests__/r-trailed-stop.test.ts` (8): the Thursday short (R 180/156, risk $390, plan 420/156), long
mirror, no-initial fallbacks, wrong-side initial typo, widened stop, panel text, scratch threshold, R strip axis and
caption. Updated two assertions that encoded the old rule: `initial-stop.test.ts` (R after a stop move is 2, was 3.5)
and `stop-moves.test.ts` (trailed above entry: R is 1, was null).

## 4. `fix/efficiency-plan-vs-actual`

**Changed.** `lib/exit-efficiency.ts`: efficiency only for a winner with MFE ≥ 2 ticks and not a scratch, as the share
of MFE kept, clamped to 0–100 %, on the first risk. Otherwise `efficiencyPercent` is null and the summary states the
facts ("closed at −1.0R; best was +0.2R"). `lib/plan-vs-actual.ts`: fidelity gains `Stopped Out`, `Trailed Stop Hit`,
`Scratch` (`stopOutcome`: trader's exit reason first, else exit at or through the working stop); a stop-out's exit row
is "Exit / Stop" (slippage) instead of "Exit / Target" (that delta was the "−2.0R" next to "Plan"); the Result row's
plan reads "+2.0R at target"; 1R is `riskStopPrice`. `TradeDetail.tsx` shows "—" when the percent is null.

**Tests.** `lib/__tests__/efficiency-stop-out.test.ts` (14): for LONG and SHORT, stop-out, slippage, win (57 %, clamp
to 100 %), scratch, trailed-stop exit, sub-2-tick MFE; exit reason wins; widened stop stays "Widened Stop". One existing
assertion updated for the "at target" wording.

## 5. `fix/sync-save-label`

**Changed.** `lib/save-label.ts` (new): `headerSaveLabel` / `headerSaveTitle` (moved from `AppShell`, same strings)
and `inlineSaveText`. Inline copy with sync on uses the names docs/11 §1 and docs/08 already give: "Syncing…",
"✓ Saved to your account", "Saved on this device — will sync", "— sign in to sync", "— couldn't sync". (The analysis
said "✓ Synced" and `·`; I switched to the spec's wording rather than add a third name.) Device-only mode and sample
trades keep today's copy; a blocked store always wins. `components/useSaveLabel.ts` (new) reads `useSyncSummary`.
Wired into `AppShell`, `PitStop` (samples are device-only), `PlanSheet`, `SessionReview` (keeps its own blocked text
and no ✓).

**Tests.** `lib/__tests__/save-label.test.ts` (5).

## 6. `fix/market-data-graceful`

**Changed.** `lib/market-data/outcome.ts` (new): `windowInFuture`, `noCandlesResponse`, `reasonFromResponse`,
`isYahooNoData`, `noCandlesMessage`. `lib/market-data/yahoo.ts`: Yahoo's 400 "Data doesn't exist" and a "No data found"
chart error are empty, not errors. `app/api/market-data/route.ts`: a future window returns `200 { candles: [],
reason: "future" }` without calling Yahoo (also for open trades, which got a 400 before, and day mode); each timeframe
attempt catches its own failure, so 1m failing no longer aborts 5m/1h; 404 `{ reason: "no-data" }`; 502 `{ reason:
"unavailable" }` only when an attempt failed and nothing answered. `lib/candles.ts`: `CandleEntry.reason`; the loader
keeps `future` / `no-data`; `nextCandleRetryAt` asks a future-dated trade again at its entry, not every minute.
`TradeDetail.tsx`: "No candles for this time: the trade is dated in the future" / "Yahoo has no candles for this time".
`docs/10` §2 quirks table: the 400 row and the route's answers.

**Tests.** `lib/__tests__/market-data-outcome.test.ts` (7): responses, Yahoo no-data detection, the provider with a
mocked `fetch` (400 empty, 429 throws), reason parsing, page message, retry at entry, loader keeps the reason.

## Commands (run on every branch, in order, from a clean tree)

| Branch | `npm test` | `typecheck` | `lint` | `build` | `check:file-length` |
| :--- | :--- | :--- | :--- | :--- | :--- |
| levels-labels | 894 tests, 893 pass, 0 fail (1 skipped, pre-existing) | ok | 0 errors, 1 warning | ok | 14 over (same list as main) |
| levels-missing | 900 / 899 / 0 | ok | 0 / 1 | ok | 14 |
| r-initial-stop | 908 / 907 / 0 | ok | 0 / 1 | ok | 14 |
| efficiency-plan-vs-actual | 922 / 921 / 0 | ok | 0 / 1 | ok | 14 |
| sync-save-label | 927 / 926 / 0 | ok | 0 / 1 | ok | 14 |
| market-data-graceful | 934 / 933 / 0 | ok | 0 / 1 | ok | 14 |

The lint warning is the pre-existing `postcss.config.mjs` anonymous default export. `node scripts/check-session-levels.mjs`
passed on branch 1. No Supabase env was set for the builds.

**Over-target files touched** (AGENTS §6.12; line counts main → branch 6): `components/TradeDetail.tsx` 812 → 807,
`components/TradeChart.tsx` 578 → 578, `lib/trades.ts` 1163 → 1163, `components/PlanSheet.tsx` 487 → 487. None grew on
any branch relative to main; new logic went to new `lib/` modules (all under 170 lines). `lib/candles.ts` 398 → 412
(under target).

## For the reviewer: check closely

1. **Chart drawing (branch 1).** New outlined tags for Key / Entry / SL / Initial SL / TP in the pill column when
   levels are on. With levels on and a crowded pane, up to 8 pills draw; the rest are faint rays. I verified with the
   headless check and unit tests, **not** by eye on the live chart at 390×844. Please look at
   `/trades/sim-trade-20261119-a` before merging. Pills still sit over the newest candles (OD-55 a, not done: it
   changes the time-scale fit).
2. **R everywhere (branch 3).** Any trade whose stop was moved now reports R on the first risk, in stats, the feed,
   challenges' inputs and cards. This is the R-10 "separate decision"; docs/16 says pending owner confirmation.
3. **Merge separators.** ` · ` between near-tick members vs ` / ` at one tick follows UX-21 vs LV-09 as `OD-20`
   proposes; the owner has not closed OD-20.
4. **Sync wording (branch 5)** is driven by the aggregate sync summary, not per record. "Saved to your account" under
   a note means every syncer is synced, which is stronger than this one record.
5. **Market data (branch 6).** I could not reach Yahoo from this worktree, so the exact 400 body is from Yahoo's known
   format, matched loosely ("doesn't exist" / "does not exist" / "no data found"). If Yahoo phrases it otherwise, the
   result is still a 502 as before, not a crash.

## Deferred

- OD-55 (b): read 5m when 1m has gaps (owner decision). Loading the week's earlier sessions only helps together with it.
- OD-55 (a): reserve a right offset so pills never cover candles (UI-2).
- Rejecting future-dated or out-of-range prices at entry and in the agent API (owner's call; the field notes say "maybe").
- The data-quality chip still shows amber "missing" coverage for a future-dated trade.
- For the integrator (workers do not edit these): DECISIONS `OD-55` "Current" column still quotes "5 shown · 6
  missing"; R-10's rMultiple switch and the inline sync wording may deserve a `D-` entry once the owner agrees.
