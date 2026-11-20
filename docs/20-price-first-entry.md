# 20 — Price-First Trade Entry and Price-Axis Stretch

From the owner's phone review on 2026-11-20 (12:26 AM CT). Two complaints:

1. **Adding a trade is backwards.** The form asked for times first. A trader remembers prices: where they got in, where they got out, the stop and the target. Times should be quick to set, with a calendar or time wheel.
2. **The arrow on the price axis is in the way.** A `›` button sat over the right price scale. The axis is needed for other things, and dragging it up or down should stretch the price scale. It could not.

This doc is the spec for both. It folds in `R-10` (stop at entry, frozen) from [docs/16](16-floor-roadmap.md), because the stop field is part of the new form. `OD-41` in [DECISIONS.md](../DECISIONS.md) records the choices; the owner answered (2) and (5) on 2026-11-20.

> Numbering: `docs/19` and `OD-40` are taken by the trade-screen design guide on branch `docs/19-design-guide`, which is not merged yet.

---

## 1. Rules carried over

- Every price is validated by `validateTradeInput` (`lib/trades.ts`). An off-tick price is an error, never snapped silently. A long's stop is below the entry, a short's above; a long's target is above the entry, a short's below.
- `Still open` (`R-03b`) hides the exit and saves `status: "open"` with null exit fields. No unrealised P&L (`OD-38`).
- Shield (#15) hides size and dollars: the contracts field is hidden and the preview shows points and R only.
- The draft is kept in memory while the app is open (principle 6). A draft kept by an older build is upgraded, not dropped (`upgradeDraft`).
- Storage stays UTC. Typed times are wall-clock in the display zone (Central by default).

## 2. The entry form (`components/AddTradeSheet.tsx`, `lib/entry-form.ts`)

Order on the sheet, top to bottom:

| Part | What it is |
| :--- | :--- |
| Side | `▲ Long` / `▼ Short`. It gets focus when the sheet opens, so no keyboard covers the sheet straight away. |
| Status | `Closed` / `Still open`. Default `Closed`. |
| **Prices** | One row per price: label, `−`, the price, `+`. Rows are **Entry**, **Exit** (hidden while open), **Stop** (optional) and **Target** (optional). `−` and `+` move one tick of the contract (0.25 on MES). On an empty stop, target or exit they start from the entry price. Typing stays the fast path. |
| Preview | `Risk $20.00 · 4.00 pts · Plan +1.4R` once a valid stop is in, and the result (`+$25.00 · +1.3R`) once a valid exit is in. Shield shows points and R only. |
| Symbol, Contracts | As before. |
| **When** | **Date** (native date picker, today by default), **Entry time** and **Exit time** (native time pickers, minute steps), each with a **Now** button. Defaults: entry 30 minutes ago, exit now. `Still open` sets the entry to now unless the trader already set a time. |
| Save | `Save trade and open chart` / `Save open trade and open chart`. |

**Times.** One date covers both fills. An exit time earlier than the entry time is read as the **next calendar day** (an overnight futures hold), and the form says "Next day, Fri, Nov 21" under the exit time. Equal times stay on the same day, so "The exit must be after the entry" still catches a slip.

**Errors.** A price error (off tick, stop on the wrong side) shows as soon as that price is typed. Missing fields show on Save, as before.

**Native pickers** were chosen over a custom wheel: iOS and Android already give a wheel or a calendar for `type="date"` and `type="time"`, they cost nothing, and they respect the phone's accessibility settings. **Owner, 2026-11-20: native pickers are fine** (`OD-41` (2)).

### 2.2 Times from the bars (`lib/infer-times.ts`, `lib/infer-message.ts`)

The owner asked for this now (`OD-41` (5), 2026-11-20): "a general logic that tries to determine what I mean by the entry by searching through the bars… kind of like a little loading thing."

**When it runs.** About 0.6 s after the entry price is valid and the date has started, and again whenever the side, a price or the date changes. While it waits and loads, a quiet line under the preview says **Finding your fill in the bars…** with a small spinner.

**Where the bars come from.** `/api/market-data` has a day mode (`from`/`to`, at most 26 h) for the picked date, midnight to midnight in the display zone, finest timeframe first (1m, then 5m, then 1h). `loadDayCandles` in `lib/candles.ts` caches each window in IndexedDB and follows the `R-02` rule: a window that ended over an hour ago is final; a fresher one is asked again after a minute. On a network error it uses a stale cache if it has one.

**How it guesses** (`inferTradeTimes`):
1. **Entry candidates** are stretches of consecutive bars whose low–high range contains the entry price. A stretch counts once, at its first bar (or at the bar nearest the trader's typed time when that time is inside it).
2. A candidate is **consistent** when the exit price trades in a later bar and the stop does not trade strictly before that exit bar.
3. **Pick:** consistent first, then nearest the trader's own time (only a time they set by hand counts as a hint; the form's default does not), then the first in regular hours (09:30–16:00 ET), then the earliest.
4. **Exit bar:** the first bar after the entry bar that trades the exit price.
5. **Flags:** the stop or target traded after the entry and before the exit ("Your stop traded at 09:50, before this exit"); the exit price never traded after the entry; the exit price also traded in the entry bar (the exit may be in that bar).
6. **Confidence:** `exact` for one candidate with its exit found, `ambiguous` for more than one candidate or a missing exit, `none` for no touch. Times are bar open times. Bars coarser than 1m are marked approximate, as with nearby alignment (`OD-28`).

**What the trader sees.**

| Result | Line |
| :--- | :--- |
| One match | `Matched 09:42 entry, 10:05 exit CST from 1m bars.` |
| Several | `Entry price traded 3 times. Picked 09:42 CST (first in regular hours), from 1m bars. Tap to change. Exit 10:05.` Tapping opens the entry time picker. |
| No touch | `6850.00 did not trade in any 1m bar on Nov 19. Set the times yourself.` |
| No bars / offline | `No bars for Nov 19 yet…` or `Offline, so the bars cannot be searched…`, with **Retry**. |

**Never overwrites the trader.** The suggestion fills the entry and exit pickers only while the trader has not set that time by hand. Once they have, a **Use 09:42–10:05** button offers the bars' times instead; nothing changes until it is tapped. The native pickers always work. Shield is unaffected: the line has prices and times, never size or dollars.

### Stop at entry, frozen (`R-10`)

Built here as specified in [docs/16 R-10](16-floor-roadmap.md#r-10--stop-at-entry-frozen):

- `TradeRecord` has `initial_stop_price` and `initial_stop_set_at`. `normalizeTrade` sets both to `null` on older records and clears a half-written pair.
- A stop typed on the form is saved as `stop_loss_price` **and** `initial_stop_price`, stamped with the save time (`entryLevelFields`).
- A trade saved without a stop: the first stop set on Trade Detail, from the level editor or a risk chip, is captured as the initial stop (`stopEditPatch`). Later edits move `stop_loss_price` only. Undo moves the stop back and leaves the initial stop alone.
- `initialRMultiple(trade)` sits beside `rMultiple`. No screen switches to it in this change.
- Trade Detail shows "Initial stop 6841.25, set 09:42" as a quiet line when the current stop differs.
- A backup restore never overwrites an initial stop the device already holds for the same trade (`keepInitialStop` in `replaceTrades`).

## 3. The chart (`components/TradeChart.tsx`, `components/TradeDetail.tsx`, `lib/price-scale.ts`)

**The arrows move off the chart.** The floating `‹` and `›` edge buttons over the chart (the right one sat on the price axis) are gone. The same action, "show 30 more bars on that side", is now a small `‹30` `30›` pair in the chart toolbar between the timeframes and `View`. It is also still in the `View` menu and on the `[` and `]` keys. These buttons never stepped between trades; trade-to-trade stays on the header swipe and the `‹ Prev` / `Next ›` pager (UX-40).

**Drag the price axis to stretch it.**

| Gesture on the price axis | Result |
| :--- | :--- |
| Drag up | Stretch: less price on screen, taller candles. |
| Drag down | Compress: more price on screen. |
| Double-tap / double-click | Back to auto-fit. `Fit trade` also resets it. |
| Mouse wheel | Stretch or compress in small steps. |

- The centre price stays put while stretching. The span is clamped between 8 ticks and 4000 ticks (`stretchPriceRange`).
- How it works: on touch, the chart library treats a vertical drag on its price axis as page scroll while `vertTouchDrag` is off, and it must stay off (UX-41). So a transparent strip covers **only the price axis** with `touch-action: none` and drives the scale through the library's `priceScale().setVisibleRange()` for touch, pen and mouse. The strip is sized from `priceScale().width()` and stops above the time axis. It draws nothing, so the position box is still a canvas primitive (invariant 1) and screenshots are unchanged.
- Unchanged: a vertical swipe on the chart body scrolls the page (UX-41), a horizontal drag pans, a pinch zooms the chart (UX-44, `R-01`). The time axis keeps the library's own drag.
- The trade card (#87) rebuilds from the stretched view once the drag stops.
- **Trade-off:** a vertical swipe that starts on the price axis (the right ~60 px of the chart) no longer scrolls the page. See `OD-41` (4).

## 4. Checked

- Unit tests: `lib/__tests__/price-first-entry.test.ts` (draft defaults, overnight exit, DST, draft upgrade, tick steppers, stop-side rule, all `R-10` cases) and `lib/__tests__/price-scale.test.ts`.
- Headless Chrome at 390×844 with touch emulation: no horizontal overflow on the sheet or the trade screen; every sheet control ≥ 44 px; a typed long stop above the entry shows the error at once; a saved trade stores the stop, the initial stop and its time. On the chart: an emulated finger drag on the axis stretched the scale and did not scroll the page; double-tap reset it; a vertical swipe on the chart body scrolled the page; a horizontal drag panned the chart. Mouse drag, double-click and wheel on the axis at 1280×900 worked.
- Bar finder, headless Chrome at 390×844 against live Yahoo 1m bars for 2026-11-19: a short at 7439.75 / 7430 matched "05:55 entry, 06:00 exit" and filled both pickers; a long at 7150.25 / 7155 said "traded 3 times, picked 23:15 (the first)"; a hand-set 10:00 entry was kept and a Use button offered; 9000 said no bar traded it; offline showed the offline line and Retry. Screenshots: `finder-*.png` in the handoff.
- **Not verified on a phone.** Real iOS and Android touch, the native pickers' look, and the right-edge scroll trade-off need the owner's phone.
