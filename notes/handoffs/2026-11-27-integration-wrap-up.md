# 2026-11-27 integration wrap-up (next wave)

This note supersedes the five `2026-11-27-next-wave-*.md` handoffs where they disagree: they were written before integration, and their "no tests run" statements no longer apply.

## Verified
- `npm run typecheck`: pass.
- `npm test`: 1860 tests, 1859 pass, 0 fail, 1 skipped.
- `npm run lint`: 0 errors, 8 warnings.
- `npm run build`: pass.
- Not done: no browser or phone check, no screenshots, no database changes.

## Fixed in the final pass
- 9 type errors, 11 failing tests, 4 lint errors.
- Idempotency: a claim left in flight for over 15 minutes is reconciled (replays the saved record, or runs the create again).
- OpenAPI and the agent workflow now describe `Idempotency-Key` and `If-Match`. Both stay optional on the server.
- "Same as last" records the current playbook version, matching the rules it copies.
- A trader edit removes agent attribution only from the note fields it changed.
- Session summary shows "Not assessed" instead of 0/7; unchecked bars or archive status read as unverified.
- Today reads the daily review for the active account (a whole-day review also covers it).
- The legacy device-only Current Focus no longer appears under other account scopes.
- HR-13 moved after HR-12 (spec updated). `docs/16` and RM-A8: Shield does not change agent API results.

## Before merging
- Apply `supabase/migrations/20261127010500_mogmine_agent_write_safety.sql` to the intended database. Without it, agent audit rows with the new columns are not saved, and creates that send `Idempotency-Key` return 503.

## Open
- Strategy Lab runs discovery only. Held-out validation needs a session-split and frozen-recipe UI (research holdout package).
- Follow-up: the agent key page now states that Shield does not apply to the API, and the Today day-review button uses the active account (a whole-day review also covers it).
- Visual redesign checks and the remaining roadmap packages in `ROADMAP.md`; Board and Roadmap statuses are not reconciled against these results.

## Files over the 450-line target (§6.12), grown by this wave
`app/globals.css` 1373 → 1384, `lib/trades.ts` 1189 → 1205, `components/TradeChart.tsx` 774 → 784, `components/TradeDetail.tsx` 674 → 679, `lib/shareCard.ts` 659 → 660, `components/StrategyLabWorkspace.tsx` 442 → 453, `lib/commands/journal-commands.ts` 449 → 453. Not split: small wiring changes during integration. The last two crossed the target and are the first candidates to split.
