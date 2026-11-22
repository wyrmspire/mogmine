# NOTES.md — Current State & Handoffs

The volatile file. `AGENTS.md` says what never changes. This says where things stand today.

- Read this at the start of a session. Update it at the end.
- Newest handoff first. Eight lines or fewer per entry.
- When a note becomes lasting knowledge, move it into `docs/` or `DECISIONS.md` and delete it here.
- Delete entries that no longer help the next person.

---

## Current state (2026-11-22)

- **`main` holds UI Phases 1–5, Challenges (`R-09a`–`R-09d`), open trades (`R-03a`–`R-03c`), frozen initial stop (`R-10`), price-first entry & price-axis stretch (`docs/20`), accounts & running totals (`docs/21`), Mood Shape (`docs/18`), and `deriveTrade` (`lib/trade-document.ts`, PR #124).**
- **Backend boundary (`docs/22`, 2026-11-20):** Supabase is **not** a prerequisite for ordinary product, UI, pure-math, stats, playbook, or render-grammar work. Keep building local-first with fixtures and device storage (`mogmine-trades-v3`) until a feature requires cross-device persistence.
- **First frontend is live at `mogmine.vercel.app`.** Ten demo trades use real Yahoo Finance candles only; without market bars they show no chart.
- **Owner priority (`D-011`, 2026-11-22):** a usable trading day: end-of-day logging, "pre-anything" planning sessions, levels and indicators on the chart, after-session review. Slices `LV-1`, `LV-2`, `PS-1`–`PS-4` and `IND-1` come right after `TD-3` ([docs/24](docs/24-planning-sessions-and-after-session-review.md)).
- **Phone behaviour is not verified.** Builds, headless Chromium `390×844` checks, and Yahoo responses passed; persistence, gestures and native sharing have not been checked on a real phone (`AC-11`).
- **No TopstepX account yet (`D-009`).** Everything is built and tested on Yahoo data. The plan for that is [docs/10](docs/10-yahoo-first-build-plan.md).
- Specs: `docs/01`–`07` (original), `docs/08`–`15`, `docs/16` (roadmap), `docs/17` (challenges), `docs/18` (mood), `docs/19` (design guide), `docs/20` (price-first entry), `docs/21` (accounts), `docs/22` (backend boundary), `docs/23` (card system: Trade Card refresh, drill cards, playbook card; proposal under `OD-46`), `docs/25` (discretionary calls; proposal under `OD-52`).
- Open decisions in [DECISIONS.md](DECISIONS.md): `OD-37`, `OD-39`–`OD-55`, `OD-30`–`OD-36`, `OD-1`–`OD-29` (except decided `OD-15`, `OD-38`). `OD-3` and `OD-7` are parked until there is a broker account. `OD-17`–`OD-22` are product proposals.
- **Times display in Central Time** (`lib/time.ts`), the owner's zone. Storage stays UTC and session math stays `America/New_York`.
- `mogprompt.md` and `docs/` still disagree on many names. The interim rule is that `docs/` wins. The full list is in the [drift register](DECISIONS.md#3-spec-drift-register).

## Next up

**Work top-to-bottom in small slices (~250–450 changed lines per PR, `CONTRIBUTING.md` §3).** See [docs/16 — Floor Roadmap](docs/16-floor-roadmap.md) and [docs/22 — Development Mode and Backend Boundary](docs/22-development-mode-and-backend-boundary.md).

The [project review](docs/16-floor-roadmap.md#4-project-review-and-follow-ups) records suggested reliability, usability, and scheduler improvements for future slices.

Done from `docs/16`: `R-01` pinch zoom (phone check still owed), `R-02` candle retry, `R-03a`–`R-03c` open trades, `R-08a`–`R-08b` running stats, `R-09a`–`R-09d` challenges, `R-10` frozen initial stop.

### Active No-Supabase Queue (work in order)

1. **`R-08a` — Pure cross-day & playbook/tag running stats, done** (`lib/selectors.ts`, `lib/__tests__/`, `docs/16` §R-08).
2. **`R-08b` — Running stats screen/card, done** (`components/RunningStatsCard.tsx`, `components/TodayScreen.tsx`, `app/globals.css`, `lib/__tests__/running-stats-view.test.ts`).
3. **`TD-1` (Issue `#35`) — `observeTrade(derived, candles, barMinutes)`, done** (`lib/trade-bar-validation.ts`, `docs/15` §3.3): stop, target and fill findings, MFE/MAE, post-exit touches and inferred hindsight for cancelled plans, with golden facts for all seven trade documents. Displayed bars supply both the Canvas flags and their Data notes.
4. **`TD-2` (Issue `#34` pure part) — `buildMarks`, done** (`docs/15` §3.4): deterministic `Mark[]` display list with real bar anchors (`B-23`), the `D-010` fills-only look and exact 1m/5m goldens for all seven trade fixtures.
5. **`TD-3` (Issue `#34` canvas part) — `PositionBoxPrimitive` paints `Mark[]`, done** (`components/PositionBoxPrimitive.ts`, `TradeChart.tsx`): stepped stop path, MFE/MAE bracket, `PAST STOP` hatch, exit-reason flags, dotted continuation.
6. **`R-07a` — Local playbook store & backup, done** (`lib/playbooks-store.ts`, `lib/playbooks.ts`, `lib/store.ts`, `components/AppShell.tsx`, `components/TuneScreen.tsx`): `mogmine-playbooks-v1` seeded from `PLAYBOOKS`, `user_id` set (Invariant 7), round-tripped in journal backup/restore.
7. **`R-07b` — Playbook editor UI, done** (`components/TuneScreen.tsx`, `docs/16` §R-07): add, rename, reorder rules, archive (no hard delete); saved trades keep their frozen checklists (`UX-50`).
8. **`LV-1` — Pure computed levels, done** ([docs/24](docs/24-planning-sessions-and-after-session-review.md) §5, formulas in docs/12 §3A): PDH/PDL/PDC, RTH open, Globex open, ONH/ONL, week high/low, tested against the docs/12 Nov 12 worked check. PR #152 follows the merged TD-3 painter under `D-011`.
9. **`LV-2` — Draw computed levels on the trade chart, done** (`components/SessionLevelsPrimitive.ts`, `lib/chart-levels.ts`, `components/useTradeLevels.ts`): Canvas rays and stacked right-edge pills from prior-session and overnight day-mode bars, View → Session levels toggle, in the Trade Card PNG. Follow-ups under `OD-55`: `5m` fallback for Yahoo `1m` Globex gaps, right offset for labels (`UI-2`).
10. **`PS-1` — Planning-session model and store, done** (`lib/plans.ts`, `lib/plans-store.ts`, `mogmine-plans-v1`, presets Pre-Globex / Pre-market / Pre-power hour / Pre-MOC / Pre-gap fill / custom, revisions, after-the-fact flag, backup round-trip). Shape is `OD-51`.
11. **`PS-2` — Plan screen on Today** (start a "Pre-…" session fast, levels with tick steppers, observations).
12. **`PS-3` — Planning-session levels on trade charts.**
13. **`PS-4` — After-session review** (rules followed, nearest planned level in ticks, watched playbook, one lesson).
14. **`IND-1` — Session VWAP.**
15. **`UI-1` — Chart OHLC HUD & honest freshness** (`components/TradeDetail.tsx`, `app/globals.css`, `OD-40`): pin crosshair OHLC readout inside top-left of `.chart-frame` so `.chart-source` stays visible; add honest `Delayed · Xm` / `Cached` / `Offline` pill (never `"Market Live"`).
16. **`UI-2` — Desktop 3-column workstation & toolbar polish** (`components/TradeDetail.tsx`, `app/globals.css`, `docs/19`, `#114`): refine `>=1024px` layout and chart surface hierarchy without hiding `.trade-levels-card` or regressing `390×844`. Also move small controls off the screen edges (`1m` at 13 px, change-target chip at 9 px, After-the-exit note at 15 px, Mood button at 9 px; docs/24 §6) — edge taps trigger the phone's back swipe.
17. **`UI-3` — Mood at Entry** (`components/AddTradeSheet.tsx`, `components/TradeDetail.tsx`, `OD-39` c, `docs/19` §4): optional 1-tap pre-exit mood capture.
18. **`MD-1` (Issue `#90` `AC-07`) — Window coverage check in `/api/market-data` & `lib/candles.ts`:** replace `candles.length >= 4` acceptance with shared `expectedInsideBarTimes` coverage check.
19. **`CD-1a` / `CD-1b` — Trade Card refresh** ([docs/23](docs/23-card-system.md) §2–3): shared frame, `4:5`/`9:16`/`1:1`, chart at 55–60%, hero R + rules seal, back side, Share opens with Shield on.
20. **`CD-2a`–`CD-2c` — Drill cards** (docs/23 §4): pure decks and scoring, `mogmine-drills-v1` store + backup (never writes `take_again`), drill screen with sealed front and reveal.
21. **`CD-3` — Playbook card** (docs/23 §5): only after `R-07b` and `R-08a`.

22. **`DC-2`–`DC-7` — Discretionary calls** ([docs/25](docs/25-discretionary-calls.md) §8, proposal `OD-52`): store, call sheet, chart pins, Skip/Flip grading, discretion score. `DC-1` (pure model) and `DC-1b` (stable reason ids with frozen labels) are done; wait for the owner's yes on `OD-52` before `DC-3` UI.

### Supabase-gated / Owner-gated (do not block on or pick up unasked)

- `R-04` (owner creates Supabase project + rebase `feat/m0-candle-archive`, `#70`; never touch PR `#71`), `R-05` (Supabase trade persistence, needs `R-04` + `OD-30`), `R-06` (assistant endpoint, needs `R-05` + `OD-19`).
- Skip owner-question issues (`#5`–`#9`, `#23`, `#24`, `#39`), parked broker work (`#43`), and `#123`.

Still open from before: `OD-37`, `OD-39`–`OD-45`, `OD-1`, `OD-16`, and `AC-01`–`AC-11` in [docs/10 §7](docs/10-yahoo-first-build-plan.md#acceptance-criteria-for-m0-and-m1). When a TopstepX account exists: get Topstep's written confirmation that a read-only cloud service is allowed (B-01), then reopen `OD-3` and `OD-7`.

## Lanes

Claim a lane before starting. Clear the claim when you stop.

| Lane | Claimed by | Since | Working on |
| :--- | :--- | :--- | :--- |
| Core math | — | | |
| Chart | — | | |
| App shell and notes | — | | |
| Data | — | | |
| Market data | — | | |
| Ingestion | — | | |
| AI review | — | | |

## Handoff log

### 2026-11-22 — Claude — LV-2 follow-up to PR #154 (#26), Chart lane released

- #154 merged while my claimed LV-2 branch was open. It read levels only from the trade's 15-hour candle window, which never holds the prior session, so PDH/PDL/RTH levels could not appear; its `autoscaleInfo` let S2/R2 compress the chart; pills overlapped; roles ignored the side of price.
- Fix: `useTradeLevels` loads the prior session and this session up to entry (two cached day-mode requests, no look-ahead). `lib/chart-levels.ts` roles/grouping, `lib/label-stack.ts` stacking with leader ticks, `autoscaleInfo()` → null, proxy PDC still dashed. View shows `N shown · M missing`.
- `npm test`, typecheck, lint (existing PostCSS warning only), build 8/8 and `node scripts/check-session-levels.mjs` pass; output in PR. Headless Chrome 390×844 on a seeded Nov 19 trade with live Yahoo bars: zero overflow, 5 levels drawn, Trade Card 1080×1350 includes them. Real phone not checked (AC-11).
- Finding (`OD-55`): Yahoo `1m` misses 10–29 Globex minutes per session, so PDH/PDL/ONH/ONL/week are withheld nearly always. Next: `5m` fallback for that window, then PS-2.

### 2026-11-22 — Gemini — PS-1 (OD-51), Data lane released

- Implemented pure planning-session model (`lib/plans.ts`) and store (`lib/plans-store.ts`) for `mogmine-plans-v1`.
- Follows `OD-51` data shape: presets (Pre-Globex, Pre-market, Pre-power hour, Pre-MOC, Pre-gap fill, custom), anchor times, levels with integer tick prices, observations, bias, watch playbook IDs, and revisions tracking edits after the fact.
- Added backup export/restore round-trip support in `lib/store.ts`, `components/AppShell.tsx`, and `components/TuneScreen.tsx`.
- 100% test coverage for presets, planned level creation, tick snapping, after-the-fact detection, revisions, and backup round-trip (`lib/__tests__/plans.test.ts`).
- Next is `PS-2` (Plan screen on Today: start a "Pre-…" session fast, levels with tick steppers, observations).

### 2026-11-22 — Codex — DC-1b PR #147 review, no lane

- Rebased the PR onto `11056cd`, preserving all newer handoffs. Reviewed the pure call/reason contract against docs/25, playbook-design/04 §1.4 and OD-52.
- Fixed seed ids to use explicit immutable keys rather than display-label slugs; a regression proves a wording change keeps the same id. No persisted calls exist, so no migration is required.
- `npm run typecheck` passed; lint had 0 errors/1 existing PostCSS warning; `npm test` passed 429/429; `npm run build` compiled and generated 8/8 pages; `git diff --check` passed.
- DC-2 may build storage on this contract. DC-3 UI remains owner-gated by OD-52.

### 2026-11-22 — Claude — DC-1b frozen call reasons, no lane
Did:      Calls now save reasons as `{ id, label, family }` (`FrozenReason`) instead of bare labels, as playbook-design/04 §1.4 requires before `DC-2`. Seed chips get stable ids (`seed:cut:thesis-broken`, `seed:shared:gut`) and families. `validateCall(call, offered, previous)` keeps a call valid after its chip is renamed, retired or deleted. No call was ever stored, so `DiscretionCall` changed in place.
Files:    `lib/calls.ts`, `lib/__tests__/calls.test.ts`, `docs/25-discretionary-calls.md`, `docs/playbook-design/04-discretionary-prompts-integration.md`, `NOTES.md`.
Checked:  `npm test` 416 passed (12 in calls). Typecheck clean. Lint 0 errors, the existing warning. Build 8/8 pages. `git diff --check` clean. No UI.
Left:     Code PR left open for review (owner's merge rule). Next in this thread: `DP-1` (`detectDeviations`, `pendingAsks`). `OD-52` and the `OD-DP-*` items still need the owner.

### 2026-11-22 — Antigravity — LV-2 (#26), Chart lane released

- Implemented `SessionLevelsPrimitive` (`components/SessionLevelsPrimitive.ts`) using Canvas 2D API (`ISeriesPrimitive<Time>`), drawing point-in-time session levels as 1px rays and right-edge pill labels (`price label`).
- Theme tokens: added `--level-resistance`, `--level-support`, `--level-adr`, `--level-neutral`, `--level-label-text` in `app/globals.css` (with blue-orange color-blind overrides) and exposed in `lib/theme.ts`.
- Integrated into `components/TradeChart.tsx` and `components/TradeDetail.tsx`: derives same-instrument levels snapshot from `lib/levels.ts`, wired view-options toggle "Session levels" (on by default), and verified `takeScreenshot(true)` inclusion in headless Chrome at 390×844 (`scripts/check-session-levels.mjs`).
- Next is `PS-1` (Planning-session model and store, `mogmine-plans-v1`).

### 2026-11-22 — Codex — LV-1 (#26), recurring review 20261122T170003Z, Core math lane released

- GitHub merged TD-3 in PR #153 at `0c2196f`. PR #152 incorporates that commit, keeps both branches' handoffs, and covers the LV-1 calculations in docs/24 §5.
- The combined checkout passed 424 tests and 96 targeted tests with `TZ=Pacific/Auckland`. Typecheck and diff checks passed, lint reported one existing PostCSS warning, the build generated 8/8 pages, and the Chrome pixel test passed.
- Next is LV-2. Feed `SessionLevelsPrimitive` the same-instrument LV-1 snapshot. Test proxy settlement, withheld levels when a native bar is missing, view-toggle state and unchanged zoom across timeframes, and legible labels in a 390×844 Trade Card PNG. Keep the exchange calendar under OD-35.

### 2026-11-22 — Codex — TD-3 (#34), recurring review 20261122T170003Z, Chart lane released

- Trade Detail, Data notes and Trade Card export share displayed-candle facts. The Canvas painter draws zones, stop steps, flags, excursion brackets and hatches from `Mark[]`. Medium detail rays follow the pane, and ‹30 and Fit toggle the leftward rays.
- `npm test` passed 415. The Auckland-time chart, mark, observer and Data-note suites passed 74. Typecheck and diff check passed. Lint reported one existing PostCSS warning. The webpack build generated 8/8 pages. The Chrome pixel test verified D-010 alpha, frameless fills, one-bar width, the trail steps and both hatches.
- Chrome at 390×844 passed 45 → 75 bars → Fit, the timeframe round trip and 1080×1350 PNG export. A same-time high correction from 7611 to 7609 removed the target-touch flag and its 09:36/09:35 Data note without replacing the canvas. Real-phone checks remain under AC-11.
- After TD-3 lands, update LV-1 (#26, draft PR #152) from `main`, check it again, and merge before starting LV-2.

### 2026-11-22 — Codex — recurring review 20261122T163003Z, Core math lane released

- The worker went idle. LV-1 (#26, draft PR #152) stays behind TD-3 under D-011. The direct-input path now withholds PDC and floor pivots without a named settlement source. The Nov 12 fixture retains its previously verified close.
- The new regression failed on the incoming calculation and passed after the fix. `npm test` passed 423, the Auckland-time checks passed 85 on LV-1 and 76 on TD-3, typecheck and diff check passed, lint reported one existing PostCSS warning, and the build generated 8/8 pages.
- `feat/td-render-pipeline` has no tracked changes beyond `main` at `4f353b7`. Chrome at 390×844 passed 45 → 75 bars, Fit, the timeframe round trip and PNG export with zero overflow or page errors. Its excursion probe found no Canvas labels where `buildMarks` produced `MAE ≈ −5.50 pts` and `MFE ≈ +9.75 pts`. Real phone verification is pending.
- Finish TD-3 using `buildMarks` and the displayed bars. Test the excursion caps, stop steps and hatches in `ex-trail` and `ex-ignored`, frameless fills in the exported screenshot, and a same-time OHLC correction on the chart and in Data notes. Refresh #152 after TD-3 lands.

### 2026-11-22 — Codex — recurring review 20261122T160003Z, Core math lane released

- LV-1 (#26) now keeps the native candle provider, ticker, calculation version and coverage together. Yahoo ticker mismatches are rejected. Dated settlement requires matching instrument and known source, and an unverified daily close is labeled `PDC (proxy)`.
- `npm test` passed 422 tests. Auckland-time level/session and chart suites passed 118 tests. Typecheck and diff check passed. Lint reported 0 errors and the existing PostCSS warning. The build generated 8/8 static pages.
- TD-3 (#34) had no tracked changes or commits beyond GitHub `main` at `4f353b7`. Its Auckland-time chart suites passed 92 tests. Local Chrome at 390×844 widened 45 → 75 bars, painted and cleared backward rays on ‹30/Fit, switched 1m → 5m → 1m, and exported a 1080×1350 PNG with zero overflow or page errors. Real phone verification is pending.
- Finish `Mark[]` painting on `feat/td-render-pipeline`. Test D-010 fill pixels, `ex-trail` stop steps and hatch, `ex-ignored` cancel and past-stop hatch, and both sides of the excursion bracket. Once TD-3 lands, refresh and check PR #152 before merging. Start LV-2 after LV-1.

### 2026-11-22 — Codex — recurring review of LV-1 (#26), Core math lane released

- Preserved the incoming worker files at `review/lv-1-worker-20261122T153555Z` (`fd5304b`). All five original tests passed, but Monday selected Sunday as its prior session, sparse bars supplied fake opens, and weekly highs used bars after the review time.
- `lib/levels.ts` and the shared session reader now use completed native bars, exact open/close anchors, and dated settlement. Regressions cover Nov 12, both DST changes, cutoffs, gaps, duplicates, hourly boundaries, and ADR 7/14 rollover.
- `npm test` passed 421 tests. With `TZ=Pacific/Auckland`, 20 level/session tests and 86 chart-mark, observer and Data-note tests passed. Typecheck, diff check and the 8-page build passed. Lint reported the existing PostCSS warning.
- `feat/lv-1-computed-levels` is queued behind TD-3 (#34) per D-011. The chart still consumes legacy box geometry plus finding flags. Finish the complete `Mark[]` painter and D-010 screenshot checks before merging LV-1. The authoritative holiday calendar stays open under OD-35.

### 2026-11-22 — Antigravity — LV-1 pure computed levels (D-011), Core math lane released
Did:      Implemented `lib/levels.ts` with pure computed levels engine (floor pivots PP/R1/S1/R2/S2, ArunKBhaskar ADR Pivots, prior Globex PDH/PDL/PDC, prior RTH levels, overnight Globex open/ONH/ONL, week high/low) and candle session extractor. All values snapped to tick size in integer ticks and float (AGENTS §3b-4). Verified against Thu 2026-11-12 worked check in docs/12 §3A and fixture `MES-2026-11-12.json`.
Files:    `lib/levels.ts` (new), `lib/__tests__/levels.test.ts` (new), `NOTES.md`.
Verified: `npm test` passed 419 tests (5 new). Typecheck and diff check clean. Lint 0 errors, 1 pre-existing warning. Local build generated 8/8 static pages.
Left:     Unblocks `LV-2` (`SessionLevelsPrimitive` canvas painter and toggle on `TradeChart.tsx`).

### 2026-11-22 — Codex — recurring review and displayed-bar findings (#35), Chart lane released

- Run `20261122T040021Z` left the TD-3 worktree's index and tracked files at `9a13989` with its ref at `4127452`. The staged inverse of PR #150 passed 414 unit tests but failed the Chrome ‹30/Fit check. Applied the merged patch to restore agreement and kept the dependency symlink and three stashes.
- Trade Detail now gives the chart and observer the same displayed bars. `buildFindingMarks` supplies dotted inferred Canvas flags, with one Data note per finding. Fetched-bar coverage still warns about gaps when displayed candles are grouped.
- `npm test` passed 414, the Auckland-time chart and observer run passed 73, typecheck and diff check passed, and lint reported 0 errors and 1 existing PostCSS warning. Build generated 8/8 pages.
- Chrome at 390×844 showed the target flag and note at 15:36Z on 1m and 15:35Z on 5m. A same-time OHLC correction removed both. Flag pixels reached the 1080px Trade Card PNG. ‹30 drew three backward rays, Fit cleared them, and the timeframe round trip kept the canvas with zero page errors or overflow.
- TD-3 (#34) still needs the general `Mark[]` painter, including D-010 plan/actual pixel checks, stop steps and hatches, both directions of the excursion bracket, and continuation as the viewport changes.

### 2026-11-22 — Codex — recurring review and backward continuation (#34), Chart lane released

- Run `20261122T033021Z` fast-forwarded `feat/td-render-pipeline` to `9a13989` and left no TD-3 source diff. The live Position Box now updates its backward rays immediately on `‹30` and `Fit`.
- `npm test` passed 414 tests. Mark, validator and observer tests passed 63 under `TZ=Pacific/Auckland`. Typecheck, lint, build and diff check passed with the existing PostCSS warning. Build generated 8/8 pages.
- Chrome at 390×844 widened 45 → 75 bars and drew three backward rays, then cleared them on Fit. Chart pixels reached the 1080px Trade Card PNG. Candle refresh and the 1m/5m round trip kept the canvas and produced zero page errors or horizontal overflow.
- TD-3 still needs a `Mark[]` Canvas painter and the D-010 screenshot check. Preserve the `‹30` / Fit round trip. For #35, compute findings from the displayed bars and use one result for chart flags and their text.

### 2026-11-22 — Codex — recurring review and TD-2 linked target labels (#34), Chart lane released

- Run `20261122T030021Z` had no source diff or TD-3 commits. The TD-2 regression expected `T2` on a repriced linked exit and got `TP`. The display list now uses the explicit target key or a matching working order ID, preserving basis.
- `npm test` passed 414 tests. Mark and observer tests passed 63 under `TZ=Pacific/Auckland`. Typecheck, lint, build and diff check passed with one existing PostCSS lint warning. Chrome at 390×844 passed the demo chart timeframe round trip and Trade Card PNG export.
- TD-3 still needs the Canvas painter, D-010 pixel checks and #35 text paired with the displayed-timeframe findings. `ex-sl` confirmed the pure `≈ TP touch` anchor at 15:36Z on 1m and 15:35Z on 5m. Changing the 15:36Z high from 7611 to 7609 removed the mark on both timeframes.

### 2026-11-22 — Claude — decision-number collisions, no lane
Did:      Two `OD-49` rows existed. The playbook-editor limits became `OD-54`; observer target attribution keeps `OD-49` (docs/15 cites it). The indicator choices that Codex's docs cited as `OD-50` are the `OD-53` row, so those docs now say `OD-53`.
Files:    `DECISIONS.md`, `NOTES.md`, `docs/16-floor-roadmap.md`, `docs/codex-indicator-summary.md`, `docs/codex-indicator-audit.md`.
Left:     Check the highest `OD-` number on `origin/main` right before adding one; two agents in parallel caused both collisions.
### 2026-11-22 — Codex — recurring review and TD-2 bracket labels (#34), Chart lane released
Did:      Reviewed run `20261122T023021Z`. The worker left no source diff or TD-3 commits. `buildMarks` now pairs excursion labels to the low and high price caps for either direction, so the Canvas painter can use the mark alone.
Files:    `lib/trade-marks.ts`, `lib/__tests__/trade-marks.test.ts`, `fixtures/trades/build-marks.golden.json`, `docs/15`, `NOTES.md`.
Verified: Short-trade regression failed on the old shape and passes on the repair. `npm test` passed 413, and the Auckland-time mark/observer run passed 62. Typecheck and diff check passed. Lint reported 0 errors and 1 existing PostCSS warning. Build generated 8/8 pages.
Verified: Chromium at 390×844 passed the existing candle refresh, timeframe switch and Trade Card PNG flow with zero overflow and no page errors.
Left:     Coordinate TD-3 in `feat/td-render-pipeline`. Paint `labels.low` at `pLow` and `labels.high` at `pHigh`. For #35, use the displayed candles for observer facts and show matching chart flags and text. `ex-sl` has its TP evidence at 15:36Z on 1m and 15:35Z on 5m.

### 2026-11-22 — Codex — recurring review and R-02 chart refresh repair, Chart lane released
Did:      Reviewed run `20261122T020021Z`. The worker left no TD-3 commits or chart changes. A same-timestamp candle correction updated OHLC but rebuilt the chart and reset its view. The series now takes refreshed bars in place and preserves the adjusted view.
Files:    `components/TradeChart.tsx`, `docs/16-floor-roadmap.md`, `NOTES.md`.
Verified: `npm test` passed 400, and the Auckland-time mark/observer run passed 62. Typecheck and diff check passed. Lint reported 0 errors and 1 existing PostCSS warning. Build generated 8/8 pages.
Verified: Headless Chromium at 390×844 retained the extended 75-bar range, manual price scale, and canvas after a same-time OHLC correction and an append. The 1m/5m switch and Trade Card preview worked with zero overflow or page errors.
Left:     TD-3 (#34/#35) needs a pure Canvas mark painter, displayed-timeframe observer findings and matching text. Follow D-010 for the pixel checks. Coordinate with the existing `feat/td-render-pipeline` worktree.

### 2026-11-22 — Claude — discretionary calls proposal + DC-1 pure model, no lane
Did:      Owner asked how to note discretionary decisions (skip a setup, flip a signal, cut, stop placement, early profit). Wrote docs/25 (seven call kinds, reason chips, conviction, after-the-fact rule, `--call-ink` colour family, screens, hindsight grading, slices `DC-1`–`DC-7`) as `OD-52`. Built `DC-1`: `lib/calls.ts` (kinds, chips, `validateCall`, `isAfterTheFact`, `gradeCall` for Cut / Early take via `buildHindsight`, integer ticks, R from the frozen initial stop). CSS tokens only; nothing renders them yet.
Files:    `docs/25-discretionary-calls.md` (new), `lib/calls.ts` (new), `lib/__tests__/calls.test.ts` (new), `app/globals.css`, `DECISIONS.md`, `AGENTS.md`, `NOTES.md`.
Checked:  `npm test` 400 passed (9 new). Typecheck clean. Lint 0 errors, the existing warning. Build 8/8 pages. `git diff --check` clean. No UI to check at 390×844 yet.
Left:     `OD-52` needs the owner. `TD-3` is still next in the queue, then `LV-1`.

### 2026-11-22 — Claude (Opus 5.5 session) — checklist edge fix, owner direction D-011, no lane
Did:      Rule checklist (Trade Detail) and challenge playbook list are now full-width tiles with the box on the right, ~35 px from the screen edge; the owner saw a tap on the old left-edge box (23 px) slide the page away (phone back-swipe zone). Recorded the owner's goal as `D-011` (planning sessions "pre-anything", levels/indicators on the chart, after-session review) with slices in docs/24 and the queue above; data shape is `OD-51`.
Files:    `components/PitStop.tsx`, `components/ChallengeSetupSheet.tsx`, `app/globals.css`, `docs/24-planning-sessions-and-after-session-review.md` (new), `DECISIONS.md`, `AGENTS.md`, `NOTES.md`.
Checked:  Headless Chrome at 390×844 and 1280×900: boxes at 32–38 px from the right edge, row height 48 px, tapping the label toggles the box and updates the `n/4 followed` seal, 0 overflow, 0 page errors. Edge audit of Today, Feed, Review, Tune, Trade Detail: 0 overflow, no target under 40 px; edge controls on Trade Detail logged for `UI-2`. Not verified on a phone.
Left:     `TD-3` is next, then `LV-1`. Agents' in-flight branches were not touched.

### 2026-11-22 — Codex — reviewed idle run and repaired TD-1 hindsight (#35), Core math lane released
Did:      Run `20261122T013000Z` left no changes. Reviewed the TD-2 merge and reproduced the missing `ex-nottaken` bar evidence. `observeTrade` now reports inferred first level touches through cancellation, with gaps and same-bar ambiguity preserved (OD-50).
Files:    `lib/trade-bar-validation.ts`, `lib/__tests__/trade-observer.test.ts`, `docs/15`, `DECISIONS.md`, `NOTES.md`.
Verified: `npm test` passed 382. `TZ=Pacific/Auckland node --test lib/__tests__/{trade-observer,trade-marks}.test.ts` passed 62. Typecheck and diff check passed. Lint reported 0 errors and 1 existing PostCSS warning. Local build generated 8/8 static pages.
Left:     Split TD-3 into a Canvas painter slice and a chart integration slice. Check `ex-trail`, `ex-ignored`, `ex-sl` at 390×844 and 1m/5m, including D-010 screenshot pixels, exact evidence-bar flags and matching under-chart text. Issue #35 is still open.

### 2026-11-22 — Codex — reviewed TD-2 (#34), Chart lane released
Did:      Reviewed run `20261122T010010Z` and repaired TD-2 on `feat/td-2-build-marks`. The mark builder uses real bar opens, retains observer evidence, terminates cancelled plans at cancellation, preserves Shield, and follows D-010 and OD-32.
Files:    `lib/trade-marks.ts`, `lib/trade-document.ts`, `lib/trade-bar-validation.ts`, `lib/trades.ts`, `lib/__tests__/trade-marks.test.ts`, `fixtures/trades/build-marks.golden.json`, `docs/15`, `docs/16`, `DECISIONS.md`, `NOTES.md`.
Verified: `npm test` passed 375 tests. `TZ=Pacific/Auckland` mark and observer tests passed 55. Typecheck and diff check passed. Lint reported 0 errors and 1 existing PostCSS warning. The local build generated 8/8 static pages.
Left:     TD-3 needs a Canvas painter, inferred finding text equivalents (#35) and the D-010 screenshot check at 390×844. The `ex-nottaken` observer still needs separate hypothetical hindsight for entry touch, same-bar ambiguity and the cancellation cutoff.

### 2026-11-22 — agent (Antigravity) — TD-2 buildMarks pure display list (#34), Chart lane released
Did:      Implemented `buildMarks(derived, facts, timeframe, detail, shield, options)` in `lib/trade-marks.ts` (docs/15 §3.4, issue #34, D-010 fills-only look: no purple, faint red/green plan fills, actual band / scratch line, stepped stop path, excursion bracket, observer findings, entry/exit flags, locked profit/past stop hatches, hindsight continuation). Implemented `snapTime` with B-23 bar snapping and bounded tolerance. Added unit and golden tests across 1m and 5m for all 7 fixtures in `lib/__tests__/trade-marks.test.ts`.
Files:    `lib/trade-marks.ts` (new), `lib/__tests__/trade-marks.test.ts` (new), `NOTES.md`.
Verified: `npm test` passed 363 tests; `npm run typecheck` clean; `npm run lint` 0 errors, 1 pre-existing warning; `NEXT_TELEMETRY_DISABLED=1 npm run build` generated 8/8 routes; `git diff --check origin/main...HEAD` clean.
Left:     Unblocks `TD-3` (Issue #34 canvas part: `PositionBoxPrimitive` painting `Mark[]` with Canvas flags, text equivalents, and D-010 screenshot check).

### 2026-11-22 — Codex — TD-2 worker review and TD-1 repair, Core math lane released
Did:      Reviewed run `20261122T003028Z`. `feat/td-2-build-marks` at `961b2b9` contains the Chart lane claim. Reproduced the TD-1 false finding for a same-price target when an anonymous fill preceded a fill with an explicit order ID. The repair reserves linked fill quantity within each working segment (OD-49).
Files:    `lib/trade-document.ts`, `lib/__tests__/trade-observer.test.ts`, `docs/15-trade-document-and-render-grammar.md`, `DECISIONS.md`, `NOTES.md`.
Verified: TD-2 baseline had 347 passing tests. On the repair, `npm test` passed 352, `TZ=Pacific/Auckland node --test lib/__tests__/trade-observer.test.ts` passed 32, and typecheck passed. Lint had 0 errors and 1 existing PostCSS warning. `NEXT_TELEMETRY_DISABLED=1 npm run build` generated 8/8 static pages. Diff check passed.
Left:     Resume TD-2 (#34) from current `main`, retaining the worker's topic commit. Add 1m/5m goldens for all seven fixtures, with missing-bar alignment and inferred finding provenance. TD-3 still needs the Canvas flags, equivalent text and D-010 screenshot check. `ex-nottaken` plan hindsight still needs an observer fact contract for the hypothetical plan.

### 2026-11-22 — Codex — reviewed TD-1, Core math lane released
Did:      Reproduced and fixed false target findings for orderless exits and shared target prices, the exact four-tick boundary for decimal contracts, and fill findings against a forming bar on open trades. Same-price allocation remains an interim rule under OD-49.
Files:    `lib/trade-bar-validation.ts`, `lib/trade-document.ts`, `lib/trades.ts`, `lib/__tests__/trade-observer.test.ts`, `docs/15-trade-document-and-render-grammar.md`, `DECISIONS.md`, `NOTES.md`.
Checked:  `npm test` passed 347 tests. `TZ=Pacific/Auckland node --test lib/__tests__/trade-observer.test.ts` passed 27 tests. Typecheck passed, lint reported 0 errors and 1 existing PostCSS warning, the build generated 8/8 pages, and `git diff --check origin/main` passed.
Left:     TD-2 (#34) needs 1m and 5m mark goldens for all seven fixtures. Carry observer findings into flags with their inferred basis, exact bar and price. TD-3 needs dotted `≈` marks, a matching text equivalent, and a screenshot check of the D-010 fills-only design.
### 2026-11-22 — Codex — session indicators and trend math, Core math lane released
Did: Added point-in-time VWAP, POC/value area, prior-day, overnight and week-to-date extremes, dated settlement, and trend/level distances. Uses regular New York hours and an explicit anchor. Interim profile and trend choices are in `OD-50`.
Files: [Indicator summary](docs/codex-indicator-summary.md#files-changed) and [audit](docs/codex-indicator-audit.md).
Checked: `npm test` 342 passed, 0 failed. Indicator tests under `TZ=Pacific/Auckland` 13 passed. Typecheck exited 0, lint had 0 errors and the existing PostCSS warning, and diff check exited 0.
Left: Supply session coverage and freeze the entry snapshot before wiring the chart and card. The audit details candle-only autoscale and off-frame flags. Work is local on `codex/indicator-level-trend-math`.

### 2026-11-21 — Claude (Opus 5.5 session) — R-07a + R-07b playbook store and editor, Data lane released
Did:      `lib/playbooks-store.ts` (`mogmine-playbooks-v1`, seeds, `user_id`, archive-only, validation, backup round-trip) and Tune → Playbooks (`components/PlaybookEditor.tsx`: add, rename, default style, add/reorder/remove rules, archive/restore). Pickers, stats labels, rows and Clean Run setup read the store. Samples stay on seed rules. Open choices recorded as `OD-54`.
Files:    `lib/playbooks.ts`, `lib/playbooks-store.ts` (new), `lib/store.ts`, `lib/fixtures.ts`, `lib/__tests__/playbooks-store.test.ts` (new), `components/PlaybookEditor.tsx` (new), `components/{TuneScreen,AppShell,PitStop,ChallengeSetupSheet,TradeRow,RunningStatsCard}.tsx`, `app/globals.css`, `docs/16`, `DECISIONS.md`, `NOTES.md`.
Checked:  `npm test` 329 passed, 0 failed. Typecheck clean, lint 0 errors and the existing warning, build 8/8. Headless Chrome at 390×844 and 1280×900, 26/26 checks: seeds listed, clash message, add/reorder/save (pending rule kept), `user_id` in storage, archive/restore, `no-setup` locked, rename shown on Feed, 0 overflow, 44px targets, 0 page errors.
Left:     Phone check still owed (`AC-11`). `CD-3` is unblocked once the worker's TD queue allows. `OD-54` needs the owner.

### 2026-11-21 — agent (Antigravity) — TD-1 observeTrade pure observer (#35), Core math lane released
Did:      Implemented `observeTrade(derived, candles, barMinutes, options)` in `lib/trade-bar-validation.ts` (docs/15 §3.3, issue #35): checks each stop segment traded through, unfilled targets touched before exit, fills outside bar with `DEFAULT_TICK_TOLERANCE_TICKS = 4` (B-12), honest MFE/MAE excursions, and post-exit hindsight touches. Preserved `validateTradeAgainstBars` compatibility. Added golden unit tests in `lib/__tests__/trade-observer.test.ts`.
Files:    `lib/trade-bar-validation.ts`, `lib/__tests__/trade-observer.test.ts` (new), `NOTES.md`.
Verified: `npm run typecheck` clean; `npm run lint` 0 errors, 1 pre-existing warning; `npm test` 328 passed, 0 failed; `npm run build` generated 8/8 pages.
Left:     Unblocks `TD-2` (Issue #34 pure part: `buildMarks` display list with D-010 fills-only look & golden tests).

### 2026-11-21 — Codex — reviewed R-08b, App shell and notes lane released
Did:      Finished the Today stats card with accessible windows, all-time breakdowns, priced denominators, missing-R counts and Shield. OD-47 now covers how undated legacy trades affect accounts, challenges and Trade Detail.
Files:    `components/RunningStatsCard.tsx`, Today and companion views, account and challenge calculators, candle retry, duration formatter, tests, and specs.
Checked:  `npm test` 320 passed, `TZ=Pacific/Auckland` stats tests 14 passed, typecheck passed, lint 0 errors and 1 existing PostCSS warning, build 8/8 pages, and diff check passed. Chromium at 390×844 and 1280×900 exercised the fixture states, Shield, keyboard controls, undated trade paths, and zero overflow or page errors. Not verified on a phone.
Left:     `TD-1` (issue #35 pure observer) is next. For OD-47 recovery, a backup built from an undated device record still fails its own restore validation. Keep that follow-up scoped to safe exit-date repair and backup round-tripping.

### 2026-11-21 — agent (Antigravity) — R-08b running stats card view, App shell and notes lane released
Did:      Implemented `RunningStatsCard` and embedded it on `TodayScreen`. Added time-window tab switcher (Last 20, This Week, This Month, All-Time), gross P&L display with Shield protection, priced/unpriced incomplete handling, skipped R and scratch tracking, rule adherence, breakdown toggles for Playbook and Tag, and footer notes for undated/open/sample exclusions. Added styling in `app/globals.css` and tests in `lib/__tests__/running-stats-view.test.ts`.
Files:    `components/RunningStatsCard.tsx`, `components/TodayScreen.tsx`, `app/globals.css`, `lib/__tests__/running-stats-view.test.ts`, `NOTES.md`.
Verified: `npm test` 316 passed, 0 failed; `npm run typecheck` passed; `npm run lint` 0 errors, 1 existing PostCSS warning; `npm run build` generated 8/8 routes.
Left:     Unblocks `TD-1` (Issue #35 pure part: `observeTrade(derived, candles, barMinutes)`).

### 2026-11-21 — Codex — reviewed R-08a, Core math lane released
Did:      Reviewed the 21:30 UTC worker changes against docs/16 and #61. Required an explicit clock for the session windows, counted each trade once per tag, and kept closed trades with invalid exit dates in all-time totals (OD-47). The final API reports `skippedRCount` for every null R.
Files:    `lib/selectors.ts`, `lib/__tests__/running-stats.test.ts`, `docs/16-floor-roadmap.md`, `DECISIONS.md`, `NOTES.md`.
Checked:  `npm test` 313 passed. The running stats tests also passed 10/10 under `TZ=Pacific/Auckland`. Typecheck passed, lint had 0 errors and the existing PostCSS warning, build generated 8/8 pages, and the diff check passed.
Left:     `R-08b` should pass the current instant to `runningStats(trades, now)` and show gross P&L, priced denominator, skipped R and undated counts. Verify empty and incomplete states, Shield, and the layout at 390×844 and desktop.

### 2026-11-21 — Codex — whole-project implementation review, no lane
Did:      Added [project-wide review notes](docs/16-floor-roadmap.md#4-project-review-and-follow-ups) for journal recovery, candle coverage, the phone workflow, review and stats, trade facts, and scheduled merges. Aligned the `R-05` intro with docs/22.
Files:    `docs/16-floor-roadmap.md`, `DECISIONS.md`, `NOTES.md`.
Checked:  `npm test` 303 passed, 0 failed. Typecheck passed, lint had 0 errors and 1 existing PostCSS warning, and build generated 8/8 pages. A Node storage simulation reproduced the lost note and confirmed the blocked-write state. GitHub returned `protected: false` and `[]` for `main` rules. `git diff --check` and 21 added links passed.
Left:     Proposals for owner review. The pending-note loss and the remaining `MD-1` acceptance checks have concrete repro or code references in docs/16 §4.

### 2026-11-21 — Codex — card implementation review, no lane
Did:      Left [review notes](docs/23-card-system.md#9-review-notes-for-future-slices) on prepared exports, Shield, blind chart cutoffs, drill feedback and statistics, empty decks, and scheduled handoffs. Logged the crop conflict as `OD-48`.
Files:    `docs/23-card-system.md`, `DECISIONS.md`, `NOTES.md`.
Checked:  `git diff --check` passed. Checked 12 added local links and their heading anchors.
Left:     `CD-1a` can use the current visible chart under `AC-10`. The crop waits for `OD-48`.

### 2026-11-21 — agent (Antigravity) — R-08a pure running stats, Core math lane released
Did:      Implemented `summarizeTrades`, `sessionWeekMonday`, and `runningStats` in `lib/selectors.ts` per docs/16 §R-08 / Active No-Supabase Queue item 1. Computes rolling windows (last 20, this week, this month), per-playbook, and per-tag stats. Always excludes `is_sample` and `open` trades; skips trades with no stop from R totals and tracks `skippedWithNoStop` without zeroing; reports gross figures only. Added tests in `lib/__tests__/running-stats.test.ts`.
Files:    `lib/selectors.ts`, `lib/__tests__/running-stats.test.ts` (new), `NOTES.md`.
Verified: `npm test` 309 passed, 0 failed; `npm run typecheck` clean; `npm run lint` 0 errors, 1 pre-existing warning; `npm run build` passed (8/8 routes generated).
Left:     Unblocks `R-08b` (Running stats UI screen/card on Today or `/feed`, Shield-safe, gross-labelled).

### 2026-11-21 — Claude (Haiku 5.5 session) — lessons from the card-system work, no lane
Did:      Wrote and merged the card spec (`docs/23`, PR #130), `OD-46`, and the `CD-1`–`CD-3` queue entries. Added the lessons below to `CONTRIBUTING.md` §4 so they outlive this session.
Learned:  (1) GPT and Codex runners read `origin/main` only. Work left in a local checkout was invisible to them, and the spec would have been lost to them without a PR. (2) A file changed on disk while I was editing `docs/23`. It was committed as found, but its content was not checked line by line against the draft. Re-read `docs/23` before building `CD-1a`. (3) `git branch -vv` showed several old local branches and a worktree (`mogmine-work.JBhofO`). Check them before reusing a branch name.
Files:    `docs/23-card-system.md`, `CONTRIBUTING.md`, `NOTES.md`.
Left:     Owner decisions in `OD-46` (letter grade, defaults). Next queue item is `MD-1`, then `CD-1a`.

### 2026-11-21 — Claude — card system spec (`docs/23`), no lane
Did:      Owner asked how to improve Trade Cards and whether to add playbook and practice cards. Wrote docs/23: shared card frame, Trade Card refresh (`CD-1`), drill / flash cards built on BET-03 (`CD-2`), playbook card (`CD-3`), later day / plan / mistake / week cards, and uses. Opened `OD-46` with interim rules so `CD-1`/`CD-2` are not blocked.
Files:    `docs/23-card-system.md` (new), `DECISIONS.md`, `AGENTS.md`, `docs/03-trade-cards-and-note-taking.md`, `docs/16-floor-roadmap.md`, `NOTES.md`.
Checked:  Docs only. Relative-link check and `git diff --check` (output in the PR).
Left:     `CD-1a` follows `MD-1` in the queue. `OD-46` (c) letter grade needs the owner; do not invent one.

### 2026-11-21 — Codex — reviewed the scheduled maintainer, no lane
Did:      Inspected the host timer, runner and run reports. Four half-hour worker and reviewer runs landed Challenges in PRs #125–#128.
Files:    `NOTES.md`.
Checked:  `systemctl --user show` reported an active, enabled timer and a successful 21:00 UTC run. The worker checkout returned 303 passing tests and 0 failures. `gh pr checks 128` reported two Vercel passes. The GitHub branch and rules APIs returned `protected: false` and `[]` for `main`.
Left:     The runner expects the local-first queue, which is in this checkout’s roadmap edits and was absent from `origin/main` at review time.

### 2026-11-21 — agent (Antigravity) — post-R-09d local-first queue & roadmap update, no lane
Did:      Updated `NOTES.md` and `docs/16-floor-roadmap.md` to reflect merged `R-03b`/`R-03c`/`R-09a`–`R-09d`/`R-10`/`#124` and define an ordered, ~250–450-LOC no-Supabase queue aligned with `docs/22`: `R-08a`–`b` (running stats), `TD-1`–`TD-3` (`docs/15` `observeTrade`/`buildMarks`/`PositionBoxPrimitive` under `D-010`), `R-07a`–`b` (local playbook store/editor), `UI-1`–`UI-3` (`docs/19`, `OD-40`, `OD-39` c), and `MD-1` (`#90`).
Files:    `NOTES.md`, `docs/16-floor-roadmap.md`.
Checked:  Relative links, `git diff --check`, `npm run typecheck && npm run lint && npm test && npm run build`.
Left:     Start with `R-08a` (pure cross-day & playbook/tag running stats in `lib/selectors.ts`). Keep `R-04`–`R-06` paused until Supabase keys exist (`docs/22`).

### 2026-11-21 — Codex — reviewed R-09d, App shell and notes lane released
Did:      Reviewed the worker's uncommitted detail route against docs/17 and #80. Fixed saved drawdown row values, deciding labels for unavailable trades, end-time comparison, direct-route finalization, and neutral drawdown accents. Added a Today history link for manually ended attempts (OD-45).
Files:    `app/challenges/[id]/page.tsx`, `app/globals.css`, `components/ChallengeCard.tsx`, `components/ChallengeDetail.tsx`, `docs/17-challenges.md`, `DECISIONS.md`, `NOTES.md`.
Verified: `npm test` 303 passed, 0 failed. `npm run typecheck` passed. `npm run lint` 0 errors, 1 existing PostCSS warning. `npm run build` generated 8/8 pages and included the dynamic challenge route. Local Chromium at 390×844 passed Today navigation and restart, saved breach after edit/deletion, post-end cutoff, Shield, Clean Run shapes and issue links, manual end/cancel/reopen, direct-route pass, and missing route. Zero horizontal overflow and page errors.
Left:     R-09d is complete. The floor roadmap and owner decisions govern subsequent work.

### 2026-11-21 — agent (Antigravity) — R-09d challenge detail screen (`/challenges/[id]`), App shell and notes lane released
Did:      Built `components/ChallengeDetail.tsx` and dynamic route `app/challenges/[id]/page.tsx` (docs/17 §6: headline metrics, inline SVG step path for equity and floor, Clean Run dot history with shapes/colors, scored trades list with deciding trade badge, issues list with trade fix links, fine print disclosures, manual end confirmation with frozen final result, post-end edit difference detection, and past attempts list). Wired whole-row links in `components/ChallengeCard.tsx` while keeping grading links and actions distinct. Added detail styling in `app/globals.css`.
Files:    `app/challenges/[id]/page.tsx` (new), `components/ChallengeDetail.tsx` (new), `components/ChallengeCard.tsx`, `app/globals.css`, `NOTES.md`.
Verified: `npm test` 303 passed, 0 failed; `npm run typecheck` clean; `npm run lint` 0 errors, 1 existing PostCSS warning; `npm run build` 8/8 static/dynamic routes; `git diff --check origin/main` clean. Headless Chromium at 390×844: verified Today whole-row navigation, Drawdown step line & floor, Clean Run dot shapes, deciding trade label, trade difference banner after post-end edit, issue links to trade details, manual end confirmation & cancellation, Shield mode ($ masking), zero horizontal overflow (`scrollWidth === clientWidth === 390`), zero page errors.
Left:     R-09 suite (a–d) is now feature complete. Next planned priorities are `R-04` (candle archive activation/rebase) or `R-03b`/`R-03c` (open trades).

### 2026-11-21 — Codex — reviewed R-09c, App shell and notes lane released
Did:      Freeze pass/fail, enable retry with prior rules, show provisional and grading states, wrap long dot rows, and validate whole-number targets. Documented completed-row visibility in OD-44.
Files:    `components/ChallengeCard.tsx`, `components/ChallengeSetupSheet.tsx`, `components/TodayScreen.tsx`, `lib/ui.ts`, `app/globals.css`, `docs/17-challenges.md`, `DECISIONS.md`, `NOTES.md`.
Verified: Local Chromium at 390×844 reported all Today states with Shield on/off, grading link, 50 dots, setup validation, focus trap, frozen pass/fail, restart, blocked storage, 44px targets, zero overflow and zero page errors.
Left:     R-09d adds the detail route, whole-row navigation, scoring history, and manual end confirmation.

### 2026-11-21 — agent (Antigravity) — R-09c Today challenge card & setup sheet (docs/17), App shell and notes lane released
Did:      Built `components/ChallengeCard.tsx` (Drawdown Defender bar/estimate/close/breach/Shield/passed/failed states, Clean Run gold process dots, single/multi active rows, storage blocked banner fallback) and `components/ChallengeSetupSheet.tsx` (Drawdown and Clean Run presets, plain rule sentence, validation). Wired into `components/TodayScreen.tsx` (suppressed when only sample trades exist per docs/17 §6). Added reactive `now` to `lib/ui.ts` `useToday`.
Files:    `components/ChallengeCard.tsx` (new), `components/ChallengeSetupSheet.tsx` (new), `components/TodayScreen.tsx`, `lib/ui.ts`, `app/globals.css`, `NOTES.md`.
Checked:  `npm test` 303 passed, 0 failed; `npm run typecheck` clean; `npm run lint` 0 errors, 1 existing PostCSS warning; `npm run build` 8/8 static pages; `git diff --check origin/main` clean. Headless Chrome at 390×844: verified sample trade suppression, start challenge link, setup sheet validation, Drawdown submission, meter & close warnings, Clean Run dots, Shield mode ($ masking), storage blocked warning banner, zero horizontal overflow (`scrollWidth === clientWidth === 390`).
Left:     Unblocks `R-09d` (detail screen `/challenges/[id]`).

### 2026-11-21 — Codex — reviewed R-09b, Data lane released
Did:      Fixed legacy and challenge-only restores, duplicate active imports, frozen results, and validation. The local store exposes whether storage succeeded.
Files:    `lib/challenge-store.ts`, `lib/__tests__/challenge-store.test.ts`, `lib/store.ts`, `components/AppShell.tsx`, `components/TuneScreen.tsx`, `docs/17-challenges.md`, `NOTES.md`.
Checked:  `npm test` 303 passed, 0 failed; `npm run typecheck` clean; `npm run lint` 0 errors, 1 existing PostCSS warning; `npm run build` 8/8 static pages; `git diff --check` clean. Local 390×844 Tune restore smoke passed.
Left:     R-09c can wire the Today card and setup sheet. Test Shield on/off, session-only storage fallback, and every state in docs/17 §6.

### 2026-11-21 — agent (Antigravity) — R-09b challenge store & backup/restore (docs/17), Data lane released
Did:      Built `lib/challenge-store.ts` (`mogmine-challenges-v1`, enforces <= 1 active challenge of each kind, final freeze on end, sanitization, backup export & restore) and tests in `lib/__tests__/challenge-store.test.ts`. Added optional `challenges` field to `JournalBackup` and `buildBackup`/`parseBackupFile` in `lib/store.ts`, connected restore and export in `components/TuneScreen.tsx`, and hydrated in `components/AppShell.tsx`.
Files:    `lib/challenge-store.ts` (new), `lib/__tests__/challenge-store.test.ts` (new), `lib/store.ts`, `components/TuneScreen.tsx`, `components/AppShell.tsx`, `NOTES.md`.
Checked:  `npm test` 301 passed, 0 failed; `npm run typecheck` clean; `npm run lint` 0 errors, 1 existing PostCSS warning; `npm run build` 8/8 static pages; `git diff --check origin/main` clean.
Left:     Unblocks `R-09c` (Today card and setup sheet).

### 2026-11-21 — Codex — reviewed R-09a, Core math lane released
Did:      Kept drawdown breaches provisional with missing prices, froze the scored path at the breach, corrected the Clean Run deciding trade after a reset, and counted only positions overlapping the start for the exclusion disclosure.
Files:    `lib/challenges.ts`, `lib/__tests__/challenges.test.ts`, `docs/17-challenges.md`, `NOTES.md`.
Checked:  `npm test` 295 passed, 0 failed; `npm run typecheck` clean; `npm run lint` 0 errors, 1 existing PostCSS warning; `npm run build` 8/8 static pages; `git diff --check origin/main` clean.
Left:     R-09b can build local persistence and backup/restore against the evaluator contract.

### 2026-11-21 — agent (Antigravity) — R-09a challenge evaluator (docs/17), Core math lane
Did:      Built `lib/challenges.ts` (pure evaluation engine for Drawdown Defender and Clean Run; integer cents, session assignment, provisional states, no broker enforcement or AI scoring) and comprehensive test suite `lib/__tests__/challenges.test.ts`.
Files:    `lib/challenges.ts` (new), `lib/__tests__/challenges.test.ts` (new), `NOTES.md`.
Checked:  `npm run typecheck`, `npm run lint` (0 errors, 1 pre-existing warning), `npm test` (292 pass), `npm run build` (8/8 static).
Left:     Unblocks `R-09b` (`lib/challenge-store.ts`, backup/restore).

### 2026-11-21 — Codex — recovered timed-out issue #33 review, Core math lane
Did:      Replaced bracket inference by event adjacency with an explicit opening fill reference (OD-43), validated event payloads, preserved legacy metadata, and prevented inferred stop exits at cancelled stops.
Files:    `lib/trade-document.ts`, `lib/__tests__/trade-document.test.ts`, two bracket fixtures, docs/15, DECISIONS.md, NOTES.md.
Checked:  `npm test` 288 passed and 0 failed, `npm run typecheck` clean, `npm run lint` 0 errors and 1 existing PostCSS warning, `npm run build` 8/8 static pages, `git diff --check origin/main` clean.
Left:     OD-43 source mapping to confirm if broker support resumes.

### 2026-11-21 — agent (Antigravity) — cycle 2 review & regression fixes (#33), Core math lane
Did:      Fixed initial R to capture stop in force at entry fill even when pre-entry stop was modified (docs/15 §3.3). Changed `fromLegacy` stop modify/cancel events to `basis: "inferred"` because legacy records don't store post-freeze edit timestamps. Added regression tests for both.
Files:    `lib/trade-document.ts`, `lib/__tests__/trade-document.test.ts`, `NOTES.md`.
Checked:  `npm test` (286 passed, 0 failed), `npm run typecheck`, `npm run lint` (0 errors, 1 pre-existing warning).
Left:     Unblocks #34 (`buildMarks` display list) and #35 (`observeTrade`).

### 2026-11-21 — agent (Antigravity) — issue #33 (`deriveTrade`, `fromLegacy`, `mogmine.trade.v1`), Core math lane
Did:      Built `lib/trade-document.ts` (pure, no I/O, no candles, no DB tables per `OD-30`): `mogmine.trade.v1` types, `deriveTrade(doc, spec)` (FIFO integer-tick P&L, B-32 initial risk against first stop in force, D-010 scratch 0.1R/2-tick rule, stepped stop path with widened/locked flags, working orders, planned R:R per target, `void` exclusion, `stop_removed_while_open`/`exit_past_stop` facts, non-throwing structural errors) and `fromLegacy(record)` (zero-loss conversion incl. R-10 moved stops, R-03 open trades, exact-match exit reason inference).
Files:    `lib/trade-document.ts`, `lib/__tests__/trade-document.test.ts` (new), `docs/15-trade-document-and-render-grammar.md`, `NOTES.md`.
Checked:  Golden tests for all 7 `fixtures/trades/*.json`, scratch thresholds, short/MCL/scale-in/void/fees, structural errors, and `fromLegacy` parity across all `demoTrades`; typecheck, lint, test, build.
Left:     Unblocks #34 (`buildMarks` + marks painter), #35 (`observeTrade`), and #36 (stop path UI). No Supabase or persistence changes (per docs/22 & `OD-30`).

### 2026-11-20 — agent (Grok Bot) — accounts merged after price-first entry: renumbered to docs/21, OD-42
Did:      Merged main (#119 price-first entry, #120 design guide) into `feat/accounts-running-total`. Both used docs/20 and `OD-41`; the price-first change merged first, so accounts is now `docs/21-accounts-and-running-totals.md` and `OD-42`, with every reference moved (AGENTS, README, DECISIONS, NOTES, docs/06, docs/17, code comments). The account picker sits under Side and Status on the price-first sheet; `EntryDraft` carries `accountId`.
Checked:  typecheck, lint (0 errors, 1 pre-existing warning), test (261 pass), build. Headless Chrome 390×844: picker lists the account, a saved trade gets `account_id` and its frozen stop, the Today card adds it; no overflow. **Not verified on a phone.**
Left:     `OD-42`; docs/21 §6 step 4 (Drawdown Defender as an account rule).

### 2026-11-20 — agent (Grok Bot) — times from the bars (docs/20 §2.2, OD-41 (5)), App shell + Market data lanes
Did:      Owner asked for OD-41 (5) now and OK'd native pickers. `lib/infer-times.ts` (`inferTradeTimes`: entry stretches, consistency with exit and stop, hint / RTH / earliest, exit bar, stop-or-target-first flag, exact/ambiguous/none, approximate on coarse bars), `lib/infer-message.ts`, day mode on `/api/market-data` (`from`/`to`), `loadDayCandles` with IndexedDB cache and the R-02 one-minute rule. Sheet: "Finding your fill in the bars…" then fills untouched pickers; hand-set times kept with a "Use …" button; Retry on no bars / offline.
Files:    `lib/infer-times.ts`, `lib/infer-message.ts` (new), `lib/candles.ts`, `lib/entry-form.ts`, `app/api/market-data/route.ts`, `components/AddTradeSheet.tsx`, `app/globals.css`, `lib/__tests__/infer-times.test.ts` (new); docs/20, `DECISIONS.md` (`OD-41`).
Checked:  typecheck, lint (0 errors, 1 pre-existing warning), test (239 pass), build. Headless Chrome 390×844 with live Yahoo 1m bars for 2026-11-19: exact, ambiguous, hand-set, no-match and offline states; no overflow. **Not verified on a phone.**
Left:     `OD-41` (1), (3), (4) and the tie-break / previous-evening questions on (5). The finder line shows 24-hour times while iOS pickers show 12-hour.

### 2026-11-20 — agent (Grok Bot) — price-first entry + price-axis stretch (docs/20), App shell + Chart + Core math lanes
Did:      Owner phone feedback. Add-trade sheet leads with side, status and a price ladder (Entry, Exit, Stop, Target) with one-tick `−`/`+` steppers; date + time pickers with Now buttons below; overnight exit read as next day. `R-10` itself came from #118 (merged into this branch, its `stopPatch` is the one implementation); this branch adds only `keepInitialStop` on backup restore and a valid-pair check in `parseTradeItem`. Chart: floating `‹`/`›` edge buttons removed (the right one sat on the price axis); `‹30` `30›` now in the toolbar. Transparent grip over the price axis: drag stretches/compresses, double-tap/double-click auto-fits, wheel works.
Files:    `lib/entry-form.ts`, `lib/price-scale.ts` (new), `lib/trades.ts`, `lib/store.ts`, `lib/format.ts`, `components/AddTradeSheet.tsx`, `TradeChart.tsx`, `TradeDetail.tsx`, `TradeLevelEditor.tsx`, `RiskChips.tsx`, `app/globals.css`, tests `price-first-entry.test.ts`, `price-scale.test.ts`; docs/20 (new), docs/06, 08, 15, 16, `DECISIONS.md` (`OD-41`), `AGENTS.md`.
Checked:  typecheck, lint (0 errors, 1 pre-existing warning), test (222 pass), build. Headless Chrome 390×844 with touch emulation: no overflow, targets ≥ 44 px, axis drag stretches without page scroll, chart-body vertical swipe still scrolls, horizontal pan works; mouse at 1280×900. **Not verified on a phone.**
Left:     `OD-41` (next-day rule, undo vs frozen initial stop, right-edge scroll trade-off, times suggested from candles later). docs/19 + `OD-40` are on unmerged `docs/19-design-guide`, hence docs/20 / `OD-41`.

### 2026-11-20 — agent (Claude Code) — design guide from the owner's mockups, no lane
Did:      Saved the owner's phone and desktop trade screen mockups to `docs/design/` and wrote `docs/19-design-guide.md`: what they show, a map to built and planned work, four conflicts with decisions on record (gold, "Market Live", "Set Trade", tab names), opened as `OD-40`, and where the Mood Shape fits (entry-time tap for `OD-39` (c)). Documentation only.
Files:    `docs/19-design-guide.md`, `docs/design/mockup-phone-trade.png`, `docs/design/mockup-desktop-trade.png`, `DECISIONS.md`, `AGENTS.md`, `README.md`, `NOTES.md`.
Checked:  Relative links and image paths resolve. No code changed.
Left:     `OD-40` and `OD-39` need the owner. Suggested build order is docs/19 §5.

### 2026-11-20 — agent (Claude Code) — accounts steps 2–3: Today card, add/edit sheet, picker (docs/21), App shell lane
Did:      `AccountCards` on Today (balance, high, today, balance line with floor, room before limit, daily room, target, Match broker balance, History), `AccountSheet` (name, start, optional target / loss limit / daily loss / how the limit moves; archive with Undo), `AccountSelect` in the entry form (defaults to the last account) and on Trade Detail. `formatBalance`, `formatCents` in `lib/format.ts`. Shield hides every dollar on the card.
Files:    `components/AccountCard.tsx`, `AccountSheet.tsx`, `AccountSelect.tsx` (new), `TodayScreen.tsx`, `AddTradeSheet.tsx`, `TradeDetail.tsx`, `lib/format.ts`, `app/globals.css`, `docs/21`, `NOTES.md`.
Checked:  typecheck, lint (0 errors), 219/219 tests, build. Headless Chrome 390×844: add account → log MES 2 × +10 pts → card shows $50,100.00, room $2,100.00 (end-of-day trailing, floor $48,000), today +$100.00; a $50,095.50 broker balance records −$4.50; Shield shows no dollars; no overflow; no console errors. Not checked on a real phone.
Watch:    `app/r10-stop-at-entry` also edits `AddTradeSheet.tsx` and `TradeDetail.tsx`; my changes there are a few lines each, so a merge conflict should be small.

### 2026-11-20 — agent (Claude Code) — accounts and running totals, step 1 (docs/21), Core math lane
Did:      `lib/accounts.ts`: `TradingAccount` with per-account rules (static / trailing / end-of-session trailing loss limit, daily loss, target), `accountSummary` (balance, peak, drawdown, room, today, target, curve, ledger), balance checks as adjustments, `defaultAccountId`, sanitisers. `account_id: string | null` on `TradeRecord` (default null). `lib/accounts-store.ts` (`mogmine-accounts-v1`), hydrated in AppShell, in backups.
Files:    `lib/accounts.ts`, `lib/accounts-store.ts`, `lib/trades.ts`, `lib/store.ts`, `components/AppShell.tsx`, `components/TuneScreen.tsx`, `lib/__tests__/accounts.test.ts`, `docs/21` (new), docs/06, docs/17, `DECISIONS.md` (`OD-42`), `AGENTS.md`, `README.md`.
Checked:  typecheck, lint (0 errors, 1 pre-existing warning), 219/219 tests, build. The docs/17 §3 golden drawdown cases pass on the account engine; six hand mutations of the engine each fail at least one test.
Left:     No screen yet: steps 2–4 in docs/21 §6 (Today card, account picker, setup and rules screen). `OD-42`.

### 2026-11-19 — agent (Tappy) — R-10 stop at entry, frozen, Core math + App shell lanes
Did:      `R-10`: `TradeRecord` gains `initial_stop_price` / `initial_stop_set_at` (null on old records, never back-filled); `stopPatch()` freezes the first stop once and later edits move `stop_loss_price` only; `initialRMultiple()` added beside an unchanged `rMultiple`. `AddTradeSheet` gains an optional Stop field (existing `validateTradeInput` stop-side rule) that sets all three fields on save; `TradeLevelEditor` captures the first stop via `stopPatch` (undo restores the working stop only, never the frozen one). Trade Detail shows a quiet "Initial stop 6841.25, set 09:42" line only when the working stop differs.
Files:    `lib/trades.ts`, `lib/__tests__/initial-stop.test.ts`, `components/AddTradeSheet.tsx`, `components/TradeLevelEditor.tsx`, `components/TradeDetail.tsx`, `app/globals.css`, `docs/06-data-model-and-roadmap.md`, `docs/16-floor-roadmap.md` (R-05 planned columns), `NOTES.md`.
Checked:  typecheck clean; lint 0 errors (1 pre-existing postcss warning); test 180/180 (7 new R-10 tests); build passes. Headless Chrome at 390×844: no horizontal overflow on home, sheet or detail; saved a trade with a stop (stored stop = initial = 6841.25, set-at stamped, preview +2.0R), edited the stop to 6845 and the stored initial stayed 6841.25 with the quiet line reading "Initial stop 6841.25, set 22:36". Not verified on a phone.
Left:     PR open as do-not-merge-without-Chris. No screen switched from `rMultiple` to `initialRMultiple` (separate decision, per the step's Do-not list). Fixture/sample trades keep a null initial stop — theirs was never captured at entry.

### 2026-11-19 — agent (Claude Code) — Mood Shape (docs/18), App shell + Core math lanes
Did:      Mood Shape on the device: pure `lib/mood.ts` (`moodVector`, `moodPath`, `similarTrades`, `moodOutcomeStats`, phrase-matcher suggestions, `parseMoodSuggestion` AI contract, candidates, `addSpoke` + `rescoreForNewSpoke`), `lib/mood-store.ts` (`mogmine-mood-v1`, append-only records, in backups). UI: shape beside the R strip and a Mood card on Trade Detail, editor sheet (drag/arrow keys, Accept/Dismiss suggestions, "Add spoke?"), 40px feed thumbnails, shape kept visible in sealed blind review, Trade Card PNG, "Mood and result" card on Feed. Fixtures `ex-tp`/`ex-sl`/`ex-trail` got note events and `mood_records`; `fixtures/mood/spokes-v2.json`.
Files:    `lib/mood.ts`, `lib/mood-store.ts`, `lib/store.ts`, `lib/shareCard.ts`, `components/Mood*.tsx`, `TradeDetail`, `TradeRow`, `ReviewScreen`, `FeedScreen`, `TuneScreen`, `AppShell`, `app/globals.css`, `lib/__tests__/mood.test.ts`, fixtures, `docs/18` (new), docs/03, 06, 15, `DECISIONS.md` (`OD-39`, drift row), `AGENTS.md`, `README.md`.
Checked:  typecheck, lint (0 errors, 1 pre-existing warning), test, build. Headless Chrome at 390×844: no horizontal overflow on feed, detail, editor, review, card; handle hit targets 55px; a drag writes one `user` record; Accept writes `voice_ai` only. Not checked on a real phone.
Left:     `OD-39` (spokes, N = 3, pre-exit capture moment). No AI parser and no voice memo exist: "Suggest from notes" uses the on-device phrase matcher. No table until `OD-30`. Stats exclude samples, so on the demo journal they read "not enough data yet".

### 2026-11-16 — agent (Claude Code) — R-03c open-trade chart and candles, Chart + Market data lanes
Did:      `R-03c`: `/api/market-data` takes `exit` as optional; without it the range is entry − 15h to now and only the entry bar is required (`anchorsTradeWindow` entry-only mode when `exitMs` is null); a present but invalid `exit` is still `400`. `lib/candles.ts`: an open trade's cache is never final (the network is always asked; a payload without the entry bar keeps the cache), a loaded set refreshes every 5 min (R-02 rule), a missing set retries each minute for the first hour after entry then every 15. `TradeChart` takes any `TradeRecord`: an open trade's box runs from the entry bar to the last loaded bar, stop and target fills as before, no exit flag, no execution path, no actual band, no continuation. `PositionBoxPrimitive.exitPrice` is nullable. `buildHindsight` returns null for an open trade; the Continuation menu item is hidden for one; no exit-bar data notes. Trade Card for an open trade reads `OPEN` with no result (OD-38). `YahooFinanceProvider` drops the in-progress last row Yahoo appends during a live session (docs/10 §2).
Files:    `app/api/market-data/route.ts`, `lib/market-data/coverage.ts`, `lib/market-data/yahoo.ts`, `lib/candles.ts`, `lib/hindsight.ts`, `lib/shareCard.ts`, `components/TradeChart.tsx`, `components/PositionBoxPrimitive.ts`, `components/TradeDetail.tsx`, tests (`candle-cache`, `market-data-coverage`, `hindsight`, `open-trade`), `docs/10-yahoo-first-build-plan.md`, `NOTES.md`.
Checked:  typecheck, lint (0 errors, 1 pre-existing warning), test, build. Live `MES=F` open trade (entry 25 min ago) drawn in headless Chrome at 390×844: 45 bars visible, box to the last bar, Trade Card `OPEN`, no horizontal overflow. Not checked on a real phone.
Left:     Stacked on R-03b (#112): merge that first. Removed R-03b's interim "chart not available" note: an open trade now loads candles, and a failed load shows the normal Retry. Each 5-minute refresh rebuilds the chart, so a pan or zoom resets then (same as R-02 for fresh closed trades).

### 2026-11-16 — agent (Claude Code) — challenges design and roadmap update, no lane
Did:      Added `docs/17-challenges.md`: Drawdown Defender and Clean Run, with rules, math, golden test cases, the `lib/challenges.ts` contract, storage, the Today card, setup sheet and detail screen, and build steps `R-09a`–`R-09d`. In `docs/16`: rewrote `R-09` to point at it and unblocked it from `R-05`; added `R-10` (optional stop at entry, frozen as `initial_stop_price`); corrected the status table (open trades are in the model since `R-03a`) and marked `R-01`, `R-02`, `R-03a` merged. Restated `OD-37`. Documentation only.
Files:    `docs/17-challenges.md`, `docs/16-floor-roadmap.md`, `DECISIONS.md`, `AGENTS.md`, `README.md`, `NOTES.md`.
Checked:  Golden drawdown and Clean Run cases worked by hand; every dollar amount is a whole number of `MES` ticks. Relative links resolve. No code changed.
Left:     The owner's four `OD-37` choices. Profit-target and R-scored challenges are deferred on purpose (docs/17 §1).

### 2026-11-16 — agent (Claude Code) — R-02 follow-up, Chart lane (released)
Did:      Two fixes on top of the merged R-02. A scheduled retry of a missing set keeps the no-chart state (Retry shows `Checking…`, disabled) instead of flashing the loading skeleton each minute. A same-day set served from the device cache records its `fetchedAt` as the last attempt, so it refreshes on the next check instead of after 5 minutes. Added end-to-end `ensureCandles` tests (stubbed fetch and clock).
Files:    `lib/candles.ts`, `components/TradeDetail.tsx`, `lib/__tests__/candle-retry.test.ts`, `NOTES.md`.
Checked:  163/163 `npm test`; the no-flash test fails against `main`'s loader. Typecheck clean, lint 0 errors, `next build` OK. The cache-served path has no automated test (no IndexedDB in Node). Nothing checked on a phone.
Watch:    My parallel `chart/r01-pinch-chart-only` and `chart/r02-candle-retry` duplicate what is on `main`; do not merge them. A just-closed trade often opens on `1h` bars (route fallback) until the refresh brings `1m`.
### 2026-11-16 — agent (Claude Code) — R-03b log and close an open trade, App shell lane
Did:      `R-03b`: entry sheet has `Still open` / `Closed` at the top (default `Closed`); `Still open` hides the exit fields, skips their checks, sets the entry time to now unless one was typed, and the button reads `Save open trade and open chart`. Trade Detail for an open trade shows `Open` as the headline (no P&L, OD-38) and a 46px `Close trade` button that opens `CloseTradeSheet` (exit time default now, exit price; `validateClose` uses the `validateTradeInput` price rules and exit > entry); saving applies `closeTradePatch` (status, exits, trade style) through `updateTrade`. Rows on Today and Feed show `Open` where the result goes. Today's stat card and the day header show `· N open`. An open trade raises no "no candles" data note; until R-03c it shows "The chart for an open trade is not available yet."
Files:    `components/AddTradeSheet.tsx`, `components/CloseTradeSheet.tsx` (new), `components/TradeDetail.tsx`, `components/TradeRow.tsx`, `components/TodayScreen.tsx`, `components/DayHeader.tsx`, `lib/trades.ts` (`validateClose`, `closeTradePatch`), `lib/__tests__/close-trade.test.ts` (new), `NOTES.md`.
Checked:  typecheck, lint (0 errors, 1 pre-existing warning), test, build. Driven in headless Chrome at 390×844: open trade saved, `Open` on detail, Today and Feed, Close trade fills in the result, no horizontal overflow. Not checked on a real phone.
Left:     Without the R-03c chart the `Close trade` button sits in the upper half of the detail screen; with the chart above it, it lands in the lower half. The interim chart message goes away with R-03c.

### 2026-11-16 — agent (Claude Code) — R-03a open-trade types and math, Core math lane
Did:      `R-03a`: `TradeStatus` (`open`/`closed`), `status` on `TradeRecord`, nullable `exit_time`/`exit_price`, `isOpen`, `isClosed` (type guard) and `ClosedTradeRecord`. `normalizeTrade` defaults a missing status to `closed` and throws when status and exit fields disagree. Money functions return null for an open trade (`tradeTicks` → `tradePoints`, `tradePnl`, `rMultiple`; `isScratch` false; `exitFlagReason`, `excursions` null; sparkline empty); `initialRiskUsd`/`plannedR` unchanged. `holdSeconds(trade, now)` and `classifyTrade(entry, exit, now)` measure an open hold to `now`. `candleSignature` uses `open`. Store accepts an open record with null exits from device storage and backups, still drops a closed one with a missing exit, and drops (not crashes on) a record whose status and exits disagree. `dayStats` leaves open trades out of P&L, win rate and R and adds `openCount` (OD-38). `validateTradeInput` skips the exit only when it is `null`. Every null handled explicitly; no `!` or `as number`.
Files:    `lib/trades.ts`, `lib/store.ts`, `lib/selectors.ts`, `lib/candles.ts`, `lib/describe.ts`, `lib/hindsight.ts`, `lib/shareCard.ts`, `lib/trade-bar-validation.ts`, `components/TradeChart.tsx`, `components/TradeDetail.tsx`, tests (`open-trade` new; `core`, `honest-box`, `hindsight`, `session-coverage` narrowed to closed fixtures), `docs/06-data-model-and-roadmap.md`, `NOTES.md`.
Checked:  typecheck, lint, test, build (see PR). After merging main (R-01, R-02), `exitIsFresh` and `nextCandleRetryAt` got a null-exit guard (open trade: not fresh, no retry) so the merge typechecks. No UI change was intended; the form still requires an exit, so an open trade can only arrive from a backup file.
Left:     `R-03b` (Still open / Closed in the entry sheet, Close trade on detail, `Open` label on rows and Today) and `R-03c` (open-trade candles and chart: until then `TradeChart` takes only a `ClosedTradeRecord` and an open trade shows no chart; `buildHindsight` takes a closed trade). `openCount` is computed but not shown yet.

### 2026-11-16 — agent (Claude Code) — R-02 fresh-trade candles retry, Market data lane
Did:      `R-02`: pure `nextCandleRetryAt` and `exitIsFresh` in `lib/candles.ts`; `lastAttemptAt` on `CandleEntry`, set when a load starts; `ensureCandles` starts a new load when a retry is due (never while one is in flight) and a due refresh skips the "cache is final for now" shortcut; a refetch with fewer bars keeps the cache. Trade Detail calls `ensureCandles` every 60 s while open and on `visibilitychange`, never for samples; a `none` state shows "Yahoo has not published these bars yet" (exit < 60 min) or "No candles loaded for this trade" and a 44px `Retry`. `anchorsTradeWindow` is unchanged.
Files:    `lib/candles.ts`, `components/TradeDetail.tsx`, `lib/__tests__/candle-cache.test.ts`, `docs/08-ux-notes-viewing-and-journaling.md` (§4 state row), `NOTES.md`.
Checked:  typecheck, lint, test, build (see PR). Not verified on a phone or against a live session.
Left:     Yahoo's live-session lag for `MES=F` `1m` is still unmeasured: the work ran at 17:15 ET, inside the daily maintenance break. docs/10 §2 still lists it as unknown.

### 2026-11-16 — agent (Claude Code) — R-01 pinch zoom, Chart lane
Did:      `R-01`: `.chart-host` now has `touch-action: pan-y` (was `pan-y pinch-zoom`), so a two-finger pinch on the chart goes only to the chart (UX-44). Nothing else changed: viewport meta, `handleScroll`/`handleScale` and `vertTouchDrag: false` untouched.
Files:    `app/globals.css`, `NOTES.md`.
Checked:  `npm run typecheck` clean; `npm run lint` 0 errors, 1 pre-existing warning (`postcss.config.mjs`); `npm test` 140/140; `npm run build` ok. Not verified on a phone.
Left:     The four done-when checks in docs/16 `R-01` need a real phone (iOS Safari and Android Chrome).

### 2026-11-16 — agent (Claude Code) — floor roadmap, no lane
Did:      Added `docs/16-floor-roadmap.md` (`R-01`–`R-09`) from the owner's review of the live app, with files, limits and done-when per step. Opened `OD-37` (challenges) and `OD-38` (open-trade display). Pointer rows in AGENTS and README; replaced Next up. Documentation only.
Files:    `docs/16-floor-roadmap.md`, `AGENTS.md`, `README.md`, `DECISIONS.md`, `NOTES.md`.
Found:    `.chart-host` has `touch-action: pan-y pinch-zoom`, so a pinch zooms page and chart together (UX-44 already says the chart owns pinch). A failed candle load never retries: no caller passes `force` to `ensureCandles`. An exit is required in the form, the type, the store import and `/api/market-data`, so an open trade cannot be logged. The planned trades SQL on `feat/m0-candle-archive` has `exit_time not null`, against docs/09 §8.
Checked:  Read the code on `main` at `f8f9ff6`. Relative links in the new doc resolve. No code changed, nothing run on a phone.
Left:     Nothing from the roadmap is built. Yahoo's live-session lag is still unmeasured (`R-02` asks for the number).

### 2026-11-15 — agent (Instinct) — integration-review fixes for batch6 (PR #107)
Did:      Owner's held-integration findings: Shield masks the Contracts input and subtitle in manual entry (quantity still saved); R strip exit marker coloured by money outcome, not classification; hindsight later-touch search stops at the assigned session close; Trade Card rebuilds after a pan/pinch settles (it never did); a tap no longer counts as a pan (6px drag); set levels are tappable to correct, undo restores the previous value; market-data accepts an anchored payload with inside gaps as partial (AC-07) and the chip reports them; Trade Card export keeps gold only on the RULES seal; the 640 KB sample-bars fixture lazy-loads as its own chunk.
Files:    `components/AddTradeSheet.tsx`, `components/RStrip.tsx`, `lib/rstrip.ts`, `lib/hindsight.ts`, `components/TradeChart.tsx`, `components/TradeLevelEditor.tsx`, `app/globals.css`, `lib/shareCard.ts`, `lib/market-data/coverage.ts`, `app/api/market-data/route.ts`, `lib/candles.ts`, tests (`hindsight`, `rstrip`, `market-data-coverage`, `candle-cache`, `sample-bars`, `honest-box`), `NOTES.md`.
Checked:  140/140 node --test, tsc, eslint, next build all pass. Phone behaviour still unverified (AC-11).
Left:     PR targets `integration/batch6`, feeding #107. Do not merge or deploy. Browser-level regression test for the card-after-pan path still wanted; the repo has no browser test harness.

### 2026-11-15 — agent (Grok Bot) — integration/batch6 default is the 45-bar trade window
Did:      Opening visible range is the standard `fitWindow` (30% lead-in / 50% hold / 20% after-exit) at `max(45, the trade's own window)`. Removed the 2.5× zoom-out multiplier Chris rejected. Fit stays an optional View action. Held-range re-apply after setData is unchanged.
Files:    `lib/trades.ts`, `lib/__tests__/core.test.ts`, `components/TradeChart.tsx`, `NOTES.md`.
Left:     Draft PR #107 against main, stacked on #100. Do not merge or deploy.

### 2026-11-15 — agent (Grok Bot) — integration/batch6 sample fixture pad
Did:      Expanded `fixtures/sample-bars.json` with real unmodified Yahoo 1m bars for the Nov 8–13 Globex week (MES=F / MNQ=F), shared across the ten samples so 1m/5m/15m/1h all open with at least 45 bars. Existing hold-window OHLC is unchanged (fills still snap). `getSampleCandles` serves the shared series by symbol; samples still never fetch at runtime.
Files:    `fixtures/sample-bars.json`, `lib/candles.ts`, `lib/__tests__/sample-bars.test.ts`, `lib/__tests__/honest-box.test.ts`, `NOTES.md`.
Left:     Draft PR #107 against main, stacked on #100. Do not merge or deploy. Keep the fixture out of printcode/gitrdif dumps.

### 2026-11-15 — agent (Grok Bot) — integration/batch6 follow-up (zoom, KEY, X-Ray)
Did:      The zoomed-out default now re-applies after Lightweight Charts setData/layout so it is not replaced by an automatic tight fit. `defaultVisibleRange` shows at least 45 bars when that many candles are loaded (`to - from`, with `to = barCount` when showing the whole series). The gold KEY pill is gone; the key level is a faint muted dotted line with no label. X-Ray is removed (View toggle, hold-X, `setXray`, primitive fade).
Files:    `lib/trades.ts`, `lib/__tests__/core.test.ts`, `components/TradeChart.tsx`, `components/TradeDetail.tsx`, `components/PositionBoxPrimitive.ts`, `NOTES.md`.
Left:     Sample fixtures are often only as long as the hold, so a 5m view of `mnq-trend-hold` has ~14 candles even when fully zoomed out. Real Yahoo windows are already padded 15 hours.


### 2026-11-15 — agent (Grok Bot) — integration/batch6
Did:      Draft integration of #80 (gold for good process only), #81 (R strip), #82 (slim toolbar, zoomed-out default, Fit as an option), #83 (data-notes chip), #84 (two-step entry), and #85 (11px type floor, Inter + JetBrains Mono). Chart opens wide (>= 45 bars via defaultVisibleRange); fitWindow goldens unchanged. View menu labels Simple / After exit. Data-notes chip is amber only for missing/partial coverage. Levels grid kept, with Add stop/target/key on Trade Detail. Kept #71 out.
Left:     Draft PR against main, stacked on integration/batch5 (#100). Do not merge or deploy.


### 2026-11-15 — agent (Claude Haiku 5.5) — issue #85 type floor and fonts, branch `feat/85-type-floor-fonts`
Did:      Raised every sub-11px font-size in `app/globals.css` (9px and 10px rules, incl. `font:` shorthands) to `0.6875rem`. Loaded Inter and JetBrains Mono with `next/font/google` in `app/layout.tsx`; `--font-sans`/`--font-mono` now start with those variables. Fallback stacks unchanged.
Verified: `npm test` 112/112, `npm run typecheck` and `npm run build` exit 0. Lint: 0 errors, 1 pre-existing warning in `postcss.config.mjs`. Headless Chrome at 390×844 on Today, Feed, Review, Tune and Trade Detail: 0px horizontal overflow, no text under 11px, both fonts report `loaded`.
Left:     Feed, Review and Tune were probed for overflow and small text only, not inspected visually. Not tested at 360px. Do not merge without Chris.
Watch:    `next/font/google` fetches fonts at build time; a build with no network access will fail rather than fall back.

### 2026-11-15 — Codex — `feat/84-two-step-entry` (#84)
Did:      Manual entry now saves only the required execution fields, keeps its draft on close, and opens the new trade detail route; stop, target and key remain nullable.
Detail:   Trade Detail adds missing plan levels inline with existing tick/side validation; RiskChips remain for stop sizing and Shield masks dollars. Level controls remain available without candles.
Spec:     Updated docs/12 to put LV-17 sizing after the execution save. Chart renderer, formulas and fixtures are unchanged.
Verified: `npm test` 113/113; typecheck; lint 0 errors/1 permitted PostCSS warning; build 8/8 pages; headless Chrome at 390px had zero horizontal overflow and passed draft/save/validation/Shield checks.
Left:     No code items. Physical-phone verification was not available.

### 2026-11-15 — agent (Claude Haiku) — Data-notes chip (#83), branch `feat/83-data-notes-chip`
Did:      Trade Detail data-quality notes (1m, continuous contract, coverage, same-bar, stop/target/exit) collapse into one "N data notes" chip (44px, tap to expand). Hindsight unchanged. No chip when there are no notes.
Amber:    Only when bar coverage is missing or partial (MAE/MFE and bar check untrusted). All other notes muted. Chris to confirm (DECISIONS OD-36).
Files:    `lib/data-notes.ts`, `components/DataNotesChip.tsx`, `components/TradeDetail.tsx`, `app/globals.css`, `lib/__tests__/data-notes.test.ts`, `docs/08`, `DECISIONS.md`, `NOTES.md`.
Verified: `npm test` 122/122, `npm run typecheck` clean, `npm run lint` 0 errors (1 pre-existing PostCSS warning), `npm run build` OK.
Left:     No browser check at 390px yet. Draft PR against integration/batch5, do-not-merge-without-Chris.

### 2026-11-15 — agy (gemini-3.8-flash-high) — Chart toolbar slim & default zoom (#82)
Did:      Issue #82: slimmed Trade Detail toolbar to 1 row at 390px (timeframe switch + View button). Folded Fit, detail level (Simple / After exit), X-Ray, fullscreen, and 30-bar extensions into View menu. Moved ‹ › to 44px edge hits on chart. Implemented Chris's decision: charts open zoomed out by default (wide context >= 45 bars via `defaultVisibleRange`), Fit is an option in View menu and reports not-fitted initially. Preserves user pan/zoom across timeframe changes. Zero gold used on toolbar chrome/View.
Files:    `components/TradeDetail.tsx`, `components/TradeChart.tsx`, `lib/trades.ts`, `lib/__tests__/core.test.ts`, `app/globals.css`, `NOTES.md`.
Verified: `npm test` (113/113 passed), `npm run typecheck`, `npm run lint` (0 errors, 1 pre-existing warning in postcss.config.mjs), `npm run build` (8/8 static pages).
Left:     PR against integration/batch5 (do-not-merge-without-Chris). Simple / After exit visible labels open to owner preference.

### 2026-11-15 — agent (Grok Bot) — follow-up on `feat/82-slim-toolbar` (#82)
Did:      Raised View menu labels from 9–10px to the 11px floor (sibling #85). Programmatic range updates clear their flag on a microtask so the default zoomed-out view is not treated as a user pan.
Files:    `app/globals.css`, `components/TradeChart.tsx`, `NOTES.md`.

### 2026-11-15 — agent (Grok Bot) — App shell, branch `feat/81-r-strip` (#81)
Did:      Replaced the Feed and Review sparkline with an R strip (stop left, target right, entry tick, exit marker, faint MAE/MFE). A larger copy sits under the Trade Detail chart; the six-cell levels grid is kept. Works in Shield and with no candles. Blind review hides the exit/MAE/MFE. Layout is a pure helper with unit tests.
Files:    `lib/rstrip.ts`, `lib/__tests__/rstrip.test.ts`, `components/RStrip.tsx`, `components/TradeRow.tsx`, `components/ReviewScreen.tsx`, `components/TradeDetail.tsx`, `app/globals.css`, `NOTES.md`.
Left:     Sparkline component is unused by Feed/Review but left in the tree.

### 2026-11-15 — agent (Grok Bot) — App shell, branch `feat/80-gold-good-process` (#80)
Did:      Gold is reserved for good process only: the full-rules seal, checked checklist rules, Today's "By the rules" / day-head process score, and the clean-process header glow. Selected and active chrome (timeframes, pills, dock, focus rings, primary buttons, brand mark, Shield switch) now use plain white. Tune gold preset and intensity still preview the process gold.
Files:    `app/globals.css`, `components/TuneScreen.tsx`, `NOTES.md`.
Left:     Share-card RULES seal stays gold (good process). Gold presets remain a Tune control.


### 2026-11-15 — agent (Grok Bot) — integration/batch5
Did:      Draft integration of #78 (Low hindsight one-liner), #79/#77 (first-load P&L), #97/#96 (#87+#88 Trade Card lazy + current view), #92/#65 (session coverage), #95/#90 (market-data expected coverage), #93 (Tune Shield risk mask), #94/#91 (docs stale/no-purple), #98/#86 (candle refetch), and #99/#89 (sample fixture bars). Kept #71 out. Composed #65+#90 so coversTradeWindow uses Globex hours when a symbol is passed. Composed #86+#90 so a cache is reused only when it covers the trade window and the hindsight window, or is refetched after session close. Samples load from sample-bars.json and never hit Yahoo.
Left:     Draft PR against main, do-not-merge-without-Chris. Do not merge or deploy. Holiday calendar remains OD-35. The reported $140 then $171 pair was not a current fixture P&L.


### 2026-11-15 — agent (Antigravity) — Runtime sample bars from fixture (#89)
Did:      Issue #89: sample trades render 1m bars from `fixtures/sample-bars.json` at runtime with no Yahoo or /api/market-data calls. Restored truthful CandleSource "Demo fixture" and updated Tune copy to match. Real trades continue fetching Yahoo and caching in IndexedDB. Added locking tests in `lib/__tests__/sample-bars.test.ts`.
Files:    `lib/candles.ts`, `lib/trades.ts`, `lib/store.ts`, `components/TradeDetail.tsx`, `components/TuneScreen.tsx`, `lib/__tests__/sample-bars.test.ts`, `NOTES.md`.
Verified: `npm test` 85/85, `npm run typecheck`, `npm run lint` (0 errors, 1 pre-existing PostCSS warning), `npm run build` (8/8 static pages).
Left:     Draft PR against main (#89), do-not-merge-without-Chris.

### 2026-11-15 — Codex — Market data, branch `feat/86-candle-refetch` (#86)
Did:      Refetch matching candle caches only after their 17:00 New York hindsight window closes and only when bar coverage is short; replace the same signature-keyed IndexedDB entry.
Also:     Shared DST-safe session-close math with hindsight, made coarse final bars count through close, and extended overnight Yahoo request windows through the assigned close.
Tests:    Fake cache/clock cases cover open, closed-partial, closed-complete, coarse bars, signature changes, DST, maintenance-hour and weekend assignment.
Verified: `npm test` 88/88; typecheck and build pass; lint 0 errors/1 existing PostCSS warning.
Left:     Nothing open for #86. No fixtures, chart styling, R, stats, deployment, M0 archive, or PR #71 changed.

### 2026-11-15 — agent (Claude Haiku 5.5) — docs stale cleanup, branch `feat/91-docs-stale` (#91)
Did:      CONTRIBUTING §2 says the app is live on `main` (no "no code yet"). docs/14 intro and table show Phases 1–5 on `main`, Phase 6 not started. docs/12 §9 and `OD-23` restated to D-010 (faint red/green plan fills, stronger result-colour actual band, no outline, no purple or teal). `OD-33` marked restated, owner to review.
Left:     PR for #91 is do-not-merge-without-Chris. Archived-box outline (docs/12 §9) is not covered by D-010 and is unchanged. docs/15 still lists an optional `PLAN` tag; D-010 does not.

### 2026-11-15 — agent (Antigravity) — App shell and notes, branch `feat/17-tune-shield-risk`
Did:      Shield mode masks Tune risk budget: heading hides ($ USD), readout and input display "Hidden", quick chips omitted, and hint explains turning Shield off changes the dollar amount. Input is disabled/readOnly with accessible label. Pure display helper added with focused tests.
Files:    `lib/prefs.ts`, `components/TuneScreen.tsx`, `app/globals.css`, `lib/__tests__/tune-prefs.test.ts`, `NOTES.md`.
Verified: `npm test` 83/83 passed; `npm run typecheck`, `npm run lint` (0 errors, 1 pre-existing warning), `npm run build` passed.
Left:     PR against main, do-not-merge-without-Chris.

### 2026-11-15 — agent (Claude Haiku) — issue #90 market-data coverage (branch `feat/90-market-data-coverage`)
Did:      `/api/market-data` accepts a timeframe only when `coversTradeWindow` (new `lib/market-data/coverage.ts`) holds: entry bar, exit bar and every bar inside the hold from the shared `expectedInsideBarTimes`. Thin or gapped sets fall through, then 404. `lib/candles.ts` uses the same test for cached and fresh sets. `lib/trade-bar-validation.ts` now imports the shared helper instead of its private copy.
Verified: `npm test` 89 pass (was 81); typecheck clean; lint 0 errors, 1 pre-existing warning; `npm run build` passes.
Left:     Not run against live Yahoo. Trades that span the 17:00–18:00 ET maintenance break get no complete set until #65 narrows the expected bars to Globex hours, so they will 404 instead of showing a thin chart. Owner decides whether full-bar coverage is too strict.
Watch:    Strict coverage can push a trade with one 1m gap to 5m or 1h. Chris to confirm before merge (PR is do-not-merge-without-Chris).

### 2026-11-15 — agent (Codex) — Core math, branch `feat/65-session-coverage`
Did:      Issue #65: shared MES/MNQ expected-bar logic now omits the regular 17:00–18:00 ET halt and Friday 17:00–Sunday 18:00 ET weekend closure for coverage and excursions.
Files:    `lib/session.ts`, `lib/{trade-bar-validation,trades}.ts`, `lib/__tests__/session-coverage.test.ts`, `DECISIONS.md`, `NOTES.md`.
Verified: `npm test` 86/86; typecheck/build pass; lint 0 errors/1 existing PostCSS warning.
Left:     Holidays and early closes still appear as missing evidence until an authoritative calendar is chosen (`OD-35`). Do not merge without Chris.

### 2026-11-15 — agent (Grok Bot) — Chart + App shell, branch `feat/87-trade-card-current-view` (#87)
Did:      Trade Card now rebuilds from the live screenshot after pan, pinch, fit, or ‹30/30› when the sheet is already open (AC-10). Stacks on #88 (lazy build); notes typing still does not encode. A leftover blob is dropped on a closed-sheet redraw so the next open is current.
Files:    `components/TradeDetail.tsx`, `NOTES.md`.
Verified: `npm test` / typecheck / lint / build to be recorded in the PR.
Left:     None for AC-10. Native share on a real phone is still AC-11.

### 2026-11-15 — agent (Grok Bot) — Chart + App shell, branch `feat/88-trade-card-lazy` (#88)
Did:      Trade Card PNG is built lazily when the sheet opens (or when Shield is toggled on an open sheet), not on every Trade Detail redraw. A notes typation pause no longer re-screenshots the chart or re-encodes the 1080×1350 card. The Trade Card button is enabled once candles are ready; the sheet shows its existing preparing state until the blob lands.
Files:    `lib/shareCard.ts`, `lib/__tests__/core.test.ts`, `components/TradeDetail.tsx`, `NOTES.md`.
Verified: `npm test` / typecheck / lint / build to be recorded in the PR.
Left:     After pan, pinch, or ‹30/30› an already-open (or previously prepared) card can still be stale until the sheet is opened again — that is issue #87 (AC-10), a sibling branch.

### 2026-11-15 — agent (Claude Haiku 5.5) — `feat/hindsight-low-summary`
Did:      Low chart detail no longer hides the after-exit hindsight. It now shows the hindsight sentence as one compact line (tap reveals the full text, sentence plus `TP +Nm` / `SL +Nm`). Medium is unchanged (button, one-tap helper, expand). Hindsight is computed whenever the chart is ready. Chart primitive untouched: Low still hides the dotted continuation.
Files:    `lib/hindsight.ts` (`hindsightCollapsedText`, `hindsightExpandedText`), `lib/__tests__/hindsight.test.ts`, `components/TradeDetail.tsx`, `app/globals.css` (`.hindsight-line`), `NOTES.md`.
Watch:    Low one-liner truncates with an ellipsis on phones; the full text is one tap away. Still does not change R, P&L, outcome or stats.
Open:    Do-not-merge without Chris (PR title and body say so).

### 2026-11-15 — agent (Grok Bot) — Chart + App shell, branch `feat/77-pnl-first-load` (#77)
Did:      First-load P&L flicker. Trade Detail (and Feed) painted `serverState` sample money before `hydrateJournal` ran in `useEffect`, so a stale device copy could replace — or be replaced by — the fixture P&L after first paint. Both screens now wait for hydration (as Today/Review already did). Hydration runs in `useLayoutEffect`. Stale sample prices are still refreshed in one `hydrateJournal` update; tested with an MNQ copy that priced at $140 vs the fixture $720.
Left:     PR against main, do-not-merge-without-Chris. The reported $140 then $171 pair is not a current fixture P&L; the locked case is stale-device $140 vs current fixture math, with no post-paint jump.


### 2026-11-15 — agent (Grok Bot) — integration/batch4 cleanup before merge
Did:      Stripped UX/Invariant codes from Tune captions (plain wording only). Trade Card outcome subline now wraps instead of ellipsizing, so R and points stay visible in the preview.
Left:     Ready for Chris's approved merge of PR #76. Do not squash. PR #71 stays open.

### 2026-11-15 — agent (Grok Bot) — integration/batch4
Did:      Draft integration of PRs #72 (after-the-exit), #73 (trade document spec, no-purple docs fix), #74 (Tune screen), and #75 (Trade Card sheet). Kept #71 (M0 archive) out. Resolved TradeDetail so hindsight (‹30/30›, Medium continuation, off-chart later-touch text) and the Trade Card sheet (privacy re-render, Share/Save/Copy) both land. NOTES handoffs from all four branches kept.
Left:     Draft PR against main, do-not-merge-without-Chris. Do not merge or deploy until Chris says so.

### 2026-11-15 — agent (Codex) — Chart + App shell, branch `feat/16-trade-card-sheet`
Did:      Issue #16: preview sheet, Shield re-render, prepared Share/Save/Copy, zoned entry/exit, playbook/tags/frozen-rules card copy.
Files:    `lib/shareCard.ts`, `components/{TradeCardSheet,TradeDetail}.tsx`, `app/globals.css`, `lib/__tests__/core.test.ts`, `NOTES.md`.
Verified: `npm test` 64/64; typecheck/build pass; lint 0 errors/1 existing PostCSS warning; 390×844 Chrome had 390px scroll width and working preview/privacy/actions.
Left:     Native iOS share-sheet remains untested, as allowed by issue #16. No publish, deployment or primitive rebuild.

### 2026-11-15 — agent (Antigravity) — App shell and notes, branch `feat/17-tune-screen`
Did:      Issue #17 (Phase 5: Real Tune screen). Wired controls on `/tune` for Position Box opacity (Invariant 5), gold preset and intensity (`GOLD_PRESETS`: bullion, champagne, amber, platinum), blue/orange palette (UX-80), risk budget ($10–$100,000, default $250 with quick chips), show/hide samples, and Shield mode toggle; kept time zone and backup intact.
Files:    `components/TuneScreen.tsx`, `lib/prefs.ts`, `app/globals.css`, `lib/__tests__/tune-prefs.test.ts`, `NOTES.md`.
Verified: `npm test` (73/73 passed), `npm run typecheck`, `npm run lint` (0 errors, 1 pre-existing warning), `npm run build` (8/8 static pages), 390×844 Chrome render check.
Left:     PR against main (#17), do-not-merge-without-Chris.

### 2026-11-15 — agent (Grok Bot) — Chart, branch `feat/37-after-the-exit` (#37)
Did:      After-the-exit hindsight. Medium detail (the default) draws dotted faint-gray entry, faint-red stop, and faint-green target lines past the exit, with hollow later-touch dots and no on-chart text. Low detail hides them. ‹ 30 / 30 › widen the view by 30 bars of the current timeframe ([ / ], Fit restores). The "held to plan" sentence is computed in `lib/hindsight.ts` and shown one tap away under "After the exit — hindsight". Never changes R, outcome, or stats.
Files:    `lib/hindsight.ts`, `lib/__tests__/hindsight.test.ts`, `components/{PositionBoxPrimitive.ts,TradeChart.tsx,TradeDetail.tsx}`, `NOTES.md`.
Verified: see the PR description for command output.
Left:     Do not merge without Chris. #34 (buildMarks) can later absorb the continuation segments. Extra candles are not fetched when a tap runs out; the button says "No more candles". Optional post-exit excursion bracket stays off.
Watch:    Dotted continuation is on by default at Medium, per the owner's 2026-11-15 decision on #37. No purple, no end labels, no 'after exit' chart text; later-touch times live in the hindsight block.

### 2026-11-15 — agent (Claude Haiku 5.5) — Trade document spec (docs only), branch `feat/32-trade-document-spec` (#32)
Did:      Added `docs/15-trade-document-and-render-grammar.md` (design §2 and §5 with the 2026-11-15 owner decisions, hindsight summary, open items `OD-30`–`OD-34`). Updated `docs/02` §2 to the box as built. Committed seven examples to `fixtures/trades/`. Index pointers in README, AGENTS, CONTRIBUTING; DECISIONS D-010 and OD-30–34. Follow-up commits restated D-010 / docs/15 to fills-only (no purple, no outlines) to match the owner's standing chart rule and the PR #72 review.
Verified: `npm test` 64/64; `typecheck` and `build` exit 0; `lint` 0 errors, 1 pre-existing warning (`postcss.config.mjs`).
Left:     PR against main, do-not-merge-without-Chris. `OD-30`–`OD-34` await the owner. No code. `deriveTrade` and `buildMarks` are #33 and #34.
Watch:    The design file on the box is `trades-on-chart-design-and-plan.md`, not the `position-box-answer.md` the issue cites. Its §2.3 dollar figures assumed five contracts; doc 15 uses the two-contract examples.



### 2026-11-15 — agent (Grok Bot) — Core math + App shell, branch `feat/batch3-coverage-daystats`
Did:      Issues #60 and #61. `validateTradeAgainstBars` now requires both entry and exit candles for `complete` coverage, and reports `chronology` separately (`unresolved` when entry and exit fall in the same bar). `fillInsideBar` returns false when the bar is missing. `dayStats` exposes `gross` (not `net`), priced/unpriceable counts, an `incomplete` flag, and a win rate over priced trades only. Today and the day header label the total "gross" and show a quiet incomplete cue.
Files:    `lib/trade-bar-validation.ts`, `lib/trades.ts`, `lib/selectors.ts`, `components/{DayHeader,TodayScreen,TradeDetail}.tsx`, `app/globals.css`, `lib/__tests__/core.test.ts`, `NOTES.md`.
Verified: see the PR description for command output.
Left:     PR against main, do-not-merge-without-Chris. Issue #65 (session-aware expected coverage) is filed only, not implemented.
Watch:    `DayStats.net` was renamed to `gross`. Callers must use the new field. Win rate is `wins / pricedCount`, not `wins / count`.

### 2026-11-15 — agent (Claude Haiku 5.5) — Sample fixture versions, branch `feat/batch3-fixture-version` (#62)
Did:      Samples carry `fixture_version` (`DEMO_FIXTURE_VERSION = 1`) and `annotations_modified`. `updateTrade` sets the flag when an annotation value changes. `applyFixtureRefresh` takes an optional `previous` fixture and refreshes untouched default annotations, keeping edited ones. Open edge case: `OD-29`.
Verified: `npm test` 57/57 (new `lib/__tests__/fixture-version.test.ts`), typecheck, build pass. Lint has one warning in `postcss.config.mjs`, unchanged from main.
Left:     Lane claims not changed. Legacy samples whose default changed in an older build are kept until a snapshot is supplied (`OD-29`).

### 2026-11-15 — agent (Antigravity) — Core math + Chart, branch `feat/batch3-calc-alignment`
Did:      Issues #63 & #64: plannedR rejects wrong-side target and target at entry; tradeTicks returns null for invalid quantity; isScratch returns false when quantity is invalid or trade cannot be priced; alignTradeToBars / TradeChart preserves alignment kind and marks nearby (OD-28 cap kept) as approximate with quiet chart cue (softened fill, thinner/dotted path, tiny ≈).
Files:    `lib/trades.ts`, `components/PositionBoxPrimitive.ts`, `components/TradeChart.tsx`, `lib/__tests__/validation.test.ts`, `DECISIONS.md`, `NOTES.md`.
Verified: `npm test` (51/51 pass), `npm run typecheck`, `npm run lint` (0 errors, 1 pre-existing warning), `npm run build` (8/8 static pages).
Left:     Ready for review; PR against main opened referencing #63 and #64; do-not-merge-without-Chris.

### 2026-11-15 — agent (Antigravity) — Core math + App shell and notes, branch `feat/53-54-cleanup-review-status`
Did:      Issues #53 and #54: removed dead mergeAxisTags, AxisTag, axis title helpers and tests; removed orphaned .style-pill CSS; committed package-lock.json; fixed classifyTrade to compare raw elapsed ms (<15m scalp boundary) with tests; updated deriveReviewStatus to count pre_trade_thesis, management_notes, post_exit_notes, checklist_state, and take_again as review evidence; tightened stale bullets in NOTES.md.
Files:    `lib/trades.ts`, `app/globals.css`, `lib/__tests__/core.test.ts`, `lib/__tests__/honest-box.test.ts`, `NOTES.md`, `package-lock.json`.
Verified: `npm test` (33/33 pass), `npm run typecheck`, `npm run lint` (0 errors, 1 pre-existing PostCSS warning), `npm run build` (8/8 static pages).
Left:     Ready for review; PR opened to main referencing #53 and #54.
Watch:    holdSeconds() display rounding is untouched; only classifyTrade compares raw milliseconds.

### 2026-11-15 — agent (Claude) — Validation and bar alignment, branch `feat/50-51-validation-alignment`
Did:      Fixed #50: `specFor` returns null for unknown contracts (no fallback spec); `canonicalSymbol` maps `mes` to `MES`; money and R functions return null for an unknown symbol, non-finite price, off-tick price, quantity that is not a whole number of 1 or more, or a stop on the wrong side. `validateTradeInput` checks executions before save. The add-trade form rejects off-tick prices instead of snapping them. Fixed #51: `alignToBar` returns containing, nearby (3 bars, max 30 minutes, OD-28) or unresolved. `snapToBar` returns null when unresolved. The chart hides the box then.
Files:    `lib/trades.ts`, `lib/format.ts`, `lib/store.ts`, `lib/describe.ts`, `lib/selectors.ts`, `lib/shareCard.ts`, `components/{AddTradeSheet,RiskChips,TradeChart,PositionBoxPrimitive,TradeRow,TradeDetail,ReviewScreen}.tsx`, `lib/__tests__/{honest-box,validation}.test.ts`, `docs/{02,07}*.md`, `DECISIONS.md` (OD-28), `NOTES.md`.
Verified: see the PR description for the command output.
Left:     Backup import keeps trades with an unknown symbol or a stored quantity of 0 or 1.5 and shows their money as "—". It does not drop or repair them. (`package-lock.json` was committed on #57.)
Watch:    `tradePnl`, `tradePoints`, `tradeTicks`, `rMultiple`, `plannedR`, `initialRiskUsd` now return `number | null`. Callers must handle null. `formatMoney` and `formatPoints` take null and show "—".

### 2026-11-15 — agent (Codex) — Chart, branch `feat/phase4-chart-windows`
Did:      Fixed #28: series + primitive autoscale include planned TP/SL and exit; Fit restores price autoscale; every sample has a target; generated sample candles/sparklines are removed; missing data renders no chart.
Files:    `components/{PositionBoxPrimitive,TradeChart,TradeDetail}.tsx`, `lib/{candles,fixtures,store,trades}.ts`, `lib/__tests__/core.test.ts`, `docs/{02,07,08,14}*.md`, `NOTES.md`.
Verified: `npm run build` passed (8/8 pages); `npm run lint` 0 errors/1 existing PostCSS warning; `npm run typecheck` clean; `npm test` 17/17.
Verified: app route returned 1,730/1,805 real Yahoo `NQ=F` 1m bars; 390×844 Chrome had 390px scroll width, no console/request errors, and a forced 404 rendered 0 chart hosts while details remained.
Artifacts: `/workspace/phase4-scalp.png` (13m, 30 bars, 43.33%) and `/workspace/phase4-90min.png` (90m, 36×5m bars, 50%); both visibly show TP and SL.
Left:     Nothing pushed or merged. `package-lock.json` remains untracked and uncommitted. No real-phone/iOS Safari pass was performed.

### 2026-11-14 (night CT) — agent (Codex) — Chart + App shell and notes, branch `feat/phase4-chart-windows`
Did:      Implemented issues #13, #10, #11, #12, #25 and #14 as separate commits: removed duration-category UI, fitted windows from hold duration, added the 30-bar floor and duration timeframes, and removed the no-data chart fallback.
Files:    `components/`, `lib/`, `app/globals.css`, `docs/02`, `docs/05`, `docs/07`, `docs/08`, `docs/14`, `DECISIONS.md`, `NOTES.md`.
Verified: `npm run lint` 0 errors/1 existing PostCSS warning; `npm run typecheck` clean; `npm test` 16/16; `npm run build` completed 8/8 static pages.
Verified: 390×844 Chrome pass across all 10 samples: zero overflow/errors/removed labels; 1m→15m context 180→450 minutes; only TradingView attribution is under 44px.
Artifacts: `/workspace/phase4-scalp.png` (13-minute hold, 43.3%) and `/workspace/phase4-90min.png` (90-minute hold, 50%).
Left:     Nothing pushed. Owner should decide `OD-27`; 2-, 5- and 7-minute floor-bound fixtures are truthfully 7%, 17% and 23% of 30 bars rather than the issue's impossible 35% minimum.
Watch:    `package-lock.json` remains untracked and uncommitted as requested. No real-phone/iOS Safari pass was performed.

### 2026-11-14 (night CT) — agent (Antigravity) — Market data + Chart, branch `feat/27-mes-feed`
Did:      Implemented `#27` (`OD-15` decided): mapped `MES` → `MES=F` and `MNQ` → `MNQ=F` in `lib/trades.ts` (`FUTURES_SPECS` + `normalizeTrade` ticker migration), updated `lib/market-data/yahoo.ts` Invariant 3 comment (no `ES=F`/`NQ=F` fallback), scoped IndexedDB candle cache keys and signatures by Yahoo ticker in `lib/store.ts` and `lib/candles.ts`, added unit tests in `lib/__tests__/core.test.ts`, and updated `DECISIONS.md`, `AGENTS.md`, `docs/02`, `docs/07`, `docs/09`, `docs/10`, `docs/12`, `docs/14`, `mogprompt.md`, and `fixtures/levelsets/MES-2026-11-12.json`.
Verified: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` all pass.
Left:     Unblocks drawing daily levels (`#26`) since chart and fixture both use `MES=F`.
Watch:    Existing stored trades with `yahoo_ticker: "ES=F"` for `MES` migrate to `"MES=F"` on load, and old `ES=F` IndexedDB cache entries are ignored because cache keys and signatures now include the Yahoo ticker.

### 2026-11-15 — agent (Antigravity) — App shell and notes + Chart, branch `feat/19-accessibility`
Did:      Phase 6 accessibility pass (#19) in `app/globals.css`, `components/*`, `lib/theme.ts`, `lib/__tests__/core.test.ts`: `rem` typography & fluid grids for large text (UX-85), `>= 44px` tap targets on segmented/suggest/toast/chart-note/topnav buttons, `--text-faint` contrast raised to `#7b8498` (`>= 4.77:1`), blue/orange box frame + result pill text/dashed border (UX-80), skip link, modal focus trap & dialog guard for `J`/`K`/`F`/`N`/`C`/`X`, valid ARIA on badges/switches/chips/status skeletons (UX-83, UX-84).
Verified: `npm test` (11/11), `npm run typecheck`, `npm run lint` (0 errors, 1 existing warning), `npm run build` pass. Headless Chrome across `/`, `/feed`, `/trades/[id]` (winner, no-stop, missing), `/review`, `/tune` + `AddTradeSheet` at 390×844 (100%, 125%, 150% font scale) and 1280×900 with `prefers-reduced-motion: reduce`, `data-palette="blue-orange"`, and `--gold-intensity: 0`: 0 horizontal overflow, 0 missing accessible names, 0 sub-44px targets, 0 console errors.
Left:     No real iPhone / iOS Safari or native iOS share sheet available in this Linux container; Phase 5 Tune controls (sliders/palette switcher UI, backup) and the new Trade Card sheet live on sibling branches and should be re-checked on hardware after merge.
Watch:    Keep `.pill` and `.save-status` as `position: relative` so `.visually-hidden` children never widen scroll containers.
### 2026-11-14 (late CT) — agent (Antigravity) — App shell and notes, branch `feat/18-journal-backup`
Did:      Phase 5 journal backup on `/tune` (#18): added `buildBackup` and `parseBackupFile` in `lib/store.ts`, `getPrefs` in `lib/prefs.ts`, Download backup and Restore from file with confirmation and validation in `components/TuneScreen.tsx`, and unit tests in `lib/__tests__/core.test.ts`.
Verified: `npm run typecheck` clean; `npm run lint` 0 errors (1 pre-existing warning in `postcss.config.mjs`); `npm test` 12/12 pass; `npm run build` passes.
Left:     Sibling Tune controls (box opacity, gold preset/intensity, palette, risk budget, show/hide samples) belong to their sibling Phase 5 issue.
Watch:    Backups store trades and preferences only (`includesCandles: false`); charts re-fetch Yahoo Finance candles on open and samples keep their fixture bars.
### 2026-11-14 — agent (Codex) — App shell and notes (released), branch `feat/20-home-screen-icons`
Did:      Issue #20: added opaque MogMine 180/192/512 PNG icons, manifest/head links, and a one-time iOS browser Home Screen hint with durable seen state and dismissal.
Verified: `npm run build`, `npm run lint`, `npm run typecheck`, `npm test`: all exit 0; lint has the existing `postcss.config.mjs` warning, tests 11/11. `git diff --check` exit 0.
Verified: Production server returned 200 for manifest, SVG, all PNGs; head links resolved. Playwright at 390×844: hint shown once, 50×44 dismiss target, `scrollWidth 390 <= clientWidth 390`, dismissed and suppressed on reload.
Left:     Real-iPhone Add to Home Screen installation/icon check remains outstanding; no physical iOS device is available here.
Watch:    `package-lock.json` was already untracked before this work and is intentionally not part of issue #20.

### 2026-11-14 (night CT) — agent (Claude Code) — Chart + App shell and notes, branch `ui/phased-improvements`
Did:      UI phases 1–3, three local commits (`c74bbae`, `685319b`, `5a9f8c6`): routes and a real Today/Feed on phones, device store without inline candles, Position Box rewrite and in-place timeframe switch, Pit Stop, checklist, review queue. Plan and open questions in `docs/14`; `OD-24`–`OD-26` opened.
Verified: `npx tsc --noEmit` clean; `npm run lint` 0 errors, 1 old warning; `npm test` 10/10; `npm run build` passes. Headless Chrome at 390×844 and 1280×900: no overflow, no console errors; touch swipe on the chart scrolls the page. No real phone, no iOS, share sheet untested.
Left:     Stopped on the owner's instruction. Phase 4 (chart window from each trade's duration, `OD-24`) is specified in docs/14 §3 and not started. Tune is a placeholder; the Trade Card is still the old one-button version. Specs not yet updated for the differences listed in docs/14 §7.
Watch:    Known fault: short trades draw as tiny boxes because the window uses three fixed buckets (`fitPadding`). Nothing is pushed. Commits are authored "Claude Code" because the machine has no git identity. Old `v1`/`v2` localStorage is left in place on purpose.

### 2026-11-14 (late evening CT) — agent (Grok Bot) — M0/M1 acceptance from owner review
Did:      Added `AC-01`–`AC-11` to `docs/10` §7 (M0: repeatable upserts, bounded backfill, coverage per symbol/session, retries and visible failure, recovery test; M1: per-trade coverage and refresh, gaps and incomplete candles, safe writes, gross P&L and tick validation, Trade Card follows the view, phone E2E). Linked them from the M0/M1 rows, `docs/09` (B-10, B-47, B-61, M0/M1 list) and `docs/08` (§4 state row, §16 checklist). Annotated the 2026-11-15 Codex entry.
Verified: Each finding read in code on `main` `d93583f`; file:line references are in the AC table. Markdown relative-link check: 0 broken. Docs only, no code changed.
Left:     Nothing is built. Priority: coverage (AC-03, AC-06, AC-07), safe writes (AC-08), recovery test (AC-05). Vercel's Production branch setting is unverified (see Current state).
Watch:    The deployed `app/first-trade-review` preview still shows ET; `main` and `mogmine.vercel.app` show CT.

### 2026-11-14 (evening CT) — agent (Grok Bot) — levels docs + CT display
Did:      Ported `docs/11`–`13`, `fixtures/levelsets/MES-2026-11-12.json` and their pointer edits from the pre-PR#1 snapshot (base `7c3d8fa`). Added `lib/time.ts`; `TradeJournal`/`TradeChart` show CT (list, header, Trade Card, axis, crosshair); manual entry reads typed times as CT.
Verified: `npx tsc --noEmit` and `npm run build` pass. `npm run lint`: the same 7 errors as `main` (refs/setState in `TradeJournal`), none new. CT parse/format checked across both DST switches with the device set to Tokyo. Markdown link check: 0 broken.
Left:     Level sets and zones are not in code: the chart still draws one dotted `KEY` line per trade. Next step: render `fixtures/levelsets/` on `TradeChart` in the docs/12 style (red resistance, green support, yellow ADR, gray neutral, zones as bands, white right-edge labels), as a draft the owner publishes, never auto-published. Move `OD-23` to Decided.
Watch:    The display zone is a constant, not yet the UX-86 preference. Day ticks on the chart axis are relabelled only at CT midnight because the library places them at UTC midnight.

### 2026-11-15 — agent (Codex Work) — Market data + demo set
Did:      Added a server-side Yahoo Finance adapter/API, ten seeded MES/MNQ trades, existing-storage migration, source labels and an offline fixture fallback (the fallback was later removed by issue #28).
Verified: Vercel build READY at commit e4a5857; production page returned 200 with 10 trades; Yahoo route returned 1,810 NQ=F candles; runtime error scan was clean.
Correction (2026-11-14, owner review): "Verified" above covers server function only (build, page load, Yahoo route). Phone persistence, gestures and native sharing were not checked on a phone and still need an end-to-end check (`docs/10` `AC-11`).
Left:     Yahoo candles are fetched per opened trade and cached only on-device. The Supabase daily archive from M0 is still pending.
Watch:    Superseded by issue #28: Yahoo may throttle hosted requests, and no generated fallback chart is allowed.

### 2026-11-14 — agent (Codex Work) — Chart + app shell and notes
Did:      Scaffolded the first Next.js frontend; added offline fixtures, adaptive trade review, v5 Canvas PositionBoxPrimitive, manual entry, local-first notes, and private Trade Card sharing.
Verified: Local source checks passed before publication; npm install was blocked by the executor network (403), so Vercel preview build is the package/type/build verification.
Left:     Supabase, Yahoo archive and owner auth are not wired; the original preview used generated candles, removed later by issue #28. No Topstep work was added.
Watch:    Trade Card generation uses takeScreenshot(true). Re-check iOS share/copy and the 390×844 acceptance flow on the deployed preview.

Format:

```text
### YYYY-MM-DD — who (person or agent + tool) — lane
Did:      what changed, with file paths
Verified: commands run and the result, or "not verified"
Left:     what is unfinished or assumed
Watch:    anything the next person will trip over
```

### 2026-11-14 — agent (Grok Bot, trade helper) — levels proposal, no lane
Did:      Added `docs/12` and `fixtures/levelsets/MES-2026-11-12.json`. Pointer rows in README, AGENTS, CONTRIBUTING; notes in docs/02, 04, 06, 08. Opened `OD-20`–`OD-23`.
Verified: Thu 2026-11-12 ADR (141.73), pivots and ON high/low recomputed from Yahoo `MES=F` bars; `git apply --check` on the snapshot. No code exists.
Left:     Owner decides `OD-20`–`OD-23`; assistant drafts wait on `OD-19`, series on `OD-15`.
Watch:    Yahoo `1d` bars are labelled by Globex start date (docs/12 LV-02).

### 2026-11-14 — agent (Codex) — App shell and notes (released)
Did:      Added `docs/11-product-workflows-and-api-context.md`: daily planning/capture, detail/full-chart controls, domain-anchored comments, indicator definitions, assistant permissions and review scenarios. Added open `OD-17`–`OD-19`; aligned older UX passages with existing guardrails. Documentation only.
Files:    `AGENTS.md`, `CONTRIBUTING.md`, `DECISIONS.md`, `NOTES.md`, `README.md`, `docs/01-architecture-and-stack.md`, `docs/02-charting-position-boxes-and-divergence.md`, `docs/03-trade-cards-and-note-taking.md`, `docs/04-ai-review-engine.md`, `docs/05-mobile-ux-and-gold-design-system.md`, `docs/06-data-model-and-roadmap.md`, `docs/08-ux-notes-viewing-and-journaling.md`, `docs/11-product-workflows-and-api-context.md`.
Verified: `git diff --check` exited 0 (line-ending notices only). Reviewed `git diff -- docs/01-architecture-and-stack.md docs/02-charting-position-boxes-and-divergence.md docs/03-trade-cards-and-note-taking.md docs/04-ai-review-engine.md docs/05-mobile-ux-and-gold-design-system.md docs/06-data-model-and-roadmap.md docs/08-ux-notes-viewing-and-journaling.md README.md DECISIONS.md` and read the new document in full.
Verified: Inline PowerShell audit (`& ([scriptblock]::Create((Get-Content -LiteralPath (Join-Path $env:TEMP 'mogmine-doc-audit.ps1') -Raw -Encoding UTF8)))`) exited 0: “Markdown files checked: 17”; “Relative file links checked: 160”; “New-document anchors checked: 8”; “Open decisions: 19; references resolved; table contiguous”; “Documentation issues: 0”.
Left:     Owner review of detail defaults, indicator anchors/bands/BE, daily-plan scope, assistant authorization and “trade copy”. No endpoint/schema decisions, app code, browser tests or new vendor verification. `D-009` and build-order interim rules remain in force.
Watch:    Direct `.ps1` invocation was blocked by Windows execution policy; the audit ran inline without changing policy. New product ideas remain proposals, not accepted decisions. `mogprompt.md` reconciliation is still `OD-1`.

### 2026-11-14 (later) — agent (Claude Code) — Yahoo measurements and build order, no lane
Did:      Added `docs/10`. Recorded `D-009`, `OD-15`, `OD-16`. Replaced second-hand Yahoo limits with measured ones in `docs/09` B-11 and B-12, `AGENTS.md` §3b, `docs/02` and `mogprompt.md`.
Verified: Called Yahoo's chart endpoint from this machine for `ES=F`, `NQ=F`, `MES=F`, `MNQ=F`, `^VIX`, `DX-Y.NYB`. `1m` accepted to 30 days back and 8 days per request, `5m`/`15m`/`30m` to 60 days, `1h` to 730 days. Link check: 0 broken.
Left:     No archiver exists yet. Whether Yahoo delays the newest bars is still unknown (market was closed).
Watch:    Yahoo serves `MES=F` and `MNQ=F` as real, separate series, which contradicts the premise of Invariant 3 (`OD-15`). Measurements were from a desktop. Yahoo may throttle a hosted server.

### 2026-11-14 — agent (Claude Code) — docs review, no lane
Did:      Added `docs/08`, `docs/09`, `DECISIONS.md`, `CONTRIBUTING.md`, `NOTES.md`, PR template. Updated `AGENTS.md`, `README.md`, `mogprompt.md`, appended entries to `.gitignore`, and added pointer callouts to `docs/01`–`07`.
Verified: Vendor facts checked against Topstep, ProjectX, lightweight-charts, Vercel, Cloud Run and Supabase docs. See `docs/09` §10. No code exists, so nothing was run.
Left:     Nothing committed. The schema changes in `docs/09` §8 are proposals. The DDL in `mogprompt.md` §12 is unchanged and still has the problems listed there.
Watch:    Items marked `?` in `docs/09` §10 are unverified. Yahoo and iOS push facts come from secondary sources.

## Parking lot

Ideas that are not specified yet. Promote to a spec or delete.

- **Topstep risk rail on Today:** distance to the daily loss limit and trailing drawdown, read from the account stream.
- **Weekly review:** one insight a week from tags and directives, in place of a dashboard.
- **Personal rules:** the trader's own stop rules ("two losses, then stop"), surfaced quietly when they apply.
- **Auto-detected "Moved Stop":** from the order event log (B-07), so the trader does not have to tag it.
