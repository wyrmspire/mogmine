# BOARD.md — Work Order and Tactics

> The board says **what to do next and how agents share the work**. The work items themselves live in **GitHub issues** (`gh issue list --repo wyrmspire/mogmine`). Specs live in `docs/`. Decisions live in `DECISIONS.md`. This file only points to them, it never copies them.
>
> **Only the planner edits this file** (the owner, or the agent the owner names as planner). Workers read it and never edit it in a feature PR. That keeps it from becoming a merge-conflict magnet.

---

## 1. Up next (top = highest priority)

Workers take the **first row whose status is `ready`** and whose issue has no assignee and no `claim/` branch.

_Built 2026-11-22 from NOTES.md "Next up", docs/16 §2b and the open GitHub issues, each checked against the code in this folder._

> **⚠ All agents share this one folder.** Whole-file saves from a stale copy have reverted other lanes' work three times on 2026-11-22: `app/globals.css` twice and this board once. **Re-read a file right before you write it, and change only your own lines** (targeted replacement, never "save the whole file as I last saw it"). This applies most to shared files: `BOARD.md`, `app/globals.css`, `lib/store.ts`, `components/TuneScreen.tsx`, `components/AppShell.tsx`.

| # | Issue | Item | Spec | Size | Status |
|---|---|---|---|---|---|
| 1 | #169 | `CD-3c` Playbook card PNG export on the shared frame (Shield hides results; all three sizes tested) | docs/23 §2, §5.4 | S | done (`69ab1f7`) |
| 1b | — | `RV-1` Review queue shows the trade's chart beside the Pit Stop; sealed at entry under blind review | docs/05 §2C, docs/23 §4 | S | done (`69ab1f7`) |
| 2 | — | `UI-3` Mood at Entry: optional one-tap pre-exit mood + retrospective `recorded_at` timestamp integrity | docs/19 §4, `OD-39` (c) | M | done (`1941d79`) |
| 3 | #36 | `G1` "How did it end?" one-tap exit reason in add-trade and editable on the trade page | #36, docs/15 §3 | S | done (`69ab1f7`) |
| 4 | #36 | `G2` "I moved my stop" model (`stop_moves`) + interactive `StopMovesEditor` + `WIDENED` suggestion tag (`UX-33`) | #36, docs/15 §3, `R-10` | M | done (`MM-W2-05`) |
| 5 | #42 | `M1` Time-in-trade label and exit efficiency (`captured 0.8R of 1.4R available`) | #42, docs/15 §3.4 | S | done (`1941d79`) |
| 6 | #42 | `M2` Planned-versus-actual table under the chart (entry, stop, exit: planned, actual, difference in points and R) | #42, docs/13 BET-06 | S | done (`1941d79`) |
| 7 | #42 | `M3` R ruler at each whole R on the plan, and playbook tag on the plan corner and Trade Card | #42 | S | done (`MM-W2-07`) |
| 8 | #40 | `K` Archived neighbours: other trades in view drawn faint, no labels, no axis tags, tap opens them | #40, docs/12 §14 | M | done (`MM-W2-06`) |
| 9 | — | `DC-2` Discretionary calls store + backup (storage only, no UI) | docs/25 §8 | S | done (`69ab1f7`) |
| 10 | #15 | Shield sweep + `UX-e` masked editable Contracts input preserving true P&L math | #15, UX-64 | S | done (`1941d79`) |
| 11 | #21 | Spec write-back: docs/08, docs/05, docs/02 rows listed in #21 against current code | #21 | S | done (`69ab1f7`) |
| 12 | #19 | Accessibility pass on every route: large text, reduced motion, blue/orange palette, focus, labels | #19, docs/08 §16 | M | done (`MM-W2-01`, `MM-W2-02`) |
| 12a | — | `UX-a` Chart labels collide: stacked with `separateLabels` | docs/15 §3.4 | S | done (`69ab1f7`) |
| 12b | — | `UX-b` Trade Detail mobile Pit Stop positioned directly under chart at `390×844` | docs/08 §5 | M | done (`1941d79`) |
| 12c | — | `UX-c` Header meta wraps cleanly at 390 px: unbreakable date and hold duration units | docs/08 §13 | S | done (`1941d79`) |
| 12d | — | `UX-d` Sample trades in Review queue ("10 to mark reviewed" on Today) on a fresh install | docs/08 §4 | S | blocked (owner: confirm samples leave the queue) |
| 13 | #38 | `I` Partials and multiple targets (pure integer-tick model + lot-band geometry, fixture 7 = `+1.75R`) | #38, docs/15 | L | done (pure model `MM-W2-03`) |
| 13b | — | `DP-1` Discretionary prompts engine (`detectDeviations`, `pendingAsks`, seed prompt library) | docs/playbook-design/04 | M | done (`MM-W2-04`) |
| 13c | — | `CD-4` Day Card pure builder + canvas renderer on shared card frame + `M3` Trade Card playbook tag | docs/23 §2, §6, #42 | M | done (`MM-W2-07`) |
| 14 | — | `DC-3`–`DC-7` Call sheet, chart pins, grading, score | docs/25 §8 | M each | blocked (owner: `OD-52`) |
| 15 | — | `OD-55` `5m` fallback for Yahoo `1m` Globex gaps in session levels | docs/24, `OD-55` | S | blocked (owner: `OD-55`) |
| 16 | #65 | Session-aware expected coverage across market closures | #65 | M | blocked (owner: calendar, `OD-35`) |
| 17 | #22 | Performance budgets on a real phone | docs/08 §2 | — | blocked (owner: real phone) |
| — | #41 | `CD-1b` Trade Card sheet controls | docs/23 §3 | — | done (`69ab1f7`) |
| — | #169 | `CD-3b` Playbook card + `/playbooks` binder | docs/23 §5 | — | done (`69ab1f7`) |

**Open on GitHub but already built here (owner: close them):** #10, #11, #12, #13, #14 (fitted chart window, bar floor, timeframe from duration, style labels gone, tests), #18 (backup), #20 (icons and hint; a real iOS check is still owed), #25 (no price ladder), #27 (`MES=F`), #28 (no synthetic candles), #29 (bar validator), #90 (`MD-1`), #91 (D-010 restatement), #165 (`CD-2a`–`CD-2c`). #26 and #114 are umbrellas: what is left of them is rows 15 and 16 above.

Status values: `ready` · `claimed` · `review` · `blocked (reason)` · `done`. The planner moves rows to the archive in §5 once a week.

**Never take:** owner-question issues (#5–#9, #23, #24, #39), #43, #70, #123, PR #71, or anything labelled `owner`.

---

## 1b. Wave `MM-W2` — 8-Lane Deployment (`boardinit` 7 + 1)

> **Baseline:** `main` (post-`MM-W1` unified integration `1941d79` + this `BOARD.md` commit).
> **Wave Target:** ~2,500 total changed lines (~300–450 lines per lane).
> **Worktree Isolation:** Each worker lane runs in its own isolated git worktree (`workspace: "share"` or `..\mogmine-w<N>`) on its own branch (`feat/mm-w2-01`..`feat/mm-w2-07`), with strictly disjoint writable files.
> **Cross-Lane Rule:** Workers NEVER edit `BOARD.md`, `NOTES.md`, `DECISIONS.md`, `components/TradeDetail.tsx`, or `app/globals.css`. Shared UI wiring and the full verification gate run once in Lane 8 (`MM-W2-08`, Master Agent Final Pass).

| Lane | Item | Owner | Branch | Writable Files (strict) | Must Avoid | Target | Status |
|---|---|---|---|---|---|---|---|
| `MM-W2-01` | `#19a` Accessibility pass (`/drills`, `/challenges`, `/playbooks`) | Worker 01 (`worker-1`) | `feat/mm-w2-01` | `app/drills/**`, `app/challenges/**`, `app/playbooks/**`, `components/DrillScreen.tsx`, `components/ChallengeCard.tsx`, `components/ChallengeDetail.tsx`, `components/ChallengeSetupSheet.tsx`, `components/PlaybookBinder.tsx`, `components/PlaybookCard.tsx`, `components/PlaybookCardSheet.tsx`, `components/PlaybookEditor.tsx`, `lib/__tests__/a11y-routes.test.ts` | `TradeDetail.tsx`, `TradeChart.tsx`, `AddTradeSheet.tsx`, `AppShell.tsx`, `app/globals.css`, `BOARD.md`, `NOTES.md` | ~300–450 lines | `done` |
| `MM-W2-02` | `#19b` Accessibility pass (`Today`, `Review`, `Feed`, `Tune`, `Plan`, `AppShell`) | Worker 02 (`worker-2`) | `feat/mm-w2-02` | `components/TodayScreen.tsx`, `components/ReviewScreen.tsx`, `components/FeedScreen.tsx`, `components/TuneScreen.tsx`, `components/PlanCard.tsx`, `components/PlanSheet.tsx`, `components/SessionReview.tsx`, `components/AppShell.tsx`, `lib/__tests__/a11y-core-screens.test.ts` | `TradeDetail.tsx`, `TradeChart.tsx`, `AddTradeSheet.tsx`, `app/globals.css`, `BOARD.md`, `NOTES.md`, Lane 1 files | ~300–450 lines | `done` |
| `MM-W2-03` | `#38` `I` Partials & multiple targets pure model + lot-band geometry | Worker 03 (`worker-3`) | `feat/mm-w2-03` | `lib/partials.ts`, `lib/__tests__/partials.test.ts` | `lib/trades.ts`, `lib/trade-document.ts`, `lib/trade-marks.ts`, `components/**`, `BOARD.md`, `NOTES.md` | ~300–450 lines | `done` |
| `MM-W2-04` | `DP-1` Discretionary prompts engine (`detectDeviations`, `pendingAsks`) | Worker 04 (`worker-4`) | `feat/mm-w2-04` | `lib/discretionary-prompts.ts`, `lib/__tests__/discretionary-prompts.test.ts` | `lib/calls.ts`, `lib/calls-store.ts`, `components/**`, `BOARD.md`, `NOTES.md` | ~300–450 lines | `done` |
| `MM-W2-05` | `#36` `G2-UI` Interactive `"I moved my stop"` editor component | Worker 05 (`worker-5`) | `feat/mm-w2-05` | `components/StopMovesEditor.tsx`, `lib/__tests__/stop-moves-editor.test.ts` | `components/TradeDetail.tsx`, `components/AddTradeSheet.tsx`, `lib/trades.ts`, `app/globals.css`, `BOARD.md`, `NOTES.md` | ~300–400 lines | `done` |
| `MM-W2-06` | `#40` `K-UI` Neighbour-trade hit testing & chart tap interaction | Worker 06 (`worker-6`) | `feat/mm-w2-06` | `components/TradeChart.tsx`, `components/PositionBoxPrimitive.ts`, `lib/__tests__/neighbour-hit-test.test.ts` | `components/TradeDetail.tsx`, `lib/neighbour-trades.ts`, `lib/trade-marks.ts`, `app/globals.css`, `BOARD.md`, `NOTES.md` | ~300–400 lines | `done` |
| `MM-W2-07` | `#42` `M3-Card` Trade Card playbook tag + `CD-4` Day Card builder & canvas renderer | Worker 07 (`worker-7`) | `feat/mm-w2-07` | `lib/shareCard.ts`, `lib/day-card.ts`, `lib/__tests__/day-card.test.ts` | `components/**`, `lib/trade-marks.ts`, `app/globals.css`, `BOARD.md`, `NOTES.md` | ~300–450 lines | `done` |
| `MM-W2-08` | Final Pass: Merge, Wire into `TradeDetail.tsx`, Full Verification Gate & Docs | Master Agent (08) | `main` | Integration targets (`components/TradeDetail.tsx`, `app/globals.css`, `NOTES.md`, `BOARD.md`, `AGENTS.md`) | Starting unapproved feature scope | Integration & gate | `done` |

### Wave `MM-W2` Detailed Lane Specifications

#### `MM-W2-01` · Accessibility Pass: Drills, Challenges, Playbooks (`#19a`)
- **Writable Files:** `app/drills/**`, `app/challenges/**`, `app/playbooks/**`, `components/DrillScreen.tsx`, `components/ChallengeCard.tsx`, `components/ChallengeDetail.tsx`, `components/ChallengeSetupSheet.tsx`, `components/PlaybookBinder.tsx`, `components/PlaybookCard.tsx`, `components/PlaybookCardSheet.tsx`, `components/PlaybookEditor.tsx`, `lib/__tests__/a11y-routes.test.ts`
- **Acceptance Criteria (`docs/08 §16`):**
  - Explicit accessible names (`aria-label`, visible text, or `sr-only`) on all buttons, icon buttons, toggles, and interactive cards.
  - Minimum `44×44px` tap targets on primary and thumb-zone controls.
  - `prefers-reduced-motion` respected on card flips, progress transitions, and sheets.
  - No red/green-only status conveyance (pair with icons/text/shapes for blue/orange color-blind safety).
  - Keyboard focusability and `aria-modal` / `role="dialog"` on modal sheets.

#### `MM-W2-02` · Accessibility Pass: Core Screens & AppShell (`#19b`)
- **Writable Files:** `components/TodayScreen.tsx`, `components/ReviewScreen.tsx`, `components/FeedScreen.tsx`, `components/TuneScreen.tsx`, `components/PlanCard.tsx`, `components/PlanSheet.tsx`, `components/SessionReview.tsx`, `components/AppShell.tsx`, `lib/__tests__/a11y-core-screens.test.ts`
- **Acceptance Criteria (`docs/08 §16`):**
  - Semantic landmarks (`<main>`, `<nav aria-label="...">`), `aria-current="page"` on active bottom-dock tab.
  - Accessible labels and `aria-valuetext` on Tune sliders (Gold Intensity, Box Opacity) and `role="switch"` / `aria-checked` on toggles (Shield, Color-blind mode).
  - `role="dialog"` + `aria-modal="true"` + Escape key handler on `PlanSheet` and `SessionReview`.
  - Minimum `44×44px` tap targets on all bottom-dock links, review actions, and plan buttons.

#### `MM-W2-03` · Partials & Multiple Targets Pure Model (`#38`, `I`)
- **Writable Files:** `lib/partials.ts`, `lib/__tests__/partials.test.ts`
- **Acceptance Criteria (`docs/15`, Guardrail 4):**
  - Pure types & functions for multi-lot partial exits (`PartialExit`, `PartialTarget`, `PartialLotBand`, `PartialSummary`).
  - Integer-tick P&L calculation across multiple exit legs (never floating-point price math), using contract point values (`MES` = `$5/pt`, `MNQ` = `$2/pt`, `ES` = `$50/pt`, `NQ` = `$20/pt`).
  - Per-lot R contribution and total weighted R (verify Fixture 7 case: 2 lots, T1 at `+1.0R`, T2 at `+2.5R` -> `+1.75R`).
  - Generate `PartialLotBand[]` geometry (entry time -> each lot's exit time, price range, lot count, ticks, R) ready for `PositionBoxPrimitive` / `buildMarks` wiring in Lane 8.
  - Guard `R === null` when initial stop is absent; handle open remaining lots cleanly.

#### `MM-W2-04` · Discretionary Prompts Engine (`DP-1`)
- **Writable Files:** `lib/discretionary-prompts.ts`, `lib/__tests__/discretionary-prompts.test.ts`
- **Acceptance Criteria (`docs/playbook-design/04-discretionary-prompts-integration.md`):**
  - Define `ReasonChip`, `DeviationKind`, `PromptTrigger`, `ReviewPrompt`, `PromptLibraryV1`, `PendingAsk`.
  - Seed default library (`seedPromptLibrary(userId)`) with stable `seed:*` IDs for all 7 `CallKind`s and shared reasons, always setting `user_id` (Invariant 7).
  - Implement `detectDeviations(trade: TradeRecord): DeviationKind[]` reading `exit_price`, `planned_target_price`, `initial_stop_price`, `stop_loss_price`, `stop_moves`, and `hasWidenedStop`.
  - Implement `pendingAsks(trade, library, existingCalls): PendingAsk[]` returning ordered, unanswered prompts whose trigger matches detected deviations or `always`, excluding retired prompts and already-answered kinds.

#### `MM-W2-05` · Interactive `"I Moved My Stop"` Editor (`#36`, `G2-UI`)
- **Writable Files:** `components/StopMovesEditor.tsx`, `lib/__tests__/stop-moves-editor.test.ts`
- **Acceptance Criteria (`#36`, `docs/15 §3`, `docs/20`, `UX-33`):**
  - Self-contained React component `<StopMovesEditor trade={trade} onChange={onChange} />` styled cleanly for `390×844` mobile and desktop (using existing CSS variables `--gold-mid`, `--surface`, `--text-muted`, etc., no hardcoded gold hex).
  - Allows adding a stop move with tick-stepper price adjustment (`0.25` tick size for MES/ES/MNQ/NQ via `CONTRACT_SPECS`) and timestamp picker/input, plus removing existing rows.
  - Computes and displays per-row delta vs prior stop (tightened / breakeven / widened) using `tabular-nums`.
  - When any move widens risk, displays a non-destructive suggestion badge (`Moved Stop (widened)` — suggests, never auto-applies per `UX-33`).

#### `MM-W2-06` · Neighbour-Trade Hit Testing & Chart Tap Interaction (`#40`, `K-UI`)
- **Writable Files:** `components/TradeChart.tsx`, `components/PositionBoxPrimitive.ts`, `lib/__tests__/neighbour-hit-test.test.ts`
- **Acceptance Criteria (`#40`, `D-010`, `docs/12 §14`):**
  - Add pure hit-testing helper (e.g. `hitTestArchivedMark(x, y, boxes)`) that checks pointer coordinates against rendered `layer === "archived"` box rects and returns the matching `tradeId` (if any).
  - Expose `onSelectNeighbour?: (tradeId: string) => void` prop on `TradeChart.tsx` and wire chart click/tap events to call it when an archived neighbour box is tapped.
  - Keep archived boxes faint (`<= 0.1` alpha, dotted outline, zero text labels or axis tags per `D-010`) and ensure normal chart pan, crosshair scrub, and pinch-zoom remain unaffected.

#### `MM-W2-07` · Trade Card Playbook Tag & Day Card Builder (`#42` `M3-Card` + `CD-4`)
- **Writable Files:** `lib/shareCard.ts`, `lib/day-card.ts`, `lib/__tests__/day-card.test.ts`
- **Acceptance Criteria (`docs/23 §2, §6`, `#42`, Invariant 5):**
  - In `lib/shareCard.ts`: render the trade's Playbook name/tag cleanly in the Trade Card header/context band across all 3 sizes (`4:5`, `9:16`, `1:1`), respecting Shield mode and `getTheme()` tokens.
  - In `lib/day-card.ts`: implement pure `buildDayCardData(sessionDate, trades, shield)` and canvas renderer `renderDayCardCanvas(ctx, data, theme, size)` using the shared `CARD_LAYOUT_TABLE` frame (`DAY` type label, session date, trade count `n = X`, net R, process adherence %, Shield hides all `$` amounts and contract sizes, specular 1px gold top edge).
  - Unit tests in `lib/__tests__/day-card.test.ts` verifying all 3 sizes, Shield privacy, and zero-trade / no-stop edge cases.

#### `MM-W2-08` · Final Pass: Merge, Integration & Full Release Gate
- **Owner:** Master Agent (Lane 8) | **Status:** `ready (after 01–07)`
- **Protocol:**
  1. Read all 7 worker handoffs in `notes/handoffs/` and inspect each worker's diff.
  2. Merge `feat/mm-w2-01` through `feat/mm-w2-07` into `main` in dependency order.
  3. Wire `<StopMovesEditor />` (Lane 5) and `onSelectNeighbour` navigation (Lane 6) into `components/TradeDetail.tsx`.
  4. Run the authoritative verification gate: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`.
  5. Fold handoffs into `NOTES.md`, update `BOARD.md`, clean up worktrees, and publish the final pass report.

---

## 2. Lanes

| Lane | Job | Takes new items? | Merges? |
|---|---|---|---|
| **Planner** | Keeps §1 ordered and sliced into items of about 400 lines or fewer, writes acceptance tests into the issue, takes hard fixes and architecture | Only hard fixes | Yes |
| **Workers** | Take the top `ready` item, build it, open a PR | Yes, one at a time | Only after 30 min of no review with green CI |
| **Reviewer** | Reviews PRs oldest first, pushes small fixes, merges, closes duplicates, rolls handoffs into NOTES.md | No | Yes |
| **Owner (Chris)** | Product calls, real-phone checks, anything in DECISIONS.md marked owner | — | — |

---

## 3. Claim and lock rules

A claim is only real if it is **atomic**. An issue comment is a note, not a lock.

**Local folder with no git (the current setup):** the board is the lock. Re-read BOARD.md, then in one edit change the row's Status from `ready` to `claimed (<lane>)`. Re-read straight after: if another lane's name is there, it won the race; pick the next row. Edit only your own row, and edit files by targeted replacement, never by saving a whole stale copy, since several agents share this folder. Steps 1–5 below apply once there is a git checkout.

1. **Check:** the issue has no assignee, there is no `claim/<issue>` branch on origin, and there is no open PR that references the issue.
2. **Lock:** push an empty claim branch using the **canonical issue ref** (`claim/<issue>`). Git refuses a second push of the exact same ref, guaranteeing mutual exclusion even if two lanes try to claim simultaneously.
   ```bash
   git fetch origin
   git push origin origin/main:refs/heads/claim/<issue>   # fails atomically if someone already pushed the claim
   gh issue edit <issue> --add-assignee @me
   gh issue comment <issue> --body "Locked by <lane> via canonical claim/<issue>"
   ```
   *Note:* Never use lane-suffixed branch names like `claim/<issue>-<lane>`, which can coexist on origin and cause split-brain claims.
3. **If the push fails, someone else has it.** Pick the next `ready` row. Do not start "just in case".
4. **Work on a topic branch** (`feat/<id>-<slug>`). Keep the claim branch until the PR merges or you hand off.
5. **Release:** after merge, or when handing off, delete the claim branch (`git push origin --delete claim/<issue>`) and remove yourself as assignee.
6. **Stale lock:** a claim with no pushed commits for 2 hours may be broken by the planner or reviewer. They comment on the issue and delete the claim branch.

---

## 4. Handoffs

- Write each handoff in a **new file**: `notes/handoffs/<YYYY-MM-DD>-<issue>-<lane>.md`, or in the PR body. Never append to a shared file in a feature PR.
- A handoff covers: issue, branch, what is done, what is not, the commands run with their real output, and the next step with a failing test if there is one.
- The **reviewer** folds merged handoffs into the "Current state" section of NOTES.md, which stays under about 60 lines.
- **Hand off rather than push through** when the item turns out bigger than one slice, it needs an owner decision, or it touches another lane's open branch. Release the lock, write the handoff, and mark the row `blocked (reason)` in your report so the planner updates §1.

---

## 5. Tactics (the scope guard)

1. **One slice per PR,** about 400 changed lines or fewer (CONTRIBUTING.md §3).
2. **Rebase on origin/main before opening a PR.** A PR that has conflicted for 2 hours goes back to `ready` with a note.
3. **No abstraction until the third repetition.**
4. **Fixtures and local state first**, unless docs/22 says the task needs Supabase.
5. **A defect fix ships with its regression test.**
6. **Duplicates lose.** If an item already merged, close the later PR and fold anything useful into a follow-up issue.
7. **Stay in your own folder.** Never delete, reset, or edit another lane's worktree or branch. The reviewer may push fixes to a PR branch it is reviewing.
8. **Before you merge, answer in the PR:** What became more true? What became more fragile? Is this product behaviour or scaffold? What did you not verify?
9. **Only the owner verifies on a real phone,** with real broker data, or by taste. Never claim those checks are done.

---

## 6. Archive

_Done rows move here weekly. Keep only the issue number, item, and merge PR._
