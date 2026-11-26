# TM-0 archive reads

Branch: `feat/tm-0-archive-reads` from `origin/main` (`664cd4f`).

## Built

- Trade charts and Strategy Lab resolve authenticated `MES=F` 1m archive rows first in Supabase mode.
- Archive misses or incomplete trade windows retain the existing device-cache/Yahoo fallback; local mode is unchanged.
- Chart source text distinguishes Databento, Yahoo and mixed Archive data and names crossed contract rolls.
- Browser reads use the anon client session and RLS only; no service-role key is referenced.

## Verification

- `nice -n 10 node --test --test-concurrency=2 --experimental-strip-types lib/__tests__/candle-cache.test.ts lib/__tests__/strategy-lab-bars.test.ts` — 50 passed, 0 failed.
- `nice -n 10 npm run typecheck` — `tsc --noEmit`, exit 0.
- `nice -n 10 npm run check:file-length` — exit 0; 13 existing over-target files reported.
- `git diff --check` — exit 0.

Touched grandfathered files: `components/TradeDetail.tsx` 843 → 844 lines and `lib/trades.ts` 1179 → 1180 lines. Both changes are small contract/label integrations; splitting either large shared file is outside TM-0. `components/StrategyLabWorkspace.tsx` remains 413 lines.

## Owner follow-up

- Merge/apply the archive schema and populated data from `feat/databento-mes-1m`; this branch intentionally does not duplicate those migrations.
- Browser-check an authenticated Supabase deployment, including a trade window crossing a seeded `mogmine_market_rolls` date. No live Supabase credentials were available in this worker.
