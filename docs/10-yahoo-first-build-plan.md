# 10 — Yahoo-First Build Plan (No Broker Account Yet)

**Decision (owner, 2026-11-14):** there is no TopstepX account yet. Until there is, Yahoo Finance is the only data source, and the app is built and troubleshot against it. Recorded as `D-009` in [DECISIONS.md](../DECISIONS.md).

This file says what Yahoo actually serves, what to start first, how to get trades without a broker, and a build order sized for that situation. It also carries the step-back view of the whole plan (§7). Risk items (`B-nn`) are in [09 — Backend Risk Register](09-backend-risk-register.md).

---

## 1. What changes while there is no broker

| Area | Now | Parked until an account exists |
| :--- | :--- | :--- |
| Candles | Yahoo, archived daily (§3) | ProjectX bars for the traded contract (`OD-7`) |
| Trades | Manual entry, a test-trade tool, fixtures (§5) | Pull sync and the stream listener (`OD-3`, B-01 – B-09) |
| Stops and targets | Typed or tapped by the trader | From order events (B-07) |
| CSV import | Not built. The export format is unknown without an account. | Built against a real export file |

---

## 2. What Yahoo serves (measured 2026-11-14)

Measured by calling Yahoo's chart endpoint for `ES=F` from a desktop machine. These replace the second-hand numbers quoted elsewhere. **`1m` history is 30 days, not six weeks.**

| Interval | Oldest start accepted | Widest single request |
| :--- | :--- | :--- |
| `1m` | **30 days** ago | **8 days** (9 is rejected) |
| `5m`, `15m`, `30m` | **60 days** ago | The whole range in one request (59 days tested) |
| `1h` | **730 days** ago | Not probed |
| `1d` | 10+ years | Not probed |
| `2m` | Accepted to 60 days, but returned no bars in any probe | Treat as unusable |

So today the app can draw a `1m` chart for any test trade in the last 30 days, a `5m` or `15m` chart for the last 60 days, and hourly bars for two years. Every day that passes, the oldest `1m` day falls off unless it has been archived.

### Response quirks the fetcher must handle

Each was observed directly. Saving a response as-is produces broken charts.

| Quirk | What to do |
| :--- | :--- |
| A request that starts beyond the limit returns **HTTP 422**. | Treat as "not available", never retry. |
| A closed-market window (a weekend) returns **HTTP 200 with no bars**. | Not an error and not missing data. Coverage checks need the session calendar (B-21). |
| About **3% of rows have null open/high/low/close** (38 of 1,394 in one session). | Drop any row with a null price. |
| Every response for a past window ends with **one extra row outside the requested window** (the latest quote). | Drop rows outside the requested window, or the chart draws a line to a phantom bar. |
| One-minute gaps occur on normal days (the 23:59 ET bar was missing in every futures series sampled). | Bar-count checks tolerate small gaps. |
| `meta.shortName` names the contract month behind the continuous ticker (`E-Mini S&P 500 Dec 26`). | Store it with each session. A change marks the roll date (B-12). |
| Volume was present on all but 2 bars of a sampled `ES=F` session. `^VIX` volume is always zero. | VWAP from futures volume is usable. Never compute VWAP for an index. |

Not settled: whether the newest bars are delayed. The response has no delay field and the market was closed when measured. Check the age of the newest bar during a live session.

---

## 3. Start the candle archive first

This is the one time-sensitive task. Nothing else in the project loses data by waiting.

**What it does.** Once a day, for each symbol, request the last 8 days of `1m` bars in one call, clean them (§2), split them by session, and upsert one row per session into `market_candles` (schema in [09 §8](09-backend-risk-register.md#8-proposed-schema-changes)).

**Why 8 days every day.** Each run overlaps the previous seven. A week of failed runs loses nothing, and there are 30 days of slack before any `1m` bar is gone for good.

**One-time backfill on day one.** 30 days of `1m`, 60 days of `5m`, 730 days of `1h`.

**Derive, do not fetch, the higher timeframes.** `5m`, `15m` and `1h` bars are an exact aggregation of `1m` bars. Archive `1m` only, and build the rest in code with session-anchored buckets. The fetched `5m` and `1h` backfill is only for dates before the archive began.

**Symbols.** `MES=F`, `ES=F`, `MNQ=F`, `NQ=F`. Add `^VIX` and `DX-Y.NYB` if the companion views will use them. See §4 for why both the micro and the mini.

**Where it runs.** One server route in the app (Node runtime, protected by a secret), called daily by a scheduler, plus an **Archive now** button in development. Yahoo is known to throttle datacenter addresses (B-15), and these measurements were taken from a desktop. Test the route from the deployed environment before trusting it. If it is throttled there, run the same code from a scheduled task on a home machine.

**Make it visible.** A status row records the last run and the newest archived session per symbol. The Tune screen shows it, and it turns red after three days without a new session.

**Size.** Four symbols at about 1,380 bars a day, stored as column arrays, is tens of MB a year.

---

## 4. Finding: Yahoo has separate `MES=F` and `MNQ=F` series (`OD-15` decided)

Earlier drafts of Invariant 3 mapped `MES` to `ES=F` and `MNQ` to `NQ=F` on the premise that Yahoo had no reliable micro data. That is true of the bare symbols `MES` and `MNQ`. It is not true of `MES=F` and `MNQ=F`, which return full `1m` series with their own prints and volume.

| Pair, one `1m` session | Bars with identical OHLC | Largest difference in a bar | Volume |
| :--- | :--- | :--- | :--- |
| `ES=F` vs `MES=F` | 202 of 1,354 | 1.00 pt high, 0.75 pt low | 1.41M vs 0.97M |
| `NQ=F` vs `MNQ=F` | 2 of 1,354 | 11.25 pts high, 13.25 pts low | 0.63M vs 2.81M |

A micro trade drawn on mini candles will often show a fill outside the wick, by up to 4 ticks on `MES` and far more on `MNQ`. Drawing it on the micro's own candles removes that.

- **Owner decision (`OD-15`, 2026-11-14):** chart `MES` on `MES=F` and `MNQ` on `MNQ=F`, with **no `ES=F`/`NQ=F` fallback**. Levels are computed from and drawn on the same instrument as the chart (`MES=F` for `MES`). Invariant 3 in [AGENTS.md](../AGENTS.md) is amended accordingly, and candle cache keys include the Yahoo ticker so old `ES=F` bars are never reused for `MES`.
- Point values are unaffected. `MES` is still `$5` a point and `MNQ` is `$2` a point.

---

## 5. Trades without a broker

Every path below produces fills and goes through the same `deriveTrades` function the broker paths will use later, so nothing is throwaway.

| Source | Use |
| :--- | :--- |
| **Manual entry** | The real way to journal until the account exists. Side, quantity, price and time per fill, plus an optional stop. |
| **Test-trade tool** (development only) | Tap an entry bar and an exit bar on an archived session. It creates fills at prices inside those bars, snapped to the tick. A realistic trade in seconds, guaranteed to line up with the candles. |
| **Fixtures** | The scripted scenarios in [CONTRIBUTING.md §5](../CONTRIBUTING.md#5-fixtures-nobody-needs-a-broker-account-to-contribute), generated from archived sessions. |
| **Simulate close** (development only) | Inserts a fixture trade as if it had just closed, to exercise the toast, the queue and the Pit Stop. |

- Mark tool-made and fixture trades with `is_sample`. They never count in statistics. The first-run sample trade in [08 §4](08-ux-notes-viewing-and-journaling.md#4-state-matrix) uses the same flag.
- Do not build the TopstepX CSV importer against a guessed format.

### What cannot be tested on Yahoo alone

- Anything about the broker stream: reconnects, voids, reversals as the gateway sends them, token refresh. Fixtures cover the logic, not the transport.
- Stops and stop moves taken from orders.
- Excursions inside a minute. MAE and MFE stay approximate (B-33).
- Whether real fills line up with the candles across a roll.
- Anything on `1m` bars older than the archive.

---

## 6. Library note

- **Inside the app:** `yahoo-finance2` (Node), behind `MarketDataProvider` only (Invariant 6). A plain HTTPS call to the chart endpoint also works, which is how §2 was measured.
- **`yfinance`** is the Python library for the same Yahoo endpoints, with the same limits. It is fine for one-off exploration. It should not become a second ingestion path next to the app's own.
- Both are unofficial. Yahoo can change or block the endpoint without notice (B-15).

---

## 7. Step back: is this the right way to build it?

**The components are right. The order and the amount are not.**

What is right and should stay: Next.js with Postgres on Supabase, `lightweight-charts` with canvas primitives, candles saved permanently, external services behind adapters, and the product ideas that set this apart, which are ten-second capture, grading process over outcome, and seeing the companion market beside the trade.

What to change:

1. **The plan describes a finished product before the first candle is drawn.** Ten documents, a thousand-line blueprint and sixteen open decisions exist, and no screen does. The 2026-11-14 review added to that pile. Treat the risk register as a reference to consult per milestone, not as a to-do list.
2. **The biggest unknown is not technical.** It is whether the journal gets opened after every session. Only using it answers that, so the first goal is the smallest thing that can be used daily.
3. **One service too many.** A journal does not need sub-second ingestion. A scheduled pull covers it once an account exists. Cloud Run, the SignalR listener and most of B-02 to B-09 can wait until a pull is live and its delay is a real problem. It may never be.
4. **Archive by session, not by trade.** The daily archive in §3 replaces the per-trade fetch and the three enrichment passes with one simple job, and it removes the 30-day cliff.
5. **One app before a monorepo.** The split layout in `CONTRIBUTING.md` is for when a second deployable exists. Start with one Next.js app and a `core` folder of pure functions.
6. **Two specs is one too many.** Freeze `mogprompt.md` as a historical narrative and maintain only `docs/` (`OD-1`).

### Build order

| Milestone | Build | Done when |
| :--- | :--- | :--- |
| **M0 — Archive** | Supabase with RLS, `market_candles`, the archiver, the backfill | Every session of the last 30 days is stored and the job has run unattended for three days |
| **M1 — One trade on one chart** | Deployed app, chart from the archive with derived timeframes and an ET axis, manual entry, the test-trade tool, P&L in ticks, the Position Box with snapping, Fit | A test trade placed from a phone on yesterday's session draws correctly at `1m`, `5m` and `15m` |
| **M2 — Feed and notes** | Today and Feed with their states, the Pit Stop, review status, Shield mode | It has been used for two weeks on trades entered by hand |
| **M3 — Context** | Point-in-time session levels, the companion pane, a Trade Card in one aspect ratio | The trader can explain a trade from the screen alone |
| **M4 — AI** | Voice or text to suggested tags, then a data-only review | The reviews are judged useful on twenty real trades |
| **M5 — Broker** | Pull sync, ProjectX bars, stops from orders | Trades arrive without typing |

Risk items that matter for M0 and M1, and nothing else yet: B-40, B-11, B-13, B-20, B-22, B-23, B-30, B-31, B-42.

### Parked until proven needed

| Parked | Bring it back when |
| :--- | :--- |
| Cloud Run listener and SignalR | Pull sync is live and its delay is a real problem in use |
| Supabase Realtime | A server event exists that a refetch on focus cannot cover |
| Web Push | The in-app flow has been used daily for a month |
| Monorepo split | A second deployable exists |
| Gold preset switcher and intensity slider | The core screens are done. Keep the CSS variables and the opacity slider from the start (Invariant 5). |
| Chart image as AI input | A side-by-side test shows the image changes the review |
| More than two `ReviewContextPlugin`s | The first two (telemetry, price action with levels) are trusted. Keep the interface (Invariant 6). |
| `investment` style and multi-day charts | A broker that allows overnight holds |
| Ghost Box, SMT pins, line tool, percent overlay | M3 is in daily use |
| AI follow-up chat | Reviews are trusted |

This build order is a proposal, `OD-16` in [DECISIONS.md](../DECISIONS.md). The roadmap in [06](06-data-model-and-roadmap.md) stands until the owner decides.
