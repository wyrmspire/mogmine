# 90 — Work packages for a five-agent swarm

Each package is one PR of roughly 250–450 changed lines including tests (AGENTS §6.10). Ids are stable: the planner (Gemini 4) may regroup or rename lanes, but should keep the ids so the design docs still point at the right package. Every package follows AGENTS.md: tests ship with the code (§6.8), real command output in the handoff (§6.9), no edits to BOARD/NOTES/DECISIONS by workers (§6.1), file-length rule for files over 450 lines (§6.12).

Verification for every package: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run check:file-length`. UI packages also: a headless `390×844` check (zero horizontal overflow, 44 px targets, tabular numbers) and a desktop check at 1280 px. Chart packages also: `node scripts/check-session-levels.mjs` where it applies.

**Gated** packages wait for a decision in [00](00-overview.md) §4. The planner must not hand them out before Chris answers.

---

## 1. Lanes at a glance

| Lane | Theme | Packages in order | Owns (writable, beyond new files) |
| :--- | :--- | :--- | :--- |
| **L1 Risk** | Per-account R, stated risk, entry validation | `RS-1` → `RS-2` → `RS-3a` → `RS-3b` → `RS-4` → `UX-C` | `lib/r-size.ts` (new), `lib/accounts.ts`, `lib/accounts-store.ts`, `components/AccountSheet.tsx`, `components/RiskChips.tsx`, `components/AddTradeSheet.tsx`, `lib/entry-form.ts`, R consumers in §3 |
| **L2 Trade truth** | Post-entry MAE/touches, fill matching, stop moves | `SM-1` → `FB-1` → `SM-2` → `SM-3` → `FB-2` → `UX-D` → `UX-B` | `lib/trade-bar-validation.ts`, `lib/session.ts` (one helper), `lib/data-notes.ts`, `lib/trade-document.ts`, `components/DataNotesChip.tsx`, `components/PitStop.tsx`, `lib/challenges.ts`, `components/Challenge*.tsx` |
| **L3 Chart look** | Levels, VWAP, EMA, then the Lab UI | `IN-1` → `LB-A` → `LB-B1` → `LB-B2` → `IN-2` → `PL-2a` → `PL-2b` → (`IN-3` gated) | `components/TradeChart.tsx`, `components/SessionLevelsPrimitive.ts`, `lib/level-pills.ts`, `lib/label-stack.ts`, `lib/chart-indicators.ts`, `lib/session-indicators.ts`, `components/useTradeLevels.ts`, `lib/prefs-sanitize.ts`, `app/playbooks/**`, `components/PlaybookBinder.tsx` |
| **L4 Review & days** | Daily review, review cards, day navigation | `DR-1a` → `NAV-1` → `DR-2` → `DR-3` → `DR-1b` → `UX-A` | `lib/daily-review*.ts` (new), `app/review/**`, `components/ReviewScreen.tsx`, `components/FeedScreen.tsx`, `components/TodayScreen.tsx`, `components/DayHeader.tsx`, `lib/day-card.ts`, `lib/session-review.ts`, `lib/persistence/registry.ts`, `lib/persistence/contract.ts`, `supabase/migrations/` (one new file) |
| **L5 Agent API** | House rules, vocabulary, candles, checks, levels; Lab model | `API-1` → `PL-1` → `API-2a` → `API-2b` → `API-3` → `API-4` → (`PL-3` gated) | `lib/agent/**`, `app/api/v1/**`, `app/.well-known/**`, `lib/playbook-lab.ts` (new) |

Shared files (any lane may need them) are in §4 with their order.

## 2. Waves

A wave is one package per lane, run in parallel from the same base; the integrator merges a wave before the next starts (or lanes rebase on each merge). Arrows are hard dependencies.

| Wave | L1 | L2 | L3 | L4 | L5 |
| :- | :- | :- | :- | :- | :- |
| 1 | `RS-1` | `SM-1` | `IN-1` | `DR-1a` | `API-1` |
| 2 | `RS-2` (← RS-1) | `FB-1` | `LB-A` | `NAV-1` | `PL-1` |
| 3 | `RS-3a` (← RS-1) | `SM-2` (← SM-1) | `LB-B1` (← LB-A, IN-1) | `DR-2` (← DR-1a) | `API-2a` (← RS-1 soft) |
| 4 | `RS-3b` (← RS-3a, SM-2) | `SM-3` (← SM-2) | `LB-B2` (← LB-B1) | `DR-3` (← DR-2, IN-1) | `API-2b` (← API-2a) |
| 5 | `RS-4` (← RS-1, RS-2) | `FB-2` (← FB-1) | `IN-2` | `DR-1b` (← DR-1a) | `API-3` (← FB-1, SM-1) |
| 6 | `UX-C` | `UX-D` | `PL-2a` (← PL-1, NAV-1) | `UX-A` | `API-4` (← API-3, IN-2) |
| 7 | — | `UX-B` | `PL-2b` (← PL-2a) | — | — |
| gated | — | — | `IN-3` (`OD-18`, D-G) | — | `PL-3` (Q-6) |

Waves 1–2 have no cross-lane dependencies. Wave 1 is the safest place to start.

## 3. Packages

### L1 — Risk

#### RS-1 Per-account R size: pure model and fields
- **Goal:** the R-size model of [04](04-r-size.md) §3 as pure code and stored fields, with no visible change yet.
- **Files:** new `lib/r-size.ts` (`resolveRSize`, `riskCents`, `resultR`, `riskR`, `riskComparison`); `lib/accounts.ts` + accounts sanitizer (`r_size_cents`); `lib/trades.ts` (`TradeRecord` fields `r_size_cents`, `stated_risk_r`, `risk_cents`; `normalizeTrade` defaults and computes `risk_cents`); `lib/commands/journal-commands.ts` (refuse a mismatched `risk_cents`, range-check `stated_risk_r` and `r_size_cents`); `lib/journal-backup.ts` (restore keeps a frozen `r_size_cents`). Tests: new `lib/__tests__/r-size.test.ts`.
- **Data:** jsonb record fields only; no SQL migration. Backups gain fields (older backups restore with nulls).
- **Acceptance:** the A/B/C golden table in 04 §1 at $300 passes; fallback order trade → account → prefs; no-stop trade has `resultR` and null `riskR`; `risk_cents` recomputed when entry, initial stop or qty change; 422 for a client `risk_cents` that differs; existing tests unchanged (no consumer switched yet).
- **Size:** ~350.

#### RS-2 R size in the account sheet, Tune and Trade Detail
- **Goal:** set an account's R size, relabel the default, show the risk line.
- **Files:** `components/AccountSheet.tsx` (R size field), `lib/prefs.ts` `getTuneRiskBudgetDisplay` (label "Default R size", hint), `components/RiskChips.tsx` (R size × 0.25/0.5/1, labels in R), new `components/RiskLine.tsx` (04 §3.4), `components/TradeDetail.tsx` (mount `RiskLine`; ≤ 10 net lines).
- **Acceptance:** an account saved with $300 shows `Risk $87.50 · 0.29R of $300 · you said 0.25R` on a trade like A; Shield strings contain no `$`; an account with no R size shows the source "default $250"; 390×844 check.
- **Depends:** RS-1. **Size:** ~300.

#### RS-3a Switch library consumers to account R
- **Goal:** everything labelled R in library outputs uses `resultR` (04 §3.5).
- **Files:** `lib/trades.ts` (rename `rMultiple` → `riskMultiple`, `plannedR` → `plannedRewardRisk`; **keep deprecated aliases** `rMultiple`/`plannedR` so other lanes compile), `lib/selectors.ts`, `lib/day-card.ts`, `lib/shareCard.ts`, `lib/drills.ts`, `lib/mood.ts`, `lib/describe.ts`, `lib/exit-efficiency.ts` (summary text), `lib/plan-vs-actual.ts`. Not `lib/trade-marks.ts` or `lib/rstrip.ts` (RS-3b).
- **Acceptance:** running stats, day card, share card and drills report account R on fixtures with an R size; `riskMultiple` equals the old `rMultiple` on every existing fixture; scratch unchanged (D-C); the PR lists every changed assertion and why.
- **Depends:** RS-1. **Size:** ~400. **Gated on D-A** (account R replaces stop-width R).

#### RS-3b Switch screens, ruler and R strip; remove aliases
- **Files:** `components/TradeDetail.tsx` (header R), `components/TradeRow.tsx`, `components/ReviewScreen.tsx`, `components/DrillScreen.tsx`, `lib/trade-marks.ts` (R ruler labels in account R at the trade's risk spacing), `lib/rstrip.ts`; remove the aliases once no caller remains (grep in the PR body).
- **Acceptance:** the ruler on a 0.25R trade labels +0.25R, +0.5R …; feed rows and the header agree with stats; no `rMultiple` symbol left.
- **Depends:** RS-3a; after SM-2 (both touch `lib/trade-marks.ts`). **Size:** ~300. **Gated on D-A.**

#### RS-4 Stated risk at entry, and the backfill script
- **Files:** `components/AddTradeSheet.tsx` (Risk row with chips, 04 §4; keep under its current line count or split the row into `components/RiskRow.tsx`), `lib/entry-form.ts`, new `scripts/r-size-backfill.mjs` (dry-run default, CSV out, `--apply <csv>`, idempotent, `expectedUpdatedAt`), tests with mocked repositories.
- **Acceptance:** a chip sets `stated_risk_r` and offers a stop when none is typed; with a stop typed the row shows actual vs stated; dry-run makes zero writes; apply twice changes nothing the second time; notes are never edited; samples skipped.
- **Depends:** RS-1, RS-2. **Size:** ~400. **The script is never run by a worker** against a real account.

#### UX-C Future dates and far-off prices
- **Files:** `lib/trades.ts` `validateTradeInput` (future entry/exit, 5 min allowance), `lib/entry-form.ts` (price-range warning from loaded day bars), `lib/commands/journal-commands.ts` (422 for future), tests.
- **Acceptance:** [02](02-ux.md) §2.3 table; a QA-style trade dated tomorrow is refused in the form and the API; 4866.25 on an MES day warns but saves.
- **Size:** ~200. **Gated on Q-10** (refuse vs warn).

### L2 — Trade truth

#### SM-1 Stop touches and MAE only after the entry bar
- **Files:** `lib/session.ts` (new `insideBarTimes`), `lib/trades.ts` `excursions` (call the helper; no other change in this file), `lib/trade-bar-validation.ts`, `lib/data-notes.ts` (optional muted line, D-H), tests (new `lib/__tests__/post-entry.test.ts`), golden updates.
- **Acceptance:** [05](05-stops-mae-fills.md) §1.3; the PR lists any fixture golden that changed and why.
- **Size:** ~200.

#### FB-1 ±5-minute fill-to-bar matching
- **Files:** new `lib/fill-match.ts`; `lib/trade-bar-validation.ts` (`shifted` → `fill_time_shifted`, matched entry bar for R-POST-1); `lib/trade-marks.ts` (anchor markers on the matched bar); `lib/data-notes.ts` (text for the new finding); tests.
- **Acceptance:** [05](05-stops-mae-fills.md) §4.4; trade C pattern draws on 14:13 and no `fill_outside_bar`.
- **Size:** ~400. Decision D-I uses the recommended default until Chris says otherwise.

#### SM-2 Untimed stop moves
- **Files:** `lib/trade-document.ts` (remove `pickStopMoveTime`; `"untimed"` basis at the exit instant; grandfathered 1,824 lines: must not grow net, state counts), `lib/trade-bar-validation.ts` (skip untimed segments), `lib/trade-marks.ts` (dashed final step, `moved · time?`), `components/PositionBoxPrimitive.ts` (dashed style if the painter needs it), `lib/data-notes.ts`, tests.
- **Acceptance:** [05](05-stops-mae-fills.md) §2 and §5 rows A; TD-1/TD-2 goldens updated with reasons.
- **Depends:** SM-1. **Size:** ~300.

#### SM-3 Timed stop moves: validation and what they feed
- **Files:** `lib/commands/journal-commands.ts` (move times inside the hold, last move = working stop, `initial_stop_set_at` default to entry with a warning per [02](02-ux.md) §2.6), new `lib/stop-facts.ts` (`widestRisk`, `lockedR`, exit/stop consistency), `lib/data-notes.ts`, new `components/StopFacts.tsx` mounted in `TradeDetail.tsx` (≤ 10 net lines), tests.
- **Acceptance:** [05](05-stops-mae-fills.md) §3.1–3.2 tables, each row a test.
- **Depends:** SM-2; `lockedR`/`widestRisk` in account R need RS-1 (merged in wave 1). **Size:** ~350.

#### FB-2 "Use 14:13" and the pre-filled stop-move editor
- **Files:** `components/DataNotesChip.tsx` (action buttons on `fill_time_shifted` and untimed-move notes, Undo toast), `components/StopMovesEditor.tsx` (accept a pre-filled move; grandfathered 841 lines: must not grow net), tests for the patch builders (pure, in `lib/fill-match.ts` or `lib/trades.ts` patch helpers).
- **Acceptance:** tapping "Use 14:13" writes `entry_time` 14:13 CT in UTC and Undo restores; nothing changes without the tap; 390×844.
- **Depends:** FB-1, SM-2. **Size:** ~250.

#### UX-D "No setup" chip and notes placeholders
- **Files:** `components/PitStop.tsx`, `components/ReviewScreen.tsx` (chip only; after RS-3b merged), notes placeholders and hint ([02](02-ux.md) §2.4–2.5).
- **Acceptance:** a trade with no playbook shows the chip in the Pit Stop and review card; placeholders match the table; a11y labels present.
- **Size:** ~150.

#### UX-B Challenges per account
- **Files:** `lib/challenges.ts`, challenge sanitizer, `components/ChallengeSetupSheet.tsx`, `components/ChallengeCard.tsx` (account name, floor label from [02](02-ux.md) §2.1), `lib/commands/journal-commands.ts` (accept `account_id`), tests (docs/17 golden cases still pass with `account_id: null`).
- **Acceptance:** an Eval challenge ignores Sim 2 trades; old challenges unchanged.
- **Size:** ~300.

### L3 — Chart look, then Lab UI

#### IN-1 Remember chart choices (all new prefs)
- **Files:** `lib/prefs-sanitize.ts` (`vwapAnchor`, `levelLabels`, `ema200`, `reviewCardOrientation`), `lib/commands/journal-commands.ts` prefs validation if it enumerates fields, `components/TradeDetail.tsx` (VWAP toggle reads/writes the pref; ≤ 10 net lines), tests.
- **Acceptance:** VWAP choice survives navigating between trades and a reload; sanitizer defaults for old prefs; prefs sync test passes.
- **Size:** ~150. This is the only package that edits `lib/prefs-sanitize.ts`.

#### LB-A Labels behind candles, solid, and a quieter right edge
- **Files:** `components/SessionLevelsPrimitive.ts` (labels `zOrder "bottom"`, alpha from token, rays end after the last bar, dotted settlement rays, zone right fade), `components/TradeChart.tsx` (right offset when text labels show, [03](03-indicators-and-levels.md) LB-3), `lib/theme.ts` (read `--level-label-bg-alpha`), new CSS token in `app/globals.css` (one line in `:root` and the blue/orange block), `scripts/check-session-levels.mjs`.
- **Acceptance:** [03](03-indicators-and-levels.md) §7 items for LB-1–LB-4; contrast ≥ 4.5:1; trade fit unchanged.
- **Size:** ~300.

#### LB-B1 Tap mode: no pills, axis tags, hit test
- **Files:** new `lib/level-hit-test.ts`, `components/SessionLevelsPrimitive.ts` (`priceAxisViews` for ≤ 3 groups; mode from `levelLabels`), `components/TradeChart.tsx` (`onChartClick` order: neighbour → level → close), tests (`level-hit-test.test.ts`).
- **Depends:** LB-A, IN-1. **Gated on D-D** (axis tags: 3 or none). **Size:** ~300.

#### LB-B2 Level card popover, accessible list, labelled export
- **Files:** new `components/LevelCard.tsx`, `components/TradeChart.tsx` (state for the open card), `components/TradeDetail.tsx` (View row list becomes a disclosure; ≤ 10 net lines), export path in `TradeChart`/`TradeCardSheet` for ≤ 4 labelled groups, CSS in a new `app/levels.css` imported once in `app/layout.tsx`.
- **Acceptance:** [03](03-indicators-and-levels.md) §3 LB-6/LB-7 and §7; the popover never appears in `takeScreenshot`.
- **Depends:** LB-B1. **Gated on D-E** (labelled export). **Size:** ~400.

#### IN-2 Globex VWAP with small gaps, from the session start
- **Files:** `lib/session-indicators.ts` (`gapPolicy`), `lib/chart-indicators.ts`, `components/useTradeLevels.ts` (extend the "today" window; levels still cut at entry), `components/TradeDetail.tsx` (View row text with `≈`; ≤ 5 net lines), tests with the 11/23 gap pattern (23 of ~1,380 missing, longest 12).
- **Acceptance:** [03](03-indicators-and-levels.md) §5 table; level values identical before and after on the level tests.
- **Gated on D-F.** **Size:** ~300.

#### PL-2a Lab: home, Playbooks, Tags
- **Files:** new `app/playbooks/lab/page.tsx`, new `components/PlaybookLab.tsx` (+ sub-components), `components/PlaybookBinder.tsx` (Binder | Lab tabs only), `components/TuneScreen.tsx` (link text only; one line), CSS in a new `app/lab.css`.
- **Acceptance:** [01](01-playbook-lab.md) §4.1–4.3 and §9.
- **Depends:** PL-1, NAV-1. **Size:** ~450.

#### PL-2b Lab: Map and Gaps
- **Files:** `components/PlaybookLabMap.tsx`, `components/PlaybookLabGaps.tsx`, `app/lab.css`.
- **Acceptance:** [01](01-playbook-lab.md) §4.4–4.5; the map scrolls inside its container at 390 px with no page overflow; every count links to a Feed showing that many trades.
- **Depends:** PL-2a. **Size:** ~300.

#### IN-3 200 EMA (gated on `OD-18` and D-G)
- **Files:** new `lib/ema.ts` (or in `lib/session-indicators.ts`), `components/TradeChart.tsx` (line series), `components/TradeDetail.tsx` (View toggle; ≤ 10 net lines), loader for extra day windows on 5m, token `--ind-ema200`.
- **Acceptance:** [03](03-indicators-and-levels.md) §6; unavailable with a reason when the warm-up is short.
- **Size:** ~400.

### L4 — Review & days

#### DR-1a Daily review model, local store, backup
- **Files:** new `lib/daily-review.ts` (types, `proposeTradeIds`, `dailyReviewTotals` via `buildDayCardData`, uniqueness), new `lib/daily-review-store.ts` (`mogmine-daily-reviews-v1`, `user_id`), new `lib/daily-review-sanitize.ts`, `lib/journal-backup.ts` (+ `daily_reviews`), `components/TuneScreen.tsx` backup wiring (pass-through only), tests.
- **Acceptance:** [06](06-daily-review-and-review-cards.md) §2 rules 1–6 as tests; backup round-trip; old backup leaves reviews untouched.
- **Size:** ~400.

#### NAV-1 Move between days; Feed filters
- **Files:** `lib/selectors.ts` (`FeedFilters` + `date`, `account`, `playbook`, `tag`; `parseFilters`, `filtersToQuery`, `applyFilters`, `describeFilters`), `components/FeedScreen.tsx` (chips), `components/TodayScreen.tsx` + `components/DayHeader.tsx` (`?date=`, arrows, picker, "Back to today", after-close banner), `components/ReviewScreen.tsx` (day chips), tests.
- **Acceptance:** [06](06-daily-review-and-review-cards.md) §5; arrows skip weekends; deep link `/feed?playbook=orb-reclaim&tag=Level%20Sweep` shows the same trades as the Lab count.
- **Size:** ~400. Before RS-3a touches `lib/selectors.ts` (wave order handles it).

#### DR-2 Day review screen and Days strip
- **Files:** new `app/review/day/[date]/page.tsx`, new `components/DayReviewScreen.tsx` (+ points editor), `components/ReviewScreen.tsx` (Days strip mount), CSS in a new `app/review-day.css`.
- **Acceptance:** [06](06-daily-review-and-review-cards.md) §3 including the states; "Done for the day" does not change `review_status`; the separate "also mark reviewed" works with Undo.
- **Depends:** DR-1a. **Size:** ~450.

#### DR-3 Review cards, orientation, day sheet export
- **Files:** new `components/ReviewCard.tsx` (uses `ReviewChart` + `buildMarks`), `lib/shareCard.ts` (`16:9` layout table), new `lib/day-sheet.ts` (day sheet layout; Shield copy), `components/DayReviewScreen.tsx` (orientation toggle bound to `reviewCardOrientation`).
- **Acceptance:** [06](06-daily-review-and-review-cards.md) §4 table and Shield column; portrait one column at 390 px; landscape two per row at ≥ 1024 px; PNG ready before Share.
- **Depends:** DR-2, IN-1. Card R text follows whatever RS-3a has merged. **Size:** ~450.

#### DR-1b Daily reviews in Supabase and the API
- **Files:** new `supabase/migrations/<timestamp>_mogmine_daily_reviews.sql` (jsonb pattern, generated columns, RLS, allow-list, grants), `lib/persistence/contract.ts` + `registry.ts` (`daily_reviews`), `lib/persistence/supabase-adapter.ts` / `local-adapter.ts` if they enumerate types, sync wiring as for plans (#192), `lib/commands/journal-commands.ts` (parse, 409 on duplicate day/account), tests incl. the fake Supabase.
- **Acceptance:** `/api/v1/records/daily_reviews` create/list/get works in tests; RLS policies mirror `mogmine_plans`; the migration is **not applied** by the worker (Chris applies it, D-012).
- **Depends:** DR-1a. **Size:** ~350.

#### UX-A Copy and counting fixes
- **Files:** new `lib/day-counts.ts` (`dayTradeCounts`), `components/AppShell.tsx` (header text), `components/ReviewScreen.tsx` (queue wording), `lib/session-review.ts` (whole-day window for an unanchored plan written after the close), `components/SessionReview.tsx` (one line of copy), tests.
- **Acceptance:** [06](06-daily-review-and-review-cards.md) §6 three bullets.
- **Size:** ~200.

### L5 — Agent API (and the Lab model)

#### API-1 House rules at discovery; list defaults fixed
- **Files:** new `lib/agent/house-rules.ts`, `lib/agent/openapi.ts` (`info.description`, `x-mogmine-house-rules`, per-operation notes, `setupBlock` line), `app/.well-known/mogmine.json/route.ts` (via `buildDiscovery`), new `app/api/v1/guide/route.ts`, `lib/agent/http.ts` (`includeArchived`/`includeSamples` default false), tests.
- **Acceptance:** [07](07-agent-api.md) §6 first and fourth bullets; archived accounts absent by default.
- **Size:** ~350.

#### PL-1 Lab model (pure)
- **Files:** new `lib/playbook-lab.ts`, tests on fixtures.
- **Acceptance:** [01](01-playbook-lab.md) §6; counts equal the Feed filter results for the same parameters (shared predicate from NAV-1 if merged, else a local one replaced later).
- **Size:** ~350.

#### API-2a Vocabulary, derived values, list filters
- **Files:** new `app/api/v1/vocabulary/route.ts`, `lib/agent/dispatch.ts` (`include=derived`, filters), `lib/agent/http.ts` (parse filters), `lib/commands/journal-commands.ts` (filtered list on top of `list`; read-only additions), `lib/agent/openapi.ts`, tests.
- **Acceptance:** [07](07-agent-api.md) §3.1 and §3.5; derived values match `resultR`/`riskR` (RS-1) and `tradePnl`.
- **Size:** ~400.

#### API-2b Write-time checks
- **Files:** new `lib/agent/write-checks.ts` (pure: warnings and refusals of [07](07-agent-api.md) §4 that are not already in the command layer), `lib/agent/dispatch.ts` (attach `warnings`), `lib/agent/openapi.ts`, tests per row.
- **Acceptance:** every §4 row; refusals list valid names.
- **Depends:** API-2a. Tag refusal **gated on Q-9** (ship it as a warning until answered). **Size:** ~350.

#### API-3 Candles and the trade check
- **Files:** new `app/api/v1/candles/route.ts`, new `app/api/v1/checks/trade/route.ts`, new `lib/agent/candles.ts` (server loader through `MarketDataProvider`, LRU cache, upstream cap), `lib/agent/openapi.ts`, tests with the provider mocked.
- **Acceptance:** [07](07-agent-api.md) §3.2–3.3; trade C and A patterns.
- **Depends:** FB-1, SM-1. **Size:** ~400.

#### API-4 Levels endpoint
- **Files:** new `app/api/v1/levels/route.ts`, new `lib/agent/levels.ts` (LV-1 + planned as-of + VWAP with `gapPolicy`), `lib/agent/openapi.ts`, tests.
- **Acceptance:** [07](07-agent-api.md) §3.4; as-of cut proven by a test that moves `as_of` one bar.
- **Depends:** API-3; VWAP tolerance after IN-2. **Size:** ~350.

#### PL-3 Tag registry (gated on Q-6)
- **Files:** new singleton `tag_registry` (contract, registry, sanitizer, sync, backup), Tune editor section (new component), `lib/playbooks.ts` reads from it, vocabulary endpoint reads from it.
- **Size:** ~450, likely two PRs.

## 4. Shared files and their order

| File | Packages that touch it | Rule |
| :--- | :--- | :--- |
| `lib/trades.ts` (1,163, grandfathered) | RS-1, SM-1 (`excursions` only), RS-3a, RS-3b, UX-C | Waves keep them apart. No net growth: new logic goes to new modules (`lib/r-size.ts`, `lib/fill-match.ts`, `lib/stop-facts.ts`). State line counts. |
| `components/TradeDetail.tsx` (807, grandfathered) | IN-1, RS-2, SM-3, LB-B2, IN-2, RS-3b, IN-3 | Each ≤ 10 net lines; new UI in new components; rebase on every merge. |
| `components/TradeChart.tsx` (578, grandfathered) | LB-A, LB-B1, LB-B2, IN-3 | L3 only. |
| `lib/trade-marks.ts` | FB-1 (w2), SM-2 (w3), RS-3b (w4) | In that order. |
| `lib/trade-bar-validation.ts`, `lib/data-notes.ts` | SM-1, FB-1, SM-2, SM-3 | L2 only, sequential. |
| `lib/trade-document.ts` (1,824, grandfathered) | SM-2 | No net growth. |
| `lib/commands/journal-commands.ts` | RS-1 (w1), API-2a (w3, read-only additions), SM-3 (w4), DR-1b (w5), UX-C (w6), UX-B (w7), IN-1 (w1, only if prefs fields are enumerated) | IN-1 and RS-1 are both wave 1: IN-1 touches only the prefs validator block, RS-1 only trade/account parsing. Everyone else is in a different wave. |
| `lib/selectors.ts` | NAV-1 (w2), RS-3a (w3) | In that order. |
| `lib/prefs-sanitize.ts` | IN-1 only | All new prefs land in IN-1. |
| `lib/persistence/contract.ts`, `registry.ts` | DR-1b only (PL-3 later) | |
| `lib/agent/openapi.ts` | API-1, API-2a, API-2b, API-3, API-4 | L5 only, sequential. |
| `lib/shareCard.ts` | RS-3a (w3), DR-3 (w4) | In that order. |
| `components/ReviewScreen.tsx` | NAV-1 (w2), DR-2 (w3), RS-3b (w4), UX-A (w6), UX-D (w6) | UX-A and UX-D both wave 6: UX-A edits queue wording, UX-D adds a chip; small, but the integrator merges UX-A first. |
| `components/TuneScreen.tsx` (474, over target) | DR-1a (backup pass-through), PL-2a (link text) | One or two lines each. |
| `lib/journal-backup.ts` | RS-1, DR-1a | Both wave 1: different keys; the second to merge rebases. |
| `app/globals.css` (1,174) | LB-A (token lines only) | Everything else goes in new per-feature CSS files imported once in `app/layout.tsx` (the `chart-polish.css` pattern). `app/layout.tsx` import lines are the only shared edit there. |

## 5. Not in these packages

- The 5m fallback for levels (`OD-55` b), the candle archive (`#70`, `R-04`), trade documents as stored events (`OD-30`), level snapshots on trades (`OD-20`, Q-8), the faster stop-move chip ([05](05-stops-mae-fills.md) §3.3), sizing-discipline stats, batch create in the API, a fifth nav item (Q-1), any broker work (`D-009`).
- Running the R backfill or the daily-review migration script against real accounts, and applying the Supabase migration: Chris does those.

## 6. Spec write-backs for the integrator

Workers do not edit these (AGENTS §6.1). The integrator or Chris applies them as packages land:

| Doc | Change | When |
| :--- | :--- | :--- |
| AGENTS.md §3b-4 | "R is null without a stop" → risk R null without a stop or stated risk; result R null only when P&L is not computable | D-A yes, with RS-3a |
| DECISIONS.md | New entries for D-A … D-I and Q-1 … Q-11 as Chris answers; close or amend `OD-10` (R = P&L ÷ account R size), `OD-55` (a) (done by LB-A), note `LV-09` changes (D-D, D-E), `OD-18` (VWAP gap tolerance, D-F) | as decided |
| docs/09 `B-32` | R definition | with RS-3a |
| docs/12 §5 `LV-09` | labels behind candles; tap mode; axis tags | LB-A, LB-B1 |
| docs/15 §3 | `"untimed"` basis; move time never from `initial_stop_set_at` | SM-2 |
| docs/16 `R-10` | R measured on the initial stop, as account R | RS-3a |
| docs/21 §1 | `r_size_cents` on accounts | RS-1 |
| docs/24 §3–4 | VWAP remembered, Globex tolerance; whole-day window for an unanchored late plan | IN-1, IN-2, UX-A |
| docs/26 §3–4 | `risk_cents` as a materialized derived field; new `daily_reviews` type | RS-1, DR-1b |
| docs/23 §6 | Day card and review cards are built (DR-3) | DR-3 |
| D-010 | scratch threshold on the trade's own risk | D-C yes |
| `OD-28` | adds the ±5 min price match next to the 3-bar missing-bar snap | FB-1 |
