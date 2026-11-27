# Today cockpit handoff — 2026-11-27

Package 3 completed in the shared dirty tree. Today now presents the daily attention loop as ranked Next actions, a user-confirmed Current Focus, the canonical session summary, the Daily Review entry point, plans, and the session trade list. Current Focus is deliberately conservative: a non-empty daily-review lesson is only a candidate; it becomes current after the trader taps “Pin as current focus”. The pin is persisted locally under `mogmine-current-focus-v1` and can be explicitly removed.

The session summary remains sample-safe and replay-aware. Process counts come from existing checklist readings, and the data-confidence message remains exception-only through the existing summary flags. Canonical review-queue selection and sample/replay isolation were not changed.

Files in this package:

- `components/TodayScreen.tsx`
- `components/CurrentFocusCard.tsx`
- `components/SessionSummaryCard.tsx`
- `lib/current-focus.ts`

Existing dirty-tree files `components/NextActionsCard.tsx`, `lib/next-actions.ts`, and `lib/session-summary.ts` were preserved and consumed as the package’s existing action/summary contracts.

Verification: `git diff --check --` was run for the package file list and returned no output. No tests, build, lint, typecheck, dependency installation, browsing, or repository reset/checkout/commit was performed.
