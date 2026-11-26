# IK-2 indicator kit handoff — 2026-11-26

Branch: `feat/ik-2-indicator-kit` from `origin/feat/ik-1-vwap-fill-bands`.

## Delivered

- Pure indicator registry, instance sanitizer/default/reset helpers, and legacy prefs migration.
- Persisted ordered instances for VWAP, EMA, Volume and Session levels; multiple EMA/VWAP overlays render independently.
- Mobile Indicators sheet: active list, visibility/reorder/settings/remove/reset, searchable grouped picker, Inputs and Style tabs.
- Per-instance theme/custom colour, width, line style, line visibility, fill opacity and labels. Chart output remains lightweight-charts series/Canvas primitives.
- Configurable EMA length/source; VWAP RTH/Globex/week anchors, multiples, bands and fills.
- Updated docs/24 and the 2026-11-24 indicator design note. No Supabase work; prefs use the existing local/singleton path.

## Verification

- Targeted tests: `87` passed, `0` failed.
- `npm run typecheck`: pass, no output after `tsc --noEmit`.
- `npm run check:file-length`: checked 277 files; 13 existing/known files over target.
- `git diff --check`: pass, no output.
- Chrome at `390×844`, Next dev port `3124`: `scrollWidth=clientWidth=390`, no runtime issue, active-sheet minimum target 44px, Style minimum target 44px. Added 20 EMA persisted in `mogmine-prefs-v1`. Blue/orange tokens resolved support `#3b82f6`, resistance `#f97316`.
- Screenshots (not committed): `ik2-mobile-chart.png`, `ik2-mobile-active.png`, `ik2-mobile-picker.png`, `ik2-mobile-settings.png`, `ik2-mobile-style.png`, `ik2-mobile-style-blue-orange.png`.

## File-length note

- `components/TradeChart.tsx`: 773 → 867 lines. Growth is the dynamic multi-instance line-series/style bridge and band-layer wiring; splitting the existing chart lifecycle during this slice would be a cross-cutting refactor. The picker/settings UI was kept in a new 128-line component instead.
- `components/TradeDetail.tsx`: 830 → 826 lines; the old category-toggle sections were removed.

## Open

- MogMine currently exposes no light-theme preference/tokens. The sheet uses shared semantic tokens and was visually checked in the shipped dark theme plus the blue/orange palette; a true light visual pass waits on a product-level light theme.
- ADR/zones stay out of IK-2. The registry already supports Levels-category definitions plus line/fill/background slots for IK-3.
