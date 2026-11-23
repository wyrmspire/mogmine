# Levels, chart render, R, efficiency, sync label, market-data errors: analysis (2026-11-23, Opus)

Written before any code change. Base: `origin/main` at `b3f96ce`. The source is the browser check of the API sim
(Wed 18 – Fri 20 Nov 2026, MES, `sim-trade-2026111x-*`). I could not read the live records or call Yahoo from this
worktree, so where a cause depends on the live data I say so and name the evidence.

Branches, stacked in this order: `fix/levels-labels` → `fix/levels-missing` → `fix/r-initial-stop` →
`fix/efficiency-plan-vs-actual` → `fix/sync-save-label` → `fix/market-data-graceful`.

---

## 1. Right-edge level labels stack and are unreadable

**What happens now.**

- `lib/chart-levels.ts:49` `levelLines` makes one line per **exact tick**. Levels one or two ticks apart (PDC 7340.75,
  3 PM close 7340, Globex open 7341) become three pills.
- `components/SessionLevelsPrimitive.ts:78` does call `stackLabels` at render time, with real pixels
  (`series.priceToCoordinate`), on every paint. So it already re-runs on resize and on price-scale zoom. The bug is not
  "never applied". It is what `stackLabels` is asked to do:
  - `lib/label-stack.ts:7-21` stacks **every** visible pill with no cap and no limit on how far a pill may move.
    Ten pills inside ~140 pts on a ~300 px mobile pane need ~170 px, so a cluster gets pushed into a column whose pills sit
    several rows away from their price, with long crossing leader ticks. Past the pane height, the overflow loop puts
    pills below the fold.
  - There is no priority. A far-off auto level gets a pill as readily as the level the trade was taken at.
  - The pill column knows nothing about the trade's own prices (entry, stop, trailed stop, target, key level). Its header
    comment says a pill may cover a trade label.
- The spec already asks for this: docs/08 UX-21 ("within a few ticks, merge the labels (`ONL · VWAP`) … default to the
  levels nearest the entry"), docs/12 LV-09 ("colliding labels group or stack with a leader tick … never shrink").
  `OD-20` notes UX-21 governs Trade Detail rendering and LV-07 (5 pt zones) governs stored zones.

**Change (branch `fix/levels-labels`).**

- `lib/chart-levels.ts`: `mergeNearLevels(lines, symbol, entry)` groups lines whose whole span is within
  **4 ticks** (1.00 pt on MES and MNQ, from `specFor(symbol).tickSize`, so it follows the instrument). One pill per group:
  the pill's price is the most important member's price, members at that tick join with ` / ` (LV-09, unchanged) and
  members at the other ticks join with ` · ` (UX-21). Every member keeps its own ray at its exact price.
- Priority per pill: **key level / entry / stop / trailed stop / target first**, then planned levels, then computed levels
  by distance from the entry.
- New pure `lib/level-label-layout.ts` (no imports, like `label-stack.ts`, so the primitive and the Chrome check can load
  it): takes wanted y in px, priority and pane height. It caps the pills at what fits (`min(8, pane / (pill+gap) / 2)`),
  stacks with `stackLabels`, and drops the lowest-priority pill while any pill would sit more than 2.5 rows away from its
  price. Dropped pills still draw their ray, faint. Pure and tested.
- Trade prices: the chart passes the trade's entry, stop, initial stop, target and key level as **reserved rows**. They
  are laid out first, so level pills never cover them. They are drawn as small outlined tags in the same column
  ("Entry 7405.00"). This is a visible chart change; see risks.
- Nothing is lost: the Session levels row's tooltip in View lists every level with its exact price, including those whose
  pill was dropped (pure `levelsSummary` in `lib/chart-levels.ts`).

**Risks.** The pill column now draws trade-price tags that were not drawn before; with `detail = low` they still show,
because the request was to keep those first. The primitive gets one more input from `TradeChart.tsx` (grandfathered at
578 lines; kept from growing). No stored data changes. Not done here: OD-55 (a), reserving a right offset so pills never
sit over the newest candles. That changes the time-scale fit (`fitWindow`, held default range) and belongs to `UI-2`.

## 2. "Session levels 18 shown · 6 missing"

**Which six.** `missingCandleLevels` (`lib/chart-levels.ts:79`) checks the 11 candle levels. On `sim-trade-20261119-a`
the auto levels that drew were RTH open, RTH high, RTH low, 3 PM close and Globex open: 5 of 11. The PDH, PDL, PDC, ONH
and ONL pills on that chart came from the **planning session** (`sim-plan-2026-11-19` typed them in; see the field notes),
merged by tick with the auto ones. The six missing are **PDH, PDL, ONH, ONL, Wk high, Wk low**. This matches the
measured cause already filed as `OD-55` (b): "Yahoo `1m` drops 10–29 minutes of each Globex session (measured
Nov 17–19) … ('5 shown · 6 missing')".

**Why, per level.**

- PDH/PDL (`lib/levels.ts:225`) need every 1m bar of the prior 23-hour Globex session; ONH/ONL (`lib/levels.ts:209`)
  need every bar from 18:00 to the cutoff. Yahoo leaves 1m gaps overnight, so they are withheld. RTH high/low (390 bars,
  liquid hours) survive. This follows the spec (docs/24 §5 "Extremes need whole bars through the cutoff"; docs/12 §5
  "never drawn as if complete"). **Correct by spec.**
- Wk high/low (`lib/levels.ts:211-217`) need every session from Monday to the entry, but `components/useTradeLevels.ts`
  only loads the prior session and today. From Wednesday on, the week can never be complete. That is a loader gap, but
  loading Mon–Tue too (3 more requests per trade) would not help while the whole-bar rule holds, because those sessions have
  the same overnight gaps.
- 3 PM close is withheld whenever the day windows came back coarser than 1m (`lib/levels.ts:207`).

**Change (branch `fix/levels-missing`).** No change to the coverage rule: `OD-55` (b) (read 5m when 1m has gaps) is an
open owner decision, so I do not build it. Instead `tradeLevelReport` returns the levels and a reason per withheld
level, read from the coverage that `extractSessionInputsFromCandles` already returns:
`gaps` (with the bar count), `not-loaded` (week sessions outside the two windows), `needs-1m`, `not-yet` (the window
has not opened by entry). The View row reads "5 auto · 6 withheld" (planned counted separately) and the tooltip names them
in short form: "PDH, PDL, ONH, ONL: Yahoo skipped 1m bars (47 missing) · Wk high/low: earlier sessions not loaded".

**Risks.** Copy only plus one pure function; no drawing change. **Deferred:** OD-55 (b) 5m fallback; loading the week's
earlier sessions (worth doing only together with OD-55 b).

## 3. R shows "—" when the stored stop was trailed past entry

**Cause.** `rMultiple` (`lib/trades.ts:298`) uses `stopRiskTicks` (`lib/trades.ts:279`) on `stop_loss_price` only. A
short at 7405 with the stop trailed to 7350 has its stop on the profit side, so risk is null and R is null, even though
`initial_stop_price` 7444 is stored. `initialRMultiple` (`lib/trades.ts:321`) exists but nothing calls it. The same
current-stop-only rule feeds `initialRiskUsd`, `plannedR` and `isScratch`, and through `rMultiple` every display: trade
header (`components/TradeDetail.tsx:272`), feed rows (`components/TradeRow.tsx:34`), review (`ReviewScreen.tsx:73`),
stats (`lib/selectors.ts:45,201`), day card, share card, drills, mood, describe, exit efficiency and plan-vs-actual. The
R strip (`lib/rstrip.ts:116-155`) uses `stop_loss_price` as its 1R axis too, by absolute distance, so a trailed stop gives
a wrong axis.

**Change (branch `fix/r-initial-stop`).** One rule in `lib/trades.ts`: `riskStopPrice(trade)` = the initial stop when
it is on the risk side of entry, else the current stop when it is on the risk side, else null. `stopRiskTicks` reads it,
so all R consumers follow at once. The R strip axis uses the same price. Trade detail shows "Initial stop 7444.00 ·
stop trailed to 7350.00" whenever they differ (today it needs `initial_stop_set_at`, which API-written trades may lack).
No record shape changes. `trade-document.ts` already plans from `initial_stop_price ?? stop_loss_price`.

**Risk.** Stats change for any trade whose stop was widened: R now divides by the first risk, which is what R-10 says R
is. A trade with no initial stop and a trailed stop still has no R (we cannot know the risk); the copy says so.

## 4. Efficiency −550 % and "Premature Exit" on a plain stop-out

**Cause.**

- `lib/exit-efficiency.ts:49` is `realised R ÷ MFE R` with no sign guard. Trade 18-c: −1.0R with an MFE of about
  +0.18R gives −1 / 0.18 ≈ −550 %. Any loss with a small MFE explodes. It also mixed R on the current stop
  (`rMultiple`) with MFE on the initial stop (`:38-42`).
- `lib/plan-vs-actual.ts:132-141` calls every exit short of the target "Premature Exit", including a full stop-out.
- "plan −2.0R": the Exit / Target row (`lib/plan-vs-actual.ts:86-105`) prints the gap from target to exit in R. For a
  1:1 plan stopped out, that gap is −2.0R, right next to the "Plan" column, so it reads as the plan's R. (Most likely
  reading; I could not see the live record. `plannedR` itself never returns a negative.)

**Change (branch `fix/efficiency-plan-vs-actual`).** Efficiency is the share of the best open profit that was kept:
only when the trade closed in profit and MFE is at least 2 ticks; clamped to 0–100 %. A loss or a scratch has no
efficiency (null, shown "—") and its summary reads "stopped at −1.0R; best was +0.2R". Plan vs actual gains a "Stopped
Out" fidelity (exit at or past the risk stop) and a "Scratch" one; the exit row compares the exit with the stop on a
stop-out ("Exit / Stop", slippage) and with the target otherwise; the Result row shows "Plan +1.0R" against "Actual −1.0R".
Tests: long and short, win, loss at stop, scratch, trailed-stop exit.

**Risk.** `ExecutionFidelity` is display-only (not stored or synced; checked with grep), so the new values are safe.

## 5. "Saved on this device" while synced

**Cause.** The header (`components/AppShell.tsx:27-48`) already maps sync state to text, but the three inline notes
hardcode device copy: `components/PitStop.tsx:72`, `components/PlanSheet.tsx:472`, `components/SessionReview.tsx:112`.

**Change (branch `fix/sync-save-label`).** Pure `lib/save-label.ts` (`saveLabel(local, remoteOn, sync, variant)`) for
both the header and inline notes, and `components/useSaveLabel.ts` that reads `useSyncSummary`. Inline copy with sync
on: "Saving…", "✓ Synced", "Saved on this device · will sync", "Saved on this device · sign in to sync", "Saved on this
device · couldn't sync". Device-only mode keeps today's copy. A blocked device store always wins. The header keeps its
exact current strings. No sync behaviour changes.

## 6. `/api/market-data` returns 502 for a future-dated trade

**Cause.** `app/api/market-data/route.ts` tries 1m, 5m, 1h in one `try`. For a future window Yahoo answers HTTP 400
("Data doesn't exist for startDate …"). `lib/market-data/yahoo.ts:52-53` treats only 404/422 as empty, so 400 throws,
the loop aborts on the first timeframe and the route answers 502. The client (`lib/candles.ts:291`) then treats any
failure the same, and because the exit is "fresh" (in the future), `nextCandleRetryAt` re-asks every minute and the
page says "Yahoo has not published these bars yet". The out-of-range price (4866.25) is not the route's concern: it
never sees prices. Trade-bar validation already flags prices that never traded.

**Change (branch `fix/market-data-graceful`).** Pure `marketDataWindowCheck` (future window → `200 { candles: [],
reason: "future" }`, no Yahoo call) and `isYahooNoData(status, body)` (Yahoo's "doesn't exist" 400 → empty). One
timeframe failing no longer aborts the others; 502 only when every attempt failed upstream and none answered. 404 keeps
`reason: "no-data"`. The client records the reason, does not retry a future trade until its entry time, and the page
says "No candles for this time: the trade is dated in the future" / "Yahoo has no candles for this time".

**Deferred.** Rejecting future-dated or out-of-range prices at entry (validation and agent API) is a product choice for
the owner; the field notes ask "maybe". Not done here.

---

## Cross-cutting

- No stored record shape, sanitizer or sync path changes in any branch. Nothing new is synced.
- Grandfathered files touched (`components/TradeDetail.tsx` 812, `components/TradeChart.tsx` 578, `lib/trades.ts`
  1163, `components/PlanSheet.tsx` 487): each branch keeps them at or below their starting length; new logic goes in new
  `lib/` modules.
