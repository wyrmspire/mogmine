# AGENTS.md — AI Coding Agent & Subagent Guide for MogMine

> **Read this file FIRST before planning, scaffolding, or editing any code in this repository.**  
> This guide protects smaller/faster models and specialized subagents from common charting, market-data, futures-math, and architecture pitfalls.
>
> **Then read [BOARD.md](BOARD.md)** for what to do next and how agents share work, and **[NOTES.md](NOTES.md)** for the current state and the last handoff, and check [DECISIONS.md](DECISIONS.md) before choosing a name or re-opening a settled choice. Workflow for people and agents is in [CONTRIBUTING.md](CONTRIBUTING.md). Before treating Supabase as a blocker, read [22 — Development Mode and Backend Boundary](docs/22-development-mode-and-backend-boundary.md).

---

## 1. Quick Project Context

**MogMine** is a **mobile-first AI Trade Review & Performance Platform** built for futures day traders (starting with **`MES`** on **TopstepX**).
- **Frontend / API Hosting:** Next.js (App Router, TypeScript, Tailwind CSS, PWA) on **Vercel**.
- **Database / Realtime / Storage:** **Supabase** (PostgreSQL + Realtime push to mobile + Storage for chart snapshots & Trade Cards). Starts **single-user**, structured for multi-user expansion.
- **Broker Listener:** Standalone Node.js/TypeScript service on **Google Cloud Run** listening to the **TopstepX (ProjectX Gateway)** SignalR/WebSocket feed.
- **Market Data (Initial):** **Yahoo Finance** (`MES=F`, `MNQ=F`, `ES=F`, `NQ=F`, `^VIX`, `DX-Y.NYB`) via `MarketDataProvider` adapter, permanently cached in Postgres.
- **Charts:** TradingView **`lightweight-charts` v4+** with custom HTML5 Canvas **`ISeriesPrimitive`** plugins for translucent Position Boxes and synced Companion Divergence charts.

> **Current mode (owner decision `D-009`, 2026-11-14): there is no TopstepX account yet.** Build and test against Yahoo data only. Trades come from manual entry, the test-trade tool and fixtures. Do not build the broker listener, the pull sync or the CSV importer yet. The first task is the daily candle archive. See [10 — Yahoo-First Build Plan](docs/10-yahoo-first-build-plan.md).

---

## 2. Fast Documentation Routing Table

Do not guess requirements or invent schemas. Read the matching spec doc before implementing a task:

| If You Are Working On... | Read First |
| :--- | :--- |
| Stack decisions, Adapter interfaces (`MarketDataProvider`, `TradeIngestionAdapter`, `ReviewContextPlugin`), or Cloud Run ↔ Vercel boundaries | [01 — Architecture & Stack](docs/01-architecture-and-stack.md) |
| Candlestick charts, translucent Position Boxes, Scalp/90m/Investment logic, Yahoo ticker mapping, `NQ=F` companion divergence, or Session Levels | [02 — Charting, Position Boxes & Divergence](docs/02-charting-position-boxes-and-divergence.md) |
| One-Click Quality Trade Cards, PNG export, Simple `<10s` tagging + Voice Memo, or Advanced Note-Taking | [03 — Trade Cards & Note-Taking](docs/03-trade-cards-and-note-taking.md) |
| AI Trade Review prompts, 6-input context pipeline, Vision AI snapshot evaluation, or `AITradeReviewOutput` Zod schema | [04 — Multimodal AI Review Engine](docs/04-ai-review-engine.md) |
| Mobile layout (`390x844`), bottom dock, Obsidian palette, Gold Gradient presets, or Position Box Opacity slider | [05 — Mobile UX & Gold Design System](docs/05-mobile-ux-and-gold-design-system.md) |
| Supabase Postgres tables, columns, enums, ER relationships, or build phase scope | [06 — Data Model & Roadmap](docs/06-data-model-and-roadmap.md) |
| Copy-paste code recipes ("Wrong vs. Right"), futures point-value math, chart sync loop guards, and subagent task slicing | [07 — Agent Guardrails & Smart Notes](docs/07-agent-guardrails-and-smart-notes.md) |
| Any screen: loading/empty/error states, gesture conflicts, notes that must never be lost, notifications, accessibility, number and time formatting | [08 — UX Notes: Viewing Trades & Journaling](docs/08-ux-notes-viewing-and-journaling.md) |
| Ingestion, the listener, candles and enrichment, session and money math, Supabase security, API routes, or the AI pipeline | [09 — Backend Risk Register](docs/09-backend-risk-register.md) |
| What to build first, the candle archive, Yahoo's measured limits and response quirks, or getting trades without a broker account | [10 — Yahoo-First Build Plan](docs/10-yahoo-first-build-plan.md) |
| Daily planning, unassigned capture, detail/full-chart controls, anchored comments, indicator definitions, or custom GPT/API context | [11 — Mobile Workflows, Chart Context & Assistant API](docs/11-product-workflows-and-api-context.md) (proposals `OD-17`–`OD-19`) |
| Daily levels and zones, ADR, pivots, level colours and labels, risk-sized box defaults, planned/actual/archived box styles, missed moves | [12 — Levels, Zones & the Daily Markup](docs/12-levels-zones-and-daily-markup.md) (proposals `OD-20`–`OD-23`) |
| Interface ideas beyond the current notes: Zone Ladder, day-as-unit feed, blind review, draw-the-trade entry, desk mode, execution diff | [13 — Bold UI Bets](docs/13-bold-ui-bets.md) (bets, not scope) |
| The UI branch: what phases 1–3 built, what is proposed next, what waits for the owner | [14 — UI & Experience: Phased Plan](docs/14-ui-phased-plan.md) |
| **What to build next, in order**: pinch zoom, fresh-candle retry, open trades, the archive, trades in Supabase, the assistant endpoint, playbooks, stats, challenges | [16 — Floor Roadmap](docs/16-floor-roadmap.md) (`R-01`–`R-10`) |
| Challenges: Drawdown Defender, Clean Run, the evaluator contract, golden test cases, the Today card and detail screen | [17 — Challenges](docs/17-challenges.md) (`R-09`, `OD-37`) |
| Mood Shape: emotion spokes, score records, suggestions from notes, adding a spoke and re-scoring, mood against outcome | [18 — Mood Shape](docs/18-mood-shape.md) (`OD-39`) |
| The owner's trade screen mockups (phone and desktop), and how they map to the roadmap | [19 — Design Guide](docs/19-design-guide.md) (`OD-40`) |
| The add-trade form (prices first, tick steppers, date and time pickers), stop at entry (`R-10`), dragging the price axis to stretch it | [20 — Price-First Entry & Price-Axis Stretch](docs/20-price-first-entry.md) (`OD-41`) |
| Accounts, running totals, loss limits, balance checks | [21 — Accounts and Running Totals](docs/21-accounts-and-running-totals.md) (`OD-42`) |
| Whether the current task needs Supabase, using fixtures/local state, or sharing one Supabase project with ShowMob | [22 — Development Mode and Backend Boundary](docs/22-development-mode-and-backend-boundary.md) |
| Trade document (`mogmine.trade.v1`), plan/actual/excursion box layers, stop paths, hindsight, the deriver and display list (`buildMarks`) | [15 — Trade Document & Render Grammar](docs/15-trade-document-and-render-grammar.md) (open decisions `OD-30`–`OD-34`) |
| Card family: Trade Card refresh, drill / flash cards, playbook, day, plan and mistake cards, card sizes and the shared frame | [23 — Card System](docs/23-card-system.md) (`CD-1`–`CD-3`, `OD-46`) |
| Planning sessions ("pre-anything"), levels and indicators on the chart, after-session review, the `D-011` build slices | [24 — Planning Sessions & After-Session Review](docs/24-planning-sessions-and-after-session-review.md) (`D-011`, `OD-51`) |
| Discretionary calls: skip a setup, flip the signal, cut, early take, stop placement, hold, size; reason chips, call colours, hindsight grades | [25 — Discretionary Calls](docs/25-discretionary-calls.md) (proposal `OD-52`) |
| Storage-portable persistence contract, repository interfaces, `mogmine_` tables, RLS owner rules, persist-or-defer per record type | [26 — Persistence Contract & DB Readiness](docs/26-persistence-contract-and-db-readiness.md) (#173, `D-012`) |
| A naming conflict between specs, or a choice that looks undecided | [DECISIONS.md](DECISIONS.md) |
| Branching, lanes, handoffs, fixtures, environments | [CONTRIBUTING.md](CONTRIBUTING.md) |

### When specs disagree

`mogprompt.md` and `docs/` use different names for many of the same things. Until `OD-1` in [DECISIONS.md](DECISIONS.md) is closed:

1. These invariants and guardrails win over everything.
2. Then `DECISIONS.md`, then `docs/`, then `mogprompt.md`.
3. **Never invent a third name or behaviour.** If the conflict is not in the drift register, add it and stop.

---

## 3. Seven Non-Negotiable Architectural Invariants ("DO NOT BREAK")

1. **NEVER Overlay HTML `<div>`s for Chart Position Boxes**
   - Do **not** draw profit/stop boxes using CSS-positioned `<div>` elements over the chart container—they lag, drift on mobile pinch-zoom, and are excluded from `chart.takeScreenshot()`.
   - **MUST** implement `PositionBoxPrimitive` using `lightweight-charts` v4+ `ISeriesPrimitive` Canvas 2D API (`timeToCoordinate` / `priceToCoordinate`).

2. **NEVER Fetch Yahoo Finance `1m` Candles Only On-the-Fly**
   - Yahoo Finance deletes or stops serving `1m` intraday bars older than **7–30 days** (`5m` after ~60 days).
   - **MUST** persist OHLCV candle windows (`1m`, `5m`, `15m`) into Supabase `trade_candles` when a trade is logged, and always read from `trade_candles` first.

3. **ALWAYS Map Micro Futures Tickers Properly (`OD-15`)**
   - Yahoo Finance does **not** return reliable data for bare symbols `"MES"` or `"MNQ"`, and micro contracts must be charted on their own continuous tickers without falling back to the minis.
   - **MUST** map `MES` → `MES=F`, `ES` → `ES=F`, `MNQ` → `MNQ=F`, `NQ` → `NQ=F`, `MYM`/`YM` → `YM=F`, `M2K`/`RTY` → `RTY=F` for candles (with **no** `ES=F`/`NQ=F` fallback for `MES`/`MNQ`), compute and draw levels from the same instrument as the chart, and keep the contract's true point-value multiplier (`MES` = `$5/pt`, `ES` = `$50/pt`, `MNQ` = `$2/pt`) in trade PnL math.

4. **NEVER Put Persistent WebSockets or SignalR Listeners in Vercel**
   - Vercel serverless/edge functions are stateless and time out.
   - **MUST** keep all persistent TopstepX SignalR/WebSocket connections strictly inside the **Google Cloud Run** listener service. Vercel handles UI rendering, stateless API routes, manual/CSV imports, and AI reviews.

5. **NEVER Hardcode Gold Hex Colors or Position Box Alpha**
   - Users can switch gold presets (`bullion`, `champagne`, `amber`, `platinum`) and drag **Gold Intensity** and **Position Box Opacity** sliders live.
   - **MUST** reference `--gold-gradient`, `--gold-mid`, `--gold-intensity`, and `--position-box-opacity` CSS variables (and read them dynamically in Canvas primitives).

6. **NEVER Bypass the Adapter Interfaces**
   - UI components and AI review code must **never** import `yahoo-finance2` or raw TopstepX types directly.
   - **MUST** route calls through `MarketDataProvider`, `TradeIngestionAdapter`, and `ReviewContextPlugin` so future swaps (e.g., Databento, TopstepX native bars, new context feeds) require zero UI rewrites.

7. **ALWAYS Include `user_id` on Core Database Queries & Inserts**
   - Even during single-user Phases 1–4, **MUST** populate `user_id` (using a `DEFAULT_OWNER_USER_ID` constant/env var) on `accounts`, `trades`, `playbooks`, and `user_preferences` so turning on Supabase Auth + RLS later requires zero schema migrations.

---

## 3b. Additional Guardrails (2026-11-14 review)

Binding alongside the seven invariants. Each links to its evidence in [docs/09](docs/09-backend-risk-register.md) or [docs/08](docs/08-ux-notes-viewing-and-journaling.md). The first is a hard safety rule. The rest stay in force unless the owner rejects the linked decision.

1. **Server code is READ-ONLY against the broker.** Topstep allows a server to watch and record and forbids it to trade. No file may reference an order place, modify or cancel endpoint. A violation can cost the trader's funded account. (B-01)
2. **No table without RLS, no public bucket.** The anon key ships to every browser. The service-role key never leaves server code. (B-40)
3. **Save every fill before deriving a trade.** Fills go to the ledger on arrival. Trades are rebuilt from the ledger by one pure function. Every write is idempotent. (B-04, B-05, B-08)
4. **Compute money from fills, in integer ticks.** Never from average prices, never in floating-point prices. `R` is `null` without a stop, never `0`. (B-30 – B-32)
5. **Session math uses `America/New_York`, never a fixed offset.** Store UTC. Shift times only inside the chart layer. (B-20, B-22)
6. **Snap fill times to bar times before `timeToCoordinate()`.** It returns `null` for a time that is not a bar, and the box disappears. (B-23)
7. **Write chart code against `lightweight-charts` v5.** The recipes already use v5 type names. Call `takeScreenshot(true)` so primitives are included. Do not call `getComputedStyle()` per frame. (B-61, UX-27, docs/08 §2)
8. **Never fetch candles once at close and stop.** Post-exit bars do not exist yet. Archive every session daily and record coverage. Measured Yahoo limits: `1m` goes back 30 days at 8 days per request, `5m`/`15m` 60 days, `1h` 730 days. (B-10, B-11, docs/10 §2–3)
   - **Clean every Yahoo response before saving it:** drop rows with null prices and rows outside the requested window. An empty `200` for a weekend is normal, not missing data.
9. **List queries never select `bars`.** (B-42)
10. **Files go straight to Storage.** Never through a Vercel route. Store bucket paths, not URLs. (B-46, B-50)
11. **The model never outputs a number the code can compute**, and AI suggestions never overwrite what the user entered. (B-62, UX-33)
12. **Build every state, not only the happy path.** See the state matrix in docs/08 §4.

---

## 4. Mobile-First Verification Checklist

Before marking any UI or chart task complete, verify against a mobile viewport (**`390×844`**, iPhone 14/15/16 class):
- [ ] **Zero horizontal page overflow** (`scrollWidth <= clientWidth`). Touch panning inside the chart must not scroll the outer page horizontally.
- [ ] **Thumb-zone primary controls:** Main nav, Simple Mode tags, Voice Memo, and the **Trade Card** button sit comfortably in the lower half of the screen with `>= 44px` tap targets.
- [ ] **Dark Obsidian contrast:** Candlesticks, key level labels, and translucent Position Boxes stay legible over `#07080C` / `#0D0F17` surfaces across `0.15` to `0.65` box opacity.
- [ ] **Visual Tuning sliders verified:** Changing `--gold-intensity` and `--position-box-opacity` updates cards and chart Canvas boxes smoothly without losing zoom state.
- [ ] **Tabular monospace financials:** All prices, PnL, ticks, R-multiples, and timestamps enforce `tabular-nums` monospace typography (`font-variant-numeric: tabular-nums`) so digits never jitter while scrubbing charts.
- [ ] **Specular `1px` gold lighting restraint:** Standard cards use subtle `1px` top-edge gold highlight fading into dark carbon hairlines—never heavy full-perimeter yellow borders.

More UI checks (states, gestures, offline notes, colour-blind safety, wide screens) are in [docs/08 §16](docs/08-ux-notes-viewing-and-journaling.md#16-acceptance-checklist-adds-to-agentsmd-4).

---

## 5. Before You Finish a Session

1. Report the exact files changed and the commands run with their real output. A claim without output counts as not verified.
2. Write your handoff in a new file under `notes/handoffs/` (or the PR body) and release or keep your lock, per §6 and [BOARD.md](BOARD.md) §3–4. Do not append to NOTES.md in a feature PR; the reviewer folds handoffs in.
3. If you met a spec conflict or made a choice the specs do not cover, record it in [DECISIONS.md](DECISIONS.md) as an open item. Agents propose. The project owner decides.
4. If behaviour now differs from a spec, update the spec in the same change.

**One agent guide.** This file is the only agent instruction file. A tool-specific file (`CLAUDE.md`, `GEMINI.md`, `.cursorrules`, Copilot instructions) must be a one-line pointer here, never a copy.

## 6. Working Alongside Other Agents

Several agents may work on this repo at once. [BOARD.md](BOARD.md) is the work order and holds the full rules. For multi-lane sprint planning (`board init <N> lanes`) and dispatching copyable agent prompts with a final integration pass, see [boardinit.md](boardinit.md).

**"Look at the board and go"** means: read BOARD.md, take the top `ready` row in §1 that nobody holds, lock it (§3), build it as one slice, open a PR, and hand off (§4). If §1 has no `ready` row, pick the next unclaimed item from NOTES.md "Next up" or docs/16 §2b the same way, and say so in your report. The contract rules:

1. **Work items are GitHub issues.** Workers never edit `BOARD.md`, `NOTES.md`, or `DECISIONS.md` directly. Only the planner or final integrator edits them.
2. **Isolate parallel waves with Git worktrees.** Never run 7 concurrent sessions in one shared working directory; use `git worktree add` off one reviewed baseline commit (`MM-W1` baseline commit `699c537`), or assign strictly disjoint writable files per lane.
3. **Bounded file ownership.** Every parallel assignment lists exact writable files/modules. Unlisted production files are read-only unless the planner reallocates ownership. Never modify another lane's claimed file "to help".
4. **Freeze cross-agent interfaces first.** Pure selectors/models (e.g. plan-vs-actual, neighbour projection) export agreed types/functions without editing shared UI shells (`TradeDetail.tsx`, `TradeChart.tsx`, `app/globals.css`) in parallel.
5. **Distinguish fact vs. history vs. hindsight.** Keep **observed market facts**, **user-reported history** (preserving true `recorded_at` separately from retrospective entry/exit times), and **computed hindsight** distinct. Retrospective feelings/moods must record true `recorded_at` wall-clock time distinct from the trade's historical timestamp `captured_at` or `entry_time`.
6. **Canonical atomic locks.** Use one canonical claim key per issue (`refs/heads/claim/<issue>`), never lane-specific branch names that can coexist, or central planner assignment before launch.
7. **Stay in your lane & never reset others' work.** Never delete, reset, or overwrite another agent's worktree, folder, or branch. An agent must never rewrite unrelated changes or resolve a collision by resetting someone else's work.
8. **Tests belong to the implementation.** Tests change with the behavior and must be co-delivered with the feature/bugfix.
9. **Hand off with proof.** Write handoffs in new files under `notes/handoffs/` (never append to `NOTES.md` in a worker lane). Completion requires real test/typecheck/lint/build output, not a claim.
10. **Target slice size:** Keep individual diffs reviewable (~300–450 lines target). If a complete fix is 170 lines, do not pad it; the boundary applies to the whole diff including tests.
11. **Duplicates lose & release on finish.** Close duplicate PRs, delete claim branches, and unassign on merge.

## 7. Repo Dumps for Chat (printcode / gitrdif)

When the owner asks for a dump or a diff dump, run from the repo root (Windows: `.\printcode.cmd` / `.\gitrdif.cmd`; bash: `./printcode.sh` / `./gitrdif.sh`):

- **Full dump:** `printcode` writes `dump00.md`... with the whole repo and records the baseline commit in `.last-dump-commit`. `--help` lists options (`--area app|components|lib|docs|notes|tests|config`, `--ext`, `--list`, `--head`/`--tail`).
- **Diff dump:** `gitrdif` writes `gitrdif00.md`... with commits, patch and uncommitted changes since the last full dump.
- Outputs are git-ignored. Never commit them. Tell the owner which files were written.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
