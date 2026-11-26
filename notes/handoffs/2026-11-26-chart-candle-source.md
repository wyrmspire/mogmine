# Chart candle source status

The always-visible chart source row now distinguishes the displayed interval from the underlying Yahoo interval. It calls out a 5m/1h fallback and partial gaps inside the trade. The existing View menu continues to explain why session VWAP is withheld.

- `components/TradeDetail.tsx`: 842 → 843 lines, a one-line net increase in a grandfathered file. Kept this near the source label to avoid a broader extraction for a copy change.
- `npm run typecheck`: passed.
- `npm run check:file-length`: passed, 14 existing over-target files and no new ones.
- `git diff --check`: passed.
