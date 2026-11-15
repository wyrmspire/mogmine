# 07 — Agent Guardrails & Smart Notes (For Lesser Agents & Subagents)

This document contains concrete **Wrong vs. Right** implementation recipes, exact financial/futures math constants, and task-slicing instructions so smaller or specialized coding agents produce production-grade code on the first pass without violating MogMine's architecture.

---

## 1. Wrong vs. Right Code Recipes

### Recipe 1: Translucent Position Boxes in `lightweight-charts` v4+

**❌ WRONG:** Rendering an absolute-positioned HTML `<div>` over the chart or drawing static pixels that don't move when the user pinches/drags on mobile.

**✅ RIGHT:** Implement `ISeriesPrimitive` (`IPrimitivePaneView` + `IPrimitivePaneRenderer`) so `lightweight-charts` redraws your box automatically inside its own `<canvas>` during every pan, pinch-zoom, and `chart.takeScreenshot()` call.

```typescript
import type {
  ISeriesPrimitive,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  SeriesAttachedParameter,
  Time,
} from 'lightweight-charts';
import type { CanvasRenderingTarget2D } from 'fancy-canvas';

export interface PositionBoxConfig {
  entryTime: Time;
  exitTime: Time;
  entryPrice: number;
  exitPrice: number;
  stopOrMaePrice: number;
  direction: 'LONG' | 'SHORT';
  isWinner: boolean;
}

class PositionBoxRenderer implements IPrimitivePaneRenderer {
  constructor(
    private coords: {
      x1: number;
      x2: number;
      yEntry: number;
      yExit: number;
      yRisk: number;
      isWinner: boolean;
    } | null
  ) {}

  draw(target: CanvasRenderingTarget2D) {
    if (!this.coords) return;
    target.useBitmapCoordinateSpace((scope) => {
      const ctx = scope.context;
      const { x1, x2, yEntry, yExit, yRisk } = this.coords!;
      const scaleX = scope.horizontalPixelRatio;
      const scaleY = scope.verticalPixelRatio;

      // Read live slider opacity from CSS variable (fallback 0.28)
      const rawAlpha = getComputedStyle(document.documentElement)
        .getPropertyValue('--position-box-opacity')
        .trim();
      const alpha = Number.isFinite(parseFloat(rawAlpha)) ? parseFloat(rawAlpha) : 0.28;

      const left = Math.min(x1, x2) * scaleX;
      const width = Math.max(4, Math.abs(x2 - x1)) * scaleX;

      // 1. Profit / Target Zone (Emerald)
      const profitTop = Math.min(yEntry, yExit) * scaleY;
      const profitHeight = Math.max(2, Math.abs(yExit - yEntry)) * scaleY;
      ctx.fillStyle = `rgba(16, 185, 129, ${alpha})`;
      ctx.fillRect(left, profitTop, width, profitHeight);

      // 2. Risk / Stop / MAE Zone (Crimson)
      const riskTop = Math.min(yEntry, yRisk) * scaleY;
      const riskHeight = Math.max(2, Math.abs(yRisk - yEntry)) * scaleY;
      ctx.fillStyle = `rgba(239, 68, 68, ${alpha})`;
      ctx.fillRect(left, riskTop, width, riskHeight);

      // 3. Dashed Diagonal Execution Path (Entry -> Exit)
      ctx.save();
      ctx.strokeStyle = 'rgba(247, 223, 142, 0.9)'; // Gold-tinted path
      ctx.lineWidth = 1.5 * scaleX;
      ctx.setLineDash([4 * scaleX, 4 * scaleX]);
      ctx.beginPath();
      ctx.moveTo(x1 * scaleX, yEntry * scaleY);
      ctx.lineTo(x2 * scaleX, yExit * scaleY);
      ctx.stroke();
      ctx.restore();
    });
  }
}
```
*Agent Note:* Always check that `timeScale().timeToCoordinate()` and `series.priceToCoordinate()` return non-null values before rendering (bars slightly outside the visible viewport can return `null`; clamp to canvas edges if the trade spans partially offscreen).

*Agent Notes added 2026-11-14 (verified against the v5.3 docs, see [09](09-backend-risk-register.md) §10):*
- **Snap times to bars first.** `timeToCoordinate()` returns `null` for any time that is not on the time scale. A fill at 09:48:37 is not a bar time, so an unsnapped box is never drawn. Convert `entryTime` and `exitTime` to their bar's open time for the active timeframe, and redo it on every timeframe switch (B-23).
- **These type names are v5.** `IPrimitivePaneView` and `IPrimitivePaneRenderer` were `ISeriesPrimitivePaneView` and `ISeriesPrimitivePaneRenderer` in v4. Build against v5: `chart.addSeries(CandlestickSeries, options)`, and `createSeriesMarkers(series, markers)` in place of `series.setMarkers()`.
- **Do not call `getComputedStyle()` inside `draw()`.** It runs on every frame of a pinch. Read `--position-box-opacity`, `--gold-mid` and the profit and risk colours into a small store, update it when a slider or preset changes, then call `requestUpdate()`. The values still come from the CSS variables (Invariant 5).
- **Read the profit and risk colours from tokens too** (`--profit-emerald`, `--risk-crimson`). The literal `rgba(16, 185, 129, …)` above blocks a colour-blind preset ([08](08-ux-notes-viewing-and-journaling.md) UX-80).
- **Chart times are shifted for display only.** The library has no time-zone support. Pass every bar, marker and primitive time through one `toChartTime()` helper, and never let a shifted time reach the database or the AI (B-22).

---

### Recipe 2: Time-Syncing Primary (`MES`) & Companion (`NQ=F`) Charts Without Infinite Loops

**❌ WRONG:** Calling `companionChart.timeScale().setVisibleLogicalRange(range)` inside `primaryChart.timeScale().subscribeVisibleLogicalRangeChange()` without a re-entrancy guard. This triggers mutual ping-pong events and freezes mobile Safari.

**✅ RIGHT:** Use a shared `isSyncing` boolean lock (or `activeDriver` ref) on both **logical range** and **crosshair move** listeners.

```typescript
let isSyncingRange = false;

export function syncChartTimeScales(
  primary: IChartApi,
  companion: IChartApi
) {
  primary.timeScale().subscribeVisibleLogicalRangeChange((range) => {
    if (!range || isSyncingRange) return;
    isSyncingRange = true;
    try {
      companion.timeScale().setVisibleLogicalRange(range);
    } finally {
      isSyncingRange = false;
    }
  });

  companion.timeScale().subscribeVisibleLogicalRangeChange((range) => {
    if (!range || isSyncingRange) return;
    isSyncingRange = true;
    try {
      primary.timeScale().setVisibleLogicalRange(range);
    } finally {
      isSyncingRange = false;
    }
  });
}
```
*Agent Note:* When syncing crosshairs across `ES=F` and `NQ=F`, match on `param.time` (Unix timestamp) because prices are on completely different scales (`~5950` vs `~20800`).

*Agent Note added 2026-11-14:* Prefer one chart with two panes. In v5, `chart.addSeries(LineSeries, options, 1)` puts the companion in a second pane on the same time axis, so there is nothing to sync and one screenshot captures both. Use this two-chart recipe only when two separate chart instances are really needed ([08](08-ux-notes-viewing-and-journaling.md) UX-27). On touch screens also set `handleScroll: { vertTouchDrag: false }` so a vertical swipe that starts on the chart scrolls the page (UX-41).

---

### Recipe 3: Duration-derived Yahoo window

**❌ WRONG:** Fetching only `[entryTime, exitTime]` candles from Yahoo Finance. That produces a 3-candle chart where you cannot see the trend, Overnight Low sweep, or post-exit follow-through.

**✅ RIGHT:** Size the fitted view continuously from the trade's own hold time. The trade occupies half the base span, with 30% of the view before entry and 20% after exit. Stored classification data does not control the chart.

```typescript
export function fitWindow(entryTime: Date, exitTime: Date) {
  const holdMs = Math.max(1000, exitTime.getTime() - entryTime.getTime());
  return {
    windowStart: new Date(entryTime.getTime() - holdMs * 0.6),
    windowEnd: new Date(exitTime.getTime() + holdMs * 0.4),
  };
}
```
*Agent Note:* Whenever ingesting a trade, also fetch and cache `1m`, `5m`, and `15m` bars into `trade_candles` immediately so switching timeframes on mobile works offline/instantly even months later.

*Agent Notes added 2026-11-14 ([09](09-backend-risk-register.md) §2):*
- **`windowEnd` is in the future when the trade closes.** A single fetch at ingestion never gets the post-exit bars. Fetch what exists, then schedule a top-up in the `enrichment_jobs` table. Never use `setTimeout` in a process that can restart (B-10).
- **Record coverage.** Yahoo returns an empty result, not an error, for ranges it no longer serves. Store the requested and received range per timeframe, and fall back to a coarser timeframe for old imports (B-11).
- **Session levels need whole sessions,** not this window. VWAP, `ONH/ONL` and `PDH/PDL` cannot be computed from 45 minutes of bars (B-13).
- **The bar floor is separate from the duration rule.** Apply it in bars for the selected timeframe, never as another clock-time bucket.

---

### Recipe 4: Capturing Chart + Overlay Image for Trade Card & Vision AI

**❌ WRONG:** Using `html2canvas` on a complex page expecting it to capture external WebGL/Canvas overlays reliably, or sending raw JSON candles to the LLM without the rendered chart image.

**✅ RIGHT:** Use `lightweight-charts`'s built-in `chart.takeScreenshot()` (which returns an `HTMLCanvasElement` containing candlesticks, gridlines, **and** `PositionBoxPrimitive` Canvas layers), convert it to a Blob/DataURL, and compose it inside the Trade Card export or upload it to Supabase Storage (`trade-snapshots/`) for Vision AI.

*Agent Notes added 2026-11-14:*
- **Call `takeScreenshot(true)`.** The first argument, `addTopLayer`, defaults to `false` and is what includes the top layer and primitives. Add a test that samples a pixel inside the Position Box ([09](09-backend-risk-register.md) B-61).
- **The AI snapshot is a standard render, not the user's view.** Use an off-screen chart at a fixed size, fitted to the trade, with a fixed theme and opacity, after `document.fonts.ready`. Otherwise the model sees whatever zoom the user left.
- **Upload from the browser straight to Storage** with a signed upload URL, and store the bucket path. A Vercel route cannot carry more than 4.5 MB (B-46, B-50).
- **In privacy mode, re-render the chart** so the P&L pill shows R only ([08](08-ux-notes-viewing-and-journaling.md) UX-71).

---

### Recipe 5: Futures Contract Specs & PnL Math (DO NOT MIX MICRO VS. MINI)

A frequent bug from smaller coding models is applying E-mini (`ES` = `$50/pt`) multipliers to Micro (`MES` = `$5/pt`) trades, inflating PnL by 10x. Always look up contract specs from one shared constant table:

```typescript
export interface FuturesContractSpec {
  symbol: string;
  yahooTicker: string;
  tickSize: number;
  pointValueUsd: number; // Dollars per 1.00 full point per 1 contract
  tickValueUsd: number;
}

export const FUTURES_SPECS: Record<string, FuturesContractSpec> = {
  MES: { symbol: 'MES', yahooTicker: 'ES=F', tickSize: 0.25, pointValueUsd: 5.0,  tickValueUsd: 1.25 },
  ES:  { symbol: 'ES',  yahooTicker: 'ES=F', tickSize: 0.25, pointValueUsd: 50.0, tickValueUsd: 12.50 },
  MNQ: { symbol: 'MNQ', yahooTicker: 'NQ=F', tickSize: 0.25, pointValueUsd: 2.0,  tickValueUsd: 0.50 },
  NQ:  { symbol: 'NQ',  yahooTicker: 'NQ=F', tickSize: 0.25, pointValueUsd: 20.0, tickValueUsd: 5.00 },
  MYM: { symbol: 'MYM', yahooTicker: 'YM=F', tickSize: 1.0,  pointValueUsd: 0.5,  tickValueUsd: 0.50 },
  M2K: { symbol: 'M2K', yahooTicker: 'RTY=F',tickSize: 0.1,  pointValueUsd: 5.0,  tickValueUsd: 0.50 },
  MGC: { symbol: 'MGC', yahooTicker: 'GC=F', tickSize: 0.1,  pointValueUsd: 10.0, tickValueUsd: 1.00 },
  MCL: { symbol: 'MCL', yahooTicker: 'CL=F', tickSize: 0.01, pointValueUsd: 100.0,tickValueUsd: 1.00 },
};
```

**Gross PnL Formula:**
- `LONG`: `(exitPrice - entryPrice) * quantity * spec.pointValueUsd`
- `SHORT`: `(entryPrice - exitPrice) * quantity * spec.pointValueUsd`

**R-Multiple Formula (when `stopLossPrice` exists):**
- `riskPoints = Math.abs(entryPrice - stopLossPrice)`
- `rewardPoints = direction === 'LONG' ? (exitPrice - entryPrice) : (entryPrice - exitPrice)`
- `rMultiple = riskPoints > 0 ? rewardPoints / riskPoints : null`

*Agent Notes added 2026-11-14 ([09](09-backend-risk-register.md) §4):*
- **The formulas above only hold for one entry fill and one exit fill.** With scale-ins or partial exits, compute gross P&L from the fills: the sum of signed `quantity × price` over every fill, times `pointValueUsd`. Average prices are for display only (B-30).
- **Do the arithmetic in integer ticks:** `Math.round(price / tickSize)`. Tick sizes `0.1` and `0.01` are not exact in floating point (B-31).
- **R with scaling is an open decision** (`OD-10`). The recommendation is `P&L ÷ initial risk in dollars`. Without a stop, R is `null`, never `0`.
- **Cross-check against the broker.** Closing fills from TopstepX carry the broker's own `profitAndLoss`. Flag a mismatch. Do not hide it (B-34).
- **`YM`, `RTY`, `GC` and `CL` are missing from the table above.** The full matrix is in `mogprompt.md` §3.1.

---

## 2. Subagent Task Slicing & Handoff Protocol

When an orchestrator delegates work in this repo to faster/smaller subagents, scope each subagent tightly to **one self-contained slice** and name the exact files it must read first:

| Slice Type | Ideal Subagent Scope | Required Reading |
| :--- | :--- | :--- |
| **Adapter Implementation** | One provider/plugin (e.g., `YahooFinanceProvider` or `EconomicCalendarPlugin`) + unit tests | `AGENTS.md` + `docs/01` + `docs/07` |
| **Chart Primitive** | One `ISeriesPrimitive` (e.g., `PositionBoxPrimitive` or `SessionLevelsPrimitive`) | `AGENTS.md` + `docs/02` + `docs/07` |
| **UI Component / Screen** | One mobile view or drawer (e.g., `VisualTuningDrawer` or `SimpleNotesBar`) | `AGENTS.md` + `docs/03` + `docs/05` |
| **Database Migration** | Supabase SQL migration + typed query helpers | `AGENTS.md` + `docs/06` |
| **AI Review Route** | Context assembly + Zod schema validation + Vercel AI SDK call | `AGENTS.md` + `docs/04` |

### Subagent Handoff Checklist
Every subagent finishing a task must report:
1. Exact files created/modified.
2. Verification run (typecheck, lint, unit test, or mobile viewport check) and exact output.
3. Any stubbed dependencies or follow-up assumptions (for example, if `DEFAULT_OWNER_USER_ID` is mocked pending Supabase project keys).
4. A handoff entry in [NOTES.md](../NOTES.md), and an open item in [DECISIONS.md](../DECISIONS.md) for any spec conflict or uncovered choice it met. Subagents do not resolve spec conflicts themselves.

Every slice above also reads [08 — UX Notes](08-ux-notes-viewing-and-journaling.md) (UI slices) or [09 — Backend Risk Register](09-backend-risk-register.md) (adapter, database, ingestion and AI slices), and the additional guardrails in `AGENTS.md` §3b. Team workflow is in [CONTRIBUTING.md](../CONTRIBUTING.md).
