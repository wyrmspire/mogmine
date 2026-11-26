# Strategy Lab: local historical scans and saved hits

Planning handoff for Chris, 2026-11-26. This is a future slice, not a change to the current release order or authorization to connect the market archive to the app. The blueprint's archive gate still applies.

## What already exists

- The Databento `GLBX.MDP3` MES trades batch is on the VM outside Git. `scripts/databento/trades_to_1m.py` has already produced 297,855 continuous `MES=F` one-minute bars (about ten months), plus derived 5m/15m/1h Parquet. See `notes/handoffs/2026-11-26-databento-mes-1m.md` on `feat/databento-mes-1m`.
- The live `showmob-dev` database was checked on 2026-11-26: `mogmine_market_candles` contains 90,840 `MES=F` 1m bars from 2026-08-24 22:00 UTC to 2026-11-24 21:59 UTC; `mogmine_market_coverage` contains 66 rows. The older local bars have not been uploaded.
- Strategy Lab has a pure skill registry, recipe validator, bar scanner, bracket simulator, and current-run Matches UI. Runs currently live in browser memory. Its remote loader reads `mogmine_bars_1m`, which is empty; it does not read `mogmine_market_candles` yet.
- Existing skills cover time windows, RTH/Globex VWAP relation, and distance above prior-day low (`levelMap` on `pdl`). There is no explicit engulfing-candle skill. Define whether “previous low” means the prior day or prior candle before building that recipe.

## Proposed shape

1. **Scan on the VM.** Feed the existing validated Parquet 1m series into the same `runRecipe` engine used by Strategy Lab. Keep skills pure and versioned. Do not build a second rule engine or ask Vercel to process the ten-month raw batch. A CLI/job can run one user-selected recipe over a date range and record coverage, skipped sessions, runtime, and code/data version.
2. **Save the run and hits.** Persist the exact recipe version, instrument/continuous-contract roll policy, data source and range, scan timestamp, account R basis, bracket settings, exclusions, summary, and compact hit rows. Keep these as simulated market matches, separate from real trades. Re-running the same recipe against revised data must produce a distinguishable run.
3. **Show a Scans view in Strategy Lab.** List saved runs first, then their dated hits. A hit opens the existing chart at its trigger bar with condition values, VWAP/levels, simulated entry/stop/target and exit. Offer a small candle window around older hits from a private read endpoint or an explicitly published snapshot; a result row without its historical bars cannot render an honest chart on Vercel. Keep the full raw dataset on the VM unless broader upload is separately chosen.
4. **Add only missing atomic skills.** Start with a tick-aware bullish/bearish engulfing definition over completed consecutive 1m candles, with gap and session-boundary rules. Compose it with existing `vwapRelation`, ET window, and `levelMap(pdl)` conditions. If “previous low” means the preceding candle's low, add that as a separate versioned output. Test known-at behavior: a trigger evaluated at bar close cannot use later prices.
5. **Review hits as ideas.** Show the chart and simulated OCO bracket for each hit, with the data source, contract, and coverage visible. The 1m simulator treats a bar that touches both stop and target as ambiguous-stop. Raw trade data may help inspect which price printed first; neither bars nor prints prove the trader's order would have filled. Keep actual execution, simulated outcomes, and market observations labelled separately.

## First useful vertical slice

Run one editable MES recipe locally over the complete Parquet history: **at a chosen ET time, close below RTH VWAP, bullish engulfing 1m candle, close above prior-day low**. Save one run and its hits. Open three hits from dates older than the web archive on the Vercel chart with the correct candle window and bracket marks. Compare results from the local runner and the web result view for the same recipe and bars. Report excluded sessions and same-minute ambiguous exits; show sample size before any performance claim.

No additional GLBX conversion is needed for this slice. The work to pick up is the local Parquet adapter, saved-run path, historical hit candle access, and the engulfing skill. Check the blueprint and current archive status before implementing; this note is a design handoff, not a request to merge PR #71 or switch chart sources.
