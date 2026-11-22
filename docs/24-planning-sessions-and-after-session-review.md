# 24 — Planning Sessions, Levels on the Chart & After-Session Review

The owner's direction of 2026-11-22 (`D-011`), and the slices that get the app there. It builds on [11 §1](11-product-workflows-and-api-context.md#1-the-daily-loop-beyond-the-chart) (daily loop), [12](12-levels-zones-and-daily-markup.md) (levels, zones, formulas) and [22](22-development-mode-and-backend-boundary.md) (local-first, no Supabase needed).

> [!NOTE]
> **Scope.** The goal (`D-011`) is decided. The data shape in §2 is a proposal under `OD-51`. Build it local-first, like playbooks and challenges, until a feature needs cross-device storage.

---

## 1. What the owner asked for

The app should be ready for a full trading day:

1. **Log trades at the end of the day.** This works today with the prices-first form ([20](20-price-first-entry.md)).
2. **Plan before any part of the session, not only the open.** The owner plans "pre-anything": pre-Globex, pre-market (pre-New York), pre-MOC, pre-power hour, pre-gap fill. In each one they note levels and write observations.
3. **See indicators and levels on the chart.** These are the computed levels from [12 §3A](12-levels-zones-and-daily-markup.md#a-computed-by-code), plus the levels the owner writes in a planning session.
4. **Review after the session.** Go back over the session and check whether the trades followed the setups.

[11 §1](11-product-workflows-and-api-context.md#1-the-daily-loop-beyond-the-chart) and [12 §8](12-levels-zones-and-daily-markup.md#8-the-daily-plan-and-news) plan for **one** plan per day. The owner described **several** short planning sessions in one day. §2 resolves that.

## 2. A planning session is a "pre-X" checkpoint (proposal, `OD-51`)

A day's plan is the ordered list of its planning sessions. Each one is small and quick to fill in on a phone.

| Preset | Before (CT) | Notes |
| :--- | :--- | :--- |
| Pre-Globex | 17:00 | Opens the next `session_date` (B-20) |
| Pre-market (New York) | 08:30 | The main markup of [12 §1](12-levels-zones-and-daily-markup.md#1-the-daily-workflow-this-replaces) |
| Pre-power hour | 14:00 | |
| Pre-MOC | 14:50 | MOC imbalances publish at 15:50 ET |
| Pre-gap fill | — | Event, not a clock time. No anchor time |
| Custom "Pre-…" | Optional | Free name, for example "Pre-CPI" |

Proposed record (`mogmine-plans-v1`, with `user_id` per Invariant 7):

- `id`, `user_id`, `session_date`, `symbol` (the instrument the levels were marked on; PS-3 draws a plan only on a chart of that instrument, `OD-15`), `name`, `preset` (or `null` for a custom name), `anchor_time_utc` (nullable), `created_at`.
- `levels[]`: `{ id, price_ticks, price, label, kind: "level" | "zone_low" | "zone_high", note }`, entered with the tick steppers from [20](20-price-first-entry.md). Prices are stored in integer ticks as well (guardrail 4).
- `observations` (text), optional `bias`, and `watch_playbook_ids[]`.
- `revisions[]`: every edit is kept. An edit saved after `anchor_time_utc` is marked **after the fact**, so the review never treats it as a plan that existed before the trade (LV-15).

Notes are never lost: the planning session uses the same save-on-type and "Saved on this device" state as trade notes (UX-30–UX-39).

## 3. Levels and indicators on the chart

- **Computed levels** come from the formulas in [12 §3A](12-levels-zones-and-daily-markup.md#a-computed-by-code). First slice: PDH, PDL, PDC/settle, RTH open, Globex open, ONH, ONL, week high and low. Next: ADR bands and pivots. They must match the worked check in docs/12 for Thu 2026-11-12.
- The pure session calculation takes native candles and a UTC cutoff. Its result records the provider, ticker, native timeframe, calculation version and coverage for the prior session, prior RTH, overnight and week to date. Yahoo candles must match the contract's configured ticker (`OD-15`). Extremes need whole bars through the cutoff. Opens need the exact opening bar, and the 3 PM close needs the final RTH minute. Settlement is a separately dated input with its instrument, availability time and source. PDC and floor pivots require a named close source, including when callers supply session inputs directly. Unverified daily closes appear as `PDC (proxy)`. Until `OD-35` supplies an exchange calendar, holiday and early-close gaps leave dependent levels unavailable.
- **Authored levels** from the day's planning sessions are drawn on the same chart as computed ones. Each has a right-edge label.
- **Drawing** uses a Canvas `SessionLevelsPrimitive` (Invariant 1). It reads colours from CSS variables (Invariant 5) and draws only levels from the same instrument as the chart (`OD-15`). A toggle in the chart view options controls it.
- **Indicators.** Session VWAP comes first. Every indicator records its calculation version and covered bars ([11 §4](11-product-workflows-and-api-context.md#4-indicator-context-is-reproducible)).

## 4. After-session review

Pick a planning session or a time window, for example "Pre-market → Pre-power hour". The review lists the trades in it. For each trade it shows:

- The rules checklist and its `n/total followed` seal, the same as on Trade Detail.
- The nearest planned level and its distance in ticks. Code computes this number; the model never does (guardrail 11).
- Whether the playbook used was one the plan said to watch.

The review ends with one lesson for the next session. A session with no trades is a valid review.

Built as `sessionReview` in `lib/session-review.ts` (PS-4a). The window runs from the checkpoint's anchor (or its creation time for an event preset) to the next checkpoint's anchor or the 17:00 ET close. Levels and the watch list are read as the plan stood at each entry. A plan with a `symbol` reviews only that instrument's trades. The lesson is stored on the plan (`lesson`, 280 characters) and adds no revision.

## 5. Build slices (in order, after `TD-2` and `TD-3`)

| ID | Slice | Files (expected) | Done when |
| :--- | :--- | :--- | :--- |
| `LV-1` | Pure computed levels | `lib/levels.ts`, `lib/__tests__/levels.test.ts` | First-slice levels match the docs/12 worked check; America/New_York session math; ticks snapped |
| `LV-2` | Draw computed levels on the trade chart | `components/SessionLevelsPrimitive.ts`, `components/TradeChart.tsx` | Done: labels legible at `390×844`, toggle in view options, screenshot includes them (`takeScreenshot(true)`) |
| | *LV-2 data and layout (2026-11-22, after PR #154):* `components/useTradeLevels.ts` loads the prior session and this session up to entry through two cached day-mode requests (the trade's own candle window never holds the prior session). `lib/chart-levels.ts` colours by role and side of the entry price, puts levels at one tick in one pill, and stacks pills with a leader tick (`lib/label-stack.ts`). Levels never feed autoscale. View counts missing levels. Gaps under `OD-55`. | | |
| `PS-1` | Pure planning-session model and store | `lib/plans.ts`, `lib/plans-store.ts`, backup round-trip in `lib/store.ts` | Presets, revisions, after-the-fact flag, `user_id`, backup/restore tests (done) |
| `PS-2` | Plan screen on Today | `components/PlanSheet.tsx`, `components/TodayScreen.tsx` | Done: start a "Pre-…" session in under 10 seconds, add levels with tick steppers, write observations, all states from docs/08 §4 |
| `PS-3` | Plan levels on charts | `lib/chart-levels.ts`, `components/useTradeLevels.ts` | Done: a trade chart shows the same-instrument planning-session levels for its `session_date`, as they stood at entry |
| `PS-4` | After-session review | `lib/session-review.ts`, `components/SessionReview.tsx`, `components/PlanCard.tsx` | Done: §4 above, no-trade sessions handled. Opened from a plan on Today, or from the last 14 days under "Session reviews" on Review. |
| `IND-1` | Session VWAP | `lib/chart-indicators.ts` (math in `lib/session-indicators.ts`), chart toggle | Done: matches a hand-checked session. The trader picks the RTH or Globex anchor in View (default Off) while `OD-18` is open; a gap in the anchored window withholds the line. |

Each slice is one branch and one PR (~250–450 lines, [CONTRIBUTING §3](../CONTRIBUTING.md)). Run the four checks in [16 §0](16-floor-roadmap.md#0-rules-for-every-step).

## 6. Phone check, 2026-11-22

The owner reported that tapping a rule checkbox on the phone slid the page away. The boxes sat 23 px from the screen's left edge, which is inside the phone's back-swipe zone. **Fixed:** rule rows and the challenge playbook list are now full-width tiles with the box on the right, about 35 px from the edge. Tapping the text also toggles the box.

The same check found other small controls on Trade Detail within 15 px of a screen edge: the `1m` timeframe button (13 px), the change-target chip (9 px), the "After the exit" note (15 px) and the Mood Shape button (9 px). Fold these into `UI-2`. No screen overflowed sideways, and no tap target was under 40 px.
