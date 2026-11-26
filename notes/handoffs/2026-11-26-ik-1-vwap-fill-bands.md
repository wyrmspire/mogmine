# IK-1 — mixed-resolution VWAP, bands and weekly anchor

Branch: `feat/ik-1-vwap-fill-bands`

## Changed

- Day/session requests fetch 1m, then 5m/15m/1h only for uncovered aligned stretches. Mixed bars retain `minutes` and `fillFrom`; coarse volume is residual after finer selected volume.
- Cached mixed or legacy-holey sessions receive one repair attempt on their next load. A failed repair is also bounded.
- Session levels and indicators share mixed native-width coverage. Extremes use exact coarse high/low; uncovered minutes withhold the affected output.
- Session and Sunday-18:00-ET weekly VWAP use cumulative volume-weighted population variance bands. Defaults are 1σ/2σ; View keeps the existing anchor control and adds band, fill, multiplier and weekly toggles.
- Band fills/lines are an `ISeriesPrimitive`; session/weekly center lines are lightweight-charts series. No HTML chart overlay was added.
- Updated docs/24 and the indicator design note to supersede the old percentage tolerance.

No Supabase change: runtime cache remains device IndexedDB; permanent archive work remains a separate backend stream.

## Verification

- `nice -n 10 npm run typecheck` — pass.
- Targeted node tests (mixed-resolution golden, session indicators, day cache, levels/week loading, chart indicators and prefs) — pass.
- `npm run check:file-length` — pass with existing grandfathered list; `lib/candles.ts` was split from 415 to 356 lines.
- Headless Chrome at 390×844 against `npx next dev -p 3124`: real Yahoo MES sessions Nov 17, Nov 23 and Nov 25 all rendered (`data-ready=true`, 7 chart canvases), no horizontal overflow, and the View menu showed Globex VWAP, 1σ/2σ bands/fill, weekly VWAP and lower-resolution provenance.
- Direct local route check for every trading session Nov 17–25: complete coverage, zero missing minutes, 3–8 fallback stretches per session.

Screenshots (local verification artifacts, not committed): `ik1-nov25-mobile.png`, `ik1-nov25-view-menu.png`.

## File-length notes

- `components/TradeChart.tsx`: 743 → 773. Kept together because the added series and primitive lifecycle must share the existing chart creation/redraw/crosshair cleanup state.
- `components/TradeDetail.tsx`: 812 → 830. Kept together to preserve the current View menu that IK-2 will replace; this slice only wires its indicator controls.
- `app/globals.css`: 1199 → 1200. One indicator token only; splitting the global token sheet is outside IK-1.

## Open

- `OD-18` still owns indicator choices not settled by IK-1 (notably “BE”); IK-1 explicitly settles these band defaults and the weekly anchor.
- Weekly provenance currently lists clock ranges for each fallback stretch; repeated clock ranges on different days are truthful but could gain day labels in IK-2 for faster scanning.
