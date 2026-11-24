# 03 — Levels and indicators: quieter, behind the candles, tap to read

Source: FIELD-NOTES: *Level price labels: z-order and opacity*, *Right-edge clutter* and its *tap to reveal* continuation (~8:18 PM CT), *VWAP / 200 EMA findings* (~8:20 PM CT), and the 11/23 deep-dive section (labels still over the newest candles, `OD-55`). Related: docs/12 §5 `LV-08`/`LV-09` (style spec), docs/24 §3 and §5 (`LV-2`, `IND-1`), docs/11 §4 (indicator context), `OD-18` (indicator definitions, open), `OD-20`, `OD-22`, `OD-55` (a) right offset and (b) 5m fallback, handoff `2026-11-23-levels-chart-opus.md` §1–2 (pill merge, rank, cap of 8; "withheld" copy).

"Settlements": the voice transcript said "sediments". Read here as settlement-type levels (PDC, 3 PM close, Tue settle). Chris to confirm ([00](00-overview.md) Q-7).

---

## 1. What is on screen today

- `components/SessionLevelsPrimitive.ts` has two pane views: **rays** at `zOrder "bottom"` (behind candles) and **labels** at `zOrder "top"` (over candles). Pills are a surface-colour box at **0.82 alpha** with white text and a role-colour chip.
- After PRs #200–#206: lines within 4 ticks merge into one pill, pills are ranked (trade prices, then planned, then nearest the entry), at most 8 draw, and a dropped pill's rays draw at 0.3 alpha.
- The time scale has `rightOffset: 0` (`components/TradeChart.tsx:331`), so the pill column sits over the newest candles (`OD-55` a).
- The candlestick series hides its own last-value tag (`lastValueVisible: false`). No level casts a tag on the price axis (`LV-09`: axis tags are a toggle, off by default).
- Session VWAP: View → Off / RTH / Globex in `components/TradeDetail.tsx:109` is **local state, Off on every trade**.
- Globex VWAP needs every minute from 18:00 ET (`lib/chart-indicators.ts` → `computeSessionIndicators` → `readSessionWindow` `complete`, `lib/session.ts:128-146`). Yahoo dropped 23 overnight minutes on 11/23 (17:00–17:09, 18:17–18:28 and 22:59 CT, per the field notes), so Globex VWAP showed "unavailable" on all three trades. The trade's candle set also starts about 15 hours before the exit, which is after the Globex open for trades B and C.
- No 200 EMA exists, only the `OD-18` / docs/11 §4 proposal.

## 2. Labels: behind the candles, more solid, fewer

**LB-1 Z-order** (package `LB-A`). The labels view moves to `zOrder "bottom"`, drawn after the rays in the same layer. Candles, wicks and trade marks paint over level labels. Chris asked for this explicitly. It changes `LV-09` ("never over candles" was met by placement; now it is also met by order).

**LB-2 Opacity.** The pill background becomes opaque enough to read: a new token `--level-label-bg-alpha`, default **0.95** (was a hard-coded 0.82 in the primitive, which also breaks Invariant 5's spirit of token-driven alpha). Text keeps `--level-label-text`. Check contrast ≥ 4.5:1 on both themes and on the blue/orange palette.

**LB-3 Right offset (`OD-55` a).** When levels are on and the label mode shows any text (§3, `always` mode, or the Trade Card), reserve empty space right of the last bar for the pill column: `rightOffset` = pill column width ÷ bar spacing, recomputed on resize and zoom. In `tap` mode no column is reserved. `fitWindow` and the held default range (`components/TradeChart.tsx`) must keep the trade in the same place: the offset is added to the right edge only.

**LB-4 Less on the right edge.**
- Rays end at the last bar plus 4 px, not at the pane edge. The right edge stays clear for the axis.
- Zone rectangles lose their right border and fade over their last 24 px.
- Settlement-type levels (PDC, 3 PM close, settle) draw as 1 px **dotted** rays in `--level-neutral` at 0.6 alpha. They cluster most (the 11/23 deep dive saw PDC, 3 PM close and Globex open within one point), and dotted lines stay readable when they overlap.
- The 4-tick merge from PR #200 stays.

## 3. Tap a level to read it

Chris: drop the always-on text labels. The price axis already shows the price; a tap or press shows the name.

**LB-5 Label mode** (packages `LB-B1`, `LB-B2`), a new pref `levelLabels: "tap" | "always"`, default **`tap`**. `always` is today's pill column (with LB-1 to LB-3), for traders who want it.

**LB-6 In `tap` mode:**
- No pills. Rays and zones only.
- **Axis tags, price only**, for at most 3 levels: the merged groups nearest the entry, never a trade price (the trade's own entry, stop and target tags are separate). Implemented as `priceAxisViews` on `SessionLevelsPrimitive`, role-coloured background, `--level-label-text` text. This keeps a little orientation without names. *(Decision D-D: three axis tags, or none at all. Recommended: three.)*
- **Tap target:** a tap whose y is within **10 CSS px** of a ray, or inside a zone rectangle, opens a **level card**. When several rays are in range, the nearest one wins, and its merged group is shown.
- **Level card** (a small DOM popover inside `.chart-frame`, like the OHLC HUD from UI-1; it is UI chrome, not a position box, so Invariant 1 does not apply, and it stays out of `takeScreenshot`):

  ```
  PDC · 3 PM close          7340.75
  Globex open               7341.00
  Prior session · computed
  ```
  Each member: name, exact price (tabular), source (`computed` / `planned: Pre-market`), and coverage when partial ("from 5m bars", "withheld: Yahoo skipped 3 bars" is never shown here, because withheld levels are not drawn).
- **Dismiss:** tap anywhere else, scroll, zoom, or after 6 s. One card at a time.
- **Hit order on tap** (`TradeChart.tsx` `onChartClick`, which today handles neighbour trades): (1) a neighbour trade box (`#40`, MM-W2-06) navigates; (2) a level ray or zone opens the card; (3) anything else closes an open card. Pure `hitLevel(lines, zones, y, priceToY, tolerancePx)` in a new `lib/level-hit-test.ts`, tested like `neighbour-hit-test`.
- **Touch:** single tap only. A long press is the chart's crosshair on touch, and a vertical swipe scrolls the page (UX-41). Taps must not start a pan.
- **Keyboard and screen readers:** the View row's level list (the tooltip from PR #201) becomes a real disclosure list, so every level is reachable without the canvas. Focusing an item highlights its ray.

**LB-7 Exports.** The Trade Card PNG (`takeScreenshot(true)`) cannot show a popover. In exports, draw compact pills for at most 4 groups: the trade's key level and the groups nearest the entry, in the LB-1/LB-2 style with the LB-3 offset. *(Decision D-E: labelled export, or rays only. Recommended: labelled, max 4.)*

**Spec conflicts to record (integrator):** `LV-09` says the label is "a small price tag at the right edge" and "they never shrink". Tap mode removes the always-on label, and the axis tags are on by default where LV-09 says off. Chris stated this preference in the field notes; DECISIONS.md needs an `OD` entry that supersedes those two LV-09 cells, or Chris confirms in D-D.

## 4. Remember the Session VWAP choice

**IN-1.** A new pref `vwapAnchor: "off" | "rth" | "globex"`, default `"off"` (the anchor default stays open under `OD-18`). The View toggle reads and writes it. It syncs with the other prefs (the `prefs` singleton, #191). Drill, review and playbook charts keep VWAP off (they pass no VWAP today).

`lib/prefs-sanitize.ts` gains `vwapAnchor`, `levelLabels` (§3), `ema200` (§6) and `reviewCardOrientation` ([06](06-daily-review-and-review-cards.md) §4) in one package (`IN-1`), so this shared file changes once.

## 5. Globex VWAP with small Yahoo gaps

**VW-1 Data window** (package `IN-2`). VWAP needs bars from the anchor (18:00 ET for Globex, 09:30 ET for RTH) to the right edge of the chart. Today it reads the trade's candle set, which may start too late. Use the day-mode windows the levels loader already fetches (`components/useTradeLevels.ts` → `loadDayCandles`), extending its "today" window from "up to entry" to "up to the session close or now". Levels still cut at the entry (as-of rule), so their values do not change. One cached window serves both, with no extra request in most cases.

**VW-2 Gap tolerance** (package `IN-2`). VWAP is cumulative Σ(price × volume) ÷ Σ volume. A few missing overnight minutes change it very little; overnight minutes Yahoo leaves out are thin. Proposal:

| Anchored window | Draw VWAP when | Show |
| :--- | :--- | :--- |
| RTH (09:30 ET on) | Complete, as today | Normal line |
| Globex (18:00 ET on) | Missing bars ≤ **3%** of expected bars, **and** the longest gap ≤ **15 min**, **and** no missing bar after 09:30 ET | The line, plus "≈" before the HUD value and "Globex VWAP · ≈ 23 min missing overnight" in the View row |
| Either | Beyond those limits | Nothing drawn, "unavailable" with the reason (today's behaviour, with the count) |

The 11/23 Globex session (23 missing of about 1,380 expected, longest gap 12 min) would draw with "≈". Values are computed only from bars that exist. Never fill gaps with synthetic bars (issue #28), and never mix in 5m bars (`OD-55` b is for levels).

`computeSessionIndicators` (`lib/session-indicators.ts`) gains a `gapPolicy` parameter. The default stays `"complete"`, so the API and other callers are unchanged until they opt in. The coverage block reports `missingBars`, `longestGapMin` and `approximate: true`.

*(Decision D-F: accept these thresholds for Globex VWAP. `OD-18` covers the formula; this only covers tolerance.)*

## 6. 200 EMA (package `IN-3`; build waits for `OD-18`)

| Question | Proposal |
| :--- | :--- |
| Input | Closes of the **displayed timeframe** (1m chart → 1m EMA; 5m chart → 5m EMA). This matches what traders mean by "the 200 on the 5". Decision D-G. |
| Seed | Simple mean of the first 200 closes |
| Warm-up | Draw only after 200 + **500** bars (the seed's weight then falls below 0.7%; (199/201)^500 ≈ 0.0067). Total about 700 bars before the first drawn point. |
| Data | 1m: about 700 minutes (12 h). The levels loader's prior session plus today covers it. 5m: about 3,500 minutes (about 2.5 sessions), so two extra day-mode windows, 5m (Yahoo keeps 60 days). Older than 30 days: 1m is gone, so the 1m EMA is unavailable; say so. |
| Gaps | The EMA runs bar to bar over the bars that exist. Coverage reports missing bars. When the warm-up window misses more than 3% of bars, draw it dashed with "≈". |
| Rendering | A line series in a new token `--ind-ema200`, 1 px, below the candles' wicks in visual weight. Value in the crosshair HUD. |
| Toggle | View → **200 EMA** Off/On, remembered (`ema200` pref). Off by default. |
| Server | Pure function in `lib/session-indicators.ts` (or a sibling `lib/ema.ts`) so the agent API ([07](07-agent-api.md) §3.4) returns the same values. |
| Not included | Bands, weekly VWAP, "BE" (`OD-18` says not to invent it) |

## 7. Acceptance (390×844 and desktop)

- No horizontal page overflow; the level card fits inside the chart frame and never covers the OHLC HUD.
- Candles are visibly over labels at every zoom (LB-1).
- In `tap` mode the right 60 px of the pane shows no text except the axis.
- A tap on a ray opens its card; a tap on a neighbour box still navigates; a vertical swipe still scrolls the page.
- The level card and axis tags use tabular numbers.
- Box opacity and gold intensity changes repaint without losing zoom (AGENTS §4).
- The Thursday sim trade (`/trades/sim-trade-20261119-a`) is checked by eye at 390×844 (still owed from the 11/23 deep dive).
- VWAP choice survives navigation between trades and a reload.
- Headless check `scripts/check-session-levels.mjs` updated: in `tap` mode it asserts 0 pills, ≤ 3 axis tags and rays present; in `always` mode, the existing cap of 8.
