# 05 — Stop touches and MAE after entry, timed stop moves, ±5-minute fill matching

Source: FIELD-NOTES "Evening 11/23 voice session": *Bug-ish: false "SL touch" from an untimed stop move*, *SL-touch rule*, *Fill-to-bar matching*, the *SOP for agents* (check times against 1-minute candles), and the reliability warning. Related: docs/15 §3 (trade document, stop path), docs/15 §3.3 (`observeTrade`, TD-1), `OD-28` (nearby bar snap), `OD-43`, docs/16 `R-10`, issue #36 (G2 stop moves), issue #51, guardrail §3b-6 (snap fill times to bars).

---

## 1. Stop touches and MAE count only after the entry

### 1.1 The bug

The rule: a candle that crosses the stop only on its way to the entry price is normal price action. A stop touch, and MAE, are measured **after the entry fill**, during the trade.

The code (`lib/trade-bar-validation.ts` `observeTrade`, and `lib/trades.ts` `excursions`) counts a bar as "inside the hold" when `bar.time >= entry && bar.time + barMs <= exit`. `expectedInsideBarTimes` (`lib/session.ts:70`) starts at `ceil(entry / barMs)`. That excludes the entry bar only when the entry time has seconds. **Voice and API trades are stated to the minute** (`07:55:00`), so the entry bar's open equals the entry instant and the whole entry bar counts, including its range before the fill.

Trade A (11/23, long, illustrative: the record itself is unreliable): the 07:55 CT bar dipped to 7083.75, below the 7119.50 stop, then spiked to the 7137 fill. The pre-fill dip was flagged as `stop_traded_through` ("SL touch") and pulled MAE down to 7083.75.

### 1.2 The rule

**R-POST-1.** The **entry bar is never inside the hold**, whatever the entry time's seconds. Inside bars start at `floor(entry / barMs) × barMs + barMs`. The exit bar stays excluded, as today (`bar.time + barMs <= exit`).

**R-POST-2.** MAE and MFE take the fill prices plus the inside bars, as `excursionsFromBars` does now. The entry bar contributes only its fill price. The order of prices inside a bar is unknown (issue #47), so the part of the entry bar after the fill is not used. When fewer than two inside bars remain, MAE/MFE are null and show "—" (existing rule).

**R-POST-3.** Stop-touch and target-touch checks use the same inside-bar set. A stop segment that starts inside the entry bar is checked from the next bar.

**R-POST-4.** When the entry bar's range passed the stop, record nothing visible. No chart label, and no amber data note. Optional and muted: a Data notes line, "The entry bar traded past the stop before your fill. That is not counted as a stop touch." *(Decision D-H: show this muted line or nothing. Recommended: show it; it explains why the bar looks alarming.)*

**R-POST-5.** One helper owns the rule, `insideBarTimes(entry, exit, barMs, symbol)`, in `lib/session.ts` next to `expectedInsideBarTimes`. `excursions` (`lib/trades.ts`) and `observeTrade` (`lib/trade-bar-validation.ts`) both call it. `expectedInsideBarTimes` keeps its meaning for coverage (`lib/market-data/coverage.ts` uses it); only the hold checks change.

**Matched entry bar.** When the ±5-minute match (§4) moves the entry to another bar, "the entry bar" is the matched bar.

### 1.3 Tests

- A long, entry stated `HH:MM:00`, whose entry bar's low is below the stop and later bars stay above it: no `stop_traded_through`, and MAE is the lowest inside-bar low.
- The same with entry at `HH:MM:30` (today's behaviour is already right): unchanged.
- A short mirror.
- A two-bar hold where only the entry bar passes the stop: MAE null (fewer than two inside bars), no touch.
- The goldens for all seven trade fixtures (`fixtures/trades/ex-*.json`, TD-1/TD-2) are re-run. Any change in them is listed in the PR with the reason. Expect changes only where a fixture's entry time has zero seconds.

## 2. Stop moves without a time

### 2.1 The bug

`lib/trade-document.ts` `fromLegacy`: when `initial_stop_price ≠ stop_loss_price` and there are no `stop_moves`, it invents one move at `pickStopMoveTime(entry, exit, initial_stop_set_at)`. That takes `initial_stop_set_at`, the time the **first** stop was set. It is not the time of the move. API trades set it at the entry time, so the trailed stop (7260 on trade A) was treated as live from the entry, and the early bars were flagged against it.

### 2.2 The rule

**SM-UT-1.** The time of an unrecorded move is **unknown**. It is never taken from `initial_stop_set_at`. `pickStopMoveTime` is removed.

**SM-UT-2.** An untimed move becomes a stop `modify` event at the **exit instant** with a new basis value `"untimed"` (added to `EventBasis` next to `broker`, `stated` and `inferred`). In effect:
- The initial stop is the working stop for the whole hold. Stop-touch checks run against it only. That is conservative: a touch of the first stop is a real finding, and no false touch can come from the moved stop.
- The chart (`lib/trade-marks.ts`, TD-3 stepped path) draws the initial stop to the exit bar, then a short **dashed** step to the final stop at the exit bar, labelled `moved · time?` at Medium/High detail.
- Exit reason `stop`/`trail` with an exit at the final stop is still consistent (the exit fills at the working stop at the exit instant).

**SM-UT-3.** Data notes (`lib/data-notes.ts`), muted: "Your stop moved to 7260.00 at a time you did not record. Add the time to check it against the bars." The line opens the stop-moves editor (`components/StopMovesEditor.tsx`) with the move pre-filled.

**SM-UT-4.** Validation and the API: a write whose `stop_loss_price` differs from `initial_stop_price` with no `stop_moves` is accepted with a warning `stop_moved_without_time` ([07](07-agent-api.md) §4). It is not refused: Chris may not remember the time.

## 3. Timed stop moves

`stop_moves` (`StopMove { price, time }`, issue #36 G2) already exist, and the stepped stop path draws them (TD-3). This section fixes how they are validated and what they feed.

### 3.1 Validation (command layer and form)

| Check | Result |
| :--- | :--- |
| Move time before the entry or after the exit | 422: "A stop move must fall between entry (07:55 CT) and exit (08:30 CT)." |
| Price off the tick grid | 422 (exists today) |
| Last move's price ≠ `stop_loss_price` | 422: "The working stop must equal the last stop move (7260.00)." The form sets `stop_loss_price` from the last move, so a trader never meets this. |
| Two moves at the same minute | Accepted; kept in input order (sort is stable). |
| A move to the risk side of the previous stop | Accepted, flagged `WIDENED` (exists, UX-33). |
| Move time not on a minute | Accepted as given. Display snaps to the bar (guardrail §3b-6). |

### 3.2 What stop moves feed, and what they do not

| Quantity | Uses stop moves? |
| :--- | :--- |
| Risk R, result R ([04](04-r-size.md)) | **No.** Risk is measured on the frozen initial stop (R-10). |
| MAE / MFE | **No.** They are price facts after the entry (§1). |
| Stop-touch findings | Yes, per segment: each stop is checked only while it was the working stop. |
| Chart stop path | Yes: the stepped path, solid for `stated` and `broker`, dashed for `untimed`. |
| "Widest risk" | New, small: when any move widened the stop, Trade Detail shows "Stop widened: largest risk 0.40R" (account R). Pure `widestRisk(trade)`. |
| "Locked" | New, small: when the working stop at exit was on the profit side of entry, show "Stop locked +0.12R" before the exit. Pure `lockedR(trade)`. |
| Exit-reason consistency | Exit reason `stop`/`trail` but the exit is more than 2 ticks from the working stop at the exit time → muted data note "Exit 7255.00 is 5 ticks past the working stop 7260.00 (slippage?)". |

### 3.3 Entering stop moves faster

The current editor (`components/StopMovesEditor.tsx`, 841 lines, grandfathered) is not changed by these packages beyond opening it pre-filled (SM-UT-3). Proposed for later, not packaged: a "moved my stop" chip in the close-trade sheet that asks only for the new price and a time picker that defaults to the bar where the new stop price first became valid. Recorded as an open question in [02](02-ux.md).

## 4. ±5-minute fill-to-bar matching

### 4.1 The problem

`fill_outside_bar` ("The recorded fill at X is outside the HH:MM bar by more than the price tolerance", `lib/data-notes.ts:48`) fires when the stated minute's bar does not contain the fill price within 4 ticks (`fillInsideBar`, `DEFAULT_TICK_TOLERANCE_TICKS`). Voice times are often one or two minutes off. Trade C was logged at 14:14 CT, but 7263 printed only in the 14:13 bar.

### 4.2 The rule

```ts
// lib/fill-match.ts (new, pure; 1m bars)
type FillMatch =
  | { kind: "stated"; barTime: number }                        // the stated minute's bar contains the price
  | { kind: "shifted"; barTime: number; offsetMin: number }    // another bar within ±5 min contains it
  | { kind: "outside"; barTime: number }                       // nothing in the window does
  | { kind: "no-bars" };

function matchFill(bars1m, statedInstant, price, symbol, opts?: { windowMin?: 5; notBefore?: number; notAfter?: number }): FillMatch
```

1. If the stated minute's bar contains the price (**exact range, 0 ticks tolerance**), the result is `stated`.
2. Otherwise look at the bars that open within **±5 minutes** of the stated bar. Pick the one nearest in time whose range contains the price exactly. On a tie, prefer the earlier bar for an entry and the later bar for an exit.
3. Otherwise, if the stated bar contains the price within the existing 4-tick tolerance, the result is `stated` (today's tolerance still applies).
4. Otherwise the result is `outside`, and `fill_outside_bar` fires as today.
5. Order constraints: the entry match must not be after the exit match. `notBefore` and `notAfter` enforce this (an exit is searched from the matched entry bar onward).
6. Missing bars are `OD-28`'s concern, not this one's. When the stated bar does not exist, `alignToBar` (3 bars, 30 minutes) runs first, and matching starts from its result.

### 4.3 What uses the match

- **Chart markers** (`buildMarks`, `lib/trade-marks.ts`) anchor the entry and exit to the matched bar. A `shifted` match is drawn like an `OD-28` nearby snap (visually approximate, #64).
- **`observeTrade`** uses the matched entry bar for R-POST-1 and does not emit `fill_outside_bar` for `shifted`. It emits a new muted finding `fill_time_shifted { stated, matched, offsetMin }`.
- **Data notes:** "Entry drawn on the 14:13 bar; you logged 14:14. **Use 14:13**". The button writes the matched minute to `entry_time` (or `exit_time`) through the normal update path with Undo. Nothing changes without the tap. The stored time is the trader's history, the match is computed (AGENTS §6.5: fact vs history vs hindsight).
- **Agent API:** the trade check endpoint ([07](07-agent-api.md) §3.3) returns the same matches, so an agent can verify times **before** saving (SOP from the field notes).
- **5m and 15m charts** take the 1m match and bucket it. Without 1m bars (older than 30 days), matching runs on the displayed timeframe with a window of one bar each side.

*(Decision D-I: should MAE/MFE and touch checks use the matched entry bar (recommended), or the stated one until the trader taps "Use"?)*

### 4.4 Tests

- Stated bar contains the price → `stated`.
- Price only in the bar one minute earlier → `shifted`, offset −1 (trade C pattern).
- Price in bars at −2 and +2 → the earlier one for an entry, the later one for an exit.
- Price in no bar within ±5 but within 4 ticks of the stated bar → `stated`.
- Price nowhere → `outside`, and `fill_outside_bar` still fires.
- Entry match after the exit's stated bar → constrained search.
- No 1m bars → `no-bars`, falls back to today's behaviour.

## 5. Golden cases from 11/23 (verify first)

The 11/23 records are known to be wrong in places (field notes reliability warning). A worker building a fixture from them must first pull the 1m bars for Mon 2026-11-23 (`MES=F`) and confirm each price and time. Expected, from the field notes:

| Case | Expectation after these packages |
| :--- | :--- |
| A: long 7137 at 07:55 CT, stop 7119.50, entry bar low 7083.75 | no SL touch; MAE from bars after 07:55 only |
| A with the stop moved to 7260 and no time | initial stop checked for the whole hold; dashed step at exit; "time?" note |
| A with `stop_moves: [{7260 @ 08:30 CT}]` | the move is a solid step at 08:30 |
| C: 7263 logged at 14:14, printed at 14:13 | `shifted −1`, marker on 14:13, "Use 14:13" offered |
