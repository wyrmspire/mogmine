# Handoff — #36 G1 "How did it end?" One-Tap Exit Reason — lane `antigravity`

- **Item:** `#36` `G1` "How did it end?" one-tap exit reason (`Target` · `Stop` · `Trailed` · `Breakeven` · `Market`) in add-trade, close-trade, and editable on the trade detail page (specs: `#36`, `docs/15 §3`).
- **Branch:** `feat/36-g1-exit-reason`.
- **Commit:** `699c537`.
- **Status:** Done, tested, and verified. Ready for review.

## Done

1. **Trade Core & Types (`lib/trades.ts`):**
   - Added canonical `TradeExitReason = "target" | "stop" | "trail" | "breakeven" | "manual"`.
   - Exported `EXIT_REASONS` with labels (`Target`, `Stop`, `Trailed`, `Breakeven`, `Market`) and flags (`TP`, `SL`, `TRAIL`, `BE`, `MKT`).
   - Exported `isExitReason(value)` validator.
   - Added optional `exit_reason?: TradeExitReason | null` to `TradeRecord`.
   - Enforced in `normalizeTrade` that open trades always have `exit_reason: null`, while closed trades preserve valid exit reasons.
   - Updated `closeTradePatch(trade, exitTime, exitPrice, exitReason?)` to include `exit_reason` when supplied while preserving backwards compatibility when omitted.

2. **Trade Document & Ingestion Adapter (`lib/trade-document.ts`):**
   - Expanded `ExitReason` to `"target" | "stop" | "trail" | "breakeven" | "manual" | "unknown"`.
   - Updated `fromLegacy` so that `record.exit_reason` produces an exit fill with `reason = record.exit_reason` and `reason_basis = "stated"`.
   - Updated `deriveTrade` to recognize `breakeven` in `is_scratch` and outcome mapping (`scratch`).
   - Updated `validateTradeEvent` fill reason validator to support `"breakeven"`.

3. **Chart Marks & Display List (`lib/trade-marks.ts`):**
   - Updated `exitText` map to include `breakeven: "BE"`.
   - Verified painter order and exit flag generation (`TP`, `SL`, `TRAIL`, `BE`, `MKT`).

4. **Entry Form Draft (`lib/entry-form.ts`):**
   - Added `exitReason?: TradeExitReason | null` to `EntryDraft`.
   - Updated `freshEntryDraft` (`exitReason: null`) and `upgradeDraft` (preserves valid `exitReason`).

5. **Add Trade Sheet (`components/AddTradeSheet.tsx`):**
   - Added a one-tap "How did it end? (optional)" chips row (`.exit-reason-section`) for closed trade drafts (`!isOpenDraft`).
   - Wired selection (`aria-pressed`, toggleable).
   - Passed `exit_reason: !isOpenDraft ? (draft.exitReason ?? null) : null` into `normalizeTrade` on submit.

6. **Close Trade Sheet (`components/CloseTradeSheet.tsx`):**
   - Added optional `exitReason` state and one-tap chips row (`.exit-reason-section`).
   - Passed `exitReason` into `closeTradePatch` on submit.

7. **Trade Detail Screen (`components/TradeDetail.tsx`):**
   - Added an editable `.exit-reason-detail-row` inside `trade-levels-card` for closed trades.
   - Tapping any chip updates `exit_reason` immediately via `updateTrade` with a toast and `Undo` support.
   - Tapping the active chip clears the exit reason with `Undo` support.

8. **CSS Design System & Restraint (`app/globals.css`):**
   - Added `.exit-reason-section`, `.exit-reason-title`, `.exit-reason-detail-row`, `.exit-reason-label`.
   - Neutral ink tokens: no hardcoded gold hexes, no profit/loss colors on process chips.
   - Guaranteed `≥ 44px` tap targets and zero horizontal overflow on `390×844` viewport.

9. **Comprehensive Tests (`lib/__tests__/exit-reason.test.ts`):**
   - Verified `EXIT_REASONS` canonical items, labels, flags, and `isExitReason`.
   - Verified `normalizeTrade` preserves valid reasons on closed trades and forces `null` on open trades.
   - Verified `closeTradePatch` sets `exit_reason`.
   - Verified `fromLegacy` and `deriveTrade` assign `stated` basis and map to outcomes (`target`, `stop`, `trail`, `scratch`, `manual`).
   - Verified `buildMarks` displays corresponding exit flag text (`TP`, `SL`, `TRAIL`, `BE`, `MKT`).
   - Verified `freshEntryDraft` and `upgradeDraft` roundtrip `exitReason`.

## Commands Run & Real Output

1. **Targeted Unit Tests:**
   ```powershell
   node --test lib/__tests__/exit-reason.test.ts
   ```
   Output: `tests 6 · suites 0 · pass 6 · fail 0 · duration_ms 144`

2. **Full Test Suite:**
   ```powershell
   npm test
   ```
   Output: `tests 523 · suites 2 · pass 523 · fail 0 · duration_ms 1819`

3. **Typecheck:**
   ```powershell
   npm run typecheck
   ```
   Output: `tsc --noEmit` exited 0.

4. **Lint:**
   ```powershell
   npm run lint
   ```
   Output: `0 errors`, 1 pre-existing warning (`postcss.config.mjs`).

5. **Production Build:**
   ```powershell
   npx next build --webpack
   ```
   Output: `Compiled successfully in 1742ms`, `Generating static pages (10/10) in 874ms`, exited 0.

## Next Steps

1. Reviewer folds this handoff and merges `feat/36-g1-exit-reason`.
2. Row 3 on `BOARD.md` moves to review.
3. Next ready items on `BOARD.md` include row 4 (`G2` stop moves) and row 5 (`M1` exit efficiency).
