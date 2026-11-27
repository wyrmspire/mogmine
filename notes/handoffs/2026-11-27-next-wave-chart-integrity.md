# Chart perceptual and interaction integrity

Package 2 (RM-B2 + RM-B6 + RM-E2 / DS-02 / DS-09) is integrated in the shared tree.

- `components/TradeChart.tsx` keeps the existing 1px minimum bar spacing, uses filled grayscale up/down candle paints with luminance redundancy, normalizes device-pixel-ratio fallback for exports, and rejects non-finite click points before neighbour/level hit-testing. Crosshair readouts fall back to the nearest loaded bar when a pointer lands between columns at thin spacing.
- `lib/chart-paint.ts` adds the pure filled grayscale candle palette.
- `lib/chart-thin-width.ts` adds DOM-free thin-spacing geometry and safe DPR helpers.
- `lib/chart-chrome.ts` sources the 1px floor from the thin-spacing helper.
- `lib/level-hit-test.ts` sanitizes tolerance and reversed/non-finite ray spans before comparing taps.

The touched grandfathered file `components/TradeChart.tsx` was 777 lines before this slice and is 788 lines after. No tests, build, lint, or typecheck were run per owner instruction. `git diff --check` passed for the scoped files.
