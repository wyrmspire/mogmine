# 15 — Trade Document & Render Grammar

How a logged trade is stored as events, turned into facts, and drawn on the chart, the Trade Card and the AI review. It is the target for the Position Box. What is built today is in [02 §2](02-charting-position-boxes-and-divergence.md#2-opaque--translucent-position-boxes-specification).

IDs are section numbers. Open choices are `OD-30`–`OD-34` in [DECISIONS.md](../DECISIONS.md). This doc builds on:

- [02 §2](02-charting-position-boxes-and-divergence.md#2-opaque--translucent-position-boxes-specification) and [02 §3](02-charting-position-boxes-and-divergence.md#3-duration-derived-chart-window), for the box as built and the fitted window.
- [09 §1 and §8](09-backend-risk-register.md), for the fill ledger (B-04, B-05), `order_events` (B-07) and the proposed tables.
- [12 §9](12-levels-zones-and-daily-markup.md#9-position-boxes-sizing-and-the-three-styles) and `OD-23`, for the planned, actual and archived styles.
- [08 §2 and UX-67, UX-80](08-ux-notes-viewing-and-journaling.md), for colour-blind safety and the wording of facts.

**Status: proposal.** Nothing in this doc is built. The owner decisions in §1 are settled. The schema and the placement of `plan` are not (§4).

**Source.** The design note on the owner's box, `/workspace/fable-q/trades-on-chart-design-and-plan.md`. The issue that commits this doc (#32) cites it as `position-box-answer.md`, the name the note had before it was renamed. This doc copies its §2 (render grammar) and §5 (trade document) and applies the owner decisions in §1. It summarises the hindsight part of §3 (§2.5 here). The rest of §3, §4, §6 and §7 stay in the note. Once this doc is merged, it is the spec for the render grammar and the document, and the note is history.

---

## 1. Owner decisions (2026-11-15)

These override the open questions at the end of the design note.

1. **Plan zones.** Faint red fill (stop) and faint green fill (target) only. No outline and no purple. Plan fills stay clearly weaker than the actual band. Solid green or red fill appears only in the actual band, which is also unframed. MFE and MAE are a bracket, never a rectangle. (`PLAN` / `TP` / `SL` text, if shown, is typography, not a coloured frame.)
2. **Hindsight.** A dotted continuation of entry, last stop and targets is **on by default at Medium detail**. Entry is faint gray; stop and target use the same faint red and green as the plan zones. No end labels and no "after exit" text on the chart. Later-touch marks are a small hollow dot; the `TP +38m` / `SL +12m` text and the held-to-plan sentence live in the hindsight block, one tap away.
3. **Scratch.** A trade is a scratch when its result is within **0.1R or 2 ticks of entry, whichever is larger**. For `MES` (0.25 point tick, $5 a point) the two-tick floor is 0.50 point.
4. **Not-taken plans are in v1.** Where they live in the app, Today or a Plans list, is open (`OD-31`, issue #39).

---

## 2. Render grammar

### 2.1 Layers

```text
 PLAN (faint red and green        ACTUAL (stronger               EXCURSION (bracket)
       fills, no outline)             green / red / gray fill,
                                      no frame)
 ┌               ┐ TP 2.0R
 ╎               ╎                                               ┬ MFE ≈ +1.4R
 ╎  faint green  ╎            ┌────────────┐ exit ▽ MKT           │
 ╎  reward zone  ╎            │ solid green│                     │
 ├───────────────┤ entry ▲────┴────────────┘ ─ ─ ─ ─ ─ ─          ┼ entry
 ╎  faint red    ╎                                               │
 ╎  risk zone    ╎                                               ┴ MAE ≈ −0.3R
 └               ┘ SL −1R
```

They are drawn on top of each other in that order. The sketch separates them only to show which is which.

| Layer | Meaning | Look | Source of truth |
| :--- | :--- | :--- | :--- |
| **PLAN** | Where the stop and target orders were when the trade began | No outline and no purple. Fill: faint red over entry→stop, faint green over entry→target, at box opacity × 0.28. Optional typography: right-edge `TP 2.0R` / `SL`, and a `PLAN` tag. | Plan and order events |
| **ACTUAL** | What the fills did | No frame. Fill from entry fill price to exit fill price, entry bar to exit bar: green if money was made, red if lost, gray for a scratch, at full box opacity. | Fill events |
| **EXCURSION** | How far price went for and against the position while it was open | A vertical 1 px bracket in the gap right of the exit bar: a cap at MFE, a cap at MAE, joined through the entry price. Labels `MFE ≈ +11.50` and `MAE ≈ −55.25`. Neutral text colour. No fill. | Bars between entry and exit |

Rules that follow:

- **Solid green or red fill exists only inside ACTUAL, and only when the result is that colour.** A trade stopped for −1R has a red actual band and a faint red plan risk zone, with no outline. Green fill is never used to mean a planned target.
- **Plan fills are weaker than the actual band.** The faint plan fill is 0.28 of the box opacity today (`PLAN_FILL_RATIO` in `components/PositionBoxPrimitive.ts`). The actual fill is at full opacity.
- **The plan's reward zone is drawn at the planned size**, even when it is small or price never went near it. Planned R:R is the ratio of the two plan zones, so a bad plan looks like a bad plan.
- **Excursion is never a rectangle.** A bracket cannot be mistaken for a target zone.
- **Each mark states how we know it.** `basis` (see §3.1) decides whether a mark is solid or dotted with `≈`. The renderer never upgrades an inferred mark.

### 2.2 Stop moves and trails

The stop is a **stepped line**, not a box edge. It is 1.5 px, dashed, in the muted / risk colour (never purple), and it moves horizontally in time and jumps vertically at each modification:

```text
 entry ▲──────────────────────────────▽ TRAIL
 SL ╌╌╌╌╌╌╌╌╌┐
             └╌╌╌╌╌ BE ╌╌╌╌╌┐
                            └╌╌╌╌╌╌╌╌╌ +1R   (stop above entry: locked-in profit)
```

- The plan's risk zone keeps its **original** size. The stepped line shows where the stop really was at each moment. R is always measured against the original stop (`OD-10`).
- Where the stop sits at or beyond the entry, the strip between entry and stop gets a faint hatch in the result colour: profit that was locked.
- A dot marks each move. At High detail the dot carries the time and the new price.
- A stop moved **away** from the entry (risk widened) is drawn in the risk colour from that step on and labelled `WIDENED`. That is the "Moved Stop" tag in the journal, detected instead of typed.

### 2.3 The cases

Dollar figures use the examples in §3.5: 2 contracts, 5-point stop, $5 a point, no fees. The design note's first draft used five contracts, so its dollar figures were off by a factor of 2.5. These are the corrected ones.

| Case | PLAN | ACTUAL | Exit flag | Pill |
| :--- | :--- | :--- | :--- | :--- |
| **TP hit** | Faint red and green plan fills, no outline, `TP 2.0R`, `SL` | Solid green band, entry → target price. Its far edge lies on the plan's TP edge. | `▽ TP` | `+2.0R · +$100.00` |
| **SL hit** | Same | Solid red band, entry → stop price. Its far edge lies on the plan's SL edge. | `▽ SL` | `−1.0R · −$50.00` |
| **Early exit, in profit** | Same | Solid green band, entry → exit. It stops short of the TP edge, and the untouched part of the reward zone stays faint green. | `▽ MKT` | `+0.8R`, plus `of 2.0R planned` at Medium detail |
| **Scratch at breakeven** | Same | A thin **gray** line at the entry price, no band (the result is inside the scratch threshold, §1). | `▽ BE` | `BE · −$2.50` (fees are real money) |
| **Trailed stop** | Original zones | Band entry → exit, coloured by result. Stepped stop line ends at the exit. | `▽ TRAIL` | `+1.2R` |
| **Stop ignored** | Original zones | Solid red band, entry → exit, running **past** the SL edge. The part beyond the stop is hatched red and labelled `PAST STOP −0.6R`. | `▽ MKT` | `−1.6R` |
| **Plan never filled** | Dotted faint plan fills, no outline, tag `PLAN · not filled`. Spans order placed → cancelled. | None. No entry flag. | — | none |
| **Plan cancelled before any fill** | Same, tag `PLAN · cancelled` | None | — | none |
| **Two targets** | Reward zone with inner line `T1 1.0R · 1 of 2` and outer edge `T2 2.5R · 1 of 2` | Band to T1 for the first lot, then band continuing to T2 at half the fill's thickness for the runner. The path steps at each exit. | `▽ T1`, `▽ T2` | `+1.75R avg` |
| **No plan on record** (fills-only import) | Nothing drawn. One line under the chart: "No stop or target on record", with **Add plan**. | Band entry → exit | `▽` with no reason | `+$100.00`, `—R` |

"Stop ignored" needs care. Three different things look the same on bars: the stop was cancelled, the stop was moved, or the candle data disagrees with the fill. With order events we know which. Without them (manual entry) we only know that price traded through the stated stop while the position stayed open. The mark is then dotted, says `≈`, and reads "Price traded through your stated stop at 10:31": a fact, not an accusation (UX-67).

The "no plan" row is a deliberate choice. The chart never invents a target or a stop.

Wording for the not-filled and cancelled rows assumes the faint zones stay on the plan even when no trade happened. That is my reading of the owner's first decision, not something the owner has said. See `OD-33`.

### 2.4 Partials and scale-ins

- The ACTUAL band is built per lot. Each exit fill closes a slice. Fill opacity scales with the share of the position still open, so a runner looks lighter than the full position.
- The execution path is a **polyline through the fills** in time order. A single diagonal from entry to exit crosses the box and reads as a trend line, so it goes.
- Average entry and average exit are text in the fills table, not extra lines.
- Scale-ins: one entry flag per fill. Several fills in one bar collapse to one flag with a count (UX-23). The entry line steps to the new average price.
- The entry flag sits at the fill price on the entry bar, pointing the way the trade goes (▲ long, ▼ short), in the muted text colour. The exit flag is a hollow triangle at the exit fill price, pointing against the trade, with the reason as text: `TP`, `SL`, `TRAIL`, `BE`, `MKT`. Text, not colour, carries the meaning (UX-80).
- Flags are placed by price, not by the candle. The `createSeriesMarkers` arrows above and below bars go away.

### 2.5 Hindsight: after the trade

Owner decision 2 in §1 sets the default. Detail:

- **Dotted continuation.** Entry (faint gray), last stop (faint red) and each target (faint green) extend from the exit to the right edge of the current view as 1 px dotted lines. No end labels, no "after exit" text, and no purple or teal. No fill. **No price-axis tags.** Later-touch marks are a small hollow dot only; `TP +38m` / `SL +12m` text lives in the hindsight block.
- **Default.** On at Medium detail. Low and High are not decided: this doc keeps them off until `OD-32` is answered.
- **Which stop.** The stop in force when the trade ended. If it was moved, the original stop also runs as a fainter dotted line. Any `SL (initial)` wording lives off the chart, in the hindsight block.
- **Widening the view.** The `‹30` and `30›` buttons in the chart toolbar (and the View menu, and keys `[` and `]`; never floating over the price axis, [docs/20](20-price-first-entry.md) §3) add 30 bars of the current timeframe on that side, and `Fit` restores the trade's own window. The dotted continuation grows with the view.
- **The sentence.** The held-to-plan sentence ("Hindsight: the target would have been reached first, 38 min later", or the stop-first / neither equivalents), plus any `TP +38m` / `SL +12m` labels, is one tap away under an "After the exit — hindsight" heading. It is not drawn on the chart.
- **Hindsight is not result.** It never changes R, outcome or any statistic (B-63, UX-52). A shared Trade Card shows the extension only if it was on when the card was made, and does not add on-chart hindsight text.
- **Backward is context, not hindsight.** Earlier levels are drawn the same way but computed nothing. Daily levels from [12](12-levels-zones-and-daily-markup.md) are the other lines in that view when they exist.
- **Not scheduled.** Dragging the dotted stop or target to see the R values (the design's §3.1b) is an idea. Dragging needs hit-testing the chart library does not provide out of the box.

### 2.6 Archived: the trade on later screens

A trade stays visible when it falls inside the visible range of another chart (the next trade that day, a 15m view, a day view). It is drawn in the archived style (LV-18, `OD-23`):

- Only the ACTUAL band's outline, 1 px **dotted**, neutral gray.
- Fill at 0.10 opacity or less, green or red by result.
- No plan, no whiskers, no labels, **no price-axis tags**.
- Tap to open that trade.

---

## 3. The trade document (`mogmine.trade.v1`)

### 3.1 Principles

1. **Events are the truth. Everything else is derived.** Entry price, exit price, R, outcome and MFE are computed by one pure function from the events and bars. This is the ledger-first design in [09](09-backend-risk-register.md) (B-04, B-05, B-30), extended from fills to orders (B-07).
2. **UTC in, display zone out.** Every `t` is UTC ISO-8601. Central Time appears only in the interface ([lib/time.ts](../lib/time.ts)).
3. **Prices as written, maths in ticks.** The document holds prices. The deriver converts them to integer ticks (B-31).
4. **Every event says how we know it.** `basis` is one of: `broker` (reported by the platform), `stated` (typed by the trader), `inferred` (deduced by code from bars). The renderer draws `inferred` dotted with `≈` and never upgrades it.
5. **The document never contains pixels, colours or layout.** The renderer decides those ([11 §5](11-product-workflows-and-api-context.md)).
6. **Append-only.** A correction is a new event or a new revision, never an edit in place, so a shared card cannot change under someone.

### 3.2 Schema

```jsonc
{
  "schema": "mogmine.trade.v1",
  "id": "uuid",
  "user_id": "uuid",                      // Invariant 7
  "revision": 1,
  "instrument": { "symbol": "MES", "contract": null },   // contract id when a broker gives one (B-12)
  "side": "long",                          // long | short
  "source": { "kind": "manual", "provider": null, "imported_at": null },   // manual | csv | broker
  "is_sample": false,
  "events": [ /* ordered by seq */ ]
}
```

Event types. `seq` orders events that share a timestamp.

| `type` | Fields | Meaning |
| :--- | :--- | :--- |
| `plan` | `entry {order, price}`, `stop`, `targets [{key, price, qty}]`, `qty` | The intended trade at decision time. Zero or one per revision of the plan. |
| `order` | `order`, `role` (`entry` / `stop` / `target`), `kind` (`market` / `limit` / `stop` / `trail`), `qty`, `price`, `target?`, `opening_entry_seq?` | An order went working. |
| `modify` | `order`, `price?`, `qty?` | A working order changed: a stop move or a trail step. |
| `cancel` | `order`, `reason?` | A working order was pulled. |
| `fill` | `order?`, `role` (`entry` / `exit`), `qty`, `price`, `reason?`, `fees?` | An execution. On an exit, `reason` is `target`, `stop`, `trail`, `manual` or `unknown`. |
| `note` | `text`, `anchor?` | A comment, optionally pinned to a time or an event. |
| `void` | `ref` (a `seq`) | The broker cancelled an earlier fill (B-04). |

Every event also has `seq`, `t` (UTC) and `basis`.

**Reserved names in manual documents.** A manual document has no order ids. The names `entry` (the entry order) and `stop` (the stop in force) refer to the orders in the plan. The examples use both.

### 3.3 What is derived (never stored as truth)

`deriveTrade(doc, spec)`: pure, no I/O, no candles.

- `status`: `planned`, `working`, `open`, `closed`, `not_taken`.
- Position over time, average entry and exit, maximum size.
- Result in ticks, points and dollars. Fees. R against the **first stop in force at the first entry fill** (or an attached opening bracket stop). Gross or net R is open (`OD-10`); the examples have no fees, so the question does not arise in them.
  - A stop reported after the first entry fill can supply initial risk when its order explicitly references that fill with `opening_entry_seq` (issue #33, `OD-43`). An unlinked later stop contributes to the stop path from placement and leaves initial risk and R null when no stop was in force at entry (B-32).
- `stop_path`: `[{from, to, price}]` segments built from `order` and `modify` events.
- `outcome`: `target` · `stop` · `trail` · `scratch` · `manual` · `partial_targets` · `not_taken`. From exit reasons, and from price equality with the plan when a reason is missing (then `basis: inferred`).
- Planned R:R per target.

`observeTrade(derived, candles, barMinutes)`: pure, needs candles. This is `lib/trade-bar-validation.ts` grown up.

- MFE and MAE, with the entry and exit bars handled honestly.
- `stop_traded_through`: for each stop segment, the first completed bar that trades through that segment's price while the position is open.
- `target_traded_through`: the same for each unfilled target.
- `fill_outside_bar`: any fill price outside its bar's range plus a tick tolerance (B-12).
- After-exit facts: the first later touch of the last stop and of each target (hindsight, §2.5).

Structural checks need no candles: position never goes negative, a closed trade ends flat, exits do not precede entries, the stop is on the losing side at placement, and target quantities do not exceed the position.

Each finding keeps the shape the current validator uses (`code`, `barTime`, `price`), plus `basis` and `segment`.

### 3.4 From document to pixels: a display list

```text
events ──deriveTrade──▶ derived ──observeTrade(+candles)──▶ facts
                          │                                   │
                          └────────── buildMarks(timeframe, detail, shield) ──▶ Mark[]
                                                                                 │
                                                       PositionBoxPrimitive.draw(Mark[])
```

`Mark` is a small closed set, in price and time, not pixels:

```ts
type Mark =
  | { kind: "zone"; layer: "plan" | "actual" | "archived"; t0; t1; p0; p1; tone; style }
  | { kind: "segment"; layer; t0; t1; p0; p1; dash; tone }          // entry line, stop path, continuation
  | { kind: "flag"; t; price; shape; text; basis }                   // entry, exits, stop moves
  | { kind: "bracket"; t; pLow; pMid; pHigh; labels; basis }         // excursion
  | { kind: "label"; anchor; text; priority }                        // TP 2.0R, PAST STOP, pill
  | { kind: "hatch"; t0; t1; p0; p1; tone };                         // locked profit, past stop
```

Why this shape:

- **Deterministic and testable without a canvas.** A golden test says "this document on these bars yields exactly these marks". That is the test for every case in §2.3.
- **One painter.** `PositionBoxPrimitive` stops knowing what a trade is. It converts each mark's time and price to coordinates and paints by `kind`. Times are snapped to bars in `buildMarks` (B-23).
- **One source for every surface.** The chart, the Trade Card, the AI snapshot and the archived view all call `buildMarks` with different `detail` and `shield` arguments. Shield cannot be forgotten on one of them.
- **The same facts feed the AI as text** ([04](04-ai-review-engine.md), B-62). The model is told "exit reason: trail, stop moved 2 times, never widened". It does not read that off an image.

### 3.5 Example documents

Seven example documents are committed under [`fixtures/trades/`](../fixtures/trades/). They share the header `"schema": "mogmine.trade.v1"`, `"instrument": {"symbol": "MES", "contract": null}`, `"side": "long"`, `"is_sample": true`, and a placeholder `user_id` of all zeros. They contain no real account id, name or balance. Times are UTC: 15:30Z is 09:30 CT. Entry 7600.00, stop 7595.00 (5 points, $25 a contract), target 7610.00 (2R), two contracts, unless stated.

| File | Case | Source | Derived result | Marks |
| :--- | :--- | :--- | :--- | :--- |
| `ex-tp.json` | TP hit | broker | `outcome: target`, +2.0R, +$100.00 | Dotted working-order line 15:31–15:34, plan zones, solid green band to the TP edge, `▽ TP` |
| `ex-sl.json` | SL hit | manual | `outcome: stop`, −1.0R, −$50.00 | Plan zones, solid red band to the SL edge, `▽ SL`. No green anywhere. |
| `ex-be.json` | Breakeven scratch | manual | `outcome: scratch`, +0.0R | Plan zones, stop path stepping up to entry at 15:44, gray line in place of a band, `▽ BE` |
| `ex-trail.json` | Trailed stop | broker | `outcome: trail`, +1.2R (risk from the first stop, 5 points) | Stepped stop line, faint hatch from 15:47, solid green band to 7606, `▽ TRAIL`. Risk zone only, no reward zone: the chart does not invent a target. |
| `ex-ignored.json` | Stop ignored | broker | `outcome: manual`, −1.6R; fact `stop_removed_while_open` at 15:39:20 | Stop line ends at 15:39 with a `✕`, solid red band to 7592, the 7595→7592 part hatched `PAST STOP −0.6R`. In the manual version (no `cancel`) the observer reports `stop_traded_through` with `basis: inferred`, and the hatch is dotted with `≈`. |
| `ex-nottaken.json` | Planned, not taken | manual | `status: not_taken`. No result, no R, excluded from every statistic. | Dotted faint plan fills from 15:31 to 16:10, tag `PLAN · not filled`. The observer adds hindsight: whether price reached the entry and what the plan would have done. |
| `ex-partials.json` | Two partial targets | manual | `outcome: partial_targets`; initial risk 2 × 5 pts × $5 = $50; result (5 + 12.5) × $5 = $87.50 = +1.75R | Reward zone with inner `T1 1.0R · 1 of 2` and outer `T2 2.5R · 1 of 2`, band to T1 then T2 at half, stop stepping to entry at 15:42, flags `▽ T1` and `▽ T2` |

`ex-tp`, `ex-sl` and `ex-trail` also carry a `note` event (a voice memo transcript) and a `mood_records` array. Those records are derived, versioned Mood Shape scores, not events: they can be rebuilt from the note text ([18 §3](18-mood-shape.md#3-records-derived-and-versioned)). They sit in the fixture only until `OD-30` decides where derived rows live.

The results were checked by hand against the examples: for example, ex-ignored is (7592 − 7600) × 2 × $5 = −$80 against $50 of risk, so −1.6R, and the part beyond the stop is (7595 − 7592) × 2 × $5 = $30, or 0.6R.

### 3.6 How each source maps in

| Source | What it has | What the document gets | What the chart can show |
| :--- | :--- | :--- | :--- |
| **Manual entry (now)** | What the trader types | `plan` (stated), entry and exit `fill` (stated), optional `modify` rows for stop moves, exit `reason` from one tap | Everything in §2, with `stated` basis. Stop-through is `inferred`. |
| **Current stored trades** | Flat fields: entry, exit, stop, target | A converter builds `plan` from `stop_loss_price` and `planned_target_price`, and two `fill` events. Exit reason is inferred only when the exit price **equals** the stop or target. | Plan, actual, excursion. No stop path. |
| **CSV (parked, `D-009`)** | Usually fills only | `fill` events (broker basis) | Actual only, plus "No stop or target on record → Add plan" |
| **Broker pull, `Trade/search` (parked)** | Legs, no orders (B-07) | `fill` events per leg, `void` for voided legs | Same as CSV |
| **Broker stream, `GatewayUserOrder` and `GatewayUserTrade` (parked)** | Orders with stop and limit prices, type, status, update time, and legs | `order`, `modify`, `cancel`, `fill` | Everything, with `broker` basis: real stop path, real cancels, real exit reasons |

Manual entry needs two small additions to the form: **"How did it end?"** (`Target · Stop · Trailed · Breakeven · Market`, one tap) and **"I moved my stop"** (add a row: new price, time). Both are optional. A trade entered with neither still renders, as plan and actual with an unlabelled exit.

Where it is stored is open (§4, `OD-30` and `OD-31`). The database names in [09 §8](09-backend-risk-register.md) are candidates only.

---

## 4. Open decisions

Agents propose and the owner decides. Each item is also in [DECISIONS.md](../DECISIONS.md).

| ID | Question | Options and recommendation | Interim rule |
| :--- | :--- | :--- | :--- |
| **OD-30** | Is `mogmine.trade.v1` the stored record, or the shape assembled on read? | (a) One JSON document per trade, rewritten on change. Simple, but breaks append-only. (b) Append-only event rows keyed by trade and `seq`, with the document assembled on read. Matches §3.1 principle 6 and the ledger in [09 §8](09-backend-risk-register.md). **Recommend (b).** | Build only the pure functions and the fixtures. No table names, no migration, until decided. |
| **OD-31** | Where does `plan` live? Options: a `plan` event in the same log; a revisioned plan record like the daily plan revision ([12 §8](12-levels-zones-and-daily-markup.md#8-the-daily-plan-and-news), [11 §1](11-product-workflows-and-api-context.md#1-the-daily-loop-beyond-the-chart), `OD-19`); or both. Where not-taken plans appear (Today or a Plans list) is issue #39. | Recommend a `plan` event on the trade (the trade's intent at decision time), linked to the daily plan revision when there is one. Owner decides. | Keep `plan` as an event in the fixtures. Do not add a table. |
| **OD-32** | Hindsight at Low and High detail, and how far the continuation runs. Owner set Medium on by default (§1). My reading, to confirm: the continuation is drawn to the view's right edge, so the buttons set how far it reaches. | Keep Low and High off until the owner decides. | Medium only. |
| **OD-33** | §1 restates the as-built fills-only look (no purple, no outlines) and supersedes the purple-outline wording in the issue #32 draft and in `OD-23`. `docs/12 §9` should follow. The wording for plan zones on not-taken and cancelled plans (§2.3) is still a reading. | Restate `OD-23` and docs/12 §9 to match §1. | Use §1 as written: no purple, fills only. |
| **OD-34** | [CONTRIBUTING §5](../CONTRIBUTING.md#5-fixtures-nobody-needs-a-broker-account-to-contribute) lists seven realistic `MES` scenarios (clean winner, stop-out, multi-fill scale-out, reversal, 40-second scalp, 09:30 open, roll week). The committed set is the seven in §3.5. Are the CONTRIBUTING scenarios added later, or replaced? | Keep the §3.5 set for now and add the others when `deriveTrade` exists. | Do not invent a second list. |

---

## 5. Built today and the target

| Element | On `main` today | Target (this doc) |
| :--- | :--- | :--- |
| Plan zones | Faint red and green fills, no outline, no `PLAN` tag, no `TP` / `SL` labels | §2.1: the same fills and no outline; optional typography only |
| Actual band | Stronger fill in result colour, no frame | §2.1: the same, still no frame |
| Path | One dotted diagonal, entry fill to exit fill | §2.4: polyline through the fills |
| Stop path | None | §2.2 |
| Excursion | None | §2.1 bracket |
| Hindsight | None | §2.5 |
| Archived style | None | §2.6 |
| Flags | Entry and exit flags at fill prices | §2.4 (adds the reason text) |
| `deriveTrade`, `fromLegacy` | Built (`lib/trade-document.ts`, issue #33) | §3.2, §3.3, §3.6 |
| `observeTrade`, `buildMarks` | Not built | Issues #34 and #35 |
| Fixtures | `fixtures/sample-bars.json`, `fixtures/levelsets/` | `fixtures/trades/`, §3.5 |

Nothing on the target list is drawn on a phone yet. Each element needs the §4 mobile checks in [AGENTS.md](../AGENTS.md) when it lands.
