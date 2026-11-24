# 91 — Five-Agent Swarm Execution Plan (2026-11-24)

**Planner:** Gemini 4 (Swarm Planner)
**Baseline:** `origin/main` at `fb8790b` (PRs #207 and #208 merged)
**Design inputs:** [`00-overview.md`](00-overview.md), [`01`](01-playbook-lab.md)–[`08`](08-visual-quality.md), [`90-work-packages.md`](90-work-packages.md), [`92-decisions-made-by-swarm.md`](92-decisions-made-by-swarm.md), and `~/mogmine-claude/FIELD-NOTES.md`.
**Machine manifest:** [`swarm-plan.json`](swarm-plan.json) · **Worker prompts:** [`prompts/<PKG-ID>.md`](prompts/)

---

## 1. Package Audit & Count Verification

1. **Pre-amendment audit of [`90-work-packages.md`](90-work-packages.md) (`34` packages):**
   - `90` §2–§3 marked **8 packages** directly decision-gated (`RS-3a` [D-A], `RS-3b` [D-A], `UX-C` [Q-10], `LB-B1` [D-D], `LB-B2` [D-E], `IN-2` [D-F], `IN-3` [OD-18/D-G], `PL-3` [Q-6]).
   - In addition, **1 package (`API-4`)** had a hard dependency on gated `IN-2` (`API-4 ← API-3, IN-2` for `gapPolicy` VWAP tolerance), so the true pre-amendment ungated count was **25** (not 26).
2. **Post-amendment count (all runnable):**
   - **Amendment 1 (2026-11-24 4:46 PM CT):** Chris overrode all gating (*"I don't really think anything needs my decision"*). Every open decision (`D-A`..`D-J`, `Q-1`..`Q-14`, and linked `OD-*` items) now has a concrete, reversible default recorded in [`92-decisions-made-by-swarm.md`](92-decisions-made-by-swarm.md). All **34** packages from `90` are runnable (`waiting_on_chris: []`).
   - **Amendments 3 & 4 (2026-11-24 4:49 PM CT):** Added **1** new chart visual-polish package **`UX-E`** (*"Modern position zones"*), implemented strictly from `docs/design-2026-11-24/08-visual-quality.md` and scheduled in **Wave 2** so `08-visual-quality.md` lands on `main` first.
   - **Total runnable packages:** **35** (`35 ÷ 5 agents = 7 full waves`, `0` gated / waiting on Chris).
3. **Code-path spot-check corrections applied in prompts and `writes`:**
   - `UX-A`: `"1 trade this session"` and `"12 open"` live in `components/TodayScreen.tsx` (lines 56 and 97), not `components/AppShell.tsx`.
   - `RS-2`: `lib/accounts-store.ts` (`addAccount` / `updateAccount` patch type) must accept `r_size_cents` alongside `components/AccountSheet.tsx`.
   - `RS-1` vs `DR-1a`: `lib/journal-backup.ts` `parseTradeItem` already forwards `...rest` to `normalizeTrade`, and `replaceTrades` lives in `lib/store.ts`; `RS-1` therefore owns `lib/store.ts` while `DR-1a` exclusively owns `lib/journal-backup.ts` in Wave 1.
   - `IN-1` vs `RS-1`: `lib/commands/journal-commands.ts` delegates `prefs` parsing to `sanitizePrefs(raw)` without enumerating fields, so `IN-1` does not touch `journal-commands.ts`.
   - `DR-1b` & `PL-3`: adding a collection (`daily_reviews`) or v1 singleton (`tag_registry`) also requires updating `lib/persistence/select.ts`, `lib/__tests__/fake-supabase.ts`, `lib/__tests__/journal-commands.test.ts`, `lib/__tests__/persistence-contract.test.ts`, `mogmine_replace_rows` / DML grants in SQL, and (for `PL-3`) `SINGLETON_KEYS`/`COLLECTION_KEYS` in `lib/agent/http.ts`.

---

## 2. Five Swarm Agents & Lanes

Package IDs are 100% unchanged from `90-work-packages.md` (plus `UX-E`). With `IN-3` ungated and `UX-E` added, `L3` holds 7 pure chart/indicator packages across Waves 1–7, so the 2 non-chart Playbook Lab UI slices (`PL-2a`, `PL-2b`) run in the open `L4` (Wave 4) and `L1` (Wave 7) slots to pack all 35 packages into **7 waves** with zero idle slots and zero file collisions.

| Agent | Lane | Theme | Assigned Packages (Waves 1 → 7) |
| :--- | :--- | :--- | :--- |
| **`swarm-1`** | **`L1`** | Risk & entry validation (+ Lab Map/Gaps in W7) | `RS-1` → `RS-2` → `RS-3a` → `RS-3b` → `RS-4` → `UX-C` → `PL-2b` |
| **`swarm-2`** | **`L2`** | Trade truth, fills, stops, challenges & Pit Stop UX | `FB-1` → `SM-1` → `SM-2` → `UX-B` → `SM-3` → `UX-D` → `FB-2` |
| **`swarm-3`** | **`L3`** | Chart look, position zones, levels, VWAP & 200 EMA | `IN-1` → `UX-E` → `IN-2` → `LB-A` → `LB-B1` → `LB-B2` → `IN-3` |
| **`swarm-4`** | **`L4`** | Daily review, day nav, review cards (+ Lab Home in W4) | `DR-1a` → `NAV-1` → `DR-1b` → `PL-2a` → `DR-2` → `DR-3` → `UX-A` |
| **`swarm-5`** | **`L5`** | Agent API, Playbook Lab model & Tag Registry | `API-1` → `API-2a` → `PL-1` → `API-2b` → `API-3` → `API-4` → `PL-3` |

---

## 3. Decisions Made by Swarm (Replaces "Waiting on Chris")

**0 packages are waiting on Chris.** All 24 design decisions and open questions (`D-A`..`D-J`, `Q-1`..`Q-14`, plus linked `OD-10`, `OD-18`, `OD-20`, `OD-28`, `OD-55a`) have concrete defaults documented in **[`92-decisions-made-by-swarm.md`](92-decisions-made-by-swarm.md)** and embedded directly into each affected package prompt so workers never guess or block.

---

## 4. Wave Matrix & Shared-File Serialization

Every package sits in a wave **strictly after** all of its hard dependencies and shared-file predecessors. Within any single wave, **no two packages share any writable file** (verified mechanically via `jq` across `swarm-plan.json`).

| Wave | `L1` (`swarm-1`) | `L2` (`swarm-2`) | `L3` (`swarm-3`) | `L4` (`swarm-4`) | `L5` (`swarm-5`) |
| :---: | :--- | :--- | :--- | :--- | :--- |
| **1** | `RS-1` | `FB-1` | `IN-1` | `DR-1a` | `API-1` |
| **2** | `RS-2` *(← RS-1)* | `SM-1` *(← FB-1)* | `UX-E` *(← IN-1; reads 08)* | `NAV-1` | `API-2a` *(← API-1, RS-1)* |
| **3** | `RS-3a` *(← RS-1, NAV-1, UX-E)* | `SM-2` *(← SM-1, UX-E)* | `IN-2` *(← IN-1, RS-2)* | `DR-1b` *(← DR-1a, API-2a)* 🗄️ | `PL-1` *(← NAV-1)* |
| **4** | `RS-3b` *(← RS-3a, SM-2, IN-2)* | `UX-B` *(← DR-1b)* | `LB-A` *(← UX-E)* | `PL-2a` *(← PL-1, NAV-1, DR-1a)* | `API-2b` *(← API-2a)* |
| **5** | `RS-4` *(← RS-1, RS-2, RS-3b)* | `SM-3` *(← SM-2, RS-1, RS-3b, UX-B)* | `LB-B1` *(← LB-A, IN-1)* | `DR-2` *(← DR-1a, DR-1b, RS-3b, PL-2a)* | `API-3` *(← FB-1, SM-1, SM-2, API-2b)* |
| **6** | `UX-C` *(← RS-4, SM-3)* | `UX-D` *(← DR-2, RS-3b)* | `LB-B2` *(← LB-B1, SM-3, DR-2)* | `DR-3` *(← DR-2, IN-1, RS-3a)* | `API-4` *(← API-3, IN-2)* |
| **7** | `PL-2b` *(← PL-2a)* | `FB-2` *(← FB-1, SM-2)* | `IN-3` *(← IN-1, IN-2, LB-B2, API-4)* | `UX-A` *(← UX-D, NAV-1)* | `PL-3` *(← PL-1, PL-2a, API-2a, API-2b, DR-1b, UX-C)* 🗄️ |

*(🗄️ = `needs_migration: true`: `DR-1b` adds `mogmine_daily_reviews`; `PL-3` adds `mogmine_tag_registries`. Workers write SQL files only and never apply them.)*

### Hot-Spot File Ownership Across Waves

| Shared File | Current Lines (`check:file-length`) | Exclusive Owner by Wave |
| :--- | :--- | :--- |
| `components/TradeDetail.tsx` | **807** *(over 450, grandfathered — ≤ 10 net lines per pkg)* | W1 `IN-1` → W2 `RS-2` → W3 `IN-2` → W4 `RS-3b` → W5 `SM-3` → W6 `LB-B2` → W7 `IN-3` |
| `lib/commands/journal-commands.ts` | 299 | W1 `RS-1` → W2 `API-2a` → W3 `DR-1b` → W4 `UX-B` → W5 `SM-3` → W6 `UX-C` → W7 `PL-3` |
| `lib/trades.ts` | **1,163** *(over 450, grandfathered — no net growth; extract helpers)* | W1 `RS-1` → W2 `SM-1` → W3 `RS-3a` → W4 `RS-3b` → W6 `UX-C` |
| `components/TradeChart.tsx` | **578** *(over 450, grandfathered — justify/keep tight)* | W2 `UX-E` → W4 `LB-A` → W5 `LB-B1` → W6 `LB-B2` → W7 `IN-3` |
| `components/ReviewScreen.tsx` | 162 | W2 `NAV-1` → W4 `RS-3b` → W5 `DR-2` → W6 `UX-D` → W7 `UX-A` |
| `lib/agent/openapi.ts` | 252 | W1 `API-1` → W2 `API-2a` → W4 `API-2b` → W5 `API-3` → W6 `API-4` |
| `lib/trade-marks.ts` | **509** *(over 450, grandfathered)* | W1 `FB-1` → W3 `SM-2` → W4 `RS-3b` |
| `lib/trade-bar-validation.ts` | 382 | W1 `FB-1` → W2 `SM-1` → W3 `SM-2` |
| `lib/data-notes.ts` | 93 | W1 `FB-1` → W2 `SM-1` → W3 `SM-2` → W5 `SM-3` |
| `app/globals.css` & `lib/theme.ts` | **1,174** (`globals.css` over 450 — tokens only) / 86 | W2 `UX-E` → W4 `LB-A` → W7 `IN-3` |
| `app/layout.tsx` | 45 | W4 `PL-2a` → W5 `DR-2` → W6 `LB-B2` |
| `lib/shareCard.ts` | **627** *(over 450, grandfathered)* | W2 `UX-E` → W3 `RS-3a` → W6 `DR-3` |
| `components/AddTradeSheet.tsx` | 426 *(keep ≤ 450 via `RiskRow.tsx`)* | W4 `RS-3b` → W5 `RS-4` → W6 `UX-C` |
| `components/TuneScreen.tsx` | **474** *(over 450, grandfathered — 1–3 lines only)* | W1 `DR-1a` → W4 `PL-2a` → W7 `PL-3` |
| `components/AppShell.tsx` | 94 | W1 `DR-1a` → W7 `PL-3` |
| `lib/journal-backup.ts` | 237 | W1 `DR-1a` → W7 `PL-3` |
| `lib/persistence/{contract,registry,local-adapter,supabase-adapter,select}.ts` | ≤ 400 each | W3 `DR-1b` → W7 `PL-3` |

### All 14 Over-450-Line Grandfathered Files (`AGENTS.md` §6.12)

Per `npm run check:file-length`, any PR touching or growing one of these 14 files **must report before/after line counts and justification in its handoff and PR body**, and keep new logic in dedicated modules/components:
- `lib/trade-document.ts` (1,824 — touched by `SM-2`, must not grow net)
- `app/globals.css` (1,174 — token lines only in `UX-E`, `LB-A`, `IN-3`; component CSS goes in `app/levels.css`, `app/review-day.css`, `app/lab.css`)
- `lib/trades.ts` (1,163 — touched by `RS-1`, `SM-1`, `RS-3a`, `RS-3b`, `UX-C`; new math in `lib/r-size.ts`)
- `lib/mood.ts` (895 — touched by `RS-3a`, 2-line swap to `resultR`)
- `components/StopMovesEditor.tsx` (841 — touched by `FB-2`, must not grow net)
- `components/TradeDetail.tsx` (807 — ≤ 10 net lines per package; UI lives in `RiskLine.tsx`, `StopFacts.tsx`, `LevelCard.tsx`)
- `lib/shareCard.ts` (627 — touched by `UX-E`, `RS-3a`, `DR-3`)
- `lib/partials.ts` (596 — untouched)
- `components/ChallengeDetail.tsx` (594 — touched by `UX-B`)
- `components/TradeChart.tsx` (578 — touched by `UX-E`, `LB-A`, `LB-B1`, `LB-B2`, `IN-3`)
- `lib/trade-marks.ts` (509 — touched by `FB-1`, `SM-2`, `RS-3b`)
- `lib/day-card.ts` (504 — touched by `RS-3a`, 2-line swap to `resultR`)
- `components/PlanSheet.tsx` (487 — untouched)
- `components/TuneScreen.tsx` (474 — touched by `DR-1a`, `PL-2a`, `PL-3`; new UI in `TagRegistryEditor.tsx`)

---

## 5. Worker Conventions

1. **Worktree & Branch:** Each package runs in its own isolated git worktree branched from latest `origin/main` at the start of its wave on `swarm/<PKG-ID>` (e.g., `swarm/RS-1`).
2. **Canonical Atomic Claim:** Before starting work, push the atomic lock ref `git push origin origin/main:refs/heads/claim/<PKG-ID>` (`AGENTS.md` §6.6 analog). If the push fails, stop immediately. Codex deletes `refs/heads/claim/<PKG-ID>` after merging.
3. **Standard Verification Gate (every package):**
   ```bash
   npm test && npm run typecheck && npm run lint && npm run build && npm run check:file-length
   ```
   UI packages additionally run a `390×844` mobile check (zero horizontal overflow, `≥ 44px` tap targets, `tabular-nums`) and `1280px` desktop check; chart-level packages also run `node scripts/check-session-levels.mjs`.
4. **Handoff & PR Creation:**
   - Write real command outputs, changed file list, and before/after line counts for any grandfathered (`> 450` line) file to a **new** file: `notes/handoffs/2026-11-24-<PKG-ID>.md`.
   - Push branch and open PR without merging:
     ```bash
     git push -u origin swarm/<PKG-ID>
     gh pr create --base main --title "[<PKG-ID>] <short title>" --body-file notes/handoffs/2026-11-24-<PKG-ID>.md
     ```
   - **Workers NEVER edit `BOARD.md`, `NOTES.md`, or `DECISIONS.md`, and NEVER merge PRs.** Codex reviews, rebases if needed, merges, and folds handoffs/spec write-backs (`90` §6).

---

## 6. Wave-by-Wave Ownership, Acceptance Tests & Codex Integration Notes

### Wave 1 (`RS-1`, `FB-1`, `IN-1`, `DR-1a`, `API-1`)

| Pkg | Agent / Lane | Writable Files (strict) | Acceptance Tests & Gate |
| :--- | :--- | :--- | :--- |
| **`RS-1`** | `swarm-1` (`L1`) | `lib/r-size.ts` *(new)*, `lib/accounts.ts`, `lib/trades.ts`, `lib/store.ts`, `lib/commands/journal-commands.ts`, `lib/__tests__/r-size.test.ts` *(new)* | `lib/__tests__/r-size.test.ts`: golden table A (`$87.50` = `0.29R`, `+$615` = `+2.05R`), B (`$75` = `0.25R`, `−0.25R`), C (`$60` = `0.20R`, `−0.13R`) at `$300`; fallback `trade → account → prefs ($250)`; no-stop closed trade has `resultR` & `null` `riskR`; client `risk_cents` mismatch → `invalid` (422); `replaceTrades` keeps frozen `r_size_cents`. Plus full gate. |
| **`FB-1`** | `swarm-2` (`L2`) | `lib/fill-match.ts` *(new)*, `lib/trade-bar-validation.ts`, `lib/trade-marks.ts`, `lib/data-notes.ts`, `lib/__tests__/fill-match.test.ts` *(new)* | `lib/__tests__/fill-match.test.ts`: stated bar exact → `stated`; `−1m` bar contains price (Trade C `7263` logged `14:14`, printed `14:13`) → `shifted` (`offsetMin: -1`), marker anchored on `14:13`, `fill_time_shifted` quiet note, no `fill_outside_bar`; tie breaks earlier for entry / later for exit; 4-tick fallback; `notBefore`/`notAfter` ordering. Plus full gate. |
| **`IN-1`** | `swarm-3` (`L3`) | `lib/prefs-sanitize.ts`, `components/TradeDetail.tsx`, `lib/__tests__/prefs-chart-choices.test.ts` *(new)* | `lib/__tests__/prefs-chart-choices.test.ts`: `sanitizePrefs` defaults & round-trips `vwapAnchor` (`"off"`), `levelLabels` (`"tap"`), `ema200` (`false`), `reviewCardOrientation` (`"portrait"`); `TradeDetail` VWAP toggle persists across trade navigation & reload; `prefs-sync.test.ts` passes. Plus full gate. |
| **`DR-1a`** | `swarm-4` (`L4`) | `lib/daily-review.ts` *(new)*, `lib/daily-review-store.ts` *(new)*, `lib/daily-review-sanitize.ts` *(new)*, `lib/journal-backup.ts`, `components/AppShell.tsx`, `components/TuneScreen.tsx`, `lib/__tests__/daily-review.test.ts` *(new)* | `lib/__tests__/daily-review.test.ts`: `proposeTradeIds` by `sessionDate(entry_time)` & `account_id`; `dailyReviewTotals` reuses `buildDayCardData` excluding samples; uniqueness per `(session_date, account_id)`; `recorded_at` preserved; `buildBackup`/`parseBackupFile` round-trip with `daily_reviews`, older backup leaves existing reviews intact. Plus full gate. |
| **`API-1`** | `swarm-5` (`L5`) | `lib/agent/house-rules.ts` *(new)*, `lib/agent/openapi.ts`, `app/.well-known/mogmine.json/route.ts`, `app/api/v1/guide/route.ts` *(new)*, `lib/agent/http.ts`, `lib/__tests__/agent-house-rules.test.ts` *(new)*, `lib/__tests__/agent-http.test.ts`, `lib/__tests__/agent-openapi.test.ts` | `lib/__tests__/agent-house-rules.test.ts` & `agent-http.test.ts`: all 12 rules `HR-1`..`HR-12` present in `/.well-known/mogmine.json`, `/api/v1/openapi.json` (`x-mogmine-house-rules`), and `GET /api/v1/guide`; `setupBlock` points to `guide_url`; `parseListQuery` defaults `includeArchived` & `includeSamples` to `false`. Plus full gate. |

- **Codex Wave 1 integration:** Zero shared files. Suggested merge order: `RS-1` → `FB-1` → `IN-1` → `DR-1a` → `API-1`. Confirm `docs/design-2026-11-24/08-visual-quality.md` is merged onto `main` before launching Wave 2 (`UX-E`). Run full gate once after merging all five.

---

### Wave 2 (`RS-2`, `SM-1`, `UX-E`, `NAV-1`, `API-2a`)

| Pkg | Agent / Lane | Writable Files (strict) | Acceptance Tests & Gate |
| :--- | :--- | :--- | :--- |
| **`RS-2`** | `swarm-1` (`L1`) | `components/AccountSheet.tsx`, `lib/accounts-store.ts`, `lib/prefs.ts`, `components/RiskChips.tsx`, `components/RiskLine.tsx` *(new)*, `components/TradeDetail.tsx`, `lib/__tests__/risk-line.test.ts` *(new)*, `lib/__tests__/tune-prefs.test.ts` | `lib/__tests__/risk-line.test.ts`: Trade A at `$300` renders `Risk $87.50 · 0.29R of $300 · you said 0.25R ($75)`; Shield mode strips all `$` (`Risk 0.29R · you said 0.25R`); unset account shows `"default $250"`; `RiskChips` offers `0.25R`, `0.5R`, `1R`; `390×844` layout check. Plus full gate. |
| **`SM-1`** | `swarm-2` (`L2`) | `lib/session.ts`, `lib/trades.ts`, `lib/trade-bar-validation.ts`, `lib/data-notes.ts`, `lib/__tests__/post-entry.test.ts` *(new)*, `lib/__tests__/trade-observer.test.ts`, `lib/__tests__/data-notes.test.ts`, `lib/__tests__/trade-document.test.ts` | `lib/__tests__/post-entry.test.ts`: `insideBarTimes` excludes entry bar even at `:00` seconds (and uses `FB-1` matched entry bar when shifted); Trade A (`07:55` dip `7083.75` below `7119.50` stop before `7137` fill) produces zero `stop_traded_through`, MAE from post-entry bars only, and muted `D-H` data note; `< 2` inside bars → `MAE: null`. Document any fixture golden diffs. Plus full gate. |
| **`UX-E`** | `swarm-3` (`L3`) | `components/PositionBoxPrimitive.ts`, `lib/chart-paint.ts` *(new)*, `lib/theme.ts`, `app/globals.css`, `components/TradeChart.tsx`, `lib/shareCard.ts`, `lib/__tests__/chart-paint.test.ts` *(new)*, `scripts/check-position-box.mjs` | Implement `08-visual-quality.md` §7.2 (`D-V1` & `D-V5` adopted as recommended). `lib/__tests__/chart-paint.test.ts`: crisp DPR snapping (`1/2/2.625/3`), chip width, dash table, and chip contrast `≥ 4.5:1` in classic + `blue-orange`; even-odd plan-under-actual clip; JetBrains Mono canvas font; before/after PNGs at `390×844` & `1280px` (`mes-opening-scalp`, `mnq-trend-hold`, `mes-failed-reclaim`) in `notes/handoffs/`. Plus full gate. |
| **`NAV-1`** | `swarm-4` (`L4`) | `lib/selectors.ts`, `components/FeedScreen.tsx`, `components/TodayScreen.tsx`, `components/DayHeader.tsx`, `components/ReviewScreen.tsx`, `lib/__tests__/nav-filters.test.ts` *(new)* | `lib/__tests__/nav-filters.test.ts`: `parseFilters`/`filtersToQuery`/`applyFilters`/`describeFilters` for `date`, `account`, `playbook`, `tag`; `TodayScreen` `?date=` stepping skips weekends + shows `"Back to today"` + post-`17:00 CT` close banner; `ReviewScreen` day chips filter queue cleanly; `390×844` check. Plus full gate. |
| **`API-2a`** | `swarm-5` (`L5`) | `app/api/v1/vocabulary/route.ts` *(new)*, `lib/agent/vocabulary.ts` *(new)*, `lib/agent/dispatch.ts`, `lib/agent/http.ts`, `lib/commands/journal-commands.ts`, `lib/agent/openapi.ts`, `lib/__tests__/agent-vocabulary.test.ts` *(new)*, `lib/__tests__/agent-api.test.ts`, `lib/__tests__/agent-openapi.test.ts` | `lib/__tests__/agent-vocabulary.test.ts` & `agent-api.test.ts`: `GET /api/v1/vocabulary` returns active+flagged-archived playbooks, tags, active accounts with `r_size_cents`/`r_size_source`, `default_r_size_cents`, symbols, presets, time rules; `?include=derived` matches `resultR`/`riskR`/`tradePnl` and account journal balance; trade list filters (`session_date`, `from`, `to`, `account_id`, `playbook_id`). Plus full gate. |

- **Codex Wave 2 integration:** Zero shared files. Merge order: `UX-E` → `SM-1` → `NAV-1` → `RS-2` → `API-2a`. Inspect `UX-E`'s `390×844` and `1280px` before/after screenshots in `notes/handoffs/` against `08-visual-quality.md`. Run full gate.

---

### Wave 3 (`RS-3a`, `SM-2`, `IN-2`, `DR-1b`, `PL-1`)

| Pkg | Agent / Lane | Writable Files (strict) | Acceptance Tests & Gate |
| :--- | :--- | :--- | :--- |
| **`RS-3a`** | `swarm-1` (`L1`) | `lib/trades.ts`, `lib/selectors.ts`, `lib/day-card.ts`, `lib/shareCard.ts`, `lib/drills.ts`, `lib/mood.ts`, `lib/describe.ts`, `lib/exit-efficiency.ts`, `lib/plan-vs-actual.ts`, `lib/__tests__/account-r-consumers.test.ts` *(new)*, `lib/__tests__/running-stats.test.ts`, `lib/__tests__/day-card.test.ts`, `lib/__tests__/card-system.test.ts`, `lib/__tests__/drills.test.ts`, `lib/__tests__/mood.test.ts`, `lib/__tests__/exit-efficiency.test.ts`, `lib/__tests__/plan-vs-actual.test.ts` | `lib/__tests__/account-r-consumers.test.ts`: `riskMultiple` & `plannedRewardRisk` added (keeping `@deprecated` `rMultiple`/`plannedR` aliases for Wave 3 compatibility); `runningStats`, `dayStats`, `buildDayCardData`, `shareCardContent`, `drills`, `mood`, `describeTrade`, `exitEfficiency`, `derivePlanVsActual` all report account `resultR`; `isScratch` stays on trade's own stop risk (`D-C`). List every updated test assertion in handoff. Plus full gate. |
| **`SM-2`** | `swarm-2` (`L2`) | `lib/trade-document.ts`, `lib/trade-bar-validation.ts`, `lib/trade-marks.ts`, `components/PositionBoxPrimitive.ts`, `lib/data-notes.ts`, `lib/__tests__/untimed-stop-moves.test.ts` *(new)*, `lib/__tests__/trade-document.test.ts`, `lib/__tests__/trade-marks.test.ts`, `lib/__tests__/trade-observer.test.ts` | `lib/__tests__/untimed-stop-moves.test.ts`: `pickStopMoveTime` removed (`lib/trade-document.ts` net lines `≤ 1,824`); `initial_stop_price ≠ stop_loss_price` with empty `stop_moves` creates `"untimed"` modify event at exit instant; observer checks initial stop across hold (zero false `stop_traded_through` from trailed stop); `buildMarks` emits dashed step at exit labelled `moved · time?`; muted data note emitted. Plus full gate. |
| **`IN-2`** | `swarm-3` (`L3`) | `lib/session-indicators.ts`, `lib/chart-indicators.ts`, `components/useTradeLevels.ts`, `components/TradeDetail.tsx`, `lib/__tests__/session-indicators.test.ts`, `lib/__tests__/chart-indicators.test.ts` | `lib/__tests__/session-indicators.test.ts` & `chart-indicators.test.ts`: `gapPolicy: "globex-tolerant"` draws Globex VWAP with `approximate: true` (`≈`) on 11/23 gap pattern (23/1,380 missing, longest 12m, 0 RTH gaps); rejects `> 3%`, `> 15m` gap, or any gap `≥ 09:30 ET`; `useTradeLevels` loads full session window while levels still cut strictly at `entry_time` (existing level tests unchanged). Plus full gate. |
| **`DR-1b`** | `swarm-4` (`L4`) | `supabase/migrations/20261124120000_mogmine_daily_reviews.sql` *(new)*, `lib/persistence/contract.ts`, `lib/persistence/registry.ts`, `lib/persistence/local-adapter.ts`, `lib/persistence/supabase-adapter.ts`, `lib/persistence/select.ts`, `lib/daily-review-store.ts`, `lib/commands/journal-commands.ts`, `lib/__tests__/daily-review-persistence.test.ts` *(new)*, `lib/__tests__/fake-supabase.ts`, `lib/__tests__/journal-commands.test.ts`, `lib/__tests__/persistence-contract.test.ts`, `lib/__tests__/persistence-local-adapter.test.ts`, `lib/__tests__/persistence-supabase-adapter.test.ts` | **MIGRATION NEEDS APPLYING** (`mogmine_daily_reviews` + RLS + grants + `mogmine_replace_rows` update; worker NEVER applies). `lib/__tests__/daily-review-persistence.test.ts`: `/api/v1/records/daily_reviews` CRUD + `409 conflict` on duplicate `(session_date, account_id)` returning existing id; local & fake-Supabase contract suites pass; graceful local fallback when unapplied. Plus full gate. |
| **`PL-1`** | `swarm-5` (`L5`) | `lib/playbook-lab.ts` *(new)*, `lib/__tests__/playbook-lab.test.ts` *(new)* | `lib/__tests__/playbook-lab.test.ts`: `labView` counts, `PlaybookFacet` (co-tags, exit reasons, hold bands, stop moved %, rules %, avg R gated at `n >= 10`, sparkline-only examples), `TagFacet`, `unknownTags`, `matrix`, `gaps`; every facet count equals `applyFilters` from `NAV-1`; open trades counted in `n` only (`OD-38`). Plus full gate. |

- **Codex Wave 3 integration:** Zero shared files. Merge order: `RS-3a` → `SM-2` → `IN-2` → `DR-1b` → `PL-1`. Note `DR-1b`'s SQL migration (`20261124120000_mogmine_daily_reviews.sql`) for Chris / Supabase MCP `apply_migration`. Fold `D-A`, `D-C`, `D-F`, `OD-28` spec write-backs if ready. Run full gate.

---

### Wave 4 (`RS-3b`, `UX-B`, `LB-A`, `PL-2a`, `API-2b`)

| Pkg | Agent / Lane | Writable Files (strict) | Acceptance Tests & Gate |
| :--- | :--- | :--- | :--- |
| **`RS-3b`** | `swarm-1` (`L1`) | `lib/trades.ts`, `lib/trade-marks.ts`, `lib/rstrip.ts`, `components/TradeDetail.tsx`, `components/TradeRow.tsx`, `components/ReviewScreen.tsx`, `components/DrillScreen.tsx`, `components/AddTradeSheet.tsx`, `lib/__tests__/r-ruler.test.ts`, `lib/__tests__/rstrip.test.ts`, `lib/__tests__/core.test.ts`, `lib/__tests__/open-trade.test.ts`, `lib/__tests__/validation.test.ts`, `lib/__tests__/honest-box.test.ts`, `lib/__tests__/r-trailed-stop.test.ts`, `lib/__tests__/initial-stop.test.ts`, `lib/__tests__/trade-document.test.ts`, `lib/__tests__/hindsight.test.ts`, `lib/__tests__/stop-moves.test.ts` | `lib/__tests__/r-ruler.test.ts` & `rstrip.test.ts`: R ruler and R strip space ticks by trade's own risk while labelling in account R (`+0.25R`, `+0.50R`, … on a `0.25R` trade); `TradeDetail`, `TradeRow`, `ReviewScreen`, `DrillScreen`, `AddTradeSheet` show account `resultR` / `plannedRewardRisk`; deprecated `rMultiple` & `plannedR` exports removed from `lib/trades.ts` (`grep -rn "\brMultiple\b"` zero hits in `app/ components/ lib/trades.ts`). Plus full gate. |
| **`UX-B`** | `swarm-2` (`L2`) | `lib/challenges.ts`, `lib/challenge-sanitize.ts`, `lib/challenge-store.ts`, `components/ChallengeSetupSheet.tsx`, `components/ChallengeCard.tsx`, `components/ChallengeDetail.tsx`, `lib/commands/journal-commands.ts`, `lib/__tests__/challenges.test.ts`, `lib/__tests__/challenge-store.test.ts` | `lib/__tests__/challenges.test.ts`: `account_id: string \| null` filters trades when set (`sim-acct-eval-50k` challenge ignores `sim-acct-sim-2` trades); `account_id: null` preserves all existing docs/17 golden tests; `ChallengeCard` displays account name and explicit floor label `Room before the challenge limit: $50 (from your high point)` (`Room: 3% of the limit` under Shield). Plus full gate. |
| **`LB-A`** | `swarm-3` (`L3`) | `components/SessionLevelsPrimitive.ts`, `components/TradeChart.tsx`, `lib/chart-levels.ts`, `lib/theme.ts`, `app/globals.css`, `scripts/check-session-levels.mjs`, `lib/__tests__/session-levels.test.ts` | `lib/__tests__/session-levels.test.ts` & `node scripts/check-session-levels.mjs`: level labels move to `zOrder: "bottom"` behind candles; `--level-label-bg-alpha: 0.95` token read via `lib/theme.ts` (contrast `≥ 4.5:1` on classic & `blue-orange`); `rightOffset` reserved when text pills render; rays end at `lastBar + 4px`; settlement rays (`PDC`, `3 PM close`, settle) 1px dotted `--level-neutral` at `0.6` alpha; zone right border removed + 24px fade. Plus full gate. |
| **`PL-2a`** | `swarm-4` (`L4`) | `app/playbooks/lab/page.tsx` *(new)*, `components/PlaybookLab.tsx` *(new)*, `components/PlaybookBinder.tsx`, `components/TuneScreen.tsx`, `app/lab.css` *(new)*, `app/layout.tsx`, `lib/__tests__/playbook-lab-ui.test.ts` *(new)* | `lib/__tests__/playbook-lab-ui.test.ts` + headless `390×844` & `1280px` checks: `/playbooks/lab` renders `Binder \| Lab` header, summary counts, `include samples` toggle, segmented `[Playbooks][Tags][Map][Gaps]`, Playbooks list + `?playbook=` drill-down, Tags list + `"Not in your vocabulary"` section; Tune link reads `"Playbooks & Lab"`; zero horizontal overflow, `≥ 44px` tap targets. Plus full gate. |
| **`API-2b`** | `swarm-5` (`L5`) | `lib/agent/write-checks.ts` *(new)*, `lib/agent/dispatch.ts`, `lib/agent/openapi.ts`, `lib/__tests__/agent-write-checks.test.ts` *(new)*, `lib/__tests__/agent-openapi.test.ts` | `lib/__tests__/agent-write-checks.test.ts`: every row of `07` §4 tested — `422` refusals for unknown `playbook_id` (listing valid ids/names), unknown `account_id`, unknown `quick_tags` (`Q-9`, listing valid tags), future entry/exit (`> 5m`, `Q-10`/`Q-11`), mismatched `risk_cents`; non-blocking `warnings` array on `200`/`201` for `playbook_missing`, `setup_tag_missing`, `notes_restate_fields`, `stop_moved_without_time`, `exit_reason_mismatch`, `stated_risk_differs`, `price_out_of_range`. Plus full gate. |

- **Codex Wave 4 integration:** Zero shared files. Merge order: `RS-3b` → `LB-A` → `UX-B` → `PL-2a` → `API-2b`. Verify `grep -rn "\brMultiple\b" app components lib/trades.ts` returns nothing after `RS-3b`, and run `node scripts/check-session-levels.mjs` after `LB-A`.

---

### Wave 5 (`RS-4`, `SM-3`, `LB-B1`, `DR-2`, `API-3`)

| Pkg | Agent / Lane | Writable Files (strict) | Acceptance Tests & Gate |
| :--- | :--- | :--- | :--- |
| **`RS-4`** | `swarm-1` (`L1`) | `components/AddTradeSheet.tsx`, `components/RiskRow.tsx` *(new)*, `lib/entry-form.ts`, `scripts/r-size-backfill.mjs` *(new)*, `lib/__tests__/r-size-entry-and-backfill.test.ts` *(new)* | `lib/__tests__/r-size-entry-and-backfill.test.ts`: `RiskRow` chips (`0.25R · 0.5R · 1R · other`) set `stated_risk_r` and suggest stop when blank, or display actual vs stated when stop is typed (`AddTradeSheet.tsx` stays `≤ 450` lines); `r-size-backfill.mjs` dry-run makes zero writes on mocked repos, `--apply` uses `expectedUpdatedAt` & is idempotent on second run, skips samples, never edits notes. (**Worker never runs script against live data.**) Plus full gate. |
| **`SM-3`** | `swarm-2` (`L2`) | `lib/commands/journal-commands.ts`, `lib/stop-facts.ts` *(new)*, `lib/data-notes.ts`, `components/StopFacts.tsx` *(new)*, `components/TradeDetail.tsx`, `lib/__tests__/stop-facts.test.ts` *(new)*, `lib/__tests__/journal-commands.test.ts` | `lib/__tests__/stop-facts.test.ts` & `journal-commands.test.ts`: move outside `[entry, exit]` → 422; last move `≠ stop_loss_price` → 422; same-minute moves preserve input order; missing `initial_stop_set_at` with `initial_stop_price` defaults to `entry_time` (`02` §2.6); `widestRisk` & `lockedR` in account R; exit `> 2` ticks past working stop on `stop`/`trail` emits quiet slippage data note. Plus full gate. |
| **`LB-B1`** | `swarm-3` (`L3`) | `lib/level-hit-test.ts` *(new)*, `components/SessionLevelsPrimitive.ts`, `components/TradeChart.tsx`, `scripts/check-session-levels.mjs`, `lib/__tests__/level-hit-test.test.ts` *(new)* | `lib/__tests__/level-hit-test.test.ts` & `node scripts/check-session-levels.mjs`: `levelLabels: "tap"` hides right-edge pills (`rightOffset: 0`), renders `≤ 3` price-only `priceAxisViews` for merged groups nearest entry (excluding trade prices); `hitLevel` (`10px` ray tolerance + zone interior, nearest wins); `onChartClick` order: neighbour box → level → dismiss. Plus full gate. |
| **`DR-2`** | `swarm-4` (`L4`) | `app/review/day/[date]/page.tsx` *(new)*, `components/DayReviewScreen.tsx` *(new)*, `components/ReviewScreen.tsx`, `app/review-day.css` *(new)*, `app/layout.tsx`, `scripts/migrate-1123-daily-review.mjs` *(new)*, `lib/__tests__/day-review-screen.test.ts` *(new)* | `lib/__tests__/day-review-screen.test.ts` + `390×844` check: `/review/day/[date]` renders trading-day `‹ ›` arrows, account scope selector, totals, read-only plan lessons, points editor (`went_well`, `mistake`, `observation`, `next_time`), 500-char lesson, `"Done for the day"` (leaves trade `review_status` unchanged, `Q-4`), and `"Also mark N linked trades reviewed"` with Undo; `ReviewScreen` mounts 14-day strip; `migrate-1123-daily-review.mjs` dry-run tested on fixtures only. Plus full gate. |
| **`API-3`** | `swarm-5` (`L5`) | `app/api/v1/candles/route.ts` *(new)*, `app/api/v1/checks/trade/route.ts` *(new)*, `lib/agent/candles.ts` *(new)*, `lib/agent/trade-check.ts` *(new)*, `lib/agent/openapi.ts`, `lib/__tests__/agent-candles-and-check.test.ts` *(new)*, `lib/__tests__/agent-openapi.test.ts` | `lib/__tests__/agent-candles-and-check.test.ts` (mocked `MarketDataProvider`, zero live network): `GET /api/v1/candles` maps `MES → MES=F` (no fallback), enforces `26h`/`7d` caps, cleans bars, returns `ct` strings + `coverage`, `200` empty for `closed`/`future`, LRU cache + upstream rate cap; `POST /api/v1/checks/trade` (read scope, writes nothing) catches Trade C `shifted -1` and Trade A post-entry clean check. Plus full gate. |

- **Codex Wave 5 integration:** Zero shared files. Merge order: `SM-3` → `RS-4` → `LB-B1` → `DR-2` → `API-3`. Run `node scripts/check-session-levels.mjs` and full gate.

---

### Wave 6 (`UX-C`, `UX-D`, `LB-B2`, `DR-3`, `API-4`)

| Pkg | Agent / Lane | Writable Files (strict) | Acceptance Tests & Gate |
| :--- | :--- | :--- | :--- |
| **`UX-C`** | `swarm-1` (`L1`) | `lib/trades.ts`, `lib/entry-form.ts`, `components/AddTradeSheet.tsx`, `lib/commands/journal-commands.ts`, `lib/__tests__/future-and-range-validation.test.ts` *(new)* | `lib/__tests__/future-and-range-validation.test.ts`: entry or exit `> now + 5m` rejected in `entry-form` / `AddTradeSheet` and returns `invalid` (422) in `journal-commands`; within `5m` clock-skew allowance passes; price `> 1%` outside loaded day's `[low, high]` (e.g., `4866.25` when MES traded `6935–7410`) shows inline typo warning in `AddTradeSheet` while still allowing save. Plus full gate. |
| **`UX-D`** | `swarm-2` (`L2`) | `components/PitStop.tsx`, `components/ReviewScreen.tsx`, `lib/__tests__/ux-setup-and-notes.test.ts` *(new)* | `lib/__tests__/ux-setup-and-notes.test.ts` + `390×844` check: `playbook_id === null` displays muted `"No setup picked"` / `"No setup"` chip in `PitStop` and `ReviewScreen` cards alongside playbook chips; all 4 note placeholders (`pre_trade_thesis`, `management_notes`, `post_exit_notes`, `note`) and the muted hint `"Prices, stop, risk and R are saved above. Notes are for your thinking."` match `02` §2.5 with accessible labels. Plus full gate. |
| **`LB-B2`** | `swarm-3` (`L3`) | `components/LevelCard.tsx` *(new)*, `components/TradeChart.tsx`, `components/TradeCardSheet.tsx`, `components/TradeDetail.tsx`, `app/levels.css` *(new)*, `app/layout.tsx`, `lib/__tests__/level-card.test.ts` *(new)* | `lib/__tests__/level-card.test.ts` + `390×844` check: tapping a ray/zone opens opaque `LevelCard` inside `.chart-frame` (tabular prices, source, coverage, never overlaps OHLC HUD, dismisses on outside tap/pan/zoom/Escape/6s, excluded from `takeScreenshot`); View menu level disclosure list is keyboard-focusable and highlights its ray; Trade Card PNG export (`D-E`) draws `≤ 4` labelled groups with right offset. Plus full gate. |
| **`DR-3`** | `swarm-4` (`L4`) | `components/ReviewCard.tsx` *(new)*, `lib/shareCard.ts`, `lib/day-sheet.ts` *(new)*, `components/DayReviewScreen.tsx`, `lib/__tests__/review-cards-and-sheet.test.ts` *(new)* | `lib/__tests__/review-cards-and-sheet.test.ts` + `390×844` & `1280px` checks: `ReviewCard` renders fitted `ReviewChart` + all 7 `06` §4 rows (Shield hides size, P&L `$`, risk `$`); `Portrait` (`4:5`, 1 col at 390px) & `Landscape` (`16:9` in `CARD_LAYOUT_TABLE`, 2 cols at `≥ 1024px`) bound to `reviewCardOrientation` pref; `"Share day"` pre-renders combined PNG via `day-sheet.ts` before tap (`UX-70`, Shield on by default). Plus full gate. |
| **`API-4`** | `swarm-5` (`L5`) | `app/api/v1/levels/route.ts` *(new)*, `lib/agent/levels.ts` *(new)*, `lib/agent/openapi.ts`, `lib/__tests__/agent-levels.test.ts` *(new)*, `lib/__tests__/agent-openapi.test.ts` | `lib/__tests__/agent-levels.test.ts`: `GET /api/v1/levels?symbol=MES&session_date=...&as_of=...` returns `LV-1` computed levels with `withheldReasons`, planned levels via `planStateAsOf`, and RTH + Globex VWAP (`gapPolicy: "globex-tolerant"`, `approximate` flag) + provenance; moving `as_of` 1 bar earlier proves strict point-in-time cutoff (`B-14`). Plus full gate. |

- **Codex Wave 6 integration:** Zero shared files. Merge order: `UX-C` → `UX-D` → `LB-B2` → `DR-3` → `API-4`. Run full gate.

---

### Wave 7 (`PL-2b`, `FB-2`, `IN-3`, `UX-A`, `PL-3`)

| Pkg | Agent / Lane | Writable Files (strict) | Acceptance Tests & Gate |
| :--- | :--- | :--- | :--- |
| **`PL-2b`** | `swarm-1` (`L1`) | `components/PlaybookLabMap.tsx` *(new)*, `components/PlaybookLabGaps.tsx` *(new)*, `components/PlaybookLab.tsx`, `app/lab.css`, `lib/__tests__/playbook-lab-map-gaps.test.ts` *(new)* | `lib/__tests__/playbook-lab-map-gaps.test.ts` + `390×844` check: `Map` renders playbook × setup-tag count grid using `--gold-mid` token intensity (switches to sorted pairs list when `> 8` tags; scrolls horizontally inside its own container with pinned first column and **zero** outer page overflow); `Gaps` lists no-playbook, no-setup-tag, unused playbooks/tags, and impulse share; every cell/line links to `/feed?...` matching the exact count. Plus full gate. |
| **`FB-2`** | `swarm-2` (`L2`) | `components/DataNotesChip.tsx`, `components/StopMovesEditor.tsx`, `lib/fill-match.ts`, `lib/__tests__/data-notes-actions.test.ts` *(new)* | `lib/__tests__/data-notes-actions.test.ts` + `390×844` check: `DataNotesChip` renders `"Use HH:MM"` action button on `fill_time_shifted` notes (writes UTC timestamp to `entry_time`/`exit_time` with Undo toast; zero change without tap) and `"Add time"` button on untimed-stop notes opening `StopMovesEditor` pre-filled (`StopMovesEditor.tsx` net lines `≤ 841`). Plus full gate. |
| **`IN-3`** | `swarm-3` (`L3`) | `lib/ema.ts` *(new)*, `lib/session-indicators.ts`, `lib/chart-indicators.ts`, `components/useTradeLevels.ts`, `components/TradeChart.tsx`, `components/TradeDetail.tsx`, `lib/agent/levels.ts`, `lib/theme.ts`, `app/globals.css`, `lib/__tests__/ema.test.ts` *(new)* | `lib/__tests__/ema.test.ts` + `390×844` check: `computeEma200` seeds with SMA(200) on displayed timeframe closes, draws only after `700` bars (`200 + 500`), marks dashed/`approximate` when warm-up misses `> 3%` of bars, returns unavailable reason when `< 700` bars or `1m > 30d`; `--ind-ema200` 1px line series + HUD value + View toggle (`ema200` pref) + `/api/v1/levels` output; loads extra `5m` day windows when needed. Plus full gate. |
| **`UX-A`** | `swarm-4` (`L4`) | `lib/day-counts.ts` *(new)*, `components/TodayScreen.tsx`, `components/ReviewScreen.tsx`, `lib/session-review.ts`, `components/SessionReview.tsx`, `lib/__tests__/day-counts.test.ts` *(new)*, `lib/__tests__/session-review.test.ts` | `lib/__tests__/day-counts.test.ts` & `session-review.test.ts`: `dayTradeCounts` drives `TodayScreen` `"1 trade today (0 closed)"` so entry-session vs exit-session counts never contradict account cards; Review queue summary reads `"12 to review · 1 needs tags"` (and `"All caught up"` links to `/playbooks/lab` per `Q-1`); unanchored plan written after session close windows the full session (`18:00 ET → 17:00 ET`) with `"Written after the close: showing the whole day"`. Plus full gate. |
| **`PL-3`** | `swarm-5` (`L5`) | `supabase/migrations/20261124120500_mogmine_tag_registries.sql` *(new)*, `lib/tag-registry.ts` *(new)*, `lib/tag-registry-store.ts` *(new)*, `components/TagRegistryEditor.tsx` *(new)*, `components/AppShell.tsx`, `components/TuneScreen.tsx`, `lib/playbooks.ts`, `lib/journal-backup.ts`, `lib/persistence/contract.ts`, `lib/persistence/registry.ts`, `lib/persistence/local-adapter.ts`, `lib/persistence/supabase-adapter.ts`, `lib/persistence/select.ts`, `lib/commands/journal-commands.ts`, `lib/agent/http.ts`, `lib/agent/vocabulary.ts`, `lib/agent/write-checks.ts`, `lib/__tests__/tag-registry.test.ts` *(new)*, `lib/__tests__/agent-http.test.ts`, `lib/__tests__/fake-supabase.ts`, `lib/__tests__/journal-commands.test.ts`, `lib/__tests__/persistence-contract.test.ts`, `lib/__tests__/persistence-local-adapter.test.ts`, `lib/__tests__/persistence-supabase-adapter.test.ts` | **MIGRATION NEEDS APPLYING** (`mogmine_tag_registries` singleton + RLS + grants; worker NEVER applies). `lib/__tests__/tag-registry.test.ts`: `TagRegistry` (`setup`, `execution`, `aliases`, `retired`, `playbook_ids`) seeded from `SETUP_TAGS`/`EXECUTION_TAGS`, synced via `createSingletonSync`, backed up in `JournalBackup`, editable via `TagRegistryEditor` in Tune, and consumed live by `lib/playbooks.ts`, `/api/v1/vocabulary`, and `write-checks.ts` (`SINGLETON_KEYS` includes `"tag_registry"`). Plus full gate. |

- **Codex Wave 7 final integration:** Zero shared files. Merge order: `PL-2b` → `FB-2` → `UX-A` → `IN-3` → `PL-3`. Note `PL-3`'s SQL migration (`20261124120500_mogmine_tag_registries.sql`) for Chris / Supabase MCP `apply_migration`. Complete the authoritative release gate (`npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run check:file-length`, headless `390×844` & `1280px` sweep), fold all 35 handoffs into `NOTES.md`, update `BOARD.md`, and apply the spec write-backs listed in `90-work-packages.md` §6.

## Addendum (2026-11-24 5:40 PM CT): wave 8, `VOL-1` volume

Chris: "we have been ignoring volume everywhere." Added package `VOL-1` (lane L3, `swarm-3`, wave 8, after every package that writes `components/TradeChart.tsx`): a volume histogram pane under the candles styled with the `08-visual-quality.md` tokens (View toggle, default on), plus an audit/fix so real Yahoo bar volume reaches `sessionVwap` and sample bars stop faking `volume: 1` (VWAP withheld instead of equal-weighted). Prompt: [prompts/VOL-1.md](prompts/VOL-1.md). Volume *analysis* (profile studies, relative volume, delta, volume-based setups) belongs to the separate Strategy Lab work (09-strategy-lab.md) and is out of scope here.
