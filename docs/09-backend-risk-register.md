# 09 — Backend Risk Register & Hardening Notes

What breaks in the backend if the blueprint is built exactly as written, and what to do instead. Read this before touching ingestion, market data, the database, API routes or the AI pipeline.

## How to read this

- **IDs** (`B-nn`) are stable. Cite them in PRs, handoff notes and code comments.
- **Severity:** **Blocker** = fix before the phase it belongs to ships. **High** = produces wrong data or lost trades. **Medium** = rework, cost or pain.
- **Evidence:** ✔ checked against the vendor's own docs on 2026-11-14 (sources in §10) · ◐ secondary sources only · ? not verified, test it before relying on it.
- Items that change an existing spec link to an open decision (`OD-n`) in [DECISIONS.md](../DECISIONS.md). Until a decision is closed, follow the recommendation here.

> [!NOTE]
> **No broker account yet (owner decision `D-009`, 2026-11-14).** The app is being built on Yahoo data alone. Section 1 (B-01 – B-09) is parked until a TopstepX account exists. For the first two milestones only B-40, B-11, B-13, B-20, B-22, B-23, B-30, B-31 and B-42 matter, plus B-10, B-47 and B-61 because the first frontend already fetches candles per trade. Their acceptance criteria are `AC-01` – `AC-11` in [10 §7](10-yahoo-first-build-plan.md#acceptance-criteria-for-m0-and-m1). See [10 — Yahoo-First Build Plan](10-yahoo-first-build-plan.md).

## 0. Settle these five before writing code

| # | Item | One-line reason |
| :--- | :--- | :--- |
| 1 | **B-40** Public database | "No auth in Phases 1–4" plus a public URL means anyone can read and write the journal. |
| 2 | **B-01** Topstep server rule | A server may watch and record. It may never trade. Violations cost the funded account. |
| 3 | **B-10** Post-exit candles | The blueprint fetches candles "after exit" at the moment of exit. They do not exist yet. |
| 4 | **B-05** Fill ledger | Fills held in memory until the position is flat are lost on any restart. |
| 5 | **B-12** `ES=F` is not the traded contract | Roll weeks and data gaps draw fills outside the candles. |

---

## 1. Broker access and the listener (`B-01` – `B-09`)

### B-01 — Topstep's server rule · Blocker · ✔

Topstep's API Access article says all trading activity must originate from the trader's personal device, and that VPS, VPNs and remote servers are prohibited. The same article allows a private server for work that does not touch order flow: historical data storage, logging and analytics, a read-only dashboard, and receiving copies of your own fills, positions and P&L. Its summary: *"your server can watch and record, but it cannot trade."* The stated consequence of running automation on a VPS is account suspension or removal from the program.

What this means for us:

- **Every server-side component is read-only against ProjectX.** Allowed: `Auth/loginKey`, `Auth/validate`, `Trade/search`, `History/retrieveBars`, account and contract lookups, and hub subscriptions. Never: placing, modifying or cancelling orders, or anything that relays orders.
- **Enforce it in code, not by convention.** One `projectxClient` module exposes only the allowed calls. A CI test fails if any file references an order-mutation endpoint. No "future feature" flag.
- **Get it in writing.** The carve-out is framed around a "private server". Ask Topstep to confirm that a read-only cloud service qualifies, and record the reply in [DECISIONS.md](../DECISIONS.md) (`OD-3`). Re-read the article when it changes (page dated 2026-09-17).
- The article also says Live Funded accounts cannot trade through the ProjectX API. Whether their fills are *readable* is not stated (?). Keep CSV import as the fallback path.
- API access is a paid add-on ($29/month, $14.50 with the `topstep` code) and Topstep gives no implementation support.

### B-02 — Token lifetime · High · ✔

Tokens come from `POST /api/Auth/loginKey` (`userName` + `apiKey`) and are valid for 24 hours. `POST /api/Auth/validate` returns a `newToken`. The hub takes the token in the connection URL, and the docs do not say what happens to an open hub connection when its token expires.

- Refresh at ~20 hours and rebuild the hub connection while the account is flat.
- On any `401`, log in again with the API key, then reconcile (B-03).
- The API key lives in Google Secret Manager (listener) and Vercel server env (pull route). Never in a table the browser can read.

### B-03 — Missed events are not replayed · High · ✔

The docs describe no replay after a reconnect. The official sample re-subscribes inside `onreconnected` and nothing more.

- After every connect and reconnect, and on a timer during sessions (every 2–5 minutes, plus once after the session ends), call `Trade/search` from the last persisted leg minus a safety overlap, and upsert.
- Treat reconciliation as the correctness mechanism and the socket as a latency optimisation. That reframing is why `OD-3` recommends shipping a stateless REST pull first.
- Rate limits are generous for this: 200 requests / 60 s for general endpoints, 50 requests / 30 s for `retrieveBars`. Back off on `429`.

### B-04 — Leg identity and voids · High · ✔

`GatewayUserTrade` and `Trade/search` deliver trades **per leg**. Fields: `id`, `accountId`, `contractId`, `creationTimestamp`, `price`, `profitAndLoss`, `fees`, `commissions`, `side`, `size`, `voided`, `orderId`, `fillId`.

- `fillId` is **null on simulated accounts**, which includes Combines and funded sim accounts. The idempotency key is the leg `id`, scoped by account: `unique (account_id, external_leg_id)`.
- `voided` legs are stored and excluded from position, P&L and fees. A void can arrive after a trade was already closed, so trades must be re-derivable from the ledger (B-05).
- `profitAndLoss` is null on an opening leg and carries gross P&L on a closing leg. Use it to cross-check our math (B-34).

### B-05 — In-memory aggregation loses trades · High

Cloud Run minimum instances can be restarted at any time (✔), and deploys replace the instance. The blueprint keeps opening fills in memory until the position returns to flat. A restart mid-position loses the entry, and the trade can never be rebuilt correctly.

The SQL in `mogprompt.md` §12 makes the safe design impossible: `executions.trade_id` is `NOT NULL` and `trades.exit_time` is `NOT NULL`, so a fill cannot be saved until the trade is over.

- **Ledger first.** Write every leg to `executions` the moment it arrives.
- **Trades are a projection.** One pure function, `deriveTrades(legs)`, turns an account's legs into open and closed trades. The stream, the REST pull, CSV import, manual entry and test replays all call the same function.
- On boot: load recent legs from the database, reconcile via REST, continue.
- Schema changes are in §8. Decision: `OD-5`.

### B-06 — Reversals split one fill across two trades · High

A sell of 3 while long 2 closes one trade and opens the next. A single execution then belongs to two trades, which a `trade_id` foreign key on `executions` cannot express.

- Use an allocation table `trade_executions (trade_id, execution_id, quantity)`.
- The docs say events are per leg. Whether the gateway pre-splits a reversal into two legs is unverified (?). `deriveTrades` must handle both shapes. Add a fixture for each.

### B-07 — Stops and targets live on orders, not trades · Medium · ✔

`Trade/search` has no stop or limit prices. `GatewayUserOrder` does: `stopPrice`, `limitPrice`, `type` (`Stop = 4`, `TrailingStop = 5`), `status`, `updateTimestamp`.

- Subscribe to orders as well as trades and persist an `order_events` log.
- That log gives the initial stop, every stop move, the target, and automatic detection of "Moved Stop" without the trader tagging it.
- Trades that arrive by REST pull or CSV have no stop. `r_multiple` is then `null` and the UI asks for the risk in one tap ([08 §7](08-ux-notes-viewing-and-journaling.md#7-notes-and-journaling)).

### B-08 — "Exactly one listener" cannot be guaranteed · High

Deploys overlap revisions and autoscaling still applies with instance-based billing (✔).

- Set `max-instances=1`, then assume two listeners will still run at once now and then.
- Every write is idempotent: unique keys plus upserts, and a deterministic trade identity (account + first leg id).
- Emit notifications from the database transition (the insert that actually succeeded), never from process memory.

### B-09 — Make liveness visible · Medium

- Serve `/healthz` reporting hub state and seconds since the last event. Cloud Run needs a listening port anyway.
- Write an `ingestion_status` heartbeat row every 30–60 s. The app shows "Live · synced 12s ago" or "Listener offline since 10:42 — trades will backfill".
- Handle `SIGTERM`: stop intake, flush, close the hub. The grace period was not verified (?); check the container lifecycle docs.
- Alert when the heartbeat stops during market hours.
- **Cost:** instance-based billing charges for the whole instance lifetime (✔). Price an always-on instance before Phase 4, and consider dropping `min-instances` to 0 on weekends with Cloud Scheduler.

---

## 2. Market data (`B-10` – `B-15`)

### B-10 — Post-exit candles do not exist at close · Blocker

The blueprint fetches the candle window "immediately when the trade closes", including 25–60 minutes after the exit. Those bars are in the future. A single fetch at close means every trade is permanently missing its post-exit action: no Ghost Box, no "left on the table", no hindsight for the AI. After roughly 30 days the 1m bars can no longer be fetched at all.

Use three passes backed by a durable job table:

| Pass | When | What |
| :--- | :--- | :--- |
| 1 | At close | Save the trade and legs. Fetch pre-entry and in-trade bars. The chart is usable at once. |
| 2 | Exit + post-exit padding + a delay margin | Top up the window. Finalise MAE/MFE and the post-exit view. |
| 3 | After the trading day ends | Sweep the full session for primary and companion symbols. Compute final session levels. |

- Jobs live in Postgres: `enrichment_jobs (kind, trade_id, run_after, attempts, status, last_error)`. Never `setTimeout` in a process that can restart.
- Before Cloud Run exists (Phases 1–3): top up when a trade is opened and its window is incomplete, plus a daily scheduled sweep.
- Track `candles_status` per trade. Alert when 1m coverage is still incomplete 24 hours after close.
- The UI has a state for this ([08 §4](08-ux-notes-viewing-and-journaling.md#4-state-matrix)).
- Seen in the first frontend (2026-11-14): a trade with any Yahoo bars is never fetched again, so a trade logged right after its exit keeps no post-exit bars. Acceptance: `AC-06`, `AC-07` in [10 §7](10-yahoo-first-build-plan.md#acceptance-criteria-for-m0-and-m1).

### B-11 — Yahoo retention versus imports · High · ✔ measured

Measured against Yahoo's chart endpoint on 2026-11-14 (full results and response quirks in [10 §2](10-yahoo-first-build-plan.md#2-what-yahoo-serves-measured-2026-11-14)):

| Interval | Oldest start accepted | Widest single request |
| :--- | :--- | :--- |
| `1m` | 30 days ago | 8 days |
| `5m`, `15m`, `30m` | 60 days ago | Whole range |
| `1h` | 730 days ago | Not probed |

- A request beyond the limit returns `422`. A closed-market window returns `200` with no bars.
- Any trade older than 30 days cannot get `1m` bars from Yahoo. Older than 60 days, not `5m` either. This will apply to every import of past trades.
- The fix is to archive every session daily from now on, whether or not a trade happened ([10 §3](10-yahoo-first-build-plan.md#3-start-the-candle-archive-first)).
- Store coverage per timeframe (requested range versus received range). Never mark a trade enriched because Yahoo returned an empty `200`.
- Degrade to the best available timeframe and tell the user which one they are looking at.
- Clean every response before saving: drop rows with null prices and rows outside the requested window.

### B-12 — `ES=F` is not the contract that was traded · High

- **Roll weeks.** Yahoo's continuous contract switches front month on its own schedule. If the trader is already in the next contract, every box is offset from the candles by the calendar spread, which is tens of ES points.
- **Tick differences.** MES and ES prints differ by a tick or two. Yahoo bars sometimes miss extremes. Fills then draw outside the wick and look like a bug.
- **Volume.** Measured 2026-11-14: a sampled `ES=F` session had volume on all but 2 of about 1,350 bars, so VWAP from it is usable. Indices such as `^VIX` report zero volume.
- **Freshness.** Whether the newest `ES=F` bars are delayed was not confirmed (?). The response carries no delay field. Measure the age of the latest bar during a live session.
- **Micro tickers exist (`OD-15` decided 2026-11-14).** Yahoo serves `MES=F` and `MNQ=F` as separate series whose bars differ from `ES=F` and `NQ=F` by up to a point and thirteen points respectively. `MES` is charted on `MES=F` and `MNQ` on `MNQ=F` with no `ES=F`/`NQ=F` fallback, and levels are computed from the same instrument as the chart. See [10 §4](10-yahoo-first-build-plan.md#4-finding-yahoo-has-separate-mesf-and-mnqf-series-od-15-decided).
- **Roll date for free.** `meta.shortName` names the contract month behind the continuous ticker. Store it per session.

Mitigations:

- Store the broker `contractId` (format like `CON.F.US.RTY.Z24`) on every execution and trade.
- After enrichment, check that each fill price sits inside its bar's `[low − tolerance, high + tolerance]`. If not, set `candle_alignment` to `offset` or `suspect` and surface it in the UI.
- Prefer ProjectX `POST /api/History/retrieveBars` for the traded contract (✔: units from 1 second to 1 month, up to 20,000 bars per request). Keep Yahoo for companions and macro tickers (`^VIX`, `DX-Y.NYB`). Check what the `live` flag returns on our subscription (?). Decision: `OD-7`.

### B-13 — Per-trade windows cannot produce session levels · High

VWAP needs every bar from the session anchor. `ONH/ONL` need 18:00 → 09:30 ET. `PDH/PDL/PDC` need the previous regular session. A scalp caches 45 minutes. Ten trades in one morning also store ten overlapping copies of the same bars.

- Cache by session: `market_candles (provider, symbol, timeframe, session_date)`.
- `trade_candles` stays as the per-trade read path (a slice or a view over the session cache).
- **Invariant 2 does not change:** persist when the trade is logged, read from the database first, never depend on an on-the-fly fetch. Decision: `OD-4`.

### B-14 — Levels must be point-in-time · High

The opening range does not exist until 09:35 or 09:45. The initial balance does not exist until 10:30. VWAP is a curve, not a number. `session_levels` declares `orb_high`, `onh` and others `NOT NULL`, which fails for a 03:00 London trade or a 09:31 entry. Feeding end-of-day levels to the AI, or to "nearest level at entry", is look-ahead.

- Make the level columns nullable.
- Store `levels_at_entry` on the trade: the values known at `entry_time`.
- Draw each level from the time it formed, not from the left edge of the chart.
- Pick one VWAP anchor (RTH 09:30 or Globex 18:00) and one ORB length. The specs currently say both.

### B-15 — Yahoo is unofficial and unlicensed · Medium

No SLA, no redistribution rights, and requests from datacenter IPs are often throttled or blocked (◐). That is acceptable for a personal single-user tool. A licensed feed is required before other traders are invited.

- One fetch path with retry, jitter and a circuit breaker. `provider` recorded on every cached row (already in the schema).
- The adapter boundary (Invariant 6) is what makes the later swap cheap. Keep it clean.

---

## 3. Time and sessions (`B-20` – `B-24`)

| ID | Sev. | Risk | Do this |
| :--- | :--- | :--- | :--- |
| **B-20** | High | "ET" is treated as a fixed offset. DST moves it twice a year and session math silently shifts an hour. | Use IANA `America/New_York` for all session math. Store UTC `timestamptz`. Define `session_date` once: the Globex evening belongs to the next day's session (Sunday 18:00 ET → Monday). One module in the shared core, used by listener, enrichment, UI and AI. Tests must include a March and a November week. |
| **B-21** | Medium | Holidays and half-days have no RTH session or an early close. | Keep a small exchange-calendar table. The levels engine tolerates a missing or short RTH. |
| **B-22** | High ✔ | `lightweight-charts` has no time-zone support and treats every timestamp as UTC. The vendor's guidance is to shift timestamps before passing data in. | One helper, `toChartTime()`, applied to bars, markers and primitive coordinates alike. Shifted times never leave the chart layer: not the database, not the AI context, not URLs. CME is closed during the Sunday 02:00 DST switch, so shifted times stay strictly ascending. That would not hold for 24/7 instruments. |
| **B-23** | High ✔ | `timeToCoordinate()` returns `null` when the time is not on the time scale. A fill at 09:48:37 is not a bar time. The current primitive draws nothing on `null`, so the Position Box silently disappears. | Snap every fill time to its bar's open time for the active timeframe before converting, and re-snap on timeframe change. Unit-test it. `timeToIndex(time, findNearest)` exists as an alternative. |
| **B-24** | Medium | `session_tag` (`NY_AM`, `NY_PM`, `LONDON`, `ASIA`) has no boundary definitions. | Define the boundaries in ET in one table, tag by entry time, and keep the tag derivable so it can be recomputed. |

---

## 4. Money math (`B-30` – `B-34`)

| ID | Sev. | Risk | Do this |
| :--- | :--- | :--- | :--- |
| **B-30** | High | P&L computed from average prices. Three fills average to more than four decimals, `NUMERIC(10,4)` rounds, and `avg × qty × multiplier` drifts by cents. | Compute from the ledger: sum of signed `quantity × price` over legs, times `pointValueUsd`. Average prices are for display only. |
| **B-31** | High | Floating-point prices. Tick sizes `0.1` and `0.01` (`M2K`, `MGC`, `MCL`) are not exact in binary. | Convert prices to integer ticks (`Math.round(price / tickSize)`) for all arithmetic and comparisons. Dollars as integer cents. |
| **B-32** | High | R is undefined once a trade scales in or out. `rewardPoints / riskPoints` only works for one entry and one exit. | `R = P&L ÷ initial risk $`, where initial risk is `|first entry − initial stop| × max position size × pointValueUsd`. `null` without a stop. Choose gross or net once. Decision: `OD-10`. |
| **B-33** | Medium | MAE/MFE from 1m bars is approximate. The entry and exit minutes include price action outside the hold. For a 40-second scalp it is mostly noise. | Use 1-second bars from ProjectX for the hold window where available. Store `excursion_source`. The UI prefixes approximate values with `≈`. |
| **B-34** | Medium ✔ | Our P&L and the broker's can disagree. | Closing legs carry broker `profitAndLoss`, `fees` and `commissions`. Compare. On a mismatch larger than one tick value, flag `pnl_mismatch` and show both. Do not silently pick one. |

Two more data-shape notes:

- **Copy trading.** Topstep traders often mirror one trade across several accounts. Without a `copy_group_id` the feed shows five identical cards and every statistic is multiplied.
- **`accounts.balance DEFAULT 50000.00`** invents a number. Make it nullable and sync it from `GatewayUserAccount`.

---

## 5. Supabase (`B-40` – `B-49`)

### B-40 — The database is public as specified · Blocker

"Single-user, skip auth" combined with a public Vercel URL and browser-side Realtime means the anon key ships in every page load. With RLS off, anyone holding that key can read and write every table through the auto-generated REST API. Public storage buckets expose chart snapshots and voice memos the same way.

From migration `0001`:

- RLS enabled on **every** table. Deny by default.
- Supabase Auth with exactly one allow-listed user and sign-ups disabled.
- Policies of the form `user_id = auth.uid()`. Put `user_id` on every user-owned table, child tables included, so policies stay simple and fast.
- `DEFAULT_OWNER_USER_ID` becomes that user's auth id. Invariant 7 is unchanged.
- The service-role key exists only in Cloud Run and server-only code.
- Buckets are private. The app reads through short-lived signed URLs.

This contradicts `docs/01` §2 ("skip auth in Phases 1–4"). Decision: `OD-2`.

### The rest

| ID | Sev. | Risk | Do this |
| :--- | :--- | :--- | :--- |
| **B-41** | High | Realtime is treated as a queue. Nothing is delivered while the phone sleeps or the PWA is in the background, and nothing is replayed. | On subscribe, on reconnect and on `visibilitychange → visible`, refetch "changed since last seen". Payloads carry ids only. Realtime is not push: lock-screen alerts need Web Push with a service worker, VAPID keys and a `push_subscriptions` table. On iOS that works only for Home Screen–installed PWAs (16.4+), permission must come from a tap, and subscriptions can vanish (◐), so re-check on launch. |
| **B-42** | High | A list query drags `bars` along. One `select *` with a candles join ships megabytes to a phone. | The feed selects a narrow projection. Store a ~40-point `sparkline` on the trade for thumbnails. Add a lint rule or review check for `bars` in list queries. |
| **B-43** | Medium | The DDL has no indexes beyond keys, and enum-like columns are free text. | Minimum indexes: `trades (user_id, exit_time desc)`, `trades (user_id, review_status, exit_time desc)`, `executions (account_id, filled_at)`, `economic_events (event_time)`, `enrichment_jobs (status, run_after)`. `CHECK` constraints on every enum-like column. `gen_random_uuid()` instead of `uuid-ossp`. |
| **B-44** | High | `ON DELETE CASCADE` runs from `accounts` through `trades` to candles, notes and reviews. One mistaken delete erases the journal, including 1m bars that can never be fetched again. | Soft-delete (`deleted_at`) on accounts and trades. `ON DELETE RESTRICT` on `accounts`. Scheduled exports or backups before trusting the free tier with irreplaceable data. |
| **B-45** | Medium | `ai_reviews.trade_id UNIQUE` conflicts with Re-Analyze, and `chart_snapshot_url NOT NULL` blocks any review without an image (B-60). | Keep history: drop the unique constraint, add `is_current`, `status`, `model`, `prompt_version`, `input_hash`, `inputs_used`. Make the snapshot nullable. |
| **B-46** | Medium | Columns named `*_url` store URLs. Signed URLs expire and public URLs leak. | Store bucket paths. Sign on read. |
| **B-47** | Medium | Notes race. The voice parser finishes seconds later and overwrites chips the trader tapped in the meantime. | Column-scoped updates, never whole-row overwrites. AI output lands in separate suggestion fields until accepted. Tags as rows (`tags`, `trade_tags (trade_id, tag_id, source)`) so renaming a chip does not break analytics. Snapshot the checklist rules at grading time so editing a playbook does not change old scores. The same applies between two open tabs: the first frontend saves the whole trade array, so the last tab wins (`AC-08`). |
| **B-48** | Medium | Preview deployments share the production database. One bad migration or seed corrupts the real journal. | A separate Supabase project (or branch) for dev and preview, with seed fixtures. Migrations via the Supabase CLI, one per PR, never edit an applied one, generated types committed. |
| **B-49** | Medium ✔ | Free-tier limits. Projects may pause after about a week of low activity. Database size is capped at 500 MB. | The heartbeat keeps the project awake while it is in use. A session-keyed candle cache for two symbols and three timeframes is on the order of tens of MB per year. Per-trade duplicates grow with trade count instead. Storage (PNGs, audio) is budgeted separately. |

---

## 6. Vercel (`B-50` – `B-54`)

| ID | Sev. | Risk | Do this |
| :--- | :--- | :--- | :--- |
| **B-50** | High ✔ | Function request and response bodies are capped at 4.5 MB. Retina Trade Card PNGs and audio can exceed it, and the limit cannot be raised. | Never proxy files through a route. The client uploads straight to Supabase Storage with a signed upload URL, and the route receives only the path. |
| **B-51** | High | A vision review takes tens of seconds, and phone connections drop. | `POST` creates an `ai_reviews` row with `status = 'queued'` and returns `202`. The work runs with an explicit `maxDuration` (limits depend on the plan; check them). The result is announced by Realtime plus a refetch. An idempotency key per `(trade_id, input_hash)` stops double taps from double billing. |
| **B-52** | Medium | Data routes run on the Edge runtime. | The Yahoo client and image libraries need the Node runtime. Set it explicitly. |
| **B-53** | Medium | Pass-2 enrichment depends on Vercel Cron. Frequency is plan-limited (?). | Use the job table plus top-up-on-view, or `pg_cron` in Supabase. Cron is a backstop, not the mechanism. |
| **B-54** | Medium | A secret gets a `NEXT_PUBLIC_` prefix. | Only the Supabase URL and anon key are public. Service-role key, broker API key and AI keys are server-only. Rotate anything that reaches client code or logs. |

---

## 7. AI pipeline (`B-60` – `B-66`)

| ID | Sev. | Risk | Do this |
| :--- | :--- | :--- | :--- |
| **B-60** | High | The chart snapshot only exists in a browser. "Auto-review when the trade closes" has no PNG unless a device is open. | Two tiers: a data-only review on the server straight away, and a vision review once a client has uploaded a snapshot. Record `inputs_used`. The UI says "reviewed without chart image". Avoid headless Chromium unless a decision says otherwise. |
| **B-61** | High ✔ | The snapshot may not contain the Position Box, and it captures whatever zoom the user left. `takeScreenshot(addTopLayer?, includeCrosshair?)` defaults `addTopLayer` to `false`; that flag is what includes "the top layer and primitives". | Always call `takeScreenshot(true)`. Add a test that samples a pixel inside the box. Render the AI snapshot from a dedicated off-screen chart: fixed size, Fit-Trade range, fixed theme and opacity, after `document.fonts.ready`. The shared card has the opposite problem: it must follow the current view, and today it is captured once at chart creation (`AC-10`). |
| **B-62** | High | The model is asked to output facts the code already knows: `playbook_adherence_score`, event name, minutes from event, nearest level. It can contradict the checklist or invent an event, and two different adherence scores end up on screen. | Code supplies facts. The model receives them as given and returns only judgments: grade, commentary, strengths, leaks, directive. The model never does arithmetic. Decision: `OD-12`. |
| **B-63** | Medium | Hindsight leaks into the process grade. The context includes post-exit candles, so a good decision gets marked down for what happened afterwards. | Two blocks in the prompt and the output: a decision-time assessment using only data up to the exit, and a separate, labelled "what happened next". |
| **B-64** | Medium | The same trade gets a different grade on re-run. | Low temperature, a rubric with per-criterion scores, stored `prompt_version`, `model` and `input_hash`. Re-run only when inputs change. |
| **B-65** | Medium | Hundreds of raw JSON candles per review. Slow, expensive, and the model reads them badly. | Compact rows, downsampled outside the hold, plus precomputed facts. Cap tokens per review and log usage. |
| **B-66** | Medium | Voice capture assumes `webm`. iOS records `audio/mp4`. Microphone prompts may recur in installed PWAs (?). | Pick the MIME type with `MediaRecorder.isTypeSupported`. The transcriber accepts both. Keyboard dictation is the no-permission fallback. Audio goes to a private bucket with a retention setting. |

---

## 8. Proposed schema changes

Names follow the interim canonical set in [DECISIONS.md](../DECISIONS.md) (`OD-1`). These are proposals until `OD-4` and `OD-5` close.

```sql
-- Ledger first: legs exist before, and independent of, trades (B-04, B-05)
create table executions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null,
  account_id       uuid not null references accounts(id),
  external_leg_id  text not null,      -- ProjectX leg id; fillId is null on sim accounts
  external_order_id text,
  contract_id      text not null,      -- broker contract id
  symbol           text not null,      -- canonical, e.g. 'MES'
  side             text not null check (side in ('BUY','SELL')),
  quantity         int  not null check (quantity > 0),
  price            numeric(12,4) not null,
  fees             numeric(10,2) not null default 0,
  broker_pnl       numeric(12,2),      -- null on opening legs
  voided           boolean not null default false,
  filled_at        timestamptz not null,
  source           text not null check (source in
                     ('topstepx_stream','topstepx_pull','csv_import','manual_entry')),
  unique (account_id, external_leg_id)
);

-- One leg can close one trade and open the next (B-06)
create table trade_executions (
  trade_id     uuid not null references trades(id),
  execution_id uuid not null references executions(id),
  quantity     int  not null check (quantity > 0),
  primary key (trade_id, execution_id)
);

-- Session-keyed candle cache shared by every trade that day (B-13)
create table market_candles (
  provider     text not null,
  symbol       text not null,          -- provider symbol or contract id
  timeframe    text not null,
  session_date date not null,
  bars         jsonb not null,
  is_complete  boolean not null default false,
  fetched_at   timestamptz not null default now(),
  primary key (provider, symbol, timeframe, session_date)
);

-- Durable deferred work (B-10)
create table enrichment_jobs (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null,            -- 'candles_pass2', 'session_sweep', ...
  trade_id   uuid references trades(id),
  run_after  timestamptz not null,
  status     text not null default 'pending'
               check (status in ('pending','running','done','failed')),
  attempts   int not null default 0,
  last_error text
);
```

| Table | Add or change | Why |
| :--- | :--- | :--- |
| `trades` | `status` (`open`, `closed`); `exit_time` nullable; `derivation_key` unique | B-05, B-08 |
| `trades` | `contract_id`, `session_date`, `candles_status`, `candle_alignment` | B-10, B-12, B-20 |
| `trades` | `levels_at_entry jsonb`, `sparkline jsonb`, `initial_risk_usd`, `excursion_source` | B-14, B-42, B-32, B-33 |
| `trades` | `review_status`, `copy_group_id`, `pnl_mismatch`, `deleted_at` | [08 §7](08-ux-notes-viewing-and-journaling.md#7-notes-and-journaling), B-34, B-44 |
| `order_events` (new) | Append-only log of `GatewayUserOrder` updates | B-07 |
| `ingestion_status` (new) | Heartbeat, hub state, last leg time | B-09 |
| `push_subscriptions` (new) | Web Push endpoints per device | B-41 |
| `tags`, `trade_tags` (new) | Tag rows with `source` (`user`, `voice_ai`) | B-47 |
| `trade_notes` | `ai_suggestions jsonb`, `checklist_snapshot jsonb` | B-47 |
| `ai_reviews` | Drop unique on `trade_id`; add `is_current`, `status`, `prompt_version`, `input_hash`, `inputs_used`; snapshot nullable | B-45, B-60, B-64 |
| `session_levels` | Level columns nullable | B-14 |
| Every user-owned table | `user_id`, RLS policy, `CHECK` constraints | B-40, B-43 |

---

## 9. Phase gates

A phase is not done until its gate items hold.

| Phase | Must be true |
| :--- | :--- |
| **1** | B-40 (RLS and single-user auth). B-48 (separate dev database and seed fixtures). B-30/B-31 (ledger P&L in integer ticks, with golden tests). B-20 (session module with DST tests). B-23 (time snapping). B-11 (coverage tracking and graceful degradation). B-42 (no `bars` in list queries). |
| **2** | B-10 (top-up path for post-exit candles). B-13/B-14 (session cache and point-in-time levels). B-50 (direct-to-storage uploads). B-47 (notes never overwritten by AI). |
| **3** | B-60/B-61 (two-tier review, standardised snapshot). B-62/B-63 (facts from code, hindsight labelled). B-51 (queued reviews with idempotency). B-45 (review history). |
| **4** | B-01 (read-only client enforced in CI, Topstep confirmation recorded). B-03 (reconciliation loop). B-04/B-05/B-06 (ledger, voids, reversals with fixtures). B-08 (idempotent under two listeners). B-09 (heartbeat and alert). B-02 (token refresh). |
| **5** | B-15 (licensed data before other users). B-12/OD-7 closed. |

---

## 10. Verification log (2026-11-14)

| Claim | Status | Source |
| :--- | :--- | :--- |
| Topstep: trading activity from a personal device; VPS/VPN/remote servers prohibited; a private server may watch and record but not trade; price; no technical support | ✔ | [TopstepX API Access](https://help.topstep.com/en/articles/11187768-topstepx-api-access) (page dated 2026-09-17) |
| ProjectX auth: API-key login, 24-hour token, `Auth/validate` returns `newToken` | ✔ | [Authenticate](https://gateway.docs.projectx.com/docs/getting-started/authenticate/authenticate-api-key/), [Validate session](https://gateway.docs.projectx.com/docs/getting-started/validate-session/) |
| ProjectX realtime: user and market hubs, events, per-leg trades, `fillId` null on sim, order fields, re-subscribe in sample only | ✔ | [Real Time Data Overview](https://gateway.docs.projectx.com/docs/realtime/) |
| ProjectX rate limits | ✔ | [Rate limits](https://gateway.docs.projectx.com/docs/getting-started/rate-limits) |
| ProjectX `retrieveBars` units and 20,000-bar cap; `Trade/search` fields | ✔ | [Retrieve bars](https://gateway.docs.projectx.com/docs/api-reference/market-data/retrieve-bars/), [Search trades](https://gateway.docs.projectx.com/docs/api-reference/trade/trade-search/) |
| `lightweight-charts` 5.3: `addSeries(def, options?, paneIndex?)`, `takeScreenshot(addTopLayer?, includeCrosshair?)`, `timeToCoordinate` null, no time zones, touch options, v4→v5 changes | ✔ | [Panes](https://tradingview.github.io/lightweight-charts/docs/panes), [ITimeScaleApi](https://tradingview.github.io/lightweight-charts/docs/api/interfaces/ITimeScaleApi), [IChartApi](https://tradingview.github.io/lightweight-charts/docs/api/interfaces/IChartApi), [Time zones](https://tradingview.github.io/lightweight-charts/docs/time-zones), [v4 → v5](https://tradingview.github.io/lightweight-charts/docs/migrations/from-v4-to-v5) |
| Vercel 4.5 MB body limit | ✔ | [Functions limits](https://vercel.com/docs/functions/limitations) |
| Cloud Run instance-based billing; minimum instances can restart; autoscaling still applies | ✔ | [Billing settings](https://docs.cloud.google.com/run/docs/configuring/cpu-allocation), [Instance autoscaling](https://docs.cloud.google.com/run/docs/about-instance-autoscaling) |
| Supabase free plan: pause after about a week of low activity, 500 MB database | ✔ | [Pricing](https://supabase.com/pricing) |
| Yahoo limits: `1m` 30 days back and 8 days per request; `5m`/`15m`/`30m` 60 days; `1h` 730 days; null rows; stray trailing row; `MES=F` and `MNQ=F` exist as separate series | ✔ measured | Direct calls to Yahoo's chart endpoint from a desktop, 2026-11-14. Results in [10 §2 and §4](10-yahoo-first-build-plan.md). Yahoo publishes no official limits, so re-measure if behaviour changes. |
| iOS Web Push: 16.4+, Home Screen install, permission from a tap, subscriptions can vanish | ◐ | Vendor guides, not Apple |

**Not verified — test or look up before relying on it:** delay on recent `ES=F` bars; behaviour of an open hub when its token expires; concurrent session limits per user; whether reversals arrive pre-split; whether Live Funded fills are readable through the API; Cloud Run `SIGTERM` grace period; Vercel function duration and cron limits on our plan; Topstep's daily flat-by cut-off (used in `OD-9`).
