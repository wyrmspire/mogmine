# Session indicators and trend math handoff

The pure `computeSessionIndicators` function takes native MES or MNQ candles, their timeframe, an explicit Globex or RTH anchor, and a UTC cutoff. It returns a session VWAP curve, POC and value-area levels, prior Globex high/low, overnight high/low, week-to-date high/low and PDC when the prior daily settlement candle is supplied and available. It reports coverage per window and withholds values when required bars are missing. `vwapDistance`, `vwapSlope` and `pricePosition` provide signed distances, slope and direction, and nearest level above/below. Position calculations accept points and ranges from the existing draft fixture.

The 70% volume profile uses HLC3 tick bins and lower-price ties. Trend slope uses endpoint change in points per minute. These are interim choices in `OD-50`, and there is no default VWAP anchor under `OD-18`. The calendar uses regular New York hours under `OD-35`. The caller supplies same-series data and the daily candle's normalized settlement date and availability time. [Audit and calculation details](codex-indicator-audit.md#core-math-in-this-slice) · [Decision log](../DECISIONS.md#2-open)

## Files changed

| File | Change |
| --- | --- |
| `lib/session-indicators.ts` | Session calculations, coverage and trend functions. |
| `lib/session.ts` | DST-aware equity-index session bounds and shared session-date helpers. |
| `lib/selectors.ts` | Running stats reuse the shared session week helper. |
| `lib/__tests__/session-indicators.test.ts` | 13 tests with hand-calculated cases, cutoff and coverage checks, DST and compatibility with the existing draft. |
| `docs/codex-indicator-audit.md` | Code and fixture audit, calculation contract and chart TODO. |
| `docs/11-product-workflows-and-api-context.md` | Points the indicator spec to the new pure calculation. |
| `DECISIONS.md` | Records interim profile, trend and weekly choices as `OD-50`. |
| `NOTES.md` | Handoff and Core math lane release. |
| `docs/codex-indicator-summary.md` | Scope and verification record. |

## Verification

| Command | Result |
| --- | --- |
| `npm test` | `tests 342`, `pass 342`, `fail 0`, `skipped 0`. |
| `TZ=Pacific/Auckland node --test lib/__tests__/session-indicators.test.ts` | `tests 13`, `pass 13`, `fail 0`. Node emitted its existing `MODULE_TYPELESS_PACKAGE_JSON` warning for the TypeScript test format. |
| `npm run typecheck` | `tsc --noEmit` exited 0 with no diagnostics. |
| `npm run lint` | `0 errors, 1 warning`. The baseline warning is `import/no-anonymous-default-export` at `postcss.config.mjs:1:1`. |
| `git diff --check` | Exit 0 with no diagnostics. |

## Remaining integration

Chart and Trade Card rendering need same-series session coverage and a level snapshot frozen by trade entry. The current cache is trade-sized and the chart includes execution prices in autoscale. The audit specifies the Canvas overlay, candle-only autoscale and out-of-frame flags for levels and fills, including what the Trade Card should export and what to verify on mobile. [Chart and Trade Card TODO](codex-indicator-audit.md#todo-for-chart-and-trade-card-wiring)

All changes are in `codex/indicator-level-trend-math` in the requested worktree. No merge or push was performed.
