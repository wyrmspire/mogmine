# Package Prompt: `VOL-1` — Volume pane on the trade chart + VWAP on real bar volume

- **Agent / Lane:** `swarm-3` (`L3 Chart look`) · **Wave:** `8` (runs after every other package that writes `components/TradeChart.tsx`) · **Branch:** `swarm/VOL-1`
- **Depends on:** `UX-E` (chart tokens from `08-visual-quality.md`), `IN-2` (Globex VWAP gap policy), `IN-3` (200 EMA) — all merged before this wave.
- **Owner request (Chris, 2026-11-24 5:40 PM CT):** "we've been ignoring volume everywhere." Show volume on the trade chart and make sure VWAP uses real bar volume.
- **Out of scope (owned by the separate Strategy Lab executor):** volume ANALYSIS skills — volume profile studies, relative volume, delta/footprint, volume-based setup detection or scoring. Do NOT build any of that. This package is display + data correctness only.

## 1. Goal

Add a modern volume histogram pane under the candles on the trade chart (TradeDetail / `components/TradeChart.tsx`), styled with the `08-visual-quality.md` tokens, and audit/fix the candle data path so real Yahoo bar volume reaches `lib/session-indicators.ts` (`sessionVwap`) everywhere. Where volume is not real (sample/fixture bars that carry no volume), the chart must not pretend: hide the volume pane and withhold VWAP instead of equal-weighting bars.

## 2. Read first

1. `AGENTS.md` (canvas/primitives invariants, §4 mobile checklist, §6.10 slice size, §6.12 450-line rule: `components/TradeChart.tsx` is ~578 lines and grandfathered — put new code in NEW files and add at most ~15 net lines to TradeChart; state before/after line counts in the PR body).
2. `docs/design-2026-11-24/08-visual-quality.md` (tokens: candle up/down colors, grid, background, z-order, fonts) and `03-indicators-and-levels.md` (VWAP, coverage, "withheld when incomplete").
3. `docs/design-2026-11-24/92-decisions-made-by-swarm.md` (D-F Globex VWAP, D-G 200 EMA) and `91-swarm-plan.md`.
4. Code: `lib/market-data/yahoo.ts` (volume parsed at ~line 78: `quote.volume?.[index] ?? 0`), `lib/candles.ts` (`asCandles` sets `volume: 1` for sample bars — ~line 91), `lib/session-indicators.ts` (`sessionVwap`, `volumeUsable` ~line 155), `lib/chart-indicators.ts`, `components/useTradeLevels.ts`, `components/TradeChart.tsx`, every place candles are cached/stored and re-read (search: `trade_candles`, IndexedDB/candle cache, persistence adapters, `/api/market-data`, `/api/v1/candles` if present).

## 3. Writable files (everything else read-only)

- NEW `lib/volume.ts` — pure helpers: `hasRealVolume(bars)`, `volumeHistogramData(bars, theme)` (time, value, color by up/down bar), `volumeScaleMargins(heightPx)`.
- NEW `components/VolumePane.ts` (or `useVolumeSeries.ts`) — adds/removes a lightweight-charts `HistogramSeries` on its own price scale (`priceScaleId: "volume"`), bottom ~18–22% of the pane on desktop, ~16% at 390 px, no axis labels/price line, follows the main time scale (no separate pan/zoom).
- `components/TradeChart.tsx` — wiring only (≤ 15 net lines): create/update/destroy the volume series with the candles; respect the View menu toggle.
- `components/TradeDetail.tsx` — View menu: one "Volume" toggle row, default ON (≤ 8 net lines).
- `lib/prefs-sanitize.ts` / the existing prefs type — persist `showVolume: boolean` (default `true`).
- `lib/theme.ts` + `app/globals.css` — add tokens only if 08 does not already define them: `--chart-volume-up` = candle-up color at alpha ~0.35, `--chart-volume-down` = candle-down color at alpha ~0.35 (derive from 08's `#22B88F` / `#EC5664` and their blue/orange-palette equivalents; Shield mode unaffected: volume is not money).
- `lib/candles.ts` — sample/fixture bars: carry volume if the fixture row has a 6th column, otherwise mark it unavailable (e.g. `volume: 0` + a `volumeReal: false`/`hasRealVolume` signal) — never `1`.
- Data path files ONLY if the audit finds volume dropped or zeroed between Yahoo and the chart (state each one in the handoff, minimal edits).
- `lib/session-indicators.ts` — only if needed so VWAP is withheld (not equal-weighted) when bars have no real volume; keep the gap policy from IN-2 unchanged.
- NEW tests: `lib/__tests__/volume.test.ts`, and add cases to the existing session-indicators test file.
- `notes/handoffs/2026-11-24-VOL-1.md` (+ `notes/handoffs/2026-11-24-VOL-1-*.png` screenshots).

## 4. Steps

1. Audit: trace one Yahoo 1m bar from `lib/market-data/yahoo.ts` through every cache/store/adapter to the `Candle[]` the chart and `sessionVwap` receive. Write the path (file:line per hop) at the top of the handoff and note any hop that drops or rewrites `volume`. Fix those hops.
2. Fixture/sample bars: stop inventing `volume: 1`. If `fixtures/sample-bars.json` rows have volume, use it; otherwise mark volume unavailable so VWAP and the volume pane are withheld for those trades (the View row should say "Volume unavailable for sample bars").
3. Build `lib/volume.ts` + `components/VolumePane.ts`; wire into TradeChart; add the View toggle (default ON, persisted).
4. Styling (from 08): bars colored by candle direction at ~0.35 alpha, no borders, 1 px gap between bars where the bar spacing allows, no labels/price line, drawn BEHIND candles and position zones, grid lines not doubled in the volume area. Must look calm on the dark background at 390×844 and 1280 px.
5. Export: Trade Card / PNG export keeps working; include volume in the export only if it fits cleanly, otherwise exclude it and say so in the handoff.

## 5. Tests / acceptance

- `lib/__tests__/volume.test.ts`: `hasRealVolume` false for all-0 or all-1 synthetic bars and true for real volumes; `volumeHistogramData` maps up/down colors and times exactly; empty input → empty output.
- session-indicators tests: (a) VWAP on 3 hand-checkable bars with volumes [100, 300, 600] equals Σ(tp·v)/Σv computed in the test; (b) the same bars with equal volumes give a DIFFERENT value (proves volume weighting matters); (c) bars without real volume → VWAP withheld (empty), not equal-weighted.
- A test (or script check) that a Yahoo payload's volume survives the audited path unchanged (use a small inline fixture; never call the network).
- Headless screenshots at 390×844 and 1280 px of a fixture trade with real volume: volume pane visible under candles, zero horizontal overflow; toggle OFF removes it.
- Standard gate with real output in the handoff: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run check:file-length`.

## 6. Finish

Commit; `git push -u origin swarm/VOL-1`; `gh pr create --base main --title "[VOL-1] Volume pane + VWAP on real bar volume" --body-file notes/handoffs/2026-11-24-VOL-1.md`. Do not merge. Last line: `SWARM-DONE VOL-1 PR=<url>`.

## HARD RULES (verbatim)
- Supabase: only `mogmine_`-prefixed objects. If a package truly needs a schema change, write the SQL migration file under `supabase/migrations/` in the PR, but DO NOT apply it yourself: NEVER run `supabase db push`, NEVER run `supabase migration repair`, never use psql against the project. Note "MIGRATION NEEDS APPLYING (apply_migration via Supabase MCP)" at the top of the handoff and PR body; code must degrade gracefully (local mode) until it is applied. Never touch `showmob_` tables, auth site_url or disable_signup settings.
- No data dumps (no exporting tables/journals/backups, no printcode full dumps committed).
- Never print, log, commit or echo secrets (.env*, tokens, keys). Do not cat env files.
- Never modify, delete or re-create Chris's real trade records or accounts (no calls to the live /api/v1 with real tokens, no Supabase writes). Use fixtures and unit tests.
- Stay inside this package's scope and its listed writable files. Out-of-scope need = stop and write it in the handoff.
- Never edit BOARD.md, NOTES.md, DECISIONS.md. Never merge PRs, never push to main, never force-push other branches, never touch other worktrees.
