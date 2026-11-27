# ROADMAP.md — Feature tracks and the design rules that ride with them

This file keeps two things together so neither gets forgotten:

1. **Rounding out features.** Each feature track lists what's still missing to make it complete and trustworthy.
2. **Nudging design into place.** Each track lists the design rules to apply *the next time someone touches that area*. No separate redesign is needed.

Started 2026-11-26 from [DESIGN-PRINCIPLES-REVIEW.md](DESIGN-PRINCIPLES-REVIEW.md), the two design PDFs, the Blueprint, DECISIONS.md and the code on `main` at `3747928`. Other agents are expected to elaborate it. Read §8 before editing.

## How this file relates to the others

| File | Owns | Does not own |
|---|---|---|
| [MOGMINE-BLUEPRINT.md](MOGMINE-BLUEPRINT.md) | Current state, **priority order**, R definitions | Item-level detail |
| [DECISIONS.md](DECISIONS.md) | Settled owner decisions (`D-`, `OD-`) | Plans |
| **ROADMAP.md (this file)** | Feature tracks, design standards (`DS-`), roadmap items (`RM-`) and their acceptance criteria | Priority order (that's the Blueprint), the worker queue (that's BOARD) |
| [BOARD.md](BOARD.md) | What workers take next. The planner copies `ready` `RM-` items into it. | Long-range plans |
| `docs/01`–`docs/26` | Specs and design detail | Status |

**No `ARCHITECTURE.md` is needed.** Architecture lives in [docs/01-architecture-and-stack.md](docs/01-architecture-and-stack.md), and the Blueprint is the map. A third file would drift from both. Update docs/01 instead (see RM-N6). The Blueprint's document hierarchy (§5) should list this file at the same level as BOARD (see RM-N1).

**Status values** (same as BOARD): `ready` · `claimed` · `review` · `blocked (reason)` · `done` · `parked`.

---

## 1. Design standards: the definition of done for any UI change

Every PR that changes a screen checks the standards that apply to what it touched. If a standard can't be met, the PR says why, and the planner adds an owner decision. Once `docs/27-design-principles.md` exists (RM-N4), these become short pointers into it.

| ID | Standard | Current state |
|---|---|---|
| **DS-01** | **Readable contrast.** Every text token passes WCAG 2.2 AA **and** APCA on all three surfaces (`--bg-obsidian`, `--bg-surface`, `--bg-elevated`): Lc ≥ 75 body text, Lc ≥ 60 labels, hints and axis text, Lc ≥ 45 only for large headings. | **Failing.** Muted, faint, axis and loss text sit at Lc 35–50 (RM-B1). |
| **DS-02** | **Direction never by color alone.** Up/down, win/loss and long/short also carry shape or sign: hollow vs filled candles, ▲▼, `+`/`−`. | Partly met. Signs and arrows exist, candles are color-only (RM-B2). |
| **DS-03** | **Honest numbers.** Tabular figures; true minus `−`; money always has two decimals; R is always signed. **No percentage without its denominator nearby** (`10/12`, not `83%`), and below n = 10 the label says "early". | Formatting met ([lib/format.ts](lib/format.ts)). The denominator rule isn't audited yet. |
| **DS-04** | **Process over outcome.** Gold only for rule-following (UX-66, #80). No confetti, sounds or streaks for dollar wins. Skill challenges stay valid on a correctly executed loss, and a planned no-trade day can count as success. | Met, except the no-trade day (RM-H2) |
| **DS-05** | **Facts, derived values and hypotheticals look different.** Realized, replay and backtest results never share one chart or total. Hindsight is labelled (OD-12, D-010). Strategy Lab results say "hypothetical". | Mostly met. Strategy Lab labelling isn't audited (RM-J6). |
| **DS-06** | **Agent provenance.** Anything an agent wrote is marked where it's read. An agent may *propose* a playbook or risk change, and only the owner makes it current. | **Not met.** Writes are logged under Settings → Agent keys, but nothing shows on the record (RM-K1). |
| **DS-07** | **Shield is display only.** It never changes what the API returns. Share cards open with Shield on (OD-46a). | One leak: `lib/agent/strategy-lab.ts:163` (RM-A8) |
| **DS-08** | **Calm attention.** Work arrives as queues, not interruptions. Today shows at most **three** ranked actions and says "Caught up" when nothing is due. Only data-truth problems interrupt. | Queues exist. The Today ranking doesn't (RM-C1). |
| **DS-09** | **Touch and keyboard.** 44 px minimum targets. List and detail screens get keyboard parity on desktop (J/K, Enter, Esc), with shortcut hints in menus. Never override browser shortcuts. | Met on Trade Detail (UX-69). Other list screens aren't audited. ⌘K and `?` are parked. |
| **DS-10** | **Two disclosure levels at most.** Nothing decision-critical (stop, risk, account, Shield state, sync state) is hidden behind a second level. | Met in spirit (View menu, #82). Not audited screen by screen. |
| **DS-11** | **Every state is named.** Empty, offline, loading, error and "caught up" each have words. Every agent-generated object has a visible state (pending, confirmed, rejected). | Journal screens met. Agent objects don't exist yet. |
| **DS-12** | **Dark theme only for now.** The `#07080c` canvas stays pending an owner decision. Primary text softens to `#e6e8ec` if approved (RM-B1). | Owner decision pending (§5) |

---

## 2. Track A: data truth and the candle archive (first)

This matches Blueprint §3 priorities 2–4. It goes first because lost market history can't be recovered.

**What we know** (from `notes/handoffs/2026-11-26-databento-mes-1m.md` on PR #282; **not verified from this machine**, which has no Supabase access):
- `mogmine_market_candles` on `showmob-dev` holds **90,840 Databento `MES=F` 1-minute bars, Aug 25 – Nov 24 2026**, plus **1,729 Yahoo bars for Nov 25–26** from one manual top-up run.
- **Nothing in the app writes bars into the archive.** `lib/market-data/archive.ts` and `/api/market-data` only read. Yahoo bars fill the chart when the archive is thin, but they aren't saved.
- No scheduled job exists: no Vercel cron, GitHub Action or timer. Yahoo keeps about **30 days** of 1-minute history, so **the first permanent gap starts around Dec 26 2026** unless RM-A2 ships.
- Logged trades keep their own bars in the device cache. Days without trades, which Strategy Lab and levels need, are the ones at risk.
- To check the archive yourself, run this in the Supabase SQL editor: `select min(ts), max(ts), count(*) from mogmine_market_candles where symbol = 'MES=F';`

| ID | Item | Acceptance criteria | Status |
|---|---|---|---|
| **RM-A1** | Merge PR #282 (migrations are already applied on `showmob-dev`, so this records them in the repo). Close PR #71 as superseded. | Migrations `20261126073815_*` and `20261126081228_*` are on `main`. #71 is closed with a link to #282. The Blueprint's #71 rule is updated (RM-N1). | ready (owner) |
| **RM-A2** | **Daily archive top-up, run on the server.** Add one route, e.g. `POST /api/v1/market/top-up`, that **fetches Yahoo itself** and upserts completed sessions. The caller supplies only `symbol` and an optional date range, **never prices**. Vercel Cron calls it daily after the CME close (17:15 ET, with `CRON_SECRET`). An agent with `write` scope can call the same route from its HTTP or MCP tools to backfill on demand. | Idempotent: rerunning adds 0 rows. The Databento-over-Yahoo guard in the DB still holds (Databento rows never overwritten). Writes a coverage row and a job-log row per session. Refuses symbols outside `OD-15`. The route uses the server-side service role and never exposes it. A test covers rerun, partial session and Yahoo failure. | ready |
| **RM-A3** | Optional write-through: when `/api/market-data` falls back to Yahoo for a **completed** session, upsert those bars. | Never writes an in-progress session. Same guard and idempotence as RM-A2. | parked (RM-A2 covers it) |
| **RM-A4** | Show archive status in Tune/Tools: newest bar time, sessions missing, last top-up result. | Follows DS-11. A gap of more than one trading day shows as a warning. | ready |
| **RM-A5** | Backfill Jan 25 – Aug 24 2026 Databento bars. They're already converted, on the machine that ran the conversion. | Coverage rows for every session in that range. Spot checks match the Parquet files. | blocked (owner) |
| **RM-A6** | Session calendar and holidays, so coverage says `closed` instead of `missing` on exchange holidays. | Thanksgiving and other CME holidays show `closed`. | blocked (#65, OD-35) |
| **RM-A7** | Agent write safety: `Idempotency-Key` on creates, an expected version (`expected_updated_at`) on updates, and `request_id` in responses. The audit row gains `request_id`, workflow and house-rules version. | Retrying a create with the same key makes one record. A stale update returns 409. Device sync already uses `expectedUpdatedAt` ([lib/persistence/store-sync.ts](lib/persistence/store-sync.ts)). | ready |
| **RM-A8** | Make Shield display-only in the API: stop passing `prefs.shield` in `lib/agent/strategy-lab.ts:163`. If redacted agent responses are ever wanted, make that an explicit query parameter or scope. | The API response is identical with Shield on or off. A test proves it. | ready (pending DS-07 confirmation) |
| **RM-A9** | Use operation-specific OpenAPI request schemas instead of the generic `additionalProperties: true` body (`lib/agent/openapi.ts:116`). | Each write operation has its own named schema, with required fields machine-readable. | ready |
| **RM-A10** | Before any second user: decide on a dedicated Supabase project and replace the in-process rate limiter with a durable one (Blueprint §7). | An owner decision is recorded. | parked |

---

## 3. Track B: design hygiene pass (one small PR)

Token and markup changes only. No feature changes.

| ID | Item | Acceptance criteria | Status |
|---|---|---|---|
| **RM-B1** | Contrast tokens (DS-01, DS-12). Values are proposed. Confirm them in the official APCA calculator. Change the same hexes in the fallback themes `lib/chart-paint.ts:25` and `DEFAULT_CARD_THEME` in `lib/shareCard.ts`. | See the table below. Add `lib/__tests__/contrast.test.ts`, which computes WCAG and APCA for every text token on all three surfaces and fails under the thresholds. | ready (text-primary waits on owner) |
| **RM-B2** | Hollow up candles, filled down candles (DS-02): `upColor: transparent`, keep the up border and wick. As an option in View, or the default (owner). | Readable in grayscale. Works in both palettes. Share cards follow automatically, since they read the live theme. | ready (default vs option: owner) |
| **RM-B3** | Fix the stale Shield text in `docs/20-price-first-entry.md:18`. The contracts field is now masked but editable, not hidden. | Doc matches `components/AddTradeSheet.tsx:399` | ready |
| **RM-B4** | Strategy Lab results header shows the slippage assumption. Slippage is currently editable only in the recipe JSON. | Every results screen states "slippage: N ticks stop / N ticks market". | ready |

Proposed token values. The worst-case surface is `--bg-elevated`:

| Token | Now | Proposed | Lc now → proposed |
|---|---|---|---|
| `--text-primary` | `#f4f5f7` | `#e6e8ec` (owner) | 100 → 92 |
| `--text-muted` | `#8e95a9` | `#c1c5d0` | 44 → 70 |
| `--text-faint` | `#7b8498` | `#aeb3c0` | 35 → 60 |
| `--chart-axis-text` | `#8b93a7` | `#aeb3c0` | 43 → 60 |
| `--loss-text` | `#ff6f7a` | `#ff949c` (check it still reads as loss) | 49 → 60 |
| blue-orange `--profit-text` | `#7fb2ff` | `#84b5ff` | 59 → 60 |

The greys step evenly (92 / 70 / 60), so muted and faint stay distinguishable.

---

## 4. Feature tracks: round out the feature, nudge the design

Each track has **Round out** items, needed for the feature to be complete, and **Design nudges**, to apply in the next PR that touches the area. Where a step of the Blueprint §6 acceptance scenario depends on a track, it's named, because the scenario is the real proof of completeness (0 of 11 verified as of 2026-11-24).

### Track C: Today, the human checkpoint
*Acceptance scenario steps 2 and 8.*

| ID | Round out | Acceptance criteria | Status |
|---|---|---|---|
| **RM-C1** | "Next" card: at most three ranked actions, ordered **data truth > review due > practice due > research**. Built on signals the app already has: fill matching, the data-quality chip, missing stops, unreviewed real trades, drills due. | Says "Caught up" when nothing is due, with no invented recommendation. Every item links to an existing screen. On mobile only the first is expanded ("2 more"). | ready |
| **RM-C2** | Session-state summary (plan ✓, real vs replay counts, review state, process 6/7) from canonical records only | No front-end recalculation that could disagree with the API | ready |
| **RM-C3** | "Current focus" line. It must point to an owner-confirmed lesson or playbook rule. An agent can't set it silently. | Shows the source and who set it (DS-06) | blocked (RM-K1) |
| **RM-C4** | `GET /api/v1/session?date=&account_id=` read model: plan, trades, replay count, mood, calls, review, data-quality flags. This is Blueprint priority 6, "ask MogMine about Tuesday". | One call answers "what happened on Tuesday". The response matches the screen. | ready |

**Design nudges:** DS-08 (three items, "Caught up"), DS-03 (denominators on Progress stats), DS-10 (account, 1R, Shield and sync visible in the header).

### Track D: Review and the daily loop
*Acceptance scenario step 8.*

| ID | Round out | Acceptance criteria | Status |
|---|---|---|---|
| **RM-D1** | Daily reviews reach the Supabase adapter and the agent API (Blueprint priority 5) | A daily review written on one device shows on another and through `/api/v1` | ready (verify current state first) |
| **RM-D2** | Daily review links to the session's real trades and the pre-session plan | Opening a review shows its plan and trades. Replay is excluded unless asked for. | ready |
| **RM-D3** | Blind review experiment (BET-03, OD-25): stays **off by default** and is tried on trades older than a week. Record the result in DECISIONS.md. | A result is recorded. The default changes only by owner decision. | claimed (owner experiment) |
| **RM-D4** | Review tab count badge: keep the number or switch to a dot | Owner decision recorded | blocked (owner) |

**Design nudges:** DS-05 (hindsight labelled in review), DS-06 (agent-written notes marked), DS-03.

### Track E: Trade detail and chart
*Acceptance scenario steps 4–6.*

| ID | Round out | Acceptance criteria | Status |
|---|---|---|---|
| **RM-E1** | Verify scenario steps 4–6 end to end on a phone: an agent-logged trade, a stop move, the close. | Chart, record, R, P&L and excursions agree on every surface | ready |
| **RM-E2** | Zoom-out floor review: `MIN_BAR_SPACING_PX = 3` stops zoom-out. Decide whether to lower it or auto-step to a higher timeframe. | Owner choice implemented. Pinch on a 390 px phone never crushes candles. | blocked (owner) |
| **RM-E3** | Volume pane (`VOL-1`) check on real futures trades on a phone | The band shows on real MES trades and hides on samples and indices | ready |

**Design nudges:** DS-02 (RM-B2), DS-09 (keyboard parity), DS-01.

### Track F: Feed (journal)

| ID | Round out | Acceptance criteria | Status |
|---|---|---|---|
| **RM-F1** | Keep Feed as browse and search, not analytics. Real / Replay / All exists. | No stats panels added to Feed | standing rule |
| **RM-F2** | Label rename: Feed → Journal and Tune → Tools (routes unchanged) | Owner decision | blocked (owner) |

**Design nudges:** DS-03, DS-09 (J/K in the list), DS-11 (named empty-filter states).

### Track G: Drills and practice

| ID | Round out | Acceptance criteria | Status |
|---|---|---|---|
| **RM-G1** | Drill ground truth comes from playbook or owner labels (exemplar, anti-example, checklist), **never from whether the trade won** | Owner defines the label. Scoring uses it. | blocked (owner) |
| **RM-G2** | False-take and false-pass rates with denominators | Shown on the drill summary following DS-03 | ready after RM-G1 |
| **RM-G3** | Transfer metric: live process adherence after practice vs before, with both sample sizes | No conclusion shown under 20 per side | parked (after RM-G1) |
| **RM-G4** | Replay isolation test: replay activity changes no live or account summary | Test passes | ready |

**Design nudges:** DS-04, DS-05, DS-03. The sealed reveal and 1/3/7-day misses already exist (docs/23 §4). Keep them.

### Track H: Challenges and account guardrails

| ID | Round out | Acceptance criteria | Status |
|---|---|---|---|
| **RM-H1** | Separate account guardrails (daily loss room, trailing floor, evaluation target, taken from the account's real rules) from skill challenges (Clean Run and later process challenges) | They're shown in different places. Guardrails never suggest taking a trade to reach a target. | ready |
| **RM-H2** | A planned no-trade session can advance a skill challenge. Clean Run currently counts only trades (`target_trades`). | Test: a planned no-trade day counts. No challenge rewards more trades or larger size. | ready |

**Design nudges:** DS-04, DS-08.

### Track I: Playbooks
*Acceptance scenario step 10.*

| ID | Round out | Acceptance criteria | Status |
|---|---|---|---|
| **RM-I1** | Playbook version history. Trades carry the playbook version that was active. | Editing a rule creates a version. Old trades keep theirs. | ready |
| **RM-I2** | Rule changes can be *proposed* (by owner or agent) with linked evidence, and accepted or rejected | An agent proposal never becomes current without owner approval (DS-06) | parked (after RM-K1) |

### Track J: Strategy Lab
*Blueprint §3 priority 7 traps.*

| ID | Round out | Acceptance criteria | Status |
|---|---|---|---|
| **RM-J1** | Commission per side in the cost model. Slippage already exists (1 tick per stop and market fill per recipe). | Net R includes commissions. The default is in the result header (RM-B4). | ready (owner sets the default) |
| **RM-J2** | Count conditions and variants searched per run | Shown next to the multiple-comparison caution | ready |
| **RM-J3** | Discovery and validation stages with a frozen recipe version. An inspected holdout is never reused as validation. | A run can be labelled "validation" only with a frozen recipe and unseen dates | ready |
| **RM-J4** | Walk-forward mode: chronological discovery, then validation | Discovery and validation reported separately | parked (after RM-J3) |
| **RM-J5** | Surface the existing same-bar rule in the UI: a bar that hits both stop and target counts as the stop and is labelled `ambiguous-stop` (`lib/strategy-lab/skills/measure.ts:145`) | The rule is stated on the results screen | ready |
| **RM-J6** | Contract and roll provenance per run (the roll ledger exists in PR #282) and a "hypothetical" label on every result | Follows DS-05 | ready after RM-A1 |

### Track K: Agent API and provenance
*Acceptance scenario step 3.*

| ID | Round out | Acceptance criteria | Status |
|---|---|---|---|
| **RM-K1** | Mark agent-written records using the token id the API already has: a small "by agent" marker on notes, tags and fields | Follows DS-06. The marker shows on Trade Detail, Review and Day Review. | ready |
| **RM-K2** | Read models before new objects: `GET /api/v1/session` (RM-C4), then a canonical review queue | The agent needs no client-side sorting to answer "what should I review?" | ready after RM-C4 |
| **RM-K3** | Insight proposals (claim, evidence refs, n, data quality, owner state) | Opened only when the owner opens this feature area (Blueprint: convergence first) | parked |
| **RM-K4** | Capability scopes (`journal:*`, `research:*`, `replay:write`). **Never** an execute, orders or broker scope. | Opened together with RM-K3 | parked |

### Track L: Share cards and Shield
*Acceptance scenario step 9.*

| ID | Round out | Acceptance criteria | Status |
|---|---|---|---|
| **RM-L1** | Verify on a phone that card figures match the journal and that Shield opens on | Scenario step 9 passes | ready |

**Design nudges:** DS-07, DS-02 (cards pick up hollow candles automatically).

### Track M: Accessibility and real-device checks

| ID | Round out | Acceptance criteria | Status |
|---|---|---|---|
| **RM-M1** | Performance budgets on a real phone (#22) | Budgets from docs/08 §2 met | blocked (owner phone) |
| **RM-M2** | Dark-room check of RM-B1 on the owner's phone | Owner sign-off | blocked (RM-B1) |
| **RM-M3** | Journal recovery on a fresh device, including candle evidence (scenario step 11) | Records and candles restored | ready after RM-A1 |

---

## 5. Owner decisions waiting

A reply pasted into the 2026-11-26 session made suggestions on several of these. They're listed as **suggestions**, not decisions, until the owner confirms them and they're recorded in DECISIONS.md.

| Decision | Suggestion on record | Blocks |
|---|---|---|
| Keep the `#07080c` canvas, soften primary text to `#e6e8ec` | Keep the canvas, soften the text | RM-B1, DS-12 |
| Review badge: number or dot | Keep the number | RM-D4 |
| Blind review default (OD-25) | Keep off until BET-03 settles it | RM-D3 |
| Shield display-only in the API | Yes, strictly display-only | RM-A8 |
| Hollow candles as the default or an option | — | RM-B2 |
| Drill ground truth | Playbook or owner labels, never P&L | RM-G1 |
| Strategy Lab default commission per side | — | RM-J1 |
| Backfill Jan–Aug Databento bars | — | RM-A5 |
| Zoom-out floor | — | RM-E2 |
| Feed → Journal, Tune → Tools labels | — | RM-F2 |
| Insights per account or across accounts by default (when opened) | Per account or account mode | RM-K3 |
| Dedicated Supabase project before more users | — | RM-A10 |

---

## 6. Doc upkeep (so docs don't drift from the code)

| ID | Change | Status |
|---|---|---|
| **RM-N1** | Blueprint: replace the PR #71 standing rule with #282 (RM-A1). Add ROADMAP.md to the §5 hierarchy at BOARD's level. | ready (owner edits the Blueprint) |
| **RM-N2** | docs/20 stale Shield line (same as RM-B3) | ready |
| **RM-N3** | docs/06's 5-phase roadmap: mark it superseded by the Blueprint and this file | ready |
| **RM-N4** | Write `docs/27-design-principles.md`: the audit's product loop (plan → record → review → patterns → practice → test → playbook → transfer) plus the `DS-` standards with links to code. Then §1 here shortens to pointers. | ready |
| **RM-N5** | PDFs stay as background reading. Their known errors: the charter skips Microsoft guideline G14 and shifts G15–G18 by one; the audit's `fileciteturn…` citations and `utm_source=chatgpt.com` links don't resolve. Fix them if the PDFs are regenerated. | ready |
| **RM-N6** | Check docs/01 against the code (Supabase, agent API, archive) and update it in place | ready |
| **RM-N7** | BOARD.md: the planner copies `ready` `RM-` items into "Up next" in Blueprint order | ready |

---

## 7. Not now

From Blueprint §3: broker automation (D-009), more card variations, more indicator breadth, more challenge types, a built-in multimodal AI engine, large Strategy Lab skill libraries, more major redesigns. Also, until the owner opens them: insight objects (RM-K3), capability scopes (RM-K4), walk-forward (RM-J4), the ⌘K command palette and `?` shortcut sheet.

**Test for adding anything new:** *What decision will the trader make differently, and how will MogMine know whether that change carried into live trading?* If an item can't answer that, it waits.

---

## 8. Rules for agents editing this file

- **Keep IDs stable.** Add new items at the end of their track (`RM-C5`, …). Never renumber, and never reuse a retired ID. Mark finished items `done (commit)` and leave them in place until the planner archives them.
- **Verify before claiming status.** Check the code and cite a file or commit. If you can't check, write "not verified".
- **Don't reorder priorities.** The Blueprint owns the order. Propose changes there.
- **Every item has acceptance criteria** someone could test.
- **Owner decisions go in DECISIONS.md**, not here. Here, only link to them.
- **Re-read this file right before you save it.** Several agents edit it.
