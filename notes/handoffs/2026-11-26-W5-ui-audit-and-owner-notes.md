# Wave 5 Backlog & UI/Product Audit Notes (2026-11-26)

Captured from Chris's live feedback + our mobile (`390×844`) and desktop (`1280×800`) browser audit of `3bccf06`. Ready to slice into the next 5-agent swarm once TradingView indicator settings and priorities are confirmed.

---

## 1. Owner Questions & Direct Findings

### A. "How do you add an account?"
- **Current state:** Buried at the bottom of **Today** (`/` → scroll down to Accounts → `＋ Another account` ghost button in `components/AccountCard.tsx:200`, or `Add account` when 0 accounts exist). It is **not** reachable from `/tune`, `/feed`, or the Account picker inside `AddTradeSheet` (`+`).
- **Fix for Wave 5:** Put **Accounts** in `/tune` (or a dedicated `/accounts` manager) AND add an inline `+ New account` option right inside `AddTradeSheet`'s account selector so you never have to hunt for it.

### B. "Review tab only shows demo trades"
- **Root cause (`components/ReviewScreen.tsx:107-113`):** `prefs.showSamples` defaults to `true`, and the Review queue sorts `review_status === "new"` ahead of `"tagged"`. All 10 demo/sample trades have `review_status: "new"`, so they flood the front of the Review queue ahead of real trades (`UX-d` in `BOARD.md`).
- **Fix for Wave 5:** Exclude `is_sample` trades from the Review queue completely (or only show them when the user has 0 real trades and explicitly clicks "Try demo queue"). Same for Today's "X to mark reviewed" counter.

### C. "Review tab trade thumbnails are dumb — labels cover the chart, why do we even need those labels?" + "I absolutely don't need TP or SL labels or MAE or MFE"
- **Locked Owner Directive (2026-11-26):** Remove floating `TP`, `SL`, `MAE`, and `MFE` labels from the chart canvas completely (both on Review thumbnails AND on Trade Detail charts!).
- **Root cause (`components/ReviewChart.tsx:38`, `components/PositionBoxPrimitive.ts`, `lib/trade-marks.ts`):** `buildMarks` currently paints `MFE ≈ +7.75 pts`, `MAE ≈ -5.00 pts`, `TP +1.67R`, `= SL`, and callout tags directly on top of the candles.
- **Fix for Wave 5:** Default charts and review thumbnails to **pure, unobstructed candlesticks + subtle translucent entry/stop/target shading ONLY** — zero floating `TP`, `SL`, `MAE`, or `MFE` text/brackets covering price action (numbers live cleanly in the levels ribbon/header strip below the chart, never on top of bars).

### D. "I see a -250 still"
- Verified on `/trades/mes-failed-reclaim` (demo fixture): `-$250.00` is that demo trade's **realized dollar P&L** (`-5 pts × 10 contracts × $5/pt = -$250.00`). Right underneath it reads **`-0.8R`**, confirming `$300` account R (`-$250 ÷ $300 = -0.83R`).

### E. "How do I do a pretend / replay session (scrubbing charts on TradingView/another app and telling an agent what trades I'm pretending to take and why)?"
- **Gap:** No first-class Replay / Pretend mode yet.
- **Proposed design for Wave 5:**
  1. Add `mode: "live" | "eval" | "sim" | "replay"` on `TradingAccount` (and a 1-tap **"Start Pretend / Replay Account"** preset in `AccountSheet`).
  2. Trades logged to a `replay` account get the full MogMine chart, Databento 1m candles, VWAP + bands, Pit Stop notes, Playbook tagging, and Daily Review — **without** polluting real/eval running P&L, Drawdown Defender, or live stats (clean `Real | Replay | All` filter chip on Feed & Stats).
  3. Add a `pretend_session` workflow in `lib/agent/house-rules.ts` + `/api/v1/guide` so while scrubbing TradingView you can tell your agent *"pretend session on Nov 18 — taking a long at 7310 because..."* and it logs straight to your Replay account with the historical chart timestamp (`entry_time`) while preserving true wall-clock `recorded_at`.

### F. "Upper and lower VWAP bands, VWAP accuracy, and matching TradingView indicators"
- **Current state (`lib/chart-indicators.ts`, `lib/session-indicators.ts`):** Only computes and draws the single Session VWAP midline (no `±1σ` / `±2σ` standard-deviation bands yet — `OD-18`).
- **Accuracy opportunity:** With **92,569 Databento 1m MES bars** now wired on `main`, we have real CME tick-aggregated volume (instead of patchy Yahoo volume). We can match TradingView's exact Anchored/Session VWAP formula (`hlc3`, volume-weighted variance for `±1σ` / `±2σ` / `±3σ` bands, RTH `09:30 ET` vs Globex `18:00 ET` anchor) once Chris shares or lets us inspect his TradingView indicator config.

---

## 2. Full UI/UX Audit ("What else is weird?" + Redesign Direction)

### Concrete Weirdness Spotted in Browser QA & Code Audit
1. **Mobile sticky top header wraps `+` onto a 2nd row (`390×844`, all pages):** Inflates the header from `56px` → `97px` and clips content right below it, even though the bottom dock ALREADY has a centered `+` button. **Fix:** Hide the top-bar `+` on mobile (`< 768px`) where the bottom dock owns `+`.
2. **Navigation sprawl & hidden destinations:** Top/bottom nav has 4 tabs (`Today`, `Feed`, `Review`, `Tune`), while `/playbooks`, `/playbooks/lab`, `/drills`, `/challenges`, `/strategy-lab`, `/settings/agent`, and `/review/day/[date]` are scattered as buried links inside cards on Today, Review, and Tune.
3. **Today screen overload:** Stacks 7+ heterogeneous modules vertically (Today summary, Daily Review CTA, Challenges, Running Stats, Planning Sessions, Accounts, Today's Trades) — feels like a dashboard soup instead of a calm daily cockpit.
4. **Review tab identity crisis:** Mixes 3 distinct modes on one scroll (14-day Daily Review strip + Blind Review single-trade queue + Past Session Reviews) and floods the queue with 10 demo trades.
5. **Chart label clutter on small cards & thumbnails:** Floating `MFE`, `MAE`, `TP`, `SL`, and level pills cover candlesticks on small charts instead of letting price action breathe.
6. **Trade Detail right rail & card density:** Still has `Pit Stop`, `Mood`, `Stop Moves`, `Partials`, `Plan vs Actual`, `Discretionary Prompts`, and `After the exit` stacked; desktop 3-column feels crisp now, mobile needs progressive disclosure (compact summary rows that expand only when tapped or populated).
7. **`showSamples` defaults to `true` even after real trades exist:** Once a user has `>= 1` real trade (e.g. synced from Supabase), demo/sample trades should automatically turn off (with a toggle in Tune if they ever want them back).

### Proposed UI Redesign Direction (Calm, High-Signal Trader Cockpit)
- **Make the 4 primary tabs match the trader's actual day:**
  1. **Today (Cockpit):** Top strip = active Account pill (tap to switch/add account) + Today's Net R + 1-tap `Plan` / `Daily Review`. Below: Today's trades & plans (clean, compact). Move Running Stats & Challenges into a dedicated **Stats / Progress** view (or collapsible drawer) instead of cluttering Today.
  2. **Journal / Feed (All Trades + Clean Thumbnails):** Clean `Real | Replay | Samples` segmented filter at top, clean chart thumbnails with **zero text labels over candles** (just price + subtle entry/exit/stop shading), and fast filter chips (`Account`, `Playbook`, `Day`).
  3. **Review (Two clean tabs: `Daily` | `Queue`):**
     - `Daily` = the 14-day strip + full session package (Plans + Trades + Mood + Daily Review notes).
     - `Queue` = **real unreviewed trades only** (never demo trades), clean unlabelled chart + Pit Stop right underneath.
  4. **Lab & Tools (or Tune split cleanly):** Separate **Tools** (`Playbooks`, `Strategy Lab`, `Drills`, `Accounts`, `Agent Keys`) from **Appearance & Settings** (`Theme/Gold`, `Default R`, `Shield`, `Backup`) so nothing feels randomly stuffed inside Tune.
- **Chart philosophy (TradingView-grade calm):**
  - Clean candles first. Translucent position zones (`D-010`), accurate Session VWAP + `±1σ` / `±2σ` bands matching TradingView, and **zero floating text badges colliding with bars** by default.
