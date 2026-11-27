# ROADMAP.md — Grand Plan, Feature Tracks, and the Design Rules That Ride With Them

This file keeps three things together so none gets forgotten:

1. **The Grand Plan & operating model (§0, §4b).** How MogMine's closed learning loop connects, how human/agent/app responsibilities divide, and how we execute in bounded, convergence-first waves.
2. **Rounding out features (§2–§4).** Each track lists what is still missing to make the system complete, honest, and verifiable against the 11-step acceptance scenario in [MOGMINE-BLUEPRINT.md](MOGMINE-BLUEPRINT.md) §6.
3. **Nudging design into place (§1, §3).** Each track lists the empirical UX/UI standards (`DS-01`–`DS-12`) to apply *the next time someone touches that area*. No disruptive big-bang redesign is needed.

Started 2026-11-26 and elaborated 2026-11-27 from [DESIGN-PRINCIPLES-REVIEW.md](DESIGN-PRINCIPLES-REVIEW.md), [MogMine UX_UI Design Principles.md](<MogMine UX_UI Design Principles.md>), `MogMine Product, UX, and Agent-First Architecture Audit.pdf`, [MogMine Comprehensive Codebase Audit.md](<MogMine Comprehensive Codebase Audit.md>), [MOGMINE-BLUEPRINT.md](MOGMINE-BLUEPRINT.md), [DECISIONS.md](DECISIONS.md), live `showmob-dev` schema verification, and `origin/main` at `4b9b75e`. Read §8 before editing.

## How this file relates to the others

| File | Owns | Does not own |
|---|---|---|
| [MOGMINE-BLUEPRINT.md](MOGMINE-BLUEPRINT.md) | Current state, **priority order**, locked `$300` R definitions, 11-step acceptance scenario | Item-level detail |
| [DECISIONS.md](DECISIONS.md) | Settled owner decisions (`D-`, `OD-`) | Plans |
| **ROADMAP.md (this file)** | Closed-loop operating model, wave sequence, design standards (`DS-`), roadmap items (`RM-`) and their acceptance criteria | Priority order (that's the Blueprint), active worker claims (that's BOARD) |
| [BOARD.md](BOARD.md) | Active wave lanes and atomic locks. The planner copies `ready` `RM-` items from §4b into it. | Long-range plans |
| `docs/01`–`docs/26` (+ `docs/27`) | Subsystem specs and design detail | Live status |

**No `ARCHITECTURE.md` is needed.** Architecture lives in [docs/01-architecture-and-stack.md](docs/01-architecture-and-stack.md), and the Blueprint is the map. A third file would drift from both. Update `docs/01` instead (see RM-N6). The Blueprint's document hierarchy (§5) should list this file at the same level as BOARD (see RM-N1).

**Status values** (same as BOARD): `ready` · `claimed` · `review` · `blocked (reason)` · `done` · `parked`.

---

## 0. The Grand Plan: Closed-Loop Architecture & How We Work Moving Forward

### 0.1 The product spine (one chain of evidence, not disconnected tabs)

MogMine is a **closed-loop trading improvement system**, not a P&L scrapbook or an analytics dashboard. Every screen, store, and API endpoint serves one feedback loop:

```text
PLAN (bias, levels, watched playbooks)
  ↓
OBSERVE / RECORD (fills, fixed-R sizing, 3-stage notes, mood, discretionary calls)
  ↓
REVIEW (trade Pit Stop + daily review against the pre-declared plan)
  ↓
PATTERN CANDIDATE (Playbook Lab slices + evidence-backed observations)
  ↓
PRACTICE (sealed-right-edge Drills + isolated Replay sandbox)
  ↓
RESEARCH TEST (Strategy Lab frozen-recipe validation on archived 1m bars)
  ↓
PLAYBOOK REVISION (versioned, owner-approved rule updates)
  ↓
LIVE TRANSFER (did post-practice live process adherence actually improve?)
  └──────────────────────────────────────────────────────────→ next PLAN
```

Instead of inventing a monolithic "learning" table, existing primitives (`plans`, `trades`, `daily_reviews`, `playbooks`, `drills`, `strategy_recipes`, `strategy_runs`, `calls`) link via lightweight IDs and version stamps so journal facts are never duplicated.

### 0.2 Division of labor: External Agent ↔ MogMine ↔ Trader

1. **The External Agent collects, queries, and drafts.** Agents talk to `/api/v1` over scoped bearer keys (`mmk_…`), read server-computed models (`/session`, `/review-queue`, `/vocabulary`, `/candles`, `/levels`, `/checks/trade`), and draft journal records or research hypotheses. Agents **never** invent market/R math in prompt space, **never** silently mutate active playbooks or risk settings, and **never** place broker orders (`B-01`).
2. **MogMine enforces financial, temporal, and statistical truth.** Integer ticks and integer cents; per-account fixed `1R` (`$300` standard, whole-micro `Math.ceil` sizing recorded separately from `stated_risk_r`); `America/New_York` / `America/Chicago` session boundaries; Databento-over-Yahoo 1m bar precedence; strict separation between **Realized**, **Replay**, and **Hypothetical** results; optimistic concurrency + idempotency; and `"by agent"` provenance.
3. **The UI allocates human attention where only human judgment counts.** `Today` is a calm checkpoint (`≤ 3` ranked Next actions: **Truth > Review > Practice > Research**, or `"Caught up"`), `Review` grades process without hindsight distortion, `Drills` and `Replay` train pattern discrimination without risking capital, and the owner holds sole authority to promote playbook or risk changes.

### 0.3 Operating rules: how we work moving forward

1. **Convergence before expansion (`Blueprint §3`).** No new feature verticals open until existing subsystems reconcile cleanly and pass the **11-Step End-to-End Acceptance Scenario (`Blueprint §6`)**. Every proposed item must answer: *What decision will the trader make differently, and how will MogMine measure whether that transferred to live behavior?*
2. **Sequenced, bounded multi-agent waves (§4b).** Work ships in focused waves of **5–8 isolated git-worktree lanes + 1 Integrator/Verifier** (`~250–450` changed lines per worker lane, `AGENTS.md §6`):
   - **Pure domain & read-model lanes land or freeze types first** (`lib/**`, `app/api/**`, unit tests).
   - **UI lanes own strictly disjoint component files** — two workers never edit `TodayScreen.tsx`, `TradeDetail.tsx`, `TradeChart.tsx`, or `app/globals.css` concurrently.
   - **Workers run targeted tests + `npm run typecheck`** (`nice -n 10`, `--test-concurrency=2`). The Integrator merges in dependency order, wires shared shells, and runs the full gate (`typecheck`, `lint`, `npm test`, `check:file-length`, `next build`).
3. **Hotspot extraction rule (`≤ 450` lines, `#177`).** Twelve production files currently exceed 450 lines (`lib/trade-document.ts` 1810, `app/globals.css` 1373, `lib/trades.ts` 1189, `lib/mood.ts` 899, `StopMovesEditor.tsx` 826, `TradeChart.tsx` 774, `TradeDetail.tsx` 674, `lib/shareCard.ts` 659, `ChallengeDetail.tsx` 596, `lib/trade-marks.ts` 513, `lib/day-card.ts` 507, `PlanSheet.tsx` 487). Any wave touching a hotspot extracts a cohesive sub-module (e.g., `lib/next-actions.ts` rather than bloating `TodayScreen.tsx`) and reports before/after line counts.
4. **Design-nudge piggybacking (`DS-01`–`DS-12`).** Every feature PR applies the track's listed `DS-*` rules to the exact files it touches (denominators on rates, APCA-safe tokens, 44 px targets, keyboard `J`/`K`, named empty/error states, `"by agent"` markers).
5. **Same-wave doc parity ("Current Invariant vs. Historical Incident").** Whenever code closes a gap or supersedes old spec prose, the spec updates in the same wave so future agents reading `docs/` never reintroduce a fixed bug (such as the historical Shield quantity bug).

---

## 1. Design standards: the definition of done for any UI change

Every PR that changes a screen checks the standards that apply to what it touched. If a standard can't be met, the PR says why, and the planner adds an owner decision. Once `docs/27-design-principles.md` exists (RM-N4), these become short pointers into it.

| ID | Standard | Current state |
|---|---|---|
| **DS-01** | **Readable contrast.** Every text token passes WCAG 2.2 AA **and** APCA on all three surfaces (`--bg-obsidian`, `--bg-surface`, `--bg-elevated`): Lc ≥ 75 body text, Lc ≥ 60 labels, hints and axis text, Lc ≥ 45 only for large headings. | **Failing.** Muted, faint, axis and loss text sit at Lc 35–50 (RM-B1). |
| **DS-02** | **Direction never by color alone.** Up/down, win/loss and long/short also carry sign, arrow, luminance or edge/style cues: ▲▼, `+`/`−`, and grayscale-distinguishable candles. Hollow candles are rejected. | Partly met. Signs and arrows exist; candle grayscale direction cues are still in RM-B2. |
| **DS-03** | **Honest numbers.** Tabular figures; true minus `−`; money always has two decimals; R is always signed. **No percentage without its denominator nearby** (`10/12`, not `83%`), and below n = 10 the label says "early". | Formatting met ([lib/format.ts](lib/format.ts)). The denominator rule isn't audited yet (RM-B5). |
| **DS-04** | **Process over outcome.** Gold only for rule-following (UX-66, #80). No confetti, sounds or streaks for dollar wins. Skill challenges stay valid on a correctly executed loss, and a planned no-trade day can count as success. | Met, except the no-trade day (RM-H2). |
| **DS-05** | **Facts, derived values and hypotheticals look different.** Realized, replay and backtest results never share one chart or total. Hindsight is labelled (OD-12, D-010). Strategy Lab results say "hypothetical". | Mostly met. Strategy Lab labelling isn't audited (RM-J6). |
| **DS-06** | **Agent provenance.** Anything an agent wrote is marked where it's read. An agent may *propose* a playbook or risk change, and only the owner makes it current. | **Not met.** Writes are logged under Settings → Agent keys, but nothing shows on the record (RM-K1). |
| **DS-07** | **Shield is display only.** It never changes what the API returns. Share cards open with Shield on (OD-46a). | One leak: `lib/agent/strategy-lab.ts:163` (RM-A8). |
| **DS-08** | **Calm attention.** Work arrives as queues, not interruptions. Today shows at most **three** ranked actions and says "Caught up" when nothing is due. Only data-truth problems interrupt. | Queues exist. The Today ranking doesn't (RM-C1, RM-C5). |
| **DS-09** | **Touch and keyboard.** 44 px minimum targets. List and detail screens get keyboard parity on desktop (J/K, Enter, Esc), with shortcut hints in menus. Never override browser shortcuts. | Met on Trade Detail (UX-69). Feed/Review list parity open (RM-F3). ⌘K and `?` are parked. |
| **DS-10** | **Two disclosure levels at most.** Nothing decision-critical (stop, risk, account, Shield state, sync state) is hidden behind a second level. | Audit owed; RM-B7 makes the screen-by-screen check explicit. |
| **DS-11** | **Every state is named.** Empty, offline, loading, error and "caught up" each have words. Every agent-generated object has a visible state (pending, confirmed, rejected). | Journal screens met. Agent objects don't exist yet. |
| **DS-12** | **Dark theme only for now.** The `#07080c` canvas stays pending an owner decision. Primary text softens to `#e6e8ec` if approved (RM-B1). | Owner decision pending (§5). |

---

## 2. Track A: data truth, sync safety, and the candle archive (first)

This matches Blueprint §3 priorities 2–4. It goes first because lost market history can't be recovered and silent write races corrupt journal evidence.

**Verified live state (2026-11-27 against `origin/main` at `4b9b75e` and `showmob-dev` ref `vsasmtsifuylhfrrsrso`):**
- **PR #282 (`e164930`) and PR #296 (`4b9b75e`) are both merged on `main`.**
- Live Supabase inspection confirmed all 25 `mogmine_*` tables have `rls_enabled: true`:
  - `mogmine_market_candles` holds **92,569 `MES=F` 1-minute rows** (90,840 Databento bars Aug 25 – Nov 24 2026 + 1,729 Yahoo bars Nov 25–26), `mogmine_market_coverage` has **68 rows**, `mogmine_market_archive_jobs` has **5 rows**, and `mogmine_market_rolls` has **3 rows**.
  - `mogmine_daily_reviews`, `mogmine_tag_registries`, `mogmine_strategy_recipes`, and `mogmine_strategy_runs` are all live on `showmob-dev`.
  - One empty legacy table, `mogmine_bars_1m` (0 rows, from `20261126120000_mogmine_strategy_lab.sql`), sits alongside `mogmine_market_candles` and should be retired (`RM-A14`).
- `GET /api/cron/archive-topup` (`vercel.json` at `23:00 UTC` daily, `lib/market-data/top-up.ts`) now fetches Yahoo server-side and upserts completed CME sessions without ever overwriting Databento bars. **Action needed in Vercel Production:** set `CRON_SECRET` and verify `SUPABASE_SERVICE_ROLE_KEY` so the daily cron executes (`RM-A4` surfaces this in Tools).

| ID | Item | Acceptance criteria | Status |
|---|---|---|---|
| **RM-A1** | Merge PR #282 (migrations are already applied on `showmob-dev`, so this records them in the repo). Close PR #71 as superseded. | Migrations `20261126073815_*` and `20261126081228_*` are on `main`. #71 is closed with a link to #282. The Blueprint's #71 rule is updated (RM-N1). | done (`e164930`; #71 closed) |
| **RM-A2** | **Daily archive top-up, run on the server.** Server route fetches Yahoo itself and upserts completed sessions (`GET /api/cron/archive-topup` at 23:00 UTC with `CRON_SECRET`, `lib/market-data/top-up.ts`). | Idempotent: rerunning adds 0 rows. Databento-over-Yahoo DB guard holds. Writes coverage + `mogmine_market_archive_jobs` row. Service-role guard pinned in `lib/__tests__/auth.test.ts` and `market-data-top-up.test.ts`. Needs `CRON_SECRET` set in Vercel Production for live runs. | done (`4b9b75e` / PR #296; env check via RM-A4) |
| **RM-A3** | Optional write-through: when `/api/market-data` falls back to Yahoo for a **completed** session, upsert those bars. | Never writes an in-progress session. Same guard and idempotence as RM-A2. | parked (RM-A2 covers it) |
| **RM-A4** | Show archive status in Tune/Tools (`components/TuneScreen.tsx` + read-only `/api/market-data/status`): newest bar timestamp, session count, missing sessions, and latest `mogmine_market_archive_jobs` run status/time. | Follows DS-11. A gap of more than one completed trading day or a failed/missing cron run shows an explicit warning. | ready |
| **RM-A5** | Backfill Jan 25 – Aug 24 2026 Databento bars. They're already converted, on the machine that ran the conversion. | Coverage rows for every session in that range. Spot checks match the Parquet files. | blocked (owner) |
| **RM-A6** | Session calendar and holidays, so coverage says `closed` instead of `missing` on exchange holidays. | Thanksgiving and other CME holidays show `closed`. | blocked (#65, OD-35) |
| **RM-A7** | Agent write safety (`lib/agent/handle.ts`, `lib/agent/dispatch.ts`, migration on `mogmine_agent_audit` + `mogmine_agent_idempotency`): `Idempotency-Key` on `POST` creates (replay 2xx on matching payload hash, 409 in-flight, 422 payload mismatch), `expected_updated_at` / `If-Match` on `PUT`/`PATCH` updates (409 on stale version), and canonical `request_id` in responses. Audit row gains `request_id`, `workflow` (`X-MogMine-Reason`), and `house_rules_version` without copying private prose. | Retrying a create with the same key makes one record; mismatched body returns 422; stale update returns 409. Device sync already uses `expectedUpdatedAt` ([lib/persistence/store-sync.ts](lib/persistence/store-sync.ts)). | ready |
| **RM-A8** | Make Shield display-only in the API: pass `shield: false` instead of `prefs.shield` in `lib/agent/strategy-lab.ts:163`. If redacted agent responses are ever wanted, make that an explicit query parameter or scope. | `/api/v1/strategy-lab/context` returns identical payloads with UI Shield on or off. Regression test in `lib/__tests__/` proves it. | ready (pending DS-07 confirmation) |
| **RM-A9** | Use operation-specific OpenAPI request schemas in `lib/agent/openapi.ts` (`CreateTradeInput`, `PatchTradeInput`, `DailyReviewInput`, `PlanInput`, `AccountInput`, `PlaybookInput`, `TradeCheckInput`) instead of generic `additionalProperties: true` (`lib/agent/openapi.ts:116`). | Each write operation references a named component schema with machine-readable `required` fields and `additionalProperties: false` where strictness applies. OpenAPI contract test validates every write route. | ready |
| **RM-A10** | Before any second user: decide on a dedicated Supabase project and replace the in-process rate limiter with a durable one (Blueprint §7). | An owner decision is recorded. | parked |
| **RM-A11** | Agent-triggered backfill (`POST /api/v1/market/top-up`): an agent with `write` scope invokes `lib/market-data/top-up.ts` for a bounded symbol/date window, **never** passing prices. | Same Databento precedence, `OD-15` symbol allowlist, and idempotence as `/api/cron/archive-topup`. Logged in `mogmine_agent_audit` and `mogmine_market_archive_jobs`, documented in OpenAPI. | ready |
| **RM-A12** | Protect local data from browser eviction (`lib/storage-persist.ts` + Tools status row): call `navigator.storage.persisted()` / `navigator.storage.persist()` on startup, and warn a device-only user (notably iOS Safari's 7-day ITP purge) to sign in to sync or install to the Home Screen. | Persisted grant status (`persisted` / `best-effort`) is shown in Tools. Unsynced device-only mode with `false` persistence shows a calm, dismissible warning once. | ready |
| **RM-A13** | Delete versus edit conflicts. Today a record deleted on one device and edited on another is re-created, on purpose (docs/26 §8.2). Decide whether to keep that or add `deleted_at` tombstones. | Owner decision recorded in DECISIONS.md, with a test for the chosen behaviour. | blocked (owner) |
| **RM-A14** | Retire empty duplicate bar table `public.mogmine_bars_1m` (created in `20261126120000_mogmine_strategy_lab.sql`, 0 rows on `showmob-dev`, superseded by `public.mogmine_market_candles` in PR #282). | Repoint `lib/strategy-lab/bars-cache.ts`, `bars.ts`, and `use-lab-persistence.ts` to read `mogmine_market_candles` (`MES=F`, `1m`), add a new migration dropping `public.mogmine_bars_1m`, and update `lib/__tests__/strategy-lab-persistence.test.ts`. | ready |

---

## 3. Track B: design hygiene & perceptual precision (Wave 7)

Token, typography-audit, and canvas verification changes only. Zero behavioral regressions.

| ID | Item | Acceptance criteria | Status |
|---|---|---|---|
| **RM-B1** | Contrast tokens (DS-01, DS-12) in `app/globals.css`, `lib/chart-paint.ts:25`, and `DEFAULT_CARD_THEME` in `lib/shareCard.ts`. Confirm final hexes in the APCA 0.0.98G calculator. | Every text token passes WCAG 2.2 AA (≥ 4.5:1) and APCA (`Lc ≥ 75` body, `Lc ≥ 60` labels/axis/small P&L) across `--bg-obsidian`, `--bg-surface`, and `--bg-elevated`, enforced by a new `lib/__tests__/contrast.test.ts`. | ready (`--text-primary` waits on owner) |
| **RM-B2** | Filled candle direction cues (DS-02) in `TradeChart.tsx`, `ReviewChart.tsx`, and card chart painters. Do not introduce hollow candles; use luminance and existing sign/arrow redundancy. | Up vs down direction is unmistakable in pure grayscale and across both classic and `blue-orange` palettes. Share cards inherit automatically via live theme read. | ready |
| **RM-B3** | Fix the stale Shield text in `docs/20-price-first-entry.md:18`. The contracts field is masked (`••`) yet editable, never hidden (`AddTradeSheet.tsx:399`). | Doc matches `components/AddTradeSheet.tsx` and cites the historical defect fix so agents never re-hide quantity. | ready |
| **RM-B4** | Strategy Lab results header (`components/StrategyLabResults.tsx`, `lib/strategy-lab/results-view.ts`) displays the active slippage assumption. | Every Strategy Lab results view states `"Slippage: N ticks stop · N ticks market"` alongside the R basis. | ready |
| **RM-B5** | **Denominator & small-sample sweep (`DS-03`).** Add `formatRateWithCount(num, den, { minN?: number })` in `lib/format.ts` (`"10/12 (83%)"`, or `"4/5 · early"` when `den < 10`) and apply across `RunningStatsCard.tsx`, `PlaybookBinder.tsx`, `PlaybookLab`, `ChallengeCard.tsx`, `DrillScreen.tsx`, and `DayReviewScreen.tsx`. | No win rate, rule-adherence rate, or drill accuracy renders as a bare percentage without its `num/den` count adjacent. Unit tests cover `den = 0`, `den < 10`, and `den ≥ 10`. | ready |
| **RM-B6** | **Canvas primitive & DPR verification pass.** Audit `PositionBoxPrimitive.ts`, `SessionLevelsPrimitive.ts`, and `ReviewChart.tsx` against `lightweight-charts` v5 invariants: DPR-crisp coordinate snapping (`crisp()`), reference-stable `paneViews()`, cached `autoscaleInfo()`, `detached()` cleanup, and `vertTouchDrag: false` on embedded cards. | Automated test in `lib/__tests__/canvas-primitives-audit.test.ts` pins view-array reference stability, `detached()` teardown, and scroll-hijack flags. | ready |

| **RM-B7** | Progressive disclosure audit (DS-10) across Today, Trade Detail, Review, Feed, Tools and Strategy Lab. | A screen matrix records level-one decision facts, one-level disclosures, and exceptions. Stop, risk, account, Shield and sync state remain visible without a second disclosure. | ready |
| **RM-B8** | UI component consistency pass: standardize cards, chips, buttons, tabs, sheets, spacing and typography using existing tokens. | Touched surfaces use the shared component vocabulary and spacing scale; one-off treatments require a documented exception. | ready |
| **RM-B9** | Screen-state audit for loading, empty, offline, error and recovery states. | Every major screen has named states with a recovery action where recovery is possible; no blank panel or spinner-only state remains. | ready |
| **RM-B10** | Responsive visual regression suite for desktop and mobile layouts. | Stable screenshots or equivalent assertions cover `390×844` and desktop width for Today, Trade Detail, Review, Feed, Tools and Strategy Lab. | ready |

Proposed token values (worst-case surface is `--bg-elevated` `#141824`):

| Token | Now | Proposed | Lc now → proposed |
|---|---|---|---|
| `--text-primary` | `#f4f5f7` | `#e6e8ec` (owner) | 100 → 92 |
| `--text-muted` | `#8e95a9` | `#c1c5d0` | 44 → 70 |
| `--text-faint` | `#7b8498` | `#aeb3c0` | 35 → 60 |
| `--chart-axis-text` | `#8b93a7` | `#aeb3c0` | 43 → 60 |
| `--loss-text` | `#ff6f7a` | `#ff949c` (check it still reads as loss) | 49 → 60 |
| blue-orange `--profit-text` | `#7fb2ff` | `#84b5ff` | 59 → 60 |

The greys step evenly (92 / 70 / 60), so muted and faint stay distinguishable. Compare during RM-B1 against the codebase audit's close ramp: secondary `#c5cbd6` (Lc 74), muted `#adb6c4` (Lc 61), loss `#fca5a5` (Lc 65), win `#5eead4` (Lc 80), and Okabe-Ito dark pair `#56B4E9` / `#E69F00`.

---

## 4. Feature tracks: round out the feature, nudge the design

Each track has **Round out** items, needed for the feature to be complete, and **Design nudges**, to apply in the next PR that touches the area. Where a step of the Blueprint §6 acceptance scenario depends on a track, it's named, because the scenario is the real proof of completeness (0 of 11 verified on a real phone as of 2026-11-27).

### Track C: Today, the human checkpoint & attention allocator
*Acceptance scenario steps 2 and 8.*

| ID | Round out | Acceptance criteria | Status |
|---|---|---|---|
| **RM-C1** | **"Next" decision card (`lib/next-actions.ts` + `components/NextActionsCard.tsx`):** at most **three** ranked actions ordered **Truth > Review > Practice > Research**, computed purely from signals the app already has (unresolved fill-to-bar match, missing initial stop on a real trade, archive gap > 1 day, unreviewed real trades, unfinished daily review, due missed drills). | Renders `"Caught up"` when nothing is due — never fabricates filler advice. Every item deep-links to an existing route. On `390×844` mobile only item #1 is expanded (`"N more"` disclosure); `TodayScreen.tsx` stays under 450 lines. | ready |
| **RM-C2** | **Canonical session-state summary (`lib/session-summary.ts`):** `Plan ✓/○`, `Real / Replay` counts, `Review` state, `Process X/Y rules`, and account risk state computed by one pure function shared by `TodayScreen.tsx` and `/api/v1/session`. | Zero duplicate front-end recalculation that could disagree with `/api/v1/session`. Includes rule denominator (`6/7 rules`, DS-03). | ready |
| **RM-C3** | **"Current focus" line.** Points strictly to an owner-confirmed daily-review lesson or active playbook rule; an external agent cannot set or overwrite it silently. | Displays source link and provenance (DS-06). Hidden cleanly when no focus is pinned. | blocked (RM-K1) |
| **RM-C4** | **`GET /api/v1/session?date=&account_id=` read model** (`app/api/v1/session/route.ts`, `lib/agent/session.ts`): returns pre-session plans, real trades (with derived R/P&L), replay count, mood records, discretionary calls, daily review, process summary, and data-quality flags in one call. Blueprint priority 6 ("ask MogMine about Tuesday"). | One authenticated `read`-scope request answers `"what happened on Tuesday?"` with zero client-side joins, matching `RM-C2` byte-for-byte. Documented in OpenAPI and `/api/v1/guide`. | ready |
| **RM-C5** | **Exception-only Data Confidence banner (`DS-08`).** Computed inside `lib/session-summary.ts`: stays invisible when clean, and renders `"Data confidence: needs attention"` with exact counts (`"2 of 17 reviewed trades have unresolved fill times"`, `"1 archive session missing"`) when truth flags exist. | Never renders a synthetic percentage like `"94%"`. Links each count directly to the affected trades or Tools archive status. | ready |

**Design nudges:** DS-08 (three items max, "Caught up", exception-only truth banner), DS-03 (denominators on Progress stats), DS-10 (account, 1R, Shield and sync visible at Level 1).

### Track D: Review and the daily loop
*Acceptance scenario step 8.*

| ID | Round out | Acceptance criteria | Status |
|---|---|---|---|
| **RM-D1** | Verify daily reviews end-to-end across local store, Supabase adapter, and `/api/v1` (Blueprint priority 5). *Code & DB check 2026-11-27:* `lib/daily-review-store.ts`, `supabase-adapter.ts:65`, `/api/v1/records/daily_reviews`, and `public.mogmine_daily_reviews` on `showmob-dev` are all in place. | Integration test (`lib/__tests__/daily-review-sync-api.test.ts`) proves create → sync → `/api/v1` read/update → second-device pull and `(session_date, account_id)` uniqueness with zero data loss. | ready |
| **RM-D2** | Daily review (`components/DayReviewScreen.tsx`, `lib/daily-review.ts`) explicitly links to and renders the session's pre-session plan(s) and real trades, excluding replay/sample trades unless explicitly toggled. | Opening `/review/day/[date]` shows the session's plan bias/levels alongside linked real trades and plan fidelity (`X/Y trades matched plan`). | ready |
| **RM-D3** | Blind review experiment (BET-03, OD-25): stays **off by default** and is tried on trades older than a week. Record the result in DECISIONS.md. | A result is recorded. The default changes only by owner decision. | claimed (owner experiment) |
| **RM-D4** | Review tab count badge: keep the number or switch to a dot. | Owner decision recorded. | blocked (owner) |
| **RM-D5** | **Shared review-queue selector (`lib/review-queue.ts`).** Extract the ordering and real-trade filtering logic from `ReviewScreen.tsx` into one pure module shared by `/review` UI, the AppShell navigation badge and `GET /api/v1/review-queue` (`RM-K2`). | UI queue count, Today’s review due count, navigation badge and `/api/v1/review-queue` always return the exact same ordered items (excluding `is_sample` and isolating `replay`). | ready |

**Design nudges:** DS-05 (hindsight labelled in review), DS-06 (agent-written notes marked), DS-03.

### Track E: Trade detail, chart, and financial truth
*Acceptance scenario steps 4–6.*

| ID | Round out | Acceptance criteria | Status |
|---|---|---|---|
| **RM-E1** | Verify scenario steps 4–6 end to end on a phone: an agent-logged trade, a stop move, the close. | Chart, record, R, P&L and excursions agree on every surface. | ready |
| **RM-E2** | Continuous zoom-out: remove the fixed `MIN_BAR_SPACING_PX = 3` behavior or replace it with equivalent continuous scaling so candles shrink toward approximately 1px, TradingView-style. Include crosshair accuracy, candle selection and level hit-testing at narrow widths. | Pinch/scroll zoom on a 390px phone keeps adding visible history; crosshair, candle and level hit-testing remain accurate at thin spacing. Add regression coverage for `lib/level-hit-test.ts` and chart interaction helpers. | ready |
| **RM-E6** | Trade Detail simplification for mobile: price action first, essential trade facts second, human judgment third; move stop history, partials and plan-vs-actual behind clear disclosure. | At `390×844`, the chart and Entry/Exit, Initial stop and Result R remain visible without scrolling through secondary sections. Pit Stop remains available at level two and preserves all existing facts. | ready |
| **RM-E3** | Volume pane (`VOL-1`) check on real futures trades on a phone. | The band shows on real MES trades and hides on samples and indices. | ready |
| **RM-E4** | Commissions on trades: record `commission_cents` (integer cents) and show **Gross R** and **Net R** (`(gross_pnl_cents − commission_cents) ÷ r_size_cents`). Blueprint §2 still defines R and sizing. | Net R and Net P&L shown alongside Gross wherever P&L/R appear. Unknown commission reads as `null` / `"fees unrecorded"`, never `$0.00`. | ready (owner sets per-contract rates) |
| **RM-E5** | **Cross-surface financial & temporal truth suite (Blueprint §3.2).** Add `lib/__tests__/cross-surface-truth.test.ts` running canonical edge cases (shifted fill on 1m bar not admitting full bar range as sequenced excursion, timed & untimed stop moves, multi-lot partials, scratch within `max(0.1R, 2 ticks)`, open trade `OD-38`, `$300` ceiling sizing) across `deriveTrade`, `observeTrade`, `buildMarks`, `excursions`, `selectors`, `shareCard`, `day-card`, `describe.ts`, and `/api/v1` `?include=derived`. | Every surface produces identical P&L cents, Result R, Risk R, MAE/MFE, and process status for every fixture. | ready |

**Design nudges:** DS-02 (RM-B2), DS-09 (keyboard parity), DS-01.

### Track F: Feed (journal)

| ID | Round out | Acceptance criteria | Status |
|---|---|---|---|
| **RM-F1** | Keep Feed as browse and search, not analytics. Real / Replay / All exists. | No stats panels added to Feed. | standing rule |
| **RM-F2** | Label rename: Feed → Journal and Tune → Tools (routes unchanged). | Owner decision. | blocked (owner) |
| **RM-F3** | **Desktop keyboard navigation (`DS-09`)** on `FeedScreen.tsx` and `ReviewScreen.tsx`: `J`/`K` moves focus/selection through visible rows, `Enter` opens the trade, `Esc` clears/closes sheets, with subtle key hints and zero override of browser shortcuts (`Cmd/Ctrl+C/F/R`). | Tested in `lib/__tests__/` and verified alongside mobile touch scrolling. | ready |
| **RM-F4** | Sample-data lifecycle: keep demo/replay trades isolated from actual trading workflows, review queues, badges and totals. | Sample data is clearly labelled, excluded by default from real workflows, and can be removed or reset without touching real trades. | ready |

**Design nudges:** DS-03, DS-09 (J/K in the list), DS-11 (named empty-filter states).

### Track G: Drills, replay, and deliberate practice

| ID | Round out | Acceptance criteria | Status |
|---|---|---|---|
| **RM-G1** | Drill ground truth comes from playbook or owner labels (exemplar, anti-example, checklist), **never from whether the trade won**. *(Code note: `lib/drills.ts:90` `isMiss` currently requires `r < 0 && process === "broken"` or `r > 0 && process === "clean"`; decoupling `r` removes outcome bias completely.)* | Owner defines the authoritative label rule. `isMiss` scores strictly against process/setup quality, never realized `r`. | blocked (owner) |
| **RM-G2** | False-take rate (`anti_examples_called_take / anti_example_answers`) and false-pass rate (`clean_examples_called_pass / clean_example_answers`) with explicit denominators. | Shown on `DrillScreen.tsx` summary following DS-03 (`"early"` below `n = 10`, stable comparison after `n = 30`). | ready after RM-G1 |
| **RM-G3** | Transfer metric: post-practice live process adherence vs pre-practice baseline for the drilled playbook/rule, showing both sample sizes. | No directional claim shown under `n = 20` reviewed live trades per side. | parked (after RM-G1) |
| **RM-G4** | **Comprehensive Replay isolation suite (`lib/__tests__/replay-isolation.test.ts`).** Verify across `selectors`, `RunningStatsCard`, `challenges`, `playbook-lab`, `daily-review`, `ReviewScreen`, and `/api/v1/session` that `mode: "replay"` trades never alter live performance, drawdown guardrails, or Clean Run streaks unless explicitly queried. | Automated suite covers every consumer and passes 100%. | ready |

**Design nudges:** DS-04, DS-05, DS-03. The sealed reveal (`cutAtEntry` hiding the entry bar and all later bars) and 1/3/7-day miss spacing already exist (`lib/drills.ts`, docs/23 §4). Keep them; do not adopt SM-2 or FSRS unless the owner reopens scheduling.

### Track H: Challenges and account guardrails

| ID | Round out | Acceptance criteria | Status |
|---|---|---|---|
| **RM-H1** | Separate **Account Guardrails** (mechanical daily loss room, static/trailing/EOD drawdown floor, evaluation target read directly from `TradingAccount` rules) from **Skill Challenges** (Clean Run and process habits) in `TodayScreen.tsx` (Progress tab) and `ChallengeCard.tsx`. | Rendered under distinct headings (`Account Guardrails` vs `Skill Challenges`). Guardrails state buffer and next hard boundary mechanically and **never** suggest taking a trade to hit a profit target. | ready |
| **RM-H2** | A planned no-trade session can advance a skill challenge. `lib/challenges.ts` (`evaluateCleanRun`) currently advances only on `target_trades`. Support a pre-session plan + completed daily review recording disciplined flat/no-setup adherence without forcing trade count. | Unit test proves a planned, reviewed no-trade day advances process consistency and zero challenges incentivize trade frequency or size recovery. | ready |

**Design nudges:** DS-04, DS-08, DS-03.

### Track I: Playbooks
*Acceptance scenario step 10.*

| ID | Round out | Acceptance criteria | Status |
|---|---|---|---|
| **RM-I1** | **Playbook version history (`lib/playbooks.ts`, `lib/playbooks-store.ts`).** Increment `version` and append an immutable rule snapshot whenever `checklist_rules` change; stamp `playbook_version` on new trades at capture while preserving frozen `checklist_state` on historical trades (`UX-50`). | Editing a playbook's rules increments its version; historical trades display and grade against the exact version active at entry. Round-trips through local store, Supabase sync, and `/api/v1`. | ready |
| **RM-I2** | Rule changes can be *proposed* (by owner or agent) with linked trade/run evidence, and accepted or rejected (`proposed → accepted | rejected`). | An agent proposal never becomes active without an explicit owner confirmation action (DS-06). | parked (after RM-K1) |

### Track J: Strategy Lab (methodological governance before skill breadth)
*Blueprint §3 priority 7 traps.*

| ID | Round out | Acceptance criteria | Status |
|---|---|---|---|
| **RM-J1** | Commission per side (`commissionCentsPerSide`) in the Strategy Lab cost model (`lib/strategy-lab/types.ts`, `runner.ts`). Slippage (`slippageTicks: { stop, market }`) already exists. | `netResultR = (grossPnlCents − commissionsCents − slippageCents) / fixedRSizeCents` in integer cents. Default cost model is visible in the result header (with RM-B4) and saved on the run. | ready (owner sets default rate) |
| **RM-J2** | **Trials / variants searched counter** (`lib/strategy-lab/runner.ts`, `StrategyLabResults.tsx`). Count distinct condition leaves and parameter variants evaluated per recipe/session. | Displayed directly beside the multiple-comparison caution on every run and persisted on `mogmine_strategy_runs`. | ready |
| **RM-J3** | **Explicit `discovery` vs `validation` stages with frozen recipe hash.** Compute a canonical hash of `(version, trigger, stop, target, window, sizing)`; require a frozen recipe and disjoint, uninspected holdout date range before a run can carry stage `"validation"`. | Editing a recipe resets stage to `"discovery"`; reusing dates already inspected in discovery blocks the `"validation"` badge with a plain explanation. | ready |
| **RM-J4** | Walk-forward mode: chronological discovery window followed by out-of-sample validation window. | Discovery and validation metrics reported in separate columns, never pooled. | parked (after RM-J3) |
| **RM-J5** | Surface the existing deterministic same-bar rule in `StrategyLabResults.tsx`: a bar hitting both stop and target counts conservatively as the stop (`ambiguous-stop`, `lib/strategy-lab/skills/measure.ts:145`), plus count how many matches hit `ambiguous-stop`. | Fill policy and `ambiguous-stop` count are visible in the run metadata header. | ready |
| **RM-J6** | **Contract/roll provenance & `"Hypothetical — simulated"` badge (`DS-05`).** Attach candle source (`databento` / `yahoo`) and active roll entries from `mogmine_market_rolls` to each run, and render an unmistakable `"Hypothetical"` badge on `StrategyLabResults.tsx` and `/api/v1/strategy-lab/*`. | Every simulated output is visually and structurally marked hypothetical and records bar-source + roll provenance. | ready |
| **RM-J7** | **Independent-session count alongside match count.** Report `"N matches across M sessions"` in `lib/strategy-lab/results-view.ts`, `StrategyLabResults.tsx`, and `StrategyLabContextCard.tsx`. | Prevents clustered intraday triggers on one trend day from masquerading as `N` independent observations. | ready |

### Track K: Agent API, read models, and human-AI trust
*Acceptance scenario step 3.*

| ID | Round out | Acceptance criteria | Status |
|---|---|---|---|
| **RM-K1** | **In-UI agent provenance markers (`DS-06`).** Stamp `written_by: { actor: "agent", token_id, token_prefix, at }` on records/fields mutated via `/api/v1` (`lib/agent/dispatch.ts`), cleared/updated to `"owner"` when edited in the UI, and render a quiet `"by agent"` chip on `TradeNotesPanel.tsx`, `ReviewScreen.tsx`, and `DayReviewScreen.tsx`. | Any note, tag, or record written by an agent is visibly marked where read; tapping/hovering shows key prefix and timestamp. RM-C3 is scheduled immediately after this provenance lands. | ready |
| **RM-K2** | **Read-model endpoints (`GET /api/v1/review-queue`, after `RM-C4` `GET /api/v1/session`).** Expose the canonical review queue (`RM-D5`) and Next-actions summary (`RM-C1`) as read-only server views. | External agents answer `"what needs my review?"` and `"what happened in this session?"` in one `GET` without inventing sorting or filtering rules. | ready (pairs with RM-C4, RM-D5) |
| **RM-K3** | Insight proposals (`claim`, `kind`, `evidence_refs[]`, `n`, `data_quality`, `trials_considered`, `human_state: pending | confirmed | rejected | snoozed`). | Opened only when the owner opens this feature area (Blueprint: convergence first). | parked |
| **RM-K4** | Granular capability scopes (`journal:read`, `journal:write`, `research:read`, `research:write`, `replay:write`) alongside backward-compatible `read`/`write`. **Never** an `execute`, `orders`, or `broker` scope. | Opened together with RM-K3. | parked |
| **RM-K5** | **Indirect prompt-injection defense (`OWASP LLM01`).** Explicitly list untrusted user-authored prose fields (`pre_trade_thesis`, `in_trade_notes`, `post_trade_review`, `notes_and_feelings`, `lesson`, `observations`, `quick_tags`) in an `_untrusted_fields` metadata block / OpenAPI `x-untrusted-user-text: true` annotation and house rule, instructing agents to treat them strictly as data, never instructions. | Documented in `lib/agent/house-rules.ts` and `openapi.ts`; regression test in `lib/__tests__/` verifies a trade note containing imperative prompt injection stays quarantined as literal data. | ready |

### Track L: Share cards and Shield
*Acceptance scenario step 9.*

| ID | Round out | Acceptance criteria | Status |
|---|---|---|---|
| **RM-L1** | Verify on a phone that Trade Card, Playbook Card, and Day Card figures match the journal and that Shield opens on by default (`OD-46a`). | Scenario step 9 passes across `4:5`, `9:16`, `1:1`, and `16:9` safe zones. | ready |

**Design nudges:** DS-07, DS-02 (cards pick up hollow candles automatically).

### Track M: Accessibility and real-device checks

| ID | Round out | Acceptance criteria | Status |
|---|---|---|---|
| **RM-M1** | Performance budgets on a real phone (#22). | Budgets from docs/08 §2 met. | blocked (owner phone) |
| **RM-M2** | Dark-room check of RM-B1 on the owner's phone. | Owner sign-off. | blocked (RM-B1) |
| **RM-M3** | Journal recovery on a fresh device, including historical candle evidence from `mogmine_market_candles` (scenario step 11). | Records, R units, plans, reviews, and trade charts restore cleanly on a fresh profile/device. | ready |
| **RM-M4** | Accessibility interaction audit across touched screens: touch targets, focus order, keyboard navigation, labels and screen-reader names. | No critical action is pointer-only; focus is visible and ordered; controls have accessible names; the audit covers Today, Trade Detail, Review, Feed, Tools and Strategy Lab. | ready |

---

## 4b. Sequenced Execution Plan (Waves 6–10)

All `ready` items above group into **five conflict-free waves** ordered strictly by [MOGMINE-BLUEPRINT.md](MOGMINE-BLUEPRINT.md) §3. Each wave uses disjoint writable file ownership so 5–8 workers can run in parallel git worktrees, followed by one Integrator pass.

### Wave 6 — Data Truth, Archive Visibility & Agent Write Safety
*Blueprint §3 priorities 2, 3, 4, 5 · Unblocks Scenarios 1, 3, 4–7, 11.*
1. **Lane 1 (`RM-A4`):** Archive health read endpoint (`/api/market-data/status`) + Tools status card (newest bar, coverage gaps, last cron job result).
2. **Lane 2 (`RM-A11` + `RM-A14`):** Agent-triggered `POST /api/v1/market/top-up` reusing `lib/market-data/top-up.ts` + migration dropping empty `public.mogmine_bars_1m`.
3. **Lane 3 (`RM-A7`):** Agent API `Idempotency-Key`, `expected_updated_at` (409 on conflict), `request_id`, and decision-audit columns (`workflow`, `house_rules_version`).
4. **Lane 4 (`RM-A8` + `RM-K5`):** Fix `prefs.shield` leak in `lib/agent/strategy-lab.ts:163` + untrusted user-prose annotations in `house-rules.ts`, `dispatch.ts`, and responses.
5. **Lane 5 (`RM-A9`):** Operation-specific OpenAPI 3.1 request schemas (`CreateTradeInput`, `PatchTradeInput`, `DailyReviewInput`, `PlanInput`, etc.) in `lib/agent/openapi.ts`.
6. **Lane 6 (`RM-A12`):** `lib/storage-persist.ts` (`navigator.storage.persist()`) + iOS Safari 7-day device-only warning.
7. **Lane 7 (`RM-E5` + `RM-G4`):** `cross-surface-truth.test.ts` (chart/marks/excursions/stats/cards/API reconciliation) + `replay-isolation.test.ts`.
8. **Integrator:** Merge, wire Tools status row in `TuneScreen.tsx`, run full gate (`typecheck`, `lint`, `test`, `check:file-length`, `build`).

### Wave 7 — Design Hygiene, Perceptual Contrast & Stale-Doc Immunity
*Standards `DS-01`, `DS-02`, `DS-03` · Zero feature churn.*
1. **Lane 1 (`RM-B1`):** Dual WCAG 2.2 AA + APCA contrast ramp in `app/globals.css`, `lib/chart-paint.ts`, `lib/shareCard.ts` + `lib/__tests__/contrast.test.ts`.
2. **Lane 2 (`RM-B2` + `RM-B6` + `RM-E2`):** Filled candles with grayscale direction cues, continuous TradingView-style zoom toward ~1px, and `canvas-primitives-audit.test.ts` plus crosshair/candle/level hit-testing coverage.
3. **Lane 3 (`RM-B5`):** `formatRateWithCount` in `lib/format.ts` + denominator & `"early"` (`n < 10`) sweep across stats, playbooks, challenges, drills, and day review.
4. **Lane 4 (`RM-B4` + `RM-J5`):** Strategy Lab slippage assumption + `ambiguous-stop` same-bar policy surfaced in `StrategyLabResults.tsx`.
5. **Lane 5 (`RM-B3`, `RM-N2`, `RM-N3`, `RM-N4`, `RM-N6`):** Maintain `docs/27-design-principles.md`, fix stale `docs/20` Shield prose, mark `docs/06` phases superseded, and update `docs/01` to current Supabase/API/archive state.
6. **Lane 6 (`RM-B7` + `RM-B8` + `RM-B9`):** Progressive-disclosure, component-consistency and named-state implementation pass.
7. **Lane 7 (`RM-B10` + `RM-M4`):** Responsive regression and accessibility interaction verification at `390×844` and desktop width.
8. **Integrator:** Grayscale chart check and full verification gate. Contrast, chart-interaction and design regression checks are merge-blocking.

### Wave 8 — Today Attention Allocator, Daily Loop & Read-Model API
*Blueprint §3 priorities 5 & 6 · Unblocks Scenarios 2, 3, 8.*
1. **Lane 1 (`RM-C1`):** Pure `lib/next-actions.ts` (`Truth > Review > Practice > Research`, max 3, `"Caught up"`) + `<NextActionsCard />` (mobile expands #1 + `"N more"`).
2. **Lane 2 (`RM-C2` + `RM-C5`):** Pure `lib/session-summary.ts` (canonical plan/real/replay/review/process counts + exception-only Data Confidence banner).
3. **Lane 3 (`RM-C4`):** `GET /api/v1/session?date=&account_id=` ("ask MogMine about Tuesday") sharing `lib/session-summary.ts` + OpenAPI & `/guide` docs.
4. **Lane 4 (`RM-D5` + `RM-K2`):** Pure `lib/review-queue.ts` + `GET /api/v1/review-queue` + wire into `ReviewScreen.tsx`.
5. **Lane 5 (`RM-D1` + `RM-D2`):** Link pre-session plans + plan fidelity into `DayReviewScreen.tsx` + `daily-review-sync-api.test.ts`.
6. **Lane 6 (`RM-K1`):** Agent write provenance stamp in `lib/agent/dispatch.ts` + `"by agent"` chip on `TradeNotesPanel.tsx`, `ReviewScreen.tsx`, `DayReviewScreen.tsx`.
7. **Lane 7 (`RM-F3`):** Desktop `J`/`K`/`Enter`/`Esc` keyboard navigation on `FeedScreen.tsx` and `ReviewScreen.tsx`.
8. **Lane 8 (`RM-F4`):** Sample/demo lifecycle and canonical isolation from real queues, badges, totals and review flows.
9. **Integrator:** Mount `<NextActionsCard />` and `<SessionSummary />` cleanly in `TodayScreen.tsx` (keeping `< 450` lines), full gate.

### Wave 9 — Guardrails vs. Challenges, Playbook Versions & Strategy Lab Rigor
*Blueprint §3 priority 7 · Unblocks Scenarios 6, 10.*
1. **Lane 1 (`RM-H1` + `RM-H2`):** Split `Account Guardrails` (mechanical account rules) from `Skill Challenges` (Clean Run) + support planned no-trade sessions advancing Clean Run.
2. **Lane 2 (`RM-I1`):** Playbook `version` history on rule edits + `playbook_version` stamped on trades.
3. **Lane 3 (`RM-J2` + `RM-J7`):** Strategy Lab conditions/variants searched counter + `"N matches across M sessions"` cluster disclosure.
4. **Lane 4 (`RM-J3` + `RM-J6`):** Frozen recipe hash for `discovery` → `validation` holdout protection + roll/source provenance + `"Hypothetical"` badge.
5. **Lane 5 (`RM-E4` + `RM-J1`, once owner sets default fee rate):** Integer-cent `commission_cents` on trades and Strategy Lab runs, rendering Gross R and Net R side-by-side.
6. **Lane 6 (`RM-E6`):** Finish mobile Trade Detail hierarchy and disclosure while keeping initial stop/risk visible at level one.
7. **Integrator:** Cross-check R/cost consistency across journal and Strategy Lab, full gate.

### Wave 10 — 11-Step End-to-End Acceptance & Real-Phone Sign-Off
*Blueprint §6 · Final convergence milestone.*
- Execute and record every step of Blueprint §6 (`1` fixed `$300` 1R account → `2` pre-session plan → `3` agent-logged trade via `/api/v1` → `4` phone chart verification `RM-E1`/`RM-E3` → `5` stop move → `6` close & cross-surface R/excursion match → `7` concurrent multi-device edit → `8` daily review → `9` Shielded Trade Card export `RM-L1` → `10` playbook investigation → `11` fresh-device recovery `RM-M3`), plus owner real-phone checks (`RM-M1`, `RM-M2`).

---

## 5. Owner decisions waiting

A reply pasted into the 2026-11-26 session made suggestions on several of these. They're listed as **suggestions**, not decisions, until the owner confirms them and they're recorded in DECISIONS.md.

| Decision | Suggestion on record | Blocks |
|---|---|---|
| Keep the `#07080c` canvas, soften primary text to `#e6e8ec` | Keep the canvas, soften the text | RM-B1, DS-12 |
| Review badge: number or dot | Keep the number | RM-D4 |
| Blind review default (OD-25) | Keep off until BET-03 settles it | RM-D3 |
| Shield display-only in the API | Yes, strictly display-only | RM-A8 |
| Hollow candles as the default or an option | Rejected 2026-11-27; filled candles plus grayscale/sign redundancy are required | — |
| Drill ground truth | Playbook or owner labels, never P&L | RM-G1 |
| Strategy Lab default commission per side | — (e.g. `$0.62`/side MES micro?) | RM-J1 |
| Backfill Jan–Aug Databento bars | — | RM-A5 |
| Feed → Journal, Tune → Tools labels | — | RM-F2 |
| Insights per account or across accounts by default (when opened) | Per account or account mode | RM-K3 |
| Dedicated Supabase project before more users | — | RM-A10 |
| Delete vs. edit across devices: keep re-create, or tombstones | — | RM-A13 |
| Commission rates per contract | — | RM-E4, RM-J1 |

---

## 6. Doc upkeep (so docs don't drift from the code)

| ID | Change | Status |
|---|---|---|
| **RM-N1** | Blueprint: replace the PR #71 standing rule with #282 (RM-A1) and #296 (RM-A2). Add ROADMAP.md to the §5 hierarchy at BOARD's level. | ready (owner edits the Blueprint) |
| **RM-N2** | docs/20 stale Shield line (same as RM-B3) | ready |
| **RM-N3** | docs/06's 5-phase roadmap: mark it superseded by the Blueprint and this file | ready |
| **RM-N4** | Write `docs/27-design-principles.md`: the audit's product loop (plan → record → review → patterns → practice → test → playbook → transfer) plus the `DS-` standards with links to code and a "Current invariant vs. historical incident" table. Then §1 here shortens to pointers. | ready |
| **RM-N5** | The charter (now Markdown) and the two audits stay as background reading. Known errors: the charter skips Microsoft guideline G14 and shifts G15–G18 by one; the audit's `fileciteturn…` citations and `utm_source=chatgpt.com` links don't resolve. Fix them if the documents are regenerated. | ready |
| **RM-N6** | Check docs/01 against the code (Supabase, agent API, Databento/Yahoo archive) and update it in place | ready |
| **RM-N7** | BOARD.md: when launching a wave from §4b, the planner copies that wave's `ready` `RM-` lanes into BOARD §1 | ready |
| **RM-N8** | [MogMine Comprehensive Codebase Audit.md](<MogMine Comprehensive Codebase Audit.md>) was written **without the repo**, so its checklist items are to-dos, not findings. Checked 2026-11-26: already done are SHA-256 key hashes, `(select auth.uid())` in RLS, `vertTouchDrag: false`, primitive `detached()` cleanup, per-trade `r_size_cents` and Chicago time. Its gaps are tracked as RM-A7, A12, A13, B1, B2, B6, E4, J7, K1, K5. Do not adopt its floor-sizing default (Blueprint §2 wins) or FSRS (drills use 1/3/7 days, not SM-2) without an owner decision. | done (`0016263`) |

---

## 7. Not now

From Blueprint §3: broker automation (D-009), more card variations, more indicator breadth, more challenge types, a built-in multimodal AI engine, large Strategy Lab skill libraries, more major redesigns. Also, until the owner opens them: insight objects (RM-K3), capability scopes (RM-K4), walk-forward (RM-J4), the ⌘K command palette and `?` shortcut sheet.

**Test for adding anything new:** *What decision will the trader make differently, and how will MogMine know whether that change carried into live trading?* If an item can't answer that, it waits.

---

## 8. Rules for agents editing this file

- **Keep IDs stable.** Add new items at the end of their track (`RM-C6`, …). Never renumber, and never reuse a retired ID. Mark finished items `done (commit)` and leave them in place until the planner archives them.
- **Verify before claiming status.** Check the code and cite a file or commit. If you can't check, write "not verified".
- **Don't reorder priorities.** The Blueprint owns the order. Propose changes there.
- **Every item has acceptance criteria** someone could test.
- **Owner decisions go in DECISIONS.md**, not here. Here, only link to them.
- **Re-read this file right before you save it.** Several agents edit it.
