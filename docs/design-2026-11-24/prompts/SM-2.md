# Package Prompt: `SM-2` — Untimed Stop Moves

- **Agent / Lane:** `swarm-2` (`L2 Trade truth`) · **Wave:** `3` · **Branch:** `swarm/SM-2`
- **Depends on:** `SM-1` (W2), `UX-E` (W2)

## 1. Goal

Eliminate false `stop_traded_through` ("SL touch") flags caused when a trade has `initial_stop_price !== stop_loss_price` and no `stop_moves`: remove `pickStopMoveTime` from `lib/trade-document.ts`, represent an unrecorded stop move as an `"untimed"` `modify` event at the exit instant (`SM-UT-1`, `SM-UT-2`), skip untimed segments in bar-touch checks so only the initial stop is checked during the hold, draw a short dashed step at exit labelled `moved · time?`, and emit a quiet Data notes line (`SM-UT-3`).

## 2. Read First (Required Context)

1. `AGENTS.md` (§6.5 fact vs history vs hindsight, §6.12 file-length rule: **`lib/trade-document.ts` is 1,824 lines — MUST NOT grow net!**)
2. `docs/design-2026-11-24/05-stops-mae-fills.md` (§2.1–§2.2 `SM-UT-1`..`SM-UT-4`, §5 row A)
3. `docs/design-2026-11-24/90-work-packages.md` (`SM-2`)
4. `docs/design-2026-11-24/92-decisions-made-by-swarm.md`

## 3. Writable Files (Strict Scope — Everything Else Read-Only)

- `lib/trade-document.ts` *(**1,824 lines — grandfathered**: MUST NOT grow net; deleting `pickStopMoveTime` frees lines; state before/after line counts)*
- `lib/trade-bar-validation.ts` *(~410 lines)*
- `lib/trade-marks.ts` *(**~515 lines — grandfathered**: state before/after line counts)*
- `components/PositionBoxPrimitive.ts` *(~380 lines — only if `"untimed"` basis needs handling in `draw`)*
- `lib/data-notes.ts` *(~125 lines)*
- `lib/__tests__/untimed-stop-moves.test.ts` *(new)*
- `lib/__tests__/trade-document.test.ts` *(existing)*
- `lib/__tests__/trade-marks.test.ts` *(existing)*
- `lib/__tests__/trade-observer.test.ts` *(existing)*

## 4. Step-by-Step Implementation Plan

1. **Update `lib/trade-document.ts` (`SM-UT-1`, `SM-UT-2` — zero net line growth!):**
   - Add `"untimed"` to `EventBasis` (`export type EventBasis = "broker" | "stated" | "inferred" | "untimed";`).
   - Delete `pickStopMoveTime`.
   - In `fromLegacy`: when `initial_stop_price != null && stop_loss_price != null && stop_loss_price !== initial_stop_price && (!stop_moves || stop_moves.length === 0)`:
     - On a closed trade (`exit_time != null`), emit the stop `modify` event at `t: trade.exit_time` with `basis: "untimed"`. (Never use `initial_stop_set_at` as a move timestamp!)
     - On an open trade (`exit_time == null`), keep the initial stop active and attach an `"untimed"` modify at the latest timestamp / derived `untimed_stop_price` so `stopAtExit` / current working stop knows `stop_loss_price` while `stop_path` keeps `initial_stop_price` across the hold.
   - Ensure `exit_reason` `"stop"` or `"trail"` with `exit_price === stop_loss_price` remains consistent at the exit instant.

2. **Update `lib/trade-bar-validation.ts`:**
   - Skip any `stop_path` segment with `stop.basis === "untimed"` (or zero-duration `[exit, exit]` segment) when checking `stop_traded_through`, so `observeTrade` checks `initial_stop_price` across the hold and never flags early bars against the moved stop.

3. **Update `lib/trade-marks.ts` (and `components/PositionBoxPrimitive.ts` if needed):**
   - Update `combineBasis` in `lib/trade-marks.ts` to handle `"untimed"` (`"untimed"` behaves like `"inferred"` for approximate display).
   - When drawing `derived.stop_path`, if `stop.basis === "untimed"`:
     - Draw a short vertical/stepped **dashed** (`dash: "dashed"`) segment at the exit bar from `previous.price` (`initial_stop_price`) to `stop.price` (`stop_loss_price`).
     - At `detail === "medium" || detail === "high"`, emit a flag/label at the exit bar & `stop.price` with text `"moved · time?"`.

4. **Update `lib/data-notes.ts` (`SM-UT-3`):**
   - Accept optional `untimedStopMovePrice?: number | null` on `DataNoteInput` (or derive from `DerivedTrade` / `stop_path` having a `basis === "untimed"` segment).
   - Emit quiet note (`tone: "quiet"`): `"Your stop moved to 7260.00 at a time you did not record. Add the time to check it against the bars."` with optional metadata `action: { kind: "edit_untimed_stop"; price: 7260 }` so `FB-2` can wire the tap-to-open pre-filled `StopMovesEditor` button!

## 5. Tests to Write (`lib/__tests__/untimed-stop-moves.test.ts`)

1. **Trade A untimed trail (`05` §2.1 & §5 row A):** LONG entry `7137.00` at `07:55 CT`, exit `7260.00` at `08:30 CT`, `initial_stop_price: 7119.50`, `initial_stop_set_at: "2026-11-23T13:55:00Z"`, `stop_loss_price: 7260.00`, `stop_moves: []`, bars between `07:56` and `08:29` trade at `7150`–`7250` (below `7260`, above `7119.50`):
   - `fromLegacy` + `deriveTrade` places the `7260` modify at `08:30 CT` with `basis: "untimed"`.
   - `observeTrade` produces **zero** `stop_traded_through` findings (would have failed before `SM-2`!).
   - If an inside bar at `08:05 CT` drops to `7118.00` (below `7119.50`), `observeTrade` DOES flag `stop_traded_through` at `7119.50`.
   - `buildMarks` at `"medium"` detail emits a dashed step to `7260.00` at the `08:30` exit bar and a mark containing `"moved · time?"`; at `"low"` detail omits `"moved · time?"`.
   - `collectDataNotes` includes `"Your stop moved to 7260.00 at a time you did not record. Add the time to check it against the bars."` with `tone: "quiet"`.
2. **Trade A WITH timed `stop_moves: [{ price: 7260, time: "2026-11-23T14:25:00Z" }]`:** `basis: "stated"`, stepped path moves at `08:25 CT`, checked from `08:25` onward, no `"moved · time?"` label.
3. Update any TD-1 / TD-2 fixture goldens in `trade-document.test.ts` / `trade-marks.test.ts` that previously relied on `pickStopMoveTime`, documenting each in the handoff.

## 6. Verification Commands

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run check:file-length
```

## 7. Claim, Handoff & PR Steps

1. Claim atomically:
   ```bash
   git fetch origin
   git push origin origin/main:refs/heads/claim/SM-2
   ```
2. Write `notes/handoffs/2026-11-24-SM-2.md` reporting exact line counts before/after for `lib/trade-document.ts` (must be `<= 1,824`) and `lib/trade-marks.ts`, golden updates, and real command outputs.
3. Commit, push, and open PR:
   ```bash
   git add -A
   git status   # verify ONLY files in §3 and notes/handoffs/2026-11-24-SM-2.md are staged
   git commit -m "fix(SM-2): model untimed stop moves at exit with dashed step and no false SL touch"
   git push -u origin swarm/SM-2
   gh pr create --base main --title "[SM-2] Untimed stop moves without false SL touches" --body-file notes/handoffs/2026-11-24-SM-2.md
   ```

## 8. What NOT to Do & Out-of-Scope Rule

- Do **NOT** grow `lib/trade-document.ts` net line count above `1,824`.
- Do **NOT** edit `components/DataNotesChip.tsx` or `components/StopMovesEditor.tsx` (`FB-2` wires the UI click in Wave 7).
- **STOP and leave a note** in the handoff if any out-of-scope file seems needed.

HARD RULES:
- Supabase: only `mogmine_`-prefixed objects. If a package truly needs a schema change, write the SQL migration file under `supabase/migrations/` in the PR, but DO NOT apply it yourself: NEVER run `supabase db push`, NEVER run `supabase migration repair`, never use psql against the project. Note "MIGRATION NEEDS APPLYING (apply_migration via Supabase MCP)" at the top of the handoff and PR body; code must degrade gracefully (local mode) until it is applied. Never touch `showmob_` tables, auth site_url or disable_signup settings.
- No data dumps (no exporting tables/journals/backups, no printcode full dumps committed).
- Never print, log, commit or echo secrets (.env*, tokens, keys). Do not cat env files.
- Never modify, delete or re-create Chris's real trade records or accounts (no calls to the live /api/v1 with real tokens, no Supabase writes). Use fixtures and unit tests.
- Stay inside this package's scope and its listed writable files. Out-of-scope need = stop and write it in the handoff.
- Never edit BOARD.md, NOTES.md, DECISIONS.md. Never merge PRs, never push to main, never force-push other branches, never touch other worktrees.

## Addendum (2026-11-24 9:02 PM CT) — Planned boxes always stay drawn

Chris: when the stop is hit, the planned TP box disappears. It must not. Planned TP and planned SL boxes stay drawn for the trade no matter the outcome (SL hit, TP hit, or early/manual exit). If he exits early (before TP or SL), keep the planned boxes and show the actual exit as a distinct marker or line over them. Styling stays with `docs/design-2026-11-24/08-visual-quality.md` (no opacity or anchoring experiments).

Do this in the already-writable files (`lib/trade-marks.ts`, `components/PositionBoxPrimitive.ts`, `lib/__tests__/trade-marks.test.ts`). If the marks already exist but the box is clipped off-screen (autoscale / visible range fitted only to candles or the actual SL), fix the range so planned TP and SL prices stay in view — a small `components/TradeChart.tsx` edit is allowed only for that visible-range fix (≤ 10 net lines; state before/after counts).

Targeted tests only (no full suite):
- `mes-failed-reclaim` (exit = SL, planned TP is 7560.75): `buildMarks` includes a `layer: "plan"` profit zone with `p0`/`p1` covering `planned_target_price`, and the price range used for autoscale includes 7560.75.
- Early/manual exit (exit is neither SL nor TP, e.g. `mes-opening-scalp`): both planned SL and TP zones are still present, plus a distinct actual-exit marker or line (not by deleting the plan).
