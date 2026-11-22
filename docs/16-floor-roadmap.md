# 16 — Floor Roadmap: Zoom, Open Trades, Fresh Candles, Then Data and AI

The ordered work list from the owner's 2026-11-16 review of the live app. The owner set this order. Work top to bottom. Do not skip ahead: later steps depend on earlier ones.

Every step has an ID (`R-01` …), the exact files to touch, what to change, what **not** to change, and how to prove it is done. If a step is unclear, stop and add an open item to [DECISIONS.md](../DECISIONS.md). Do not guess.

This doc builds on [09 — Backend Risk Register](09-backend-risk-register.md) (`B-nn`), [10 — Yahoo-First Build Plan](10-yahoo-first-build-plan.md) (`AC-nn`, milestones `M0`–`M5`), [11](11-product-workflows-and-api-context.md) (`OD-19`) and [15](15-trade-document-and-render-grammar.md). Line numbers are from `main` at `f8f9ff6`; search for the quoted text if they have moved.

---

## 0. Rules for every step

1. One step per branch and per PR. Branch name: `lane/short-description` ([CONTRIBUTING](../CONTRIBUTING.md)).
2. Before opening the PR, run all four and paste the real output:
   ```
   npm run typecheck
   npm run lint
   npm test
   npm run build
   ```
3. A UI step is not done until the [AGENTS.md §4](../AGENTS.md#4-mobile-first-verification-checklist) checklist passes at `390×844`. If you cannot test on a real phone, write "not verified on a phone" in the handoff. Never claim it.
4. Add tests in `lib/__tests__/` for every new pure function. The test runner is `node --test`; there is no browser test harness.
5. Never invent a P&L, a price, or a bar. A value that cannot be computed is `null` and the screen says so (guardrails 4 and 11).
6. Update the spec named in the step in the same PR, and add a handoff entry to [NOTES.md](../NOTES.md).

## 1. Where things stand (2026-11-21)

| Area | State on `main` |
| :--- | :--- |
| Trades | Stored **only on the device** in `localStorage` key `mogmine-trades-v3` (`lib/store.ts`), plus `deriveTrade` (`lib/trade-document.ts`). No server copy yet. |
| Candles | Fetched per trade and per day from `/api/market-data` (Yahoo), cached in IndexedDB (`lib/candles.ts`). |
| Candle archive | Built on branch `feat/m0-candle-archive`. **Not merged.** Off until Supabase keys exist. |
| Open trades | Complete (`R-03a`–`R-03c` merged). |
| Challenges | Complete on device (`R-09a`–`R-09d` merged, `docs/17`). |
| Stop at entry | Complete (`R-10` merged in `#118`; used by the price-first form in `docs/20`). |
| Accounts & Mood | Complete on device (`docs/21`, `docs/18`). |
| AI | No AI code and no endpoint an assistant can call (`R-06`). |
| Playbooks | Four hardcoded setups sharing one checklist (`lib/playbooks.ts`). No editor (`R-07`). |
| Stats | Daily and running stats on Today. Running stats include rolling windows and all-time playbook and tag breakdowns (`R-08`). |

## 2. The order

| Step | What | Size | Needs |
| :--- | :--- | :--- | :--- |
| `R-01` | Pinch zooms the chart, not the page | **Merged** (phone check still owed) | — |
| `R-02` | Fresh-trade candles retry and refresh | **Merged** | — |
| `R-03` | Log a trade that is still open | **Merged** (`R-03a`–`R-03c`) | `OD-38` |
| `R-04` | Turn on the candle archive | Owner task + merge | Supabase project |
| `R-05` | Trades stored in Supabase | Large | `R-03`, `R-04` |
| `R-06` | Read-only assistant endpoint | Medium | `R-05`, `OD-19` |
| `R-07` | Playbook editor (`R-07a` local store, `R-07b` editor; syncs in `R-05`) | Medium, two PRs | **Not** blocked on `R-05` ([docs/22](22-development-mode-and-backend-boundary.md)) |
| `R-08` | Running stats across days (`R-08a` pure selectors, `R-08b` UI) | Done on Today | **Not** blocked on `R-05` ([docs/22](22-development-mode-and-backend-boundary.md)) |
| `R-09` | Challenges: Drawdown Defender and Clean Run ([docs/17](17-challenges.md)) | **Merged** (`R-09a`–`R-09d`) | `OD-37` |
| `R-10` | Stop at entry, frozen | **Merged** (#118); used by the price-first form ([docs/20](20-price-first-entry.md)) | — |
| `CD` | Card system: Trade Card refresh, drills, playbook card ([docs/23](23-card-system.md)) | Medium, six PRs | `OD-46` (interim rule allows `CD-1`, `CD-2`) |

Per [docs/22 — Development Mode and Backend Boundary](22-development-mode-and-backend-boundary.md), do **not** pause local-first product work while Supabase is unconfigured. Only `R-04`–`R-06` require Supabase (`R-06` needs server-stored trades). `R-07` and `R-08` run on device storage (`mogmine-trades-v3` / `mogmine-playbooks-v1`) first and sync to Supabase later in `R-05`.

### 2b. Local-first queue while Supabase is off (`docs/22`)

Work top-to-bottom in small slices (**aim under ~400 changed lines per PR**, `CONTRIBUTING.md` §3):

1. **`R-08a` — Pure running stats (`lib/selectors.ts` + tests), done:** Cross-day, per-playbook, per-tag, rolling windows (last 20, week, month). Exclude `is_sample` and `open`; skip `rMultiple === null` and count skipped; gross only.
2. **`R-08b` — Running stats UI, done:** Summary card on Today, `390×844` + desktop, Shield-safe, gross-labelled.
3. **`TD-1` (Issue `#35` pure) — `observeTrade` (`docs/15` §3.3), done:** Bar observer over `DerivedTrade` + golden tests on `fixtures/trades/ex-*.json`. The chart flags and text equivalents remain part of the display-list integration.
4. **`TD-2` (Issue `#34` pure) — `buildMarks` (`docs/15` §3.4), done:** Display list builder for the `D-010` fills-only look, with exact marks on all seven trade fixtures at 1m and 5m.
5. **`TD-3` (Issue `#34` canvas) — `PositionBoxPrimitive` paints `Mark[]`, done:** Stepped stop path, MFE/MAE bracket, `PAST STOP` hatch, exit-reason flags, dotted continuation.
6. **Done — `R-07a` — Local playbook store & backup (`lib/playbooks-store.ts`, `lib/store.ts`):** `mogmine-playbooks-v1` + `user_id` (Invariant 7) + backup/restore.
7. **Done — `R-07b` — Playbook editor (`components/PlaybookEditor.tsx` in Tune):** Add, rename, reorder rules, archive (no hard delete; frozen trade checklists stay intact).
8. **`UI-1` — Chart OHLC HUD & honest freshness, done (`components/TradeDetail.tsx`, `app/globals.css`, `lib/freshness.ts`, `OD-40`, #114):** Pin OHLC readout top-left inside `.chart-frame`; keep `.chart-source` visible; add `Delayed · Xm` / `Cached` / `Offline` pill.
9. **`UI-2` — Desktop 3-column workstation & toolbar polish, done (`components/TradeDetail.tsx`, `app/globals.css`, `docs/19`, `docs/24 §6`, `#114`):** Refine `>=1024px` workspace with compact levels ribbon and balanced chart frame clamp without hiding `.trade-levels-card`; move mobile edge controls (`1m`, change-target chip, after-the-exit note, mood button) >= 20px off edges to avoid back-swipe conflicts.
10. **`UI-3` — Mood at Entry (`OD-39` c, `docs/19` §4):** Optional 1-tap pre-exit mood capture in `AddTradeSheet` / open `TradeDetail`.
11. **`MD-1` (Issue `#90` `AC-07`) — Expected window coverage in `/api/market-data` & `lib/candles.ts`:** Check `expectedInsideBarTimes` instead of `candles.length >= 4`.
12. **`CD-1a` — Card frame & Trade Card layout, done (`lib/shareCard.ts` + tests, [docs/23](23-card-system.md) §2–3, `OD-46`, #41):** Shared frame, `4:5` / `9:16` / `1:1` layout tables, chart at 55–60%, hero R with rules seal, Shield copy tested for all sizes.
13. **`CD-1b` — Trade Card sheet controls, done (`components/TradeCardSheet.tsx`, `components/TradeDetail.tsx`, `lib/shareCard.ts`):** Size picker (`4:5`, `9:16`, `1:1`), front/back flip toggle, canvas back-side journal rendering, default Shield on open, and `390×844` mobile check.
14. **`CD-2a` — Drill decks, pure (`lib/drills.ts` + tests, docs/23 §4):** Eligibility (closed, not sample, bars cached, older than 7 days), warm-up / playbook / misses decks, chart cut at entry, scoring.
15. **`CD-2b` — Drill store & backup (`lib/drill-store.ts`, `lib/store.ts`):** `mogmine-drills-v1` + `user_id`, in journal backup/restore, never writes `take_again`.
16. **`CD-2c` — Drill screen:** Sealed front, *Take it / Smaller / Pass*, reveal (instant under reduced motion), missing-bars skip count.
17. **`CD-3` — Playbook card (docs/23 §5):** `CD-3a` data done (`lib/playbook-card.ts`). `CD-3b` in-app card and `/playbooks` binder done (`components/PlaybookCard.tsx`, `components/PlaybookBinder.tsx`, `lib/playbook-binder.ts`). `CD-3c`: PNG export on the shared frame, after `CD-1b`.

---

## R-01 — Pinch zooms the chart, not the page

**Problem.** Pinching on the chart zooms the whole page and the chart at the same time.

**Cause.** `app/globals.css` line 356:

```css
.chart-host { width: 100%; height: 100%; touch-action: pan-y pinch-zoom; -webkit-touch-callout: none; user-select: none; -webkit-user-select: none; }
```

`pinch-zoom` hands the two-finger gesture to the browser. The chart library also handles it (`handleScale: { pinch: true }` in `components/TradeChart.tsx`), so both react.

**Change.** In that one rule, replace `touch-action: pan-y pinch-zoom;` with `touch-action: pan-y;`. Nothing else.

**Do not:**
- Add `user-scalable=no` or `maximum-scale` to the viewport in `app/layout.tsx`. Page zoom outside the chart is an accessibility feature (UX-44).
- Change `handleScroll` or `handleScale` in `TradeChart.tsx`. `vertTouchDrag: false` must stay so a vertical swipe on the chart still scrolls the page (UX-41).
- Use `touch-action: none`. It would break vertical page scroll over the chart.

**Done when,** on a real phone:
- A two-finger pinch on the chart changes only the chart's time scale. The page does not zoom.
- A one-finger vertical swipe that starts on the chart scrolls the page.
- A one-finger horizontal drag pans the chart and the page does not move sideways.
- Pinching outside the chart (for example on the notes) still zooms the page.

**Spec.** No spec change. [docs/08](08-ux-notes-viewing-and-journaling.md) UX-44 already says the chart container owns pinch; the CSS is what disagrees.

---

## R-02 — Fresh-trade candles retry and refresh

**Problem A: a trade logged right after the exit can show no chart, and stays that way.** Yahoo publishes the newest bars late. The loader (`loadCachedCandles` in `lib/candles.ts`) accepts a response only if it contains the entry bar **and** the exit bar (`anchorsTradeWindow`). When the exit bar is not out yet, the load throws, the entry is stored as `status: "none"`, and nothing ever retries: `ensureCandles` returns early when an entry with the same signature exists, and no caller passes `force` (`components/TradeDetail.tsx` lines 93 and 95). Only reloading the app clears it.

**Problem B: the bars after the exit do not fill in during the day.** The only refresh is `cachedCandlesNeedRefetch`, which fires once after the 17:00 ET session close, once per app load.

**Change.**

1. **Add a pure function** to `lib/candles.ts`:
   ```ts
   /** When a trade's candles should be requested again, or null for never. Pure, for tests. */
   export function nextCandleRetryAt(
     trade: Pick<TradeRecord, "exit_time">,
     entry: Pick<CandleEntry, "status" | "candles" | "baseTimeframe">,
     lastAttemptAt: number,
     now: number,
   ): number | null
   ```
   Rules, in this order:
   - Session already closed and the bars reach the close (`!cachedCandlesNeedRefetch`) and `status === "ready"` → `null`. Finished candle sets never change.
   - `status === "none"` and the exit was less than 60 minutes before `now` → `lastAttemptAt + 60_000` (retry each minute while Yahoo catches up).
   - `status === "none"` and the exit is older than that → `lastAttemptAt + 15 * 60_000`.
   - `status === "ready"` and the session has not closed → `lastAttemptAt + 5 * 60_000` (pull in the after-exit bars).
   - Otherwise fall back to the existing after-close behaviour.
2. **Track the last attempt time.** Add `lastAttemptAt: number` to `CandleEntry`. Set it in `ensureCandles` when a load starts.
3. **Make `ensureCandles` honour it.** Where it now returns early for a matching signature, also allow a new load when `nextCandleRetryAt(...)` is not `null` and is `<= Date.now()`. Keep the existing `fetching` guard so two requests never overlap. A `ready` entry stays on screen while refetching (`{ ...existing, fetching: true }`, as the code already does).
4. **Call it at the right moments** in `components/TradeDetail.tsx`:
   - on mount (already there);
   - when the page becomes visible again (`document.addEventListener("visibilitychange", …)` and check `document.visibilityState === "visible"`);
   - on a timer while the trade is open on screen: one `setInterval` of 60 seconds that calls `ensureCandles(trade)`. Clear it on unmount.
5. **A Retry control.** When `candles.status === "none"`, show a button labelled `Retry` (min 44px) that calls `ensureCandles(trade, true)`. Next to it, plain text: `Yahoo has not published these bars yet` when the exit was under 60 minutes ago, otherwise the existing no-chart message.
6. **Cached partial sets.** When a refetch brings fewer bars than the cache already has, keep the cache. Never replace more data with less.
7. **Refresh the existing chart.** Apply corrected OHLC even when the candle times stay the same. Keep a manually adjusted time range and price scale when refreshed bars arrive.

**Do not:**
- Poll for sample trades (`trade.is_sample`). They never touch the network (issue #89).
- Poll from a list screen. Lists never load candles (B-42).
- Retry faster than once a minute. Yahoo may throttle a hosted server (docs/10).
- Loosen `anchorsTradeWindow`. A chart without the exit bar would draw the box in the wrong place (B-23).

**Tests** (`lib/__tests__/candle-cache.test.ts`): one case per rule in step 1; a `none` entry retries after the interval; a `ready` complete entry never retries; a refetch with fewer bars keeps the cache.

**Done when:** a trade logged one minute after its exit shows the Retry state, then draws by itself within a few minutes without reloading; and reopening an older same-day trade shows more after-exit bars than before.

**Also record:** how many minutes Yahoo lagged for `MES=F` `1m` during a live session. Put the number in [docs/10 §2](10-yahoo-first-build-plan.md#2-what-yahoo-serves-measured-2026-11-14). It is listed there as unknown.

**Spec.** [docs/08 §4](08-ux-notes-viewing-and-journaling.md) state matrix: add the "bars not published yet" state.

---

## R-03 — Log a trade that is still open

**Problem.** The trader logs the entry while the trade is still running. Today that is impossible. An exit is required in:

| Place | What blocks |
| :--- | :--- |
| `components/AddTradeSheet.tsx` | Exit time and exit price are required fields; `freshDraft` sets exit to now. |
| `lib/trades.ts` `TradeRecord` (line 50) | `exit_time: string` and `exit_price: number` are not nullable. |
| `lib/trades.ts` `validateTradeInput`, `normalizeTrade`, `tradeTicks`, `holdSeconds`, `classifyTrade`, `fitWindow`, `alignTradeToBars`, `candleSignature`, `buildSparkline` | All read the exit. |
| `lib/store.ts` line 299 | Import drops any record with no `exit_time` or `exit_price`. |
| `app/api/market-data/route.ts` | Returns `400` without `exit`, and when `exit <= entry`. |
| `lib/candles.ts`, `lib/hindsight.ts`, `lib/rstrip.ts`, `lib/trade-bar-validation.ts`, `lib/shareCard.ts`, `lib/describe.ts` | Read the exit. |

**Target shape** (matches [docs/09 §8](09-backend-risk-register.md): `status` `open`/`closed`, `exit_time` nullable):

```ts
export type TradeStatus = "open" | "closed";
// in TradeRecord:
status: TradeStatus;
exit_time: string | null;
exit_price: number | null;
```

Invariant: `status === "open"` ⇔ `exit_time === null` ⇔ `exit_price === null`. Enforce it in `normalizeTrade`. A stored record with no `status` field is `closed` (every record saved before this change has an exit).

**Do it in three PRs, in this order.**

**R-03a — Types and math (no UI change).**
- Add `TradeStatus`, make the two exit fields nullable, add `isOpen(trade)` to `lib/trades.ts`.
- Every money function returns `null` for an open trade: `tradeTicks`, `tradePoints`, `tradePnl`, `rMultiple`, `excursions`, `isScratch` (`false`), `exitFlagReason` (`null`). `initialRiskUsd` and `plannedR` do not need the exit and keep working.
- `holdSeconds(trade, now)` uses `now` for an open trade. `classifyTrade` and `defaultTimeframe` use that.
- `candleSignature` uses the literal string `open` in place of the exit time, so closing the trade changes the signature and reloads candles.
- `lib/store.ts` line 299: accept a record with `status === "open"` and null exits; still drop a `closed` record with a missing exit.
- Stats (`dayStats` in `lib/selectors.ts`): open trades are **not counted** in P&L, win rate or R. Show their count separately.
- Fix every TypeScript error this causes by handling `null` explicitly. Do not use `!` or `as number` to silence them.
- Tests: each function above with an open trade; a legacy record with no `status` normalises to `closed`; an `open` record with an exit price is rejected by `normalizeTrade`.

**R-03b — Entry and close.**
- `AddTradeSheet.tsx`: add a two-option control at the top, `Still open` / `Closed`, default `Closed`. `Still open` hides the exit time and exit price fields and skips their validation. Entry time defaults to now. The button reads `Save open trade and open chart`.
- `TradeDetail.tsx`: an open trade shows a primary button `Close trade` in the lower half of the screen (thumb zone, min 44px). It opens a small sheet with exit time (default now) and exit price, validated by the same `validateTradeInput` rules, and `exit > entry`. Saving sets `status: "closed"` through `updateTrade`.
- `TradeRow.tsx`, `TodayScreen.tsx`, `FeedScreen.tsx`: an open trade shows the label `Open` where the P&L goes. Never `$0.00`, never a blank.
- Shield mode (#15) still hides size and dollars on the new controls.

**R-03c — Chart and candles for an open trade.**
- `/api/market-data`: `exit` becomes optional. Without it, fetch from `entry − 15h` to now, and require only the entry bar (`anchorsTradeWindow` gets an entry-only mode). Keep the `400` for a present-but-invalid `exit`.
- `lib/candles.ts`: an open trade always counts as needing a refresh, on the `R-02` five-minute rule. Never cache an open trade's candles as final.
- `TradeChart.tsx` / `PositionBoxPrimitive.ts`: for an open trade the box starts at the entry bar and its right edge is the **last loaded bar**. Draw the stop and target fills as today. Draw no exit marker and no after-exit continuation. Hindsight (`lib/hindsight.ts`) returns `null`.
- `lib/shareCard.ts`: the Trade Card for an open trade is labelled `OPEN` and shows no result.
- `OD-38` (decided by the owner, 2026-11-16): an open trade shows `Open` and **no** P&L, realised or unrealised.

**Do not:**
- Compute an unrealised P&L from the last Yahoo bar and show it as the result. Yahoo is delayed; that number is not the trader's fill (guardrail 4).
- Use `0`, `""` or the entry price as a stand-in for a missing exit. Missing is `null`.
- Add a third status. Only `open` and `closed`.

**Done when:** a trade can be saved with only side, size, entry time and entry price; it appears as `Open` on Today and Feed; its chart draws with the box running to the last bar; closing it fills in the result and the chart redraws with the exit; day stats ignore it while open; an old backup file still restores.

**Spec.** [docs/06 §2](06-data-model-and-roadmap.md) `trades` table, [docs/08 §4](08-ux-notes-viewing-and-journaling.md) state matrix, [docs/15](15-trade-document-and-render-grammar.md) (an open trade is a trade with no exit event).

---

## R-04 — Turn on the candle archive

The code exists on `feat/m0-candle-archive` (issue #70). It is 125+ commits behind `main`.

**Owner does** (an agent cannot): create the Supabase project, apply `supabase/migrations/20261115100000_market_archive.sql`, put the keys in `.env.local` and in Vercel's environment settings. Never commit a key.

**Agent does:**
1. Rebase `feat/m0-candle-archive` onto `main`. Expect conflicts in `lib/candles.ts`, `app/api/market-data/route.ts`, `lib/trades.ts`, `lib/store.ts`, `components/TuneScreen.tsx`, `NOTES.md`. Keep `main`'s behaviour for coverage and partial payloads (#86, #90, AC-07); add the archive as the first source, Yahoo as the fallback.
2. Keep `R-02` working: the retry rules apply whichever source answered.
3. Run `npm run archive:ingest -- --backfill` once keys exist and paste the coverage report.
4. Confirm `AC-01`–`AC-05` in [docs/10 §7](10-yahoo-first-build-plan.md#acceptance-criteria-for-m0-and-m1).

**Do not** apply anything in `supabase/planned/`. That file is replaced by `R-05`.

**Why it cannot wait:** Yahoo stops serving `1m` bars after 30 days. Every day without the archive loses a day of `1m` history for good.

---

## R-05 — Trades stored in Supabase

This step enables cross-device journal persistence and supports `R-06`. The local-first queue in §2b can proceed with device storage and fixtures under [the backend boundary](22-development-mode-and-backend-boundary.md).

**Fix the planned SQL first.** `supabase/planned/20261115100001_trades_notes_annotations.sql` (on the archive branch) has `exit_time timestamptz not null` and `exit_price numeric not null`. That repeats the problem [docs/09](09-backend-risk-register.md) line 69 warns about and blocks `R-03`. The real migration must have:

```sql
status      text not null default 'closed' check (status in ('open','closed')),
exit_time   timestamptz,
exit_price  numeric,
initial_stop_price  numeric,
initial_stop_set_at timestamptz,
constraint trades_open_has_no_exit check (
  (status = 'open'   and exit_time is null     and exit_price is null) or
  (status = 'closed' and exit_time is not null and exit_price is not null)
)
```

**Requirements:**
- `user_id` on every row and every query (invariant 7). RLS on every table, no public bucket (guardrail 2, `OD-2`).
- The service-role key stays in server code. The browser uses the anon key with a signed-in user.
- Writes are idempotent: the client-generated `id` (`crypto.randomUUID()`, already used) is the primary key, and saves are upserts.
- **The device stays the first place a note is saved.** Notes must never be lost offline (docs/08). Write locally, then sync; show the existing `SaveState` (`saving` / `saved` / `error`).
- List queries never select candle bars (guardrail 9).
- One migration per PR. Never edit an applied migration.
- A one-time import moves the existing `mogmine-trades-v3` trades up. Sample trades (`is_sample`) are not uploaded.

**Open before starting:** `OD-30` (is the stored record the `mogmine.trade.v1` document or flat columns) decides the table shape. Get the owner's answer first.

**Done when:** a trade logged on the phone appears on a second device after sign-in; airplane-mode edits sync when the connection returns; `AC-06`–`AC-11` hold.

---

## R-06 — Read-only assistant endpoint

So an AI assistant can read the journal. Scope and authorisation are `OD-19` ([docs/11 §5](11-product-workflows-and-api-context.md)); the owner decides before code.

**Recommended first cut:**
- `GET /api/assistant/trades?from=YYYY-MM-DD&to=YYYY-MM-DD` — closed and open trades, no candles.
- `GET /api/assistant/trades/{id}` — one trade with notes, tags, checklist, and computed facts.
- `GET /api/assistant/stats?from=…&to=…` — the `R-08` numbers.
- Auth: a revocable bearer token created in Tune, stored hashed, tied to one `user_id`. No token, no data.

**Rules:**
- **Read-only.** No route creates, edits or deletes a trade. Drafts-from-assistants is a later step.
- **Every number comes from code** (`tradePnl`, `rMultiple`, `excursions`, …). The response carries the computed value; the model never calculates one (guardrail 11).
- Units are explicit in field names: `pnl_usd`, `points`, `ticks`, `r_multiple`. `r_multiple` is `null` without a stop, never `0`.
- Times are UTC ISO strings, plus the session date in `America/New_York` (guardrail 5).
- Shield mode does not apply to the API, but the token page says so plainly.
- Nothing here talks to the broker (guardrail 1).

**Until `R-06` exists:** Tune → download backup produces `mogmine-journal-backup-YYYY-MM-DD.json` (`buildBackup` in `lib/store.ts`). Hand that file to an assistant.

---

## R-07 — Playbook editor

Today `lib/playbooks.ts` holds four fixed setups that share `STANDARD_RULES`. Build local-first (`R-07a` store + backup, `R-07b` editor UI per [docs/22](22-development-mode-and-backend-boundary.md)), then sync to Supabase in `R-05`:

- Local store `mogmine-playbooks-v1` (and later `playbooks` table) with `user_id` (invariant 7): `name`, `default_style`, `checklist_rules` (ordered list of `{ id, label }`), `archived`.
- Editor in Tune or its own screen: add, rename, reorder rules, archive. No hard delete: old trades reference the playbook.
- **A trade keeps the checklist it was saved with** (UX-50, `checklistFor` already copies it). Editing a playbook never changes a past trade.
- Seed the four current playbooks so nothing existing breaks, and include custom playbooks in `buildBackup`/`parseBackupFile`.
- **Built (2026-11-21):** `lib/playbooks-store.ts` and Tune → Playbooks. Pickers hide archived playbooks except the one a trade is filed under; names still resolve for old trades. `no-setup` stays rule-free and cannot be archived. Name clash is case-insensitive and includes archived playbooks. Limits: 40-character names, 12 rules, 80-character rules (`OD-54`). Sample fixtures always use the seed rules. Backups without `playbooks` leave the device list alone.

---

## R-08 — Running stats across days

Extend `lib/selectors.ts`. Pure functions with tests (`R-08a`), then a screen/card (`R-08b`). Runs live from device trades (`mogmine-trades-v3`, [docs/22](22-development-mode-and-backend-boundary.md)); does not wait for `R-05`:

- All-time breakdowns per playbook and per quick tag: trade count, win rate, average R, total R, rule adherence (`adherence()` in `lib/trades.ts`). A trade counts once per tag.
- Rolling windows: last 20 by exit time (ties by id), this session week (Monday to Friday), this session month. The caller passes the current instant to `runningStats(trades, now)`. Calendar windows use the New York session date at exit. A closed trade with an invalid exit timestamp stays in all-time totals and is counted as undated for the rolling windows (`OD-47`).
- **Excluded always:** sample trades (`is_sample`), open trades (`R-03`).
- R-based numbers skip trades for which `rMultiple` is `null` and show the skip count. A scratch with a valid stop contributes `0R`.
- Report gross figures and label them gross (issue #61). Win rate uses priced trades. Show the priced denominator and an incomplete indication when any trade could not be priced. If no trade can be priced, display `—` for both gross P&L and win rate. Shield hides gross dollars in the summaries and breakdowns (UX-64).

---

## R-09 — Challenges: Drawdown Defender and Clean Run

The full design, with the math, golden test cases, the code contract and the screens, is **[docs/17 — Challenges](17-challenges.md)**. Read it before writing anything. Build it as `R-09a` to `R-09d` in [docs/17 §7](17-challenges.md#7-build-order).

- **Drawdown Defender:** trade N sessions without giving back more than a dollar limit from the high point. Gross dollars, closed trades.
- **Clean Run:** N trades in a row by the rules. Losing trades count; P&L is not an input.

Fixed constraints:
- Scored by code from stored trades. An AI may comment on a result; it never computes one (guardrail 11).
- Sample trades and open trades never count. A trade that cannot be scored blocks a pass and is named; it is never treated as `0`.
- Gold is for good process only (#80): Clean Run may use it, Drawdown Defender may not. No confetti, sounds or streak counters for money (UX-66).
- No profit-target challenge, no R-scored challenge and no custom builder in this step. [docs/17 §1](17-challenges.md#1-what-is-in-what-is-out) lists what each one waits for.

---

## R-10 — Stop at entry, frozen

> **Merged** in #118. The price-first form ([docs/20](20-price-first-entry.md) §2) saves its stop through the same `stopPatch`, risk chips use it too, and a backup restore keeps the device's initial stop (`keepInitialStop`).

**Problem.** `components/AddTradeSheet.tsx` saves every trade with `stop_loss_price: null`. The stop is added later on Trade Detail and stays editable, so `rMultiple` and `initialRiskUsd` can change after the trade is over. Nothing records what the risk was when the trade was taken. Any R-based stat or challenge is only as honest as that edit.

**Change.**
1. `lib/trades.ts` `TradeRecord`: add `initial_stop_price: number | null` and `initial_stop_set_at: string | null`. `normalizeTrade` defaults both to `null` for records saved before this change.
2. `AddTradeSheet.tsx`: add an **optional** `Stop` price field, validated by the existing `validateTradeInput` stop-side rule (below the entry for a long, above for a short, on the tick grid). Empty is allowed.
3. On save with a stop: set `stop_loss_price` and `initial_stop_price` to it, and `initial_stop_set_at` to the save time.
4. A trade saved without a stop: the **first** time a stop is set on Trade Detail (`TradeLevelEditor.tsx`), copy it to `initial_stop_price` and stamp `initial_stop_set_at`. Later edits change `stop_loss_price` only.
5. Add `initialRMultiple(trade)` beside `rMultiple`: the same math on `initial_stop_price`, `null` without one. Do not change what `rMultiple` returns.
6. Trade Detail shows "Initial stop 6841.25, set 09:42" as a quiet fact when the current stop differs from the initial one.

**Do not:**
- Make the stop required. Logging must stay fast.
- Back-fill `initial_stop_price` from `stop_loss_price` on old trades. It is unknown; leave it `null`.
- Ever overwrite `initial_stop_price` once set, including from a backup restore of the same trade.
- Switch existing screens from `rMultiple` to `initialRMultiple` in this step. That is a separate decision.

**Tests:** a saved stop sets all three fields; a later edit moves only `stop_loss_price`; the first stop on a stop-less trade is captured once; `initialRMultiple` is `null` with no initial stop; an old record normalises with both new fields `null`.

**Done when:** a trade can be logged with a stop in one pass, and editing the stop afterwards leaves the initial one visible and unchanged.

**Spec.** [docs/06 §2](06-data-model-and-roadmap.md) `trades`; and the planned Supabase table in `R-05` gains the two columns.

---

## 3. Not in this roadmap

The broker listener, pull sync and CSV import (`D-009`, `M5`); the companion divergence pane and session levels (`M3`, docs/12); the AI review engine itself (`M4`, docs/04). They keep their place in [docs/10 §7](10-yahoo-first-build-plan.md#7-step-back-is-this-the-right-way-to-build-it). This roadmap only inserts `R-01`–`R-03` ahead of them and names the data steps the owner's goals depend on.

---

## 4. Project review and follow-ups

Reviewed against `main` at `860547e` on 2026-11-21. MogMine already supports price-first entry, chart review, local notes, and process challenges. These are suggested follow-ups for the owner and future slices. The active order is in §2b and [Next up](../NOTES.md#next-up).

### Protect the journal and chart evidence first

1. **Keep an unsaved edit when another tab writes.** The journal replaces its in-memory trade list on a `storage` event. A simulated two-tab sequence dropped a pending note when a different trade was saved in the other tab. Preserve pending field edits across incoming updates and define how to handle two edits to the same field. Add a regression for each case. The add sheet also clears the draft and says the trade is saved before the debounced write completes. Check save confirmation, draft recovery, and the session-only state when storage is blocked. [Journal store](../lib/store.ts) · [Trade entry](../components/AddTradeSheet.tsx)
2. **Make backup restore a recovery drill.** Tune restores trades, preferences, mood, accounts, and challenges through separate writes. Exercise an old backup, a failed write, and a restore into a clean browser profile. Show recovery status for the affected data. The JSON backup carries journal records, and the chart cache stays in IndexedDB. Make that distinction clear at export and restore. When the owner can unblock `R-04`, prioritize archive coverage and missed-run recovery. A journal restored after the provider's retention window may have a trade record without its original bars, which affects review, drills, and exports. [Backup and restore](../components/TuneScreen.tsx) · [Archive acceptance](10-yahoo-first-build-plan.md#acceptance-criteria-for-m0-and-m1)
3. **Refine `MD-1` from the code already on `main`.** The route and cache already check trade anchors and inside gaps under issue #90. The route returns partial coverage when both anchors are present. `aggregateCandles` can still build a higher-timeframe candle from an incomplete bucket without identifying it. Before dispatching `MD-1`, verify the remaining `AC-07` gaps and aim the slice at what is missing, including incomplete buckets and padding if applicable. Check that inferred fill times and excursions stay explicit about the bars available, including coarser data and holiday gaps (`OD-35`). [Market-data route](../app/api/market-data/route.ts) · [Candle aggregation](../lib/trades.ts)

### Improve the daily review loop

4. **Make a real phone the release check for the core loop.** Run Today → log an open trade → add a note → close the trade → Review → export. Repeat with blocked or unavailable market data and check that capture still works. Use `AC-11` for reload, chart gestures, timeframe switching, and native Share and Copy. Record the build, phone, OS, and browser. Keep browser automation for seeded regressions, including Shield, no horizontal overflow, and empty states. [Phone acceptance](10-yahoo-first-build-plan.md#acceptance-criteria-for-m0-and-m1) · [UX checks](08-ux-notes-viewing-and-journaling.md#16-acceptance-checklist-adds-to-agentsmd-4)
5. **Use the new stats to bring one lesson back to Today.** The app already has a review queue, quick tags, and a process count. After `R-07` and `R-08`, try a weekly review that opens a representative trade or a repeated rule break and lets the trader carry one rule into the next session. Keep process counts beside gross results with a sample size and missing-R count. Keep setup judgments and account-loss-limit checks visible in their own units. Test an edited playbook against historical checklist snapshots and an edited trade against frozen challenge results. [Review queue](../components/ReviewScreen.tsx) · [Daily workflow proposals](11-product-workflows-and-api-context.md) · [Card and drill notes](23-card-system.md#9-review-notes-for-future-slices)
6. **Give the trade document a deliberate path into the live app.** `deriveTrade` and `fromLegacy` have fixture tests, and production screens currently use the legacy record and helpers. With `TD-1` through `TD-3`, compare the same trade's facts in Trade Detail, account totals, challenges, stats, and exports before switching their readers. Cover partial exits, a moved stop, missing risk, and observed versus inferred facts. Settle `OD-30` before making it a persistence format. The assistant can reuse the same facts once its read scope is approved. [Trade document](15-trade-document-and-render-grammar.md) · [Backend boundary](22-development-mode-and-backend-boundary.md)

### Make unattended development easier to trust

- **Make GitHub check the merge.** At review time `main` reported `protected: false` and its active branch rules list was empty. Add required CI checks that install from the lockfile with `npm ci` and run typecheck, lint, tests, and build. Keep the reviewer for changes that need human-readable evidence, including chart and restore behavior. Record the GitHub and local smoke results in the PR. [Definition of done](../CONTRIBUTING.md#3-how-changes-land)
- **Make each scheduled run easy to resume.** Keep one stable slice ID, spec link, dependency, and acceptance check per ready item. The worker should read queue updates from the fetched `origin/main` and check whether its prior slice already merged before starting a branch. Summarize the outcome with slice ID, base commit, check results, PR or blocker, and next eligible item. Treat a timed-out run with a partial diff as unfinished work. This keeps the useful worker → reviewer → next worker feedback when the job is interrupted. [Queue](../NOTES.md#next-up) · [Agent workflow](../CONTRIBUTING.md#4-working-with-ai-agents)
