# Handoff — UI-3 Mood at Entry — lane `antigravity`

- **Item:** `UI-3` Mood at Entry (docs/19 §4, `OD-39` (c)).
- **Branch:** `feat/ui-3-mood-at-entry`.
- **Status:** Done, tested, and verified. Ready for review.

## Done

1. **Pure Mood Model & Constants (`lib/mood.ts`):**
   - Added `ONE_TAP_MOOD_SCORE = 0.8` (matches `MOOD_TAG_SEEDS` and `SPOKE_CUES` high-level feeling score).
   - Added `spokeChipLabel(spoke)` for clean single-word chip titles (e.g., `"Calm"` instead of `"Calm / patience"`).
   - Added `userMoodRecord(meta, registry, scores)` to create versioned user mood records containing multiple scores (clamped and sanitized) with explicit `captured_at` timestamps.
   - Refactored `userScoreRecord` to delegate to `userMoodRecord`.
   - Verified that scores stamped with `captured_at` equal to trade `entry_time` cleanly resolve to `phase: "pre_exit"` both on closed trades (`entry_time < exit_time`) and open trades (`exit_time == null`).

2. **Device Mood Store (`lib/mood-store.ts`):**
   - Added `recordUserMood(tradeId, scores, now, capturedAt)` for recording one-tap entry or pre-exit mood states.
   - Added `capturedAt` parameter to `setSpokeScore`.

3. **Entry Draft (`lib/entry-form.ts`):**
   - Added optional `entryMoodSpoke?: string | null` to `EntryDraft`.
   - Updated `freshEntryDraft` (default `null`) and `upgradeDraft` (preserves draft mood selection across sheet closes).

4. **Add Trade Sheet (`components/AddTradeSheet.tsx`):**
   - Added a one-tap feeling row under R:R / price preview (`.mood-entry-section`) with `≥ 44px` chip targets.
   - Wired chip selection (`aria-pressed`, toggleable).
   - On submission, if a feeling was selected, records the mood with `captured_at: entry.toISOString()`, ensuring it persists as a verified pre-exit score.

5. **Open Trade Detail (`components/TradeDetail.tsx`):**
   - Added an active pre-exit mood capture section (`.open-mood-section`) for open trades (`open &&`), situated above "Close trade".
   - Displays the one-tap feeling chips and a 40px live `MoodShape` thumbnail.
   - Selecting a chip records the mood in real-time, displays a toast with `Undo` support, and updates the `MoodShape` thumbnail immediately.
   - Tapping the active chip clears the feeling with `Undo` support.

6. **Design System & Restraint (`app/globals.css`):**
   - Added `.mood-entry-section`, `.mood-entry-title`, `.open-mood-section`, `.open-mood-head`, and `.open-mood-sub`.
   - Follows Obsidian dark palette and neutral ink tokens (`var(--text-primary)`, `var(--bg-elevated)`, `var(--on-bright)`). No gold and no profit/loss colors.
   - Guaranteed `≥ 44px` tap targets and zero horizontal overflow on `390×844` viewport.

7. **Unit Tests (`lib/__tests__/mood.test.ts`, `lib/__tests__/price-first-entry.test.ts`):**
   - Verified `userMoodRecord` score clamping, null sanitization, and timestamp stamping.
   - Verified that entry mood with `captured_at = entry_time` is recognized as `pre_exit` on both closed and open trades.
   - Verified that `ONE_TAP_MOOD_SCORE` produces a dominant spoke and is reflected in `moodVector` and `describeMood`.
   - Verified `spokeChipLabel` chip label formatting.
   - Verified `entryMoodSpoke` in `freshEntryDraft` and `upgradeDraft`.

## Commands Run & Real Output

1. **Targeted Unit Tests:**
   ```powershell
   node --test lib/__tests__/mood.test.ts lib/__tests__/price-first-entry.test.ts
   ```
   Output: `tests 34 · pass 34 · fail 0 · duration_ms 186`

2. **Full Test Suite:**
   ```powershell
   npm test
   ```
   Output: `tests 514 · suites 2 · pass 514 · fail 0 · duration_ms 1537`

3. **Typecheck:**
   ```powershell
   npm run typecheck
   ```
   Output: `tsc --noEmit` exited 0.

4. **Lint:**
   ```powershell
   npm run lint
   ```
   Output: 0 errors, 1 pre-existing warning (`postcss.config.mjs`).

5. **Production Build:**
   ```powershell
   npm run build
   ```
   Output: Next.js 16.4.6 compiled successfully in 987ms; all 10/10 static pages generated without error.

## Next Steps

1. Reviewer folds this handoff and merges `feat/ui-3-mood-at-entry`.
2. Next row on `BOARD.md` is row 3 (`#36` `G1` "How did it end?" one-tap exit reason in add-trade and editable on the trade page).
