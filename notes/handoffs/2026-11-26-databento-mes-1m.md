# Databento MES 1m archive handoff (#70)

Branch: `feat/databento-mes-1m`. Project: `showmob-dev` (`vsasmtsifuylhfrrsrso`).

## Result

- Extracted 261 DBN day files plus metadata outside Git under `/home/chriswstubbs/data/databento/GLBX-20261126-HUCDKRKL5R/`.
- Converted 297,855 `MES=F` 1m bars (2026-01-25 23:00 UTC through 2026-11-24 23:59 UTC), plus derived 5m/15m/1h Parquet files. DBN headers mapped eight outrights and 22 spreads, so no price heuristic was used.
- Volume-selected roll sessions: 2026-03-16 `MESH6` → `MESM6`; 2026-06-15 `MESM6` → `MESU6`; 2026-09-14 `MESU6` → `MESZ6`.
- Applied migration `20261126073815_mogmine_market_archive.sql`. Uploaded 90,840 1m rows for session dates 2026-08-25..2026-11-24 and 66 coverage rows. Monthly counts: Aug 7,020; Sep 30,120; Oct 30,240; Nov 23,460.
- Yahoo validation: five hourly sessions across Feb–Nov had exact session high/low/close except roll-session lows (Databento was +55.25 and +54.50 points because the volume roll differs). Five recent 1m sessions had 14–34 Databento-only minutes, 123 total. Yahoo had an isolated bad 180.75-point high/open spike on 2026-10-30 19:03 UTC.

## Verification output

- `nice -n 10 python3 -m unittest -v test_trades_to_1m.py`: 3 tests, all OK.
- `nice -n 10 node --test-concurrency=2 --test lib/__tests__/persistence-supabase-adapter.test.ts`: 25 passed, 1 opt-in live test skipped, 0 failed.
- `nice -n 10 npm run typecheck`: `tsc --noEmit`, exit 0.
- Converter checks: 0 prices off the 0.25 grid, 0 duplicate `(symbol,timeframe,ts)` keys, 0 invalid OHLC rows.
- Supabase: 90,840 candle rows and 66 complete coverage rows; forced RLS true on both tables; authenticated has SELECT policies only; anon grants 0. Spot `2026-11-24T15:30Z`: O 7178.75 H 7183.50 L 7173.25 C 7183.00 V 6611, matching local Parquet.
- Conflict-path rerun of that spot row returned one row and left the total at 90,840.
- Security advisor after migration found no new MogMine finding. Existing findings refer to ShowMob objects/auth configuration and were not changed.

## Left

- Wire the app's candle repository/read path to query the server archive before Yahoo/IndexedDB.
- Build the daily overlap continuation and archive job/status reporting.
- Coverage `expected_bars` currently equals observed Databento active-session minutes (65 × 1,380; Sep 7 early close 1,140) until the exchange-calendar slice supplies authoritative expected ranges.
- The local Parquet includes a 60-minute partial 2026-11-25 session caused by the batch cutoff; it was excluded from Supabase.

Per AGENTS.md §6b, no full test suite, lint, or build was run; dependencies were not reinstalled.
