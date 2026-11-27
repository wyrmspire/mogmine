# BOARD.md — Work Order, Active Wave & Tactics

> The board says **what to do next and how agents share the work**. Long-range tracks and design standards (`DS-01`–`DS-12`) live in [ROADMAP.md](ROADMAP.md). Priorities and locked R rules live in [MOGMINE-BLUEPRINT.md](MOGMINE-BLUEPRINT.md). Settled decisions live in [DECISIONS.md](DECISIONS.md). Detailed specs live in `docs/`.
>
> **Only the planner / integrator edits this file.** Workers read it and never edit `BOARD.md`, `ROADMAP.md`, `NOTES.md`, or `DECISIONS.md` in a feature branch.

---

## 0. Handoff Context for GPT / Planner (2026-11-27)

1. **Git baseline before launching Wave 6 (`MM-W6`):**
   - `origin/main` is at **`4b9b75e`** (includes Wave 4 `3bccf06`, Wave 5 `3747928`, UX Charter/Audit `b88400b`, Databento archive `e164930` PR #282, and daily Vercel Cron archive top-up `4b9b75e` PR #296).
   - Branch `docs/codebase-audit-roadmap` (open PR #297) holds the elaborated [ROADMAP.md](ROADMAP.md), [MogMine Comprehensive Codebase Audit.md](<MogMine Comprehensive Codebase Audit.md>), [MogMine UX_UI Design Principles.md](<MogMine UX_UI Design Principles.md>), and **this `BOARD.md`**.
   - **Step 0 before cutting worktrees:** Commit `ROADMAP.md` + `BOARD.md` onto `docs/codebase-audit-roadmap` (note: leave unstaged local tweaks to `printcode.sh` / `gitrdif.sh` alone or stash/commit only if owner wants), rebase/merge PR #297 onto `origin/main` (`4b9b75e`), and cut all Wave 6 worktrees from that merged `main` commit so every lane has `lib/market-data/top-up.ts` from PR #296.
2. **Live Supabase (`showmob-dev`, ref `vsasmtsifuylhfrrsrso`) verified state:**
   - All 25 `mogmine_*` tables exist with `rls_enabled: true`.
   - `mogmine_market_candles` has **92,569 `MES=F` 1m bars** (Aug 25 – Nov 26 2026), `mogmine_market_coverage` has 68 rows, `mogmine_market_archive_jobs` has 5 rows, `mogmine_market_rolls` has 3 rows, and `mogmine_daily_reviews` is live.
   - `public.mogmine_bars_1m` has **0 rows** — `lib/strategy-lab/bars-cache.ts` still queries it instead of `mogmine_market_candles`. `RM-A14` (Wave 6 Lane 2) fixes that and drops `mogmine_bars_1m`.
   - **Owner env todo in Vercel Production:** set `CRON_SECRET` (and verify `SUPABASE_SERVICE_ROLE_KEY`) so `GET /api/cron/archive-topup` (`23:00 UTC` daily) runs live.
3. **Important guardrails tests enforce automatically:**
   - `lib/__tests__/auth.test.ts` enforces a strict allowlist of files allowed to reference `SUPABASE_SERVICE_ROLE_KEY` or call `createClient(`. Any new server-only archive query belongs in `lib/market-data/archive.ts` or `lib/market-data/top-up-store.ts` (already allowlisted) — or update `auth.test.ts` explicitly in the Integrator pass with server-only guards.
   - `npm run check:file-length` lists 12 grandfathered files over 450 lines (`trade-document.ts`, `globals.css`, `trades.ts`, `mood.ts`, `StopMovesEditor.tsx`, `TradeChart.tsx`, `TradeDetail.tsx`, `shareCard.ts`, `ChallengeDetail.tsx`, `trade-marks.ts`, `day-card.ts`, `PlanSheet.tsx`). Keep new logic in focused modules (`≤ 450` lines) and never grow a grandfathered file without reporting before/after counts and extracting where possible.

---

## 1. Up next (ordered strictly by `MOGMINE-BLUEPRINT.md §3` & `ROADMAP.md`)

Workers take the **first row whose status is `ready`** (or take their assigned lane in `§1b` during a multi-lane `boardinit` wave) with no assignee and no `claim/<id>` branch on `origin`.

> **⚠ Shared-file safety:** Re-read any file immediately before editing and apply targeted replacements only — never overwrite a whole file from stale memory.

| # | Roadmap ID | Item | Spec / Files | Size | Wave | Status |
|---|---|---|---|---|---|---|
| 1 | `RM-A4` | Archive health endpoint (`/api/market-data/status`) + `<ArchiveStatusCard />` in Tools (newest bar, missing sessions, last cron job result) | [ROADMAP §2](ROADMAP.md#2-track-a-data-truth-sync-safety-and-the-candle-archive-first), DS-11 | S | W6-L1 | `ready` |
| 2 | `RM-A11` + `RM-A14` | Agent-triggered `POST /api/v1/market/top-up` (`write` scope, date range only, never prices) + repoint Strategy Lab `bars-cache.ts` off empty `mogmine_bars_1m` to `mogmine_market_candles` and drop `mogmine_bars_1m` | [ROADMAP §2](ROADMAP.md#2-track-a-data-truth-sync-safety-and-the-candle-archive-first), PR #296 | M | W6-L2 | `ready` |
| 3 | `RM-A7` | Agent API write safety: `Idempotency-Key` on `POST` creates, `expected_updated_at` / `If-Match` (409) on updates, `request_id` in responses, and decision-audit columns (`workflow`, `house_rules_version`) | [ROADMAP §2](ROADMAP.md#2-track-a-data-truth-sync-safety-and-the-candle-archive-first), docs/26 §8 | M | W6-L3 | `ready` |
| 4 | `RM-A8` + `RM-K5` | Fix `prefs.shield` API leak in `lib/agent/strategy-lab.ts:163` (`DS-07`) + mark untrusted user prose (`_untrusted_fields` / house rule) against indirect prompt injection (`OWASP LLM01`) | [ROADMAP §2, §4K](ROADMAP.md#track-k-agent-api-read-models-and-human-ai-trust) | S | W6-L4 | `ready` |
| 5 | `RM-A9` | Operation-specific OpenAPI 3.1 request schemas (`CreateTradeInput`, `PatchTradeInput`, `DailyReviewInput`, `PlanInput`, `AccountInput`, `PlaybookInput`, `TradeCheckInput`) replacing generic `additionalProperties: true` | [ROADMAP §2](ROADMAP.md#2-track-a-data-truth-sync-safety-and-the-candle-archive-first), `lib/agent/openapi.ts` | M | W6-L5 | `ready` |
| 6 | `RM-A12` | Browser storage persistence (`navigator.storage.persisted()` / `persist()`) + calm iOS Safari 7-day device-only eviction warning & Tools status row | [ROADMAP §2](ROADMAP.md#2-track-a-data-truth-sync-safety-and-the-candle-archive-first), DS-11 | S | W6-L6 | `ready` |
| 7 | `RM-E5` + `RM-G4` | Cross-surface financial & temporal reconciliation suite (`cross-surface-truth.test.ts`, Blueprint §3.2) + comprehensive Replay isolation suite (`replay-isolation.test.ts`) | [ROADMAP §4E, §4G](ROADMAP.md#track-e-trade-detail-chart-and-financial-truth) | M | W6-L7 | `ready` |
| 8 | `RM-B1` | Dual WCAG 2.2 AA + APCA contrast token ramp (`globals.css`, `chart-paint.ts`, `shareCard.ts`) + automated `contrast.test.ts` across all 3 surfaces | [ROADMAP §3](ROADMAP.md#3-track-b-design-hygiene--perceptual-precision-wave-7), DS-01, DS-12 | S | W7-L1 | `ready` (`--text-primary` `#e6e8ec` pending owner) |
| 9 | `RM-B2` + `RM-B6` | Hollow rising / filled falling candles (`DS-02`) + `lightweight-charts` v5 canvas primitive DPR/reference/teardown audit test | [ROADMAP §3](ROADMAP.md#3-track-b-design-hygiene--perceptual-precision-wave-7), DS-02 | S | W7-L2 | `ready` (default vs View toggle: owner) |
| 10 | `RM-B5` | `formatRateWithCount(num, den)` in `lib/format.ts` + full denominator & `"early"` (`n < 10`) sweep across stats, playbooks, challenges, drills, and day review | [ROADMAP §3](ROADMAP.md#3-track-b-design-hygiene--perceptual-precision-wave-7), DS-03 | M | W7-L3 | `ready` |
| 11 | `RM-B4` + `RM-J5` | Surface Strategy Lab slippage assumption + `ambiguous-stop` same-bar fill rule & count in `StrategyLabResults.tsx` | [ROADMAP §3, §4J](ROADMAP.md#track-j-strategy-lab-methodological-governance-before-skill-breadth) | S | W7-L4 | `ready` |
| 12 | `RM-B3` + `RM-N2`–`N4` + `N6` | Write `docs/27-design-principles.md` (closed loop + `DS-*` code links + invariant vs historical bug table), fix stale `docs/20` Shield line, mark `docs/06` superseded, refresh `docs/01` | [ROADMAP §6](ROADMAP.md#6-doc-upkeep-so-docs-dont-drift-from-the-code) | M | W7-L5 | `ready` |
| 13 | `RM-C1` | Today `"Next"` decision card (`lib/next-actions.ts` + `<NextActionsCard />`): `≤ 3` ranked items (`Truth > Review > Practice > Research`) or `"Caught up"`; mobile expands #1 + `"N more"` | [ROADMAP §4C](ROADMAP.md#track-c-today-the-human-checkpoint--attention-allocator), DS-08 | M | W8-L1 | `ready` |
| 14 | `RM-C2` + `RM-C5` | Canonical `lib/session-summary.ts` (plan, real/replay counts, review state, process `X/Y`) + exception-only `"Data confidence: needs attention"` banner | [ROADMAP §4C](ROADMAP.md#track-c-today-the-human-checkpoint--attention-allocator), DS-03, DS-08 | S | W8-L2 | `ready` |
| 15 | `RM-C4` | `GET /api/v1/session?date=&account_id=` canonical session read model ("ask MogMine about Tuesday") sharing `lib/session-summary.ts` | [ROADMAP §4C](ROADMAP.md#track-c-today-the-human-checkpoint--attention-allocator), Blueprint §3.6 | M | W8-L3 | `ready` |
| 16 | `RM-D5` + `RM-K2` | Shared pure `lib/review-queue.ts` selector + `GET /api/v1/review-queue` wired into `ReviewScreen.tsx` | [ROADMAP §4D, §4K](ROADMAP.md#track-d-review-and-the-daily-loop) | M | W8-L4 | `ready` |
| 17 | `RM-D1` + `RM-D2` | Link pre-session plans + plan fidelity (`X/Y`) into `DayReviewScreen.tsx` + `daily-review-sync-api.test.ts` round-trip verification | [ROADMAP §4D](ROADMAP.md#track-d-review-and-the-daily-loop), Blueprint §3.5 | M | W8-L5 | `ready` |
| 18 | `RM-K1` | Stamp agent write provenance (`token_prefix`, `at`) in `lib/agent/dispatch.ts` + `"by agent"` chip on `TradeNotesPanel.tsx`, `ReviewScreen.tsx`, `DayReviewScreen.tsx` | [ROADMAP §4K](ROADMAP.md#track-k-agent-api-read-models-and-human-ai-trust), DS-06 | M | W8-L6 | `ready` |
| 19 | `RM-F3` | Desktop `J`/`K`/`Enter`/`Esc` keyboard navigation on `FeedScreen.tsx` and `ReviewScreen.tsx` (`DS-09`) | [ROADMAP §4F](ROADMAP.md#track-f-feed-journal), DS-09 | S | W8-L7 | `ready` |
| 20 | `RM-H1` + `RM-H2` | Separate mechanical `Account Guardrails` from `Skill Challenges` + allow a planned, reviewed no-trade session to advance Clean Run | [ROADMAP §4H](ROADMAP.md#track-h-challenges-and-account-guardrails), DS-04 | M | W9-L1 | `ready` |
| 21 | `RM-I1` | Playbook `version` history on rule edits + `playbook_version` stamped on trades | [ROADMAP §4I](ROADMAP.md#track-i-playbooks) | M | W9-L2 | `ready` |
| 22 | `RM-J2` + `RM-J7` | Strategy Lab conditions/variants searched counter + `"N matches across M sessions"` cluster count | [ROADMAP §4J](ROADMAP.md#track-j-strategy-lab-methodological-governance-before-skill-breadth), Blueprint §3.7 | M | W9-L3 | `ready` |
| 23 | `RM-J3` + `RM-J6` | Frozen recipe hash for `discovery` → `validation` holdout protection + roll/source provenance + `"Hypothetical"` badge | [ROADMAP §4J](ROADMAP.md#track-j-strategy-lab-methodological-governance-before-skill-breadth), DS-05 | M | W9-L4 | `ready` |
| 24 | `RM-E4` + `RM-J1` | Integer-cent `commission_cents` on trades and Strategy Lab runs, showing Gross R and Net R everywhere | [ROADMAP §4E, §4J](ROADMAP.md#track-e-trade-detail-chart-and-financial-truth) | M | W9-L5 | `ready` (owner sets default per-side rate) |
| 25 | `RM-E1` + `RM-E3` + `RM-L1` + `RM-M3` | Blueprint §6 11-step end-to-end acceptance walk (agent trade → stop move → close → card Shield → fresh-device recovery) | [MOGMINE-BLUEPRINT §6](MOGMINE-BLUEPRINT.md#6-end-to-end-acceptance-scenario-0-of-11-verified) | M | W10 | `ready` (after W6–W9) |

### 1a. Owner-gated / blocked items (do NOT pick up without owner decision)

| Roadmap / Issue | Item | Blocked on |
|---|---|---|
| `RM-A5` | Backfill Jan 25 – Aug 24 2026 Databento 1m Parquet bars | Owner upload from conversion machine |
| `RM-A6` / `#65` | CME holiday & early-close session calendar (`closed` vs `missing`) | Owner (`OD-35`) |
| `RM-A13` | Cross-device delete vs. edit conflict policy (keep re-create vs `deleted_at` tombstones) | Owner (`ROADMAP §5`) |
| `RM-C3` | Today `"Current focus"` pinned line | `RM-K1` provenance |
| `RM-D3` | Blind review experiment on trades > 7 days old | Owner experiment (`BET-03`, `OD-25`) |
| `RM-D4` | Review tab badge: number vs dot | Owner (`ROADMAP §5`) |
| `RM-E2` | Chart zoom-out floor (`MIN_BAR_SPACING_PX = 3` vs auto timeframe step) | Owner (`ROADMAP §5`) |
| `RM-F2` | Nav display labels `Feed → Journal` and `Tune → Tools` | Owner (`ROADMAP §5`) |
| `RM-G1`–`G3` | Drill ground truth decoupled from `r` + false-take/false-pass + live transfer metric | Owner label rule (`ROADMAP §5`) |
| `DC-3`–`DC-7` | Discretionary call sheet UI, chart pins, grading, score | Owner (`OD-52`) |
| `OD-55` | `5m` fallback for Yahoo `1m` Globex gaps in session levels | Owner (`OD-55`) |
| `RM-M1` / `#22`, `RM-M2` | Real-phone performance budgets & dark-room APCA check | Owner real phone |

**Never take:** owner-question issues (`#5`–`#9`, `#23`, `#24`, `#39`), parked broker work (`#43`, `D-009`), `#70`, `#123`, or parked roadmap items (`RM-A3`, `RM-A10`, `RM-I2`, `RM-J4`, `RM-K3`, `RM-K4`).

---

## 1b. Active Wave Ready to Launch: `MM-W6` — Data Truth, Archive Visibility & Agent Write Safety (`7 + 1`)

> **Baseline:** Merged `main` (`4b9b75e` + PR #297 docs).
> **Wave Target:** ~2,200 total changed lines (~250–400 lines per worker lane).
> **Worktree Isolation (`boardinit.md`):** Each worker runs in its own isolated git worktree on branch `wave6/lane-1`..`wave6/lane-7` with symlinked/linked `node_modules` (never run `npm install` unless `package-lock.json` changes).
> **Worker Verification Cap (`AGENTS.md §6b`):** Workers run **only** `nice -n 10 node --test --test-concurrency=2 lib/__tests__/<their-test>.test.ts` + `nice -n 10 npm run typecheck`. Lane 8 (Integrator) runs full `npm test`, `npm run lint`, `npm run check:file-length`, and `npm run build` once after merging.

| Lane | Roadmap IDs | Branch | Writable Files (strict — disjoint across all 7 lanes) | Must Avoid | Target | Status |
|---|---|---|---|---|---|---|
| `MM-W6-01` | `RM-A4` | `wave6/lane-1-archive-status` | `lib/market-data/archive.ts`, `app/api/market-data/status/route.ts`, `components/ArchiveStatusCard.tsx`, `lib/__tests__/archive-status.test.ts` | `components/TuneScreen.tsx`, `lib/market-data/top-up.ts`, `lib/__tests__/auth.test.ts`, `app/globals.css`, `BOARD.md` | ~280 lines | `ready` |
| `MM-W6-02` | `RM-A11` + `RM-A14` | `wave6/lane-2-topup-and-bars1m` | `app/api/v1/market/top-up/route.ts`, `lib/agent/market-topup.ts`, `lib/strategy-lab/bars-cache.ts`, `lib/strategy-lab/bars.ts`, `lib/strategy-lab/use-lab-persistence.ts`, `supabase/migrations/20261127010000_drop_unused_mogmine_bars_1m.sql`, `lib/__tests__/strategy-lab-persistence.test.ts`, `lib/__tests__/agent-market-topup.test.ts` | `lib/agent/openapi.ts`, `lib/agent/handle.ts`, `lib/agent/dispatch.ts`, `lib/market-data/top-up.ts`, `BOARD.md` | ~340 lines | `ready` |
| `MM-W6-03` | `RM-A7` | `wave6/lane-3-write-safety` | `lib/agent/idempotency.ts`, `lib/agent/handle.ts`, `lib/agent/dispatch.ts`, `lib/agent/server-auth.ts`, `supabase/migrations/20261127010500_mogmine_agent_write_safety.sql`, `lib/__tests__/agent-write-safety.test.ts` | `lib/agent/openapi.ts`, `lib/agent/house-rules.ts`, `lib/agent/strategy-lab.ts`, `BOARD.md` | ~380 lines | `ready` |
| `MM-W6-04` | `RM-A8` + `RM-K5` | `wave6/lane-4-shield-untrusted` | `lib/agent/strategy-lab.ts`, `lib/agent/untrusted-text.ts`, `lib/agent/house-rules.ts`, `lib/__tests__/agent-shield-and-untrusted.test.ts` | `lib/agent/dispatch.ts`, `lib/agent/openapi.ts`, `lib/agent/handle.ts`, `BOARD.md` | ~240 lines | `ready` |
| `MM-W6-05` | `RM-A9` | `wave6/lane-5-openapi-schemas` | `lib/agent/openapi-schemas.ts`, `lib/agent/openapi.ts`, `lib/__tests__/agent-openapi-schemas.test.ts` | `lib/agent/dispatch.ts`, `lib/agent/house-rules.ts`, `lib/agent/handle.ts`, `BOARD.md` | ~360 lines | `ready` |
| `MM-W6-06` | `RM-A12` | `wave6/lane-6-storage-persist` | `lib/storage-persist.ts`, `components/StoragePersistRow.tsx`, `lib/__tests__/storage-persist.test.ts` | `components/TuneScreen.tsx`, `components/AppShell.tsx`, `app/globals.css`, `BOARD.md` | ~220 lines | `ready` |
| `MM-W6-07` | `RM-E5` + `RM-G4` | `wave6/lane-7-truth-and-replay-suites` | `lib/__tests__/cross-surface-truth.test.ts`, `lib/__tests__/replay-isolation.test.ts` | All production files (`app/**`, `components/**`, `lib/*.ts`), `BOARD.md` | ~380 lines | `ready` |
| `MM-W6-08` | Final Pass | `main` | Integration wiring (`components/TuneScreen.tsx`, `components/AppShell.tsx`, `lib/agent/dispatch.ts`, `lib/agent/openapi.ts`, `lib/__tests__/auth.test.ts`, `NOTES.md`, `ROADMAP.md`, `BOARD.md`) | Unscoped feature additions | Gate & merge | `ready` (after L1–L7) |

### Wave `MM-W6` Detailed Lane Specifications

#### `MM-W6-01` · Archive Health Endpoint & Card (`RM-A4`)
- **Writable Files:** `lib/market-data/archive.ts`, `app/api/market-data/status/route.ts`, `components/ArchiveStatusCard.tsx`, `lib/__tests__/archive-status.test.ts`
- **Deliverables & Acceptance Criteria:**
  - Add `readArchiveStatus(symbol?: string, nowMs?: number)` inside `lib/market-data/archive.ts` (which is already allowlisted for server-only Supabase archive reads in `auth.test.ts`). Queries `mogmine_market_coverage` (latest `session_date`, `last_ts`, total covered sessions, missing expected regular sessions) and latest row of `mogmine_market_archive_jobs` (`status`, `started_at`, `finished_at`, `bars_written`). Degrades gracefully (`available: false`) when env vars are absent in local mode.
  - Expose `GET /api/market-data/status` (`Cache-Control: no-store`) returning `{ available, symbol, newestBarIso, coveredSessions, missingRecentSessions, lastJob, warning }` without leaking keys or stack traces.
  - Build `<ArchiveStatusCard />` following `DS-11` (named states: `Loading archive status…`, `Local mode (archive not configured)`, `Healthy`, and explicit amber warning when >1 completed regular trading day is missing or `lastJob.status` failed) with `tabular-nums` timestamps (`lib/time.ts` Central Time). Lane 8 mounts it in `TuneScreen.tsx` (Tools tab).

#### `MM-W6-02` · Agent Market Top-Up & Retire `mogmine_bars_1m` (`RM-A11` + `RM-A14`)
- **Writable Files:** `app/api/v1/market/top-up/route.ts`, `lib/agent/market-topup.ts`, `lib/strategy-lab/bars-cache.ts`, `lib/strategy-lab/bars.ts`, `lib/strategy-lab/use-lab-persistence.ts`, `supabase/migrations/20261127010000_drop_unused_mogmine_bars_1m.sql`, `lib/__tests__/strategy-lab-persistence.test.ts`, `lib/__tests__/agent-market-topup.test.ts`
- **Deliverables & Acceptance Criteria:**
  - **`RM-A11`:** Add `POST /api/v1/market/top-up` authenticated via `handleAgentRequest` requiring `write` scope. Accepts `{ symbol?: "MES" | "MES=F", days?: number }` (clamped 1..10, refuses any payload containing bars/prices or symbols outside `OD-15`), invokes `runTopUp` from `lib/market-data/top-up.ts` + `lib/market-data/top-up-store.ts`, and records an agent audit row (`record_type: "market_archive"`).
  - **`RM-A14`:** Repoint `lib/strategy-lab/bars-cache.ts` (`readRemoteSessionBars1m` / `BARS_1M_TABLE`) to read from `mogmine_market_candles` (`symbol = "MES=F"`, `timeframe = "1m"`, `ts` / OHLCV columns) and disable browser/client writes to any bar table (archive writes are server-only via `top-up-store.ts`). Add `supabase/migrations/20261127010000_drop_unused_mogmine_bars_1m.sql` (`drop table if exists public.mogmine_bars_1m;`) without editing historical migration `20261126120000_mogmine_strategy_lab.sql`. Update `lib/__tests__/strategy-lab-persistence.test.ts` accordingly.

#### `MM-W6-03` · Agent Write Safety & Decision Audit (`RM-A7`)
- **Writable Files:** `lib/agent/idempotency.ts`, `lib/agent/handle.ts`, `lib/agent/dispatch.ts`, `lib/agent/server-auth.ts`, `supabase/migrations/20261127010500_mogmine_agent_write_safety.sql`, `lib/__tests__/agent-write-safety.test.ts`
- **Deliverables & Acceptance Criteria:**
  - Migration `20261127010500_mogmine_agent_write_safety.sql`:
    1. Create `public.mogmine_agent_idempotency` (`user_id uuid`, `endpoint text`, `idempotency_key text`, `payload_hash text`, `state text check (state in ('in_flight','completed'))`, `status integer`, `response_body jsonb`, `created_at timestamptz`, primary key `(user_id, endpoint, idempotency_key)`, RLS enabled, `revoke all from anon, authenticated`, `service_role` only).
    2. Add nullable columns to `public.mogmine_agent_audit`: `request_id text`, `workflow text` (from `X-MogMine-Reason`, max 120 chars), `house_rules_version text`. Never store journal prose in audit rows.
  - **`Idempotency-Key` on `POST` record creates:** If provided (UUID / 1..128 ASCII chars), atomically claim before executing: replay stored `2xx` status + body when completed with matching SHA-256 `payload_hash`; return `422` when `payload_hash` differs; return `409` when `in_flight`; never cache `5xx` errors.
  - **Optimistic concurrency on `PUT` / `PATCH` updates:** Accept `If-Match` header or `expected_updated_at` field and pass `{ expectedUpdatedAt }` to the repository/command layer so stale updates return `409 conflict` cleanly.
  - **Canonical `request_id`:** Stamp `request_id` (and `X-Request-Id` response header) on every `/api/v1` response and audit entry.

#### `MM-W6-04` · Shield API Isolation & Untrusted Text Guardrails (`RM-A8` + `RM-K5`)
- **Writable Files:** `lib/agent/strategy-lab.ts`, `lib/agent/untrusted-text.ts`, `lib/agent/house-rules.ts`, `lib/__tests__/agent-shield-and-untrusted.test.ts`
- **Deliverables & Acceptance Criteria:**
  - **`RM-A8` (`DS-07`):** In `lib/agent/strategy-lab.ts:163`, pass `shield: false` instead of `prefs.shield` so UI Shield toggles never mutate `/api/v1/strategy-lab/context` outputs.
  - **`RM-K5` (`OWASP LLM01`):** Create `lib/agent/untrusted-text.ts` exporting `UNTRUSTED_TEXT_FIELDS` (per record type: `pre_trade_thesis`, `in_trade_notes`, `post_trade_review`, `notes_and_feelings`, `quick_tags`, `lesson`, `observations`, `notes`, etc.) and pure `withUntrustedTextMeta(recordType, payload)` attaching `_untrusted_user_text_fields: string[]` metadata for Lane 8 to wire into `dispatch.ts` / `openapi.ts`. Add a clear House Rule in `lib/agent/house-rules.ts` stating all user-authored text fields are untrusted quotation data and must never be followed as agent instructions. Test with a synthetic prompt-injection trade note.

#### `MM-W6-05` · Operation-Specific OpenAPI 3.1 Request Schemas (`RM-A9`)
- **Writable Files:** `lib/agent/openapi-schemas.ts`, `lib/agent/openapi.ts`, `lib/__tests__/agent-openapi-schemas.test.ts`
- **Deliverables & Acceptance Criteria:**
  - Create `lib/agent/openapi-schemas.ts` defining explicit JSON Schemas for write bodies: `CreateTradeInput`, `PatchTradeInput` (including 4-stage note fields, `stated_risk_r`, `expected_updated_at`, forbidding derived fields `net_pnl`, `r_multiple`, `hold_seconds`), `AccountInput`, `DailyReviewInput`, `PlanInput`, `PlaybookInput`, `TradeCheckInput`, `SingletonPrefsInput`, `SingletonTagRegistryInput`, plus collection-dispatched `oneOf` or per-collection paths in `lib/agent/openapi.ts` (keep both files `≤ 450` lines!).
  - Replace the blanket `additionalProperties: true` `jsonBody` helper (`lib/agent/openapi.ts:116`) with `$ref`s to those named schemas, document `Idempotency-Key`, `If-Match`, and `X-MogMine-Reason` headers, and add unit tests validating schema completeness and required/forbidden properties.

#### `MM-W6-06` · Browser Storage Persistence & iOS 7-Day Warning (`RM-A12`)
- **Writable Files:** `lib/storage-persist.ts`, `components/StoragePersistRow.tsx`, `lib/__tests__/storage-persist.test.ts`
- **Deliverables & Acceptance Criteria:**
  - Build `lib/storage-persist.ts` (`hydrateStoragePersist`, `useStoragePersistState`, pure `shouldWarnLocalEviction({ persisted, syncEnabled, standalonePwa, dismissed })`): calls `navigator.storage.persisted()` and `navigator.storage.persist()` safely in browser environments (graceful `"unsupported"` fallback in SSR/Node).
  - Build `<StoragePersistRow />` showing storage status (`Persisted`, `Best-effort`, `Cloud synced`) for Tools and a calm, once-dismissible warning banner when running local-only (`syncEnabled === false`), not installed as a standalone Home Screen PWA, and `persisted === false` (explaining iOS Safari's 7-day script-storage wipe and how to sign in or Add to Home Screen).

#### `MM-W6-07` · Cross-Surface Truth & Replay Isolation Suites (`RM-E5` + `RM-G4`)
- **Writable Files:** `lib/__tests__/cross-surface-truth.test.ts`, `lib/__tests__/replay-isolation.test.ts`
- **Deliverables & Acceptance Criteria:**
  - **`cross-surface-truth.test.ts` (`Blueprint §3.2`):** Build deterministic fixtures covering: (1) `$300` fixed 1R with whole-micro `Math.ceil` overshoot (`8 MES` on 8-pt stop = `$320` / `1.07R` risk), (2) fill matched within ±5m to a 1m bar open without counting that bar's pre-fill range as post-entry MAE/MFE, (3) timed + untimed stop moves, (4) multi-lot partial exits, (5) scratch trade within `max(0.1R, 2 ticks)`, and (6) open trade (`OD-38` `null` money/R). Assert agreement across `deriveTrade`, `observeTrade`, `buildMarks`, `excursions`, `selectors` (`dayStats`, `runningStats`), `shareCard`, `day-card`, `describe.ts`, and `dispatchAgentRoute` (`?include=derived`).
  - **`replay-isolation.test.ts` (`RM-G4`):** Assert that logging closed winning/losing trades on a `mode: "replay"` account has **zero** effect on `runningStats`, Today live `dayStats`, `evaluateChallenge` (Drawdown Defender & Clean Run), `ReviewScreen` real queue counts, and `PlaybookLab` live summaries unless replay is explicitly queried.
  - *Out-of-lane rule:* Do not edit production files; if a real cross-surface bug is caught, assert/document the exact file and line in `notes/handoffs/2026-11-27-MM-W6-07.md` so Lane 8 fixes it cleanly during integration.

#### `MM-W6-08` · Master Agent / GPT Final Integration Pass
1. Inspect all 7 worker handoffs in `notes/handoffs/` and merge `wave6/lane-1`..`wave6/lane-7` into `main` in order (`L4 → L3 → L2 → L5 → L1 → L6 → L7`).
2. Wire `<ArchiveStatusCard />` and `<StoragePersistRow />` into `components/TuneScreen.tsx` (keeping `TuneScreen.tsx ≤ 450` lines) and `hydrateStoragePersist()` in `AppShell.tsx`; wire `withUntrustedTextMeta` into `lib/agent/dispatch.ts` and `/api/v1/market/top-up` into `lib/agent/openapi.ts`; fix any discrepancy uncovered by Lane 7; verify `lib/__tests__/auth.test.ts` service-role allowlist.
3. Run the full authoritative gate once:
   - `nice -n 10 npm run typecheck`
   - `nice -n 10 npm run lint`
   - `nice -n 10 node --test --test-concurrency=2 "lib/__tests__/*.test.ts"`
   - `npm run check:file-length`
   - `nice -n 10 npm run build`
4. Apply new Supabase migrations (`20261127010000_*`, `20261127010500_*`) only when owner approves or via Supabase CLI/MCP per `D-012`, fold handoffs into `NOTES.md`, mark `RM-*` rows `done (<sha>)` in `ROADMAP.md` and `BOARD.md`, and advance `§1b` to Wave 7 (`ROADMAP.md §4b`).

---

## 2. Lanes

| Lane | Job | Takes new items? | Merges? |
|---|---|---|---|
| **Planner / Integrator** | Keeps §1 ordered and sliced into items `≤ 400` lines, dispatches isolated `git worktree` waves (`boardinit.md`), wires shared UI shells, runs full gate, merges | Integration & hard fixes | Yes |
| **Workers** | Take assigned worktree lane (or top `ready` item), run targeted tests + `typecheck`, write handoff in `notes/handoffs/` | Yes, one slice at a time | Never directly to `main` in wave mode |
| **Owner (Chris)** | Product calls (`ROADMAP §5`, `DECISIONS.md`), Vercel env secrets (`CRON_SECRET`), real-phone sign-off | — | — |

---

## 3. Claim and lock rules

A claim is only real if it is **atomic**.

1. **Multi-lane `boardinit` wave mode (preferred):** The Planner assigns disjoint lanes in `§1b` and creates one isolated `git worktree` per worker (`git worktree add ../mogmine-w<N> -b wave6/lane-<N> <baseline>` with symlinked `node_modules`). Workers stay strictly inside their worktree and writable file list.
2. **Single-worker / autonomous pull mode:** Push an atomic claim ref before starting:
   ```bash
   git fetch origin
   git push origin origin/main:refs/heads/claim/<rm-id>   # fails atomically if already claimed
   ```
   Work on `feat/<rm-id>-<slug>`, open PR, and delete `claim/<rm-id>` on merge or handoff. A claim with no commits for 2 hours is stale and may be broken by the Planner.

---

## 4. Handoffs

- Every worker writes a new file: `notes/handoffs/<YYYY-MM-DD>-<lane-or-id>.md` (never edit `NOTES.md`, `BOARD.md`, or `ROADMAP.md` in a worker branch).
- Include: branch & commit SHA, exact files changed (with before/after line counts if touching a `> 450`-line file), exported signatures for the Integrator, exact commands run + real pass/fail output, and any out-of-lane findings.
- The Integrator folds merged handoffs into `NOTES.md` ("Current state" stays concise) and updates `ROADMAP.md` + `BOARD.md`.

---

## 5. Tactics (the scope guard)

1. **One slice per lane (`~250–450` changed lines)** and **`≤ 450` lines per production file** (`npm run check:file-length`).
2. **Apply `DS-01`–`DS-12` design nudges** (`ROADMAP.md §1`) to any UI file you touch: APCA-safe tokens, no bare percentages without `n` (`10/12`, `"early"` under 10), `tabular-nums`, true minus `−`, `≥ 44px` touch targets, no hardcoded gold hexes.
3. **Never run `npm ci` / `npm install`** unless `package-lock.json` changed; prefix heavy commands with `nice -n 10` and cap `node --test` with `--test-concurrency=2`.
4. **Update specs in the same wave** whenever behavior supersedes older prose so stale docs never reintroduce fixed defects.
5. **Before merging to `main`, answer:** What became more true? What became more fragile? Is this product behavior or scaffold? What was not verified on a real phone?

---

## 6. Archive (completed milestones & waves on `main` through `4b9b75e`)

- **Foundation & UI Phases 1–5 (`#1`–`#185b`, `MM-W1`, `MM-W2`):** Price-first entry (`docs/20`), frozen initial stop (`R-10`), open trades (`OD-38`), Trade Document & Canvas marks (`TD-1`–`TD-3`, `69ab1f7`, `1941d79`), partials model (`MM-W2-03`), `StopMovesEditor` (`MM-W2-05`), archived neighbours (`MM-W2-06`), Trade/Playbook/Day Cards (`CD-1`–`CD-4`), Drills (`CD-2a`–`2c`), Challenges (`R-09a`–`09d`), Session levels & planning sessions (`LV-1`–`2`, `PS-1`–`4`), local + Supabase persistence (`#173`–`#176`), magic-link auth (`#182`), Agent API v1 + keys + OpenAPI (`#185a`/`b`).
- **2026-11-24 / 2026-11-26 Convergence & UX Waves (Waves 1–5, through `3747928`):** Per-account fixed `$300` 1R + whole-micro `Math.ceil` sizing (`RS-1`–`RS-4`), Databento archive read path (`19452b8`), Agent API 4-field notes + write checks + `/vocabulary` + `/candles` + `/levels` + `/checks/trade`, 3-stage `TradeNotesPanel` extraction, Playbook Lab + Strategy Lab workspace & archive bridge, clean label-free chart zones (`W5-01`), Session VWAP ±1σ/±2σ bands (`W5-02`), `AccountMode` `replay` isolation & 2-tap setup (`W5-03`/`04`), real-only `Review` `Queue | Daily` split (`W5-05`), single-row 56px mobile header & `Today | Progress` cockpit (`W5-06`), Feed `Real | Replay | All` (`W5-07`), `Tools | Settings` hub (`W5-08`).
- **Archive & Design Charter Merges (`b88400b`, `e164930`, `4b9b75e`):** UX/UI Charter + Product/Agent-First Architecture Audit + initial `ROADMAP.md` (PR #295), Databento 90,840-bar `MES=F` 1m archive migrations & scripts (`RM-A1`, PR #282; #71 closed), and daily Vercel Cron Yahoo archive top-up (`RM-A2`, PR #296).

---

## 7. Owner design session — 2026-11-27 (added by Tappy at the owner's request; planner: fold into §0/§1 and delete this section)

### 7.1 Correction to §0 (stale as of tonight)

- The Vercel owner todo in §0.2 is **done**: `CRON_SECRET` was added to Vercel Production on 2026-11-27, and `SUPABASE_SERVICE_ROLE_KEY` was verified present (set 2026-11-22, all environments). PR #296 merged as `4b9b75e`; the daily archive top-up cron (`23:00 UTC`) is live. GPT does not need to chase this.

### 7.2 Owner decisions made 2026-11-27 (bake in, do not re-ask)

- **No hollow candles.** §1 row 9 (`RM-B2` hollow rising / filled falling) is **overruled as written**. `DS-02` (direction never by color alone) keeps its redundancy from `+`/`−` signs, ▲▼ arrows, and luminance separation. If another cue is proposed, it returns as an owner decision — no agent picks one.
- **`RM-E2` (chart zoom-out floor) — owner direction given.** In the owner's words: zooming out should keep shrinking the candles so more always fit, "an infinite shrink thing going on like TV"; today "they stay the same size and it stops." The current clamp (`MIN_BAR_SPACING_PX = 3`) is the defect. Requirement: candle width/spacing scales continuously with the visible range down to ~1px, TradingView-style. Move `RM-E2` out of owner-gated (§1a) into the design wave planning with this requirement as its spec; the implementation choice (drop the floor vs auto timeframe step) is the planner's, the behavior is not negotiable.
- **Still open** (already tracked): `DS-12` canvas `#07080c` keep-or-soften, and `RM-B1` `--text-primary` `#e6e8ec` confirmation (§1 row 8).

### 7.3 Design planning input (from the 2026-11-27 owner session)

- Scoreboard against the charter: `DS-01` is the only standard rated **failing** (muted/faint/axis/loss text at APCA Lc 35–50 vs ≥75 required) — `RM-B1` is correctly placed as the first design package. `DS-06` (agent provenance, `RM-K1`) is the only other **not met**.
- Audit sweep still owed, plan as one small package: `DS-03` denominator rule, `DS-09` keyboard parity beyond Trade Detail, `DS-10` disclosure depth per screen, `DS-05` Strategy Lab "hypothetical" labelling (`RM-J6`).
- Parked and endorsed as parked: `RM-K3` / `RM-K4` stay gated behind Blueprint convergence.

### 7.4 Tappy's design suggestions (advisory — owner/planner may strike any)

1. **Make `contrast.test.ts` merge-blocking in the Integrator gate**, not advisory. A standard without a gate decays within two waves.
2. **DS-02 acceptance without hollow candles:** a grayscale render check. Up and down candles must stay distinguishable with color removed (luminance difference alone). It is a visible check a simple agent can run on a screenshot — no taste judgment required.
3. **Scope the candle-zoom package to include hit-testing at thin widths.** At ~1px spacing, crosshair snapping and level hit-testing (`lib/level-hit-test.ts`) are what break first. Name that file in the package or the zoom fix will quietly degrade level selection.
4. **Provenance before intelligence.** `RM-K1` ("by agent" markers) should land before any insight-proposal work is even planned in detail; trust markings are cheap now and expensive to retrofit.
5. **Mark two charter items aspirational, not gating, for a single-user app:** regional candle color polarity (red-up conventions) and APCA checks beyond text tokens. Keep them in the charter as background; do not let them into wave scope.
6. **Protect `RM-C1` (Today "Next" card).** It is the screen the owner opens daily; if a design-hygiene wave needs to slip, slip hygiene, not the Today card.
