# Package Prompt: `FB-2` — "Use 14:13" Action and Pre-Filled Stop-Move Editor from Data Notes

- **Agent / Lane:** `swarm-2` (`L2 Trade truth`) · **Wave:** `7` · **Branch:** `swarm/FB-2`
- **Depends on:** `FB-1` (W1), `SM-2` (W3)

## 1. Goal

Turn the passive `fill_time_shifted` (`FB-1`) and untimed-stop (`SM-2`) Data notes into one-tap fixes (`05-stops-mae-fills.md` §2.2 `SM-UT-3`, §4.3): add `"Use HH:MM"` action buttons on `DataNotesChip.tsx` that write the matched UTC bar time to `entry_time` or `exit_time` with an `Undo` toast (changing nothing without a tap), and add an `"Add time"` action on untimed-stop notes that opens `StopMovesEditor.tsx` pre-filled with the moved stop price (`StopMovesEditor.tsx` net lines MUST NOT grow above its grandfathered count!).

## 2. Read First (Required Context)

1. `AGENTS.md` (§6.5 stored trader history only changes on explicit tap + Undo, §4 `390×844` & `>= 44px` tap targets, §6.12 **`components/StopMovesEditor.tsx` is 841 lines — MUST NOT grow net!**)
2. `docs/design-2026-11-24/05-stops-mae-fills.md` (§2.2 `SM-UT-3`, §4.3 Data notes `"Use 14:13"`)
3. `docs/design-2026-11-24/90-work-packages.md` (`FB-2`)

## 3. Writable Files (Strict Scope — Everything Else Read-Only)

- `lib/fill-match.ts` *(existing from `FB-1` — add pure `applyMatchedFillPatch` + `undoMatchedFillPatch` helpers)*
- `components/DataNotesChip.tsx` *(existing)*
- `components/StopMovesEditor.tsx` *(existing, **841 lines — grandfathered**: MUST NOT grow net; tighten/trim redundant lines if adding `prefillPrice` prop, and report before/after line counts!)*
- `lib/__tests__/data-notes-actions.test.ts` *(new)*

*(Note: Check how `TradeDetail.tsx` renders `<DataNotesChip notes={dataNotes} />` and `<StopMovesEditor />`! Since `TradeDetail.tsx` is read-only in Wave 7 for L2 (`IN-3` owns `TradeDetail.tsx` in Wave 7), wire the `"Use HH:MM"` action directly inside `DataNotesChip.tsx` via `updateTrade` + `showToast` when `tradeId` is carried on `DataNote` or read from route/store, AND use a clean lightweight pub/sub event in `lib/fill-match.ts` or `StopMovesEditor` — e.g. `requestPrefillStopMove(tradeId, price)` — so tapping `"Add time"` in `DataNotesChip` opens and pre-fills `StopMovesEditor` on the same page with **zero** edits to `TradeDetail.tsx`!)*

## 4. Step-by-Step Implementation Plan

1. **Add pure patch & prefill helpers in `lib/fill-match.ts`:**
   ```ts
   export function buildMatchedFillPatch(
     trade: Pick<TradeRecord, "id" | "entry_time" | "exit_time" | "status">,
     role: "entry" | "exit",
     matchedBarTimeMs: number,
   ): {
     patch: Partial<Pick<TradeRecord, "entry_time" | "exit_time" | "trade_style">>;
     undoPatch: Partial<Pick<TradeRecord, "entry_time" | "exit_time" | "trade_style">>;
   } | null;

   export function requestStopMovePrefill(tradeId: string, price: number): void;
   export function subscribeStopMovePrefill(listener: (req: { tradeId: string; price: number }) => void): () => void;
   ```
   - `buildMatchedFillPatch`: converts `matchedBarTimeMs` to UTC ISO (`new Date(matchedBarTimeMs).toISOString()`), verifies ordering (`entry < exit` when closed — returning `null` if invalid), recomputes `trade_style: classifyTrade(...)`, and returns both `patch` and `undoPatch` (exact original ISO timestamp + original `trade_style`).

2. **Update `components/DataNotesChip.tsx`:**
   - When an expanded note carries `action.kind === "use_matched_fill"` (or matches `fill_time_shifted` note id): render `<button type="button" className="tool-button num" style={{ minHeight: 44 }}>Use {action.label}</button>`.
   - On click: lookup trade from `useJournal()`, compute `buildMatchedFillPatch`, call `updateTrade(trade.id, patch)`, and call `showToast(\`${role === "entry" ? "Entry" : "Exit"} time updated to \${action.label}\`, { label: "Undo", run: () => updateTrade(trade.id, undoPatch) })`.
   - When an expanded note carries `action.kind === "edit_untimed_stop"`: render `<button type="button" className="tool-button" style={{ minHeight: 44 }}>Add time</button>` calling `requestStopMovePrefill(tradeId, action.price)` (and scrolling `StopMovesEditor` into view smoothly respecting `prefers-reduced-motion`).

3. **Update `components/StopMovesEditor.tsx` (net lines `<= 841`!):**
   - Accept optional `prefillMove?: { price: number; time?: string } | null` prop AND subscribe to `subscribeStopMovePrefill` for `trade.id` so when triggered, the editor expands, pre-fills the new-move price input with `price.toFixed(decimals)` (and midpoint/entry time ready to adjust), and focuses the time input — without saving anything until the trader submits!

## 5. Tests to Write (`lib/__tests__/data-notes-actions.test.ts`)

1. **Trade C `"Use 14:13"` round-trip:** trade logged with `entry_time: "2026-11-23T20:14:00.000Z"` (`14:14 CT`), `matchedBarTimeMs = Date.parse("2026-11-23T20:13:00.000Z")`:
   - Before tap: `trade.entry_time` is `"2026-11-23T20:14:00.000Z"`.
   - `buildMatchedFillPatch` produces `patch.entry_time === "2026-11-23T20:13:00.000Z"` and `undoPatch.entry_time === "2026-11-23T20:14:00.000Z"`.
   - Applying `patch` then `undoPatch` restores the exact original record.
2. Ordering guard: rejects a matched entry patch that would sit `>= exit_time`.
3. `requestStopMovePrefill` / `subscribeStopMovePrefill` delivers `{ tradeId, price: 7260 }` cleanly and unsubscribes without leaks, making zero writes to the trade store until user submission.

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
   git push origin origin/main:refs/heads/claim/FB-2
   ```
2. Write `notes/handoffs/2026-11-24-FB-2.md` reporting exact before/after line counts for `components/StopMovesEditor.tsx` (must be `<= 841`!) and real command outputs.
3. Commit, push, and open PR:
   ```bash
   git add lib/fill-match.ts components/DataNotesChip.tsx components/StopMovesEditor.tsx lib/__tests__/data-notes-actions.test.ts notes/handoffs/2026-11-24-FB-2.md
   git commit -m "feat(FB-2): Use HH:MM fill-time action with Undo and pre-filled StopMovesEditor"
   git push -u origin swarm/FB-2
   gh pr create --base main --title "[FB-2] Use matched fill time and pre-filled stop-move editor" --body-file notes/handoffs/2026-11-24-FB-2.md
   ```

## 8. What NOT to Do & Out-of-Scope Rule

- Do **NOT** edit `components/TradeDetail.tsx` (`IN-3` owns it in Wave 7).
- Do **NOT** grow `components/StopMovesEditor.tsx` above 841 lines.
- **STOP and leave a note** in the handoff if any out-of-scope file seems needed.

HARD RULES:
- Supabase: only `mogmine_`-prefixed objects. If a package truly needs a schema change, write the SQL migration file under `supabase/migrations/` in the PR, but DO NOT apply it yourself: NEVER run `supabase db push`, NEVER run `supabase migration repair`, never use psql against the project. Note "MIGRATION NEEDS APPLYING (apply_migration via Supabase MCP)" at the top of the handoff and PR body; code must degrade gracefully (local mode) until it is applied. Never touch `showmob_` tables, auth site_url or disable_signup settings.
- No data dumps (no exporting tables/journals/backups, no printcode full dumps committed).
- Never print, log, commit or echo secrets (.env*, tokens, keys). Do not cat env files.
- Never modify, delete or re-create Chris's real trade records or accounts (no calls to the live /api/v1 with real tokens, no Supabase writes). Use fixtures and unit tests.
- Stay inside this package's scope and its listed writable files. Out-of-scope need = stop and write it in the handoff.
- Never edit BOARD.md, NOTES.md, DECISIONS.md. Never merge PRs, never push to main, never force-push other branches, never touch other worktrees.
