# 14 — UI & Experience: Phased Plan

Originally written on `ui/phased-improvements` on 2026-11-14 after the owner asked for the plan to be on paper before more was built. **Phases 1–3 are committed there; Phase 4 is implemented on `feat/phase4-chart-windows`. Nothing is pushed or merged.**

Scope is the "First" column of [08 §15](08-ux-notes-viewing-and-journaling.md#15-build-order-for-the-experience) (`OD-14`), on device storage and Yahoo data only (`D-009`). No Supabase, broker, CSV or AI work is in this plan.

---

## 1. Where it stands

| Phase | Commit | Status |
| :--- | :--- | :--- |
| 1 — Foundation, routes, Today and Feed | `c74bbae` | Done |
| 2 — Chart craft | `685319b` | Done; its fitted-window fault is resolved in Phase 4 |
| 3 — Pit Stop and review queue | `5a9f8c6` | Done |
| 4 — Chart window from the trade's own duration | `feat/phase4-chart-windows` | **Done locally; not pushed** |
| 5 — Shield mode, Trade Card sheet, Tune | — | Proposed |
| 6 — Polish, measurements, spec reconciliation | — | Proposed |

Checks at the Phase 3 commit: `npx tsc --noEmit` clean, `npm run lint` 0 errors (7 before; 1 old warning in `postcss.config.mjs`), `npm test` 10 of 10, `npm run build` passes. Screens were checked in headless Chrome at 390 × 844 and 1280 × 900: no horizontal overflow, no console errors, no tap target under 44 px except the chart library's own attribution logo. **Not checked: a real phone, iOS Safari, the share sheet.**

---

## 2. What phases 1–3 built

### Phase 1 — Foundation, routes, Today and Feed

- **Routes** from 08 §3: `/` Today, `/feed`, `/trades/[id]`, `/review`, `/tune`. Before this, the trade list only existed above 1024 px, so a phone had no list at all.
- **Feed** grouped by trading day with a sticky header: date, net, count, win rate, rules followed (UX-13). Filters live in the URL (UX-10). Previous and next follow the list the trade was opened from (UX-11).
- **Today** with its states: no trades today, last trading day labelled with its date, weekend, first run with labelled samples, review-queue card.
- **Storage:** trades are saved without candles (`mogmine-trades-v3`). A keystroke in a note used to rewrite every trade's candles, well over a megabyte. Candles now sit in IndexedDB. Old `v1`/`v2` data is read once and left in place.
- **Samples** are labelled and never mixed into real statistics (docs/10 §5).
- **Core modules with tests:** money in integer ticks and cents (B-30, B-31), session dates in `America/New_York` (B-20), one formatting module (08 §13), display zone as a preference (UX-86), a theme store so Canvas code never reads CSS per frame (Invariant 5, §3b-7).
- **Manual entry:** quantity (it was fixed at 1), live result preview, inline validation, stop and 1.5R target suggested from the risk budget (LV-17), and a draft that survives closing the sheet.
- **Market data:** adapter renamed to the docs/01 names; falls back 1m → 5m → 1h when Yahoo no longer serves the finer bars (B-11).

### Phase 2 — Chart craft

- **Position Box** in the Actual style (`OD-23`): teal frame, solid profit border, dashed risk border (UX-80), fills under the candles so candles stay crisp, MAE and MFE marks, and a result pill drawn in the canvas that shows R and points only in Shield mode (UX-71).
- **Timeframe switch swaps data in place.** The chart is no longer torn down, and the box is re-snapped to the new bars (UX-02, UX-20, B-23).
- X-Ray on crosshair tracking (UX-42), Fit shown only when the view has moved, full-screen chart (UX-25), `J`/`K`/`F`/`N`/`C`/`X` keys (UX-69), swipe between trades on the header only (UX-40).
- **States:** no chart area when there are no Yahoo candles, "showing 5m" notice, fills-off-the-bars notice (B-12), `—R` with one-tap risk chips (UX-36), `≈` on estimated MAE/MFE (B-33).
- Verified with real touch events: a vertical swipe that starts on the chart scrolls the page (UX-41).

### Phase 3 — Pit Stop and review queue

- Playbook pills, setup and execution chips, note. No Save button (UX-30). Undo in place of confirm (UX-34). Chips ordered by use, "Same as last trade" (UX-32).
- Rule checklist frozen on the trade (UX-50) and one adherence score computed from it (UX-51).
- Decision and hindsight as separate sections (UX-52). Header glow reflects process, not P&L (UX-66).
- `/review`: one trade at a time, untagged first. Optional **blind mode**, off by default (§6, Q3).

---

## 3. Phase 4 (implemented) — Chart window from the trade's own duration

**Owner note, 2026-11-14:** there is no "90-minute session" category. Some trades simply last about 90 minutes. The visible window must come from each trade's own duration on a continuous scale. A 90-minute trade shows roughly three hours. A 5-minute scalp shows a tight window, so the box is large and readable. Remove session-length tags and fixed 90-minute windows. 1m and 15m must show different context.

**What is wrong now.** The window comes from three fixed buckets (`fitPadding` in `lib/trades.ts`): 35 minutes before a "scalp", 90 before a "90m session", 480 before the rest. A 2-minute trade classed as a scalp sits in about an hour of 1m bars and its box is a few pixels wide. A 16-minute trade is classed "90m session", gets the 90-minute padding on 5m bars, and is as small. On top of that the padding is in minutes with an 18-bar floor, so what a timeframe shows depends on that floor and the bucket, not on the trade.

**Owner-approved rule:**

1. **Window from duration.** Fitted span = hold time × about 2: the trade takes roughly **half the plot width**, with more room before the entry than after the exit (about 30 % before, 20 % after). A 90-minute trade then shows about three hours, as in the note.
2. **A floor in bars, not minutes.** Never fewer than about 30 bars on screen, so a 40-second trade still has candles around it. This is the only fixed number.
3. **Default timeframe from duration,** picked so the trade spans a readable 8–40 bars: 1m up to about 40 minutes, 5m up to about 3 hours, 15m up to about 10 hours, then 1h.
4. **Timeframes show different context.** Choosing a timeframe keeps a similar number of bars on screen, not the same clock time. On 1m the trade fills the view. On 15m the same trade is a narrow box inside most of the session.
5. **Remove the category from the interface:** the "Scalp / 90m session / Extended" pill on the trade header, the same words on list rows and the review queue, and the Scalps / 90m / Extended filter pills on the Feed (and `?style=` in the URL).
6. **Tests:** golden cases for 40 s, 5 min, 16 min, 90 min and 4 h holds, asserting the share of the plot the box takes and the default timeframe.

**Done when:** at 390 × 844, duration-sized sample trades open with their box between about 35 % and 60 % of the plot width, and switching 1m → 15m visibly widens the context. The approved 30-bar floor necessarily makes the 2-, 5- and 7-minute fixtures narrower (recorded as `OD-27`); the box must not be stretched beyond its true timestamps to meet a percentage target. Screenshots of a tight short-duration trade and a 90-minute trade go in the handoff.

**Spec changes this needs** (same commit, per `AGENTS.md` §5): [02 §3](02-charting-position-boxes-and-divergence.md#3-automatic-trade-classification-scalp-vs-90-min-vs-investment), [07 Recipe 3](07-agent-guardrails-and-smart-notes.md), the wireframe in 05 §1, the "Scalp window" rows of the drift register. Tracked as `OD-24`.

---

## 4. Phase 5 (proposed) — Shield mode, Trade Card, Tune

- **Shield mode** (UX-64) is half built: the header toggle, lists, the trade header and the chart pill already switch to R and points. Left: the Trade Card, the file name, and a sweep of every screen for a remaining dollar sign or size.
- **Trade Card sheet** (08 §11): preview before sharing, privacy toggle that re-renders the chart (UX-71/72), Share / Save / Copy (UX-76), zone on every time (UX-75), playbook, tags and rules seal on the card, image ready before the tap (UX-70). The card today is the old one-button version, moved onto theme tokens.
- **Tune** is a placeholder with only the time zone. Add: Position Box opacity (Invariant 5 asks for it from the start), gold preset and intensity, the blue/orange palette (UX-80), risk budget, show or hide samples, and a **journal backup** (download and restore a file). The whole journal lives in one browser's storage; clearing site data deletes it.

## 5. Phase 6 (proposed) — Polish, measurement, reconciliation

- `AGENTS.md` §4 and 08 §16 checklists on every screen, including large text, reduced motion and the palette with red and green removed.
- Home-screen icons for iOS, and the "Add to Home Screen" hint (08 §14).
- Measure the 08 §2 budgets and record the numbers. A real phone is needed for these to count.
- Reconcile the specs with what was built (§7 below), then the `NOTES.md` handoff.

---

## 6. Open questions for the owner

| # | Question | My recommendation |
| :--- | :--- | :--- |
| Q1 | **Resolved by the owner:** trade ≈ half the plot width, with a floor of about 30 bars. | Implemented in Phase 4 issues #10–#12. |
| Q2 | With the session-length category gone from the screen, should the stored `trade_style` field go too? docs/04 §2 uses it to pick the AI coaching lens, and docs/06 has the column. | Stop showing it and stop using it for windows now. Leave the field until the AI work decides whether it needs a duration bucket (`OD-24`). |
| Q3 | Blind review (BET-03) was built in Phase 3 as an off-by-default switch on `/review`. Bets in docs/13 are not approved scope. Keep, or remove? | Keep it off by default and try it on last week's trades. It is about 40 lines to remove (`OD-25`). |
| Q4 | Playbooks, tags and the four checklist rules are fixed defaults in `lib/playbooks.ts`, taken from the docs/03 examples. There is no editor. Are those your setups? | Send your real playbooks and rules. An editor can wait for the database (`OD-26`). |
| Q5 | Daily levels on the chart (the last handoff's "next step") are blocked: the fixture is computed from `MES=F`, the chart draws `ES=F` (Invariant 3), and LV-06 forbids mixing them. | Decide `OD-15` first. Not in this plan until then. |
| Q6 | **Resolved by the owner:** a trade with no Yahoo candles shows no chart area. Labeled samples may use deterministic fixture candles for offline demos and tests; fixtures never backfill a real trade. | Implemented in Phase 4 issue #25. |
| Q7 | The `8h` timeframe button was removed. With ±15 hours of data it drew four or five bars. | Leave it out. |
| Q8 | Commits are authored as "Claude Code <noreply@anthropic.com>" because this machine has no git identity. | Tell me if you want your own name on them before anything is pushed. |

---

## 7. Where the code now differs from the specs

Not yet written back into the specs. Phase 6 does this, or sooner if you prefer.

| Spec | Difference |
| :--- | :--- |
| 08 §3 | No `/playbooks` screen. The dock is Today, Feed, Add, Review, Tune. |
| 08 §3 | The Feed's `?playbook=` filter is not built. `?style=` is built and Phase 4 removes it. |
| 08 §7 | A note alone counts as `tagged`. The spec names only a playbook or a tag. |
| 08 UX-86 | The zone preference exists. Its default stays Central, the owner's choice, not ET. |
| 05 §1 | Trade-to-trade swipe is on the header strip only (as UX-40 says), with Prev / Next buttons. |
| 02 §2 | Fill markers are plain arrows with no text; the result pill sits on the box. |
| docs/10 §3, Invariant 2 | Unchanged gap: candles are cached per device, not in Supabase. The daily archive (M0) is still the most urgent task in the project and is outside this plan. |

---

## 8. What is not in this plan

The candle archive and Supabase (M0), auth and RLS (`OD-2`), level sets and zones (M3, Q5), the companion pane, voice notes, AI review, push, and the docs/13 bets other than Q3. BET-04 "Draw the trade" would help manual entry most, but it needs archived candles to draw on and unverified hit-testing in the chart library (docs/13 §10).
