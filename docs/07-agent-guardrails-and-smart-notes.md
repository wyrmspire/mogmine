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

---

### Recipe 3: Trade Style Auto-Classification & Yahoo Window Padding

**❌ WRONG:** Fetching only `[entryTime, exitTime]` candles from Yahoo Finance. That produces a 3-candle chart where you cannot see the trend, Overnight Low sweep, or post-exit follow-through.

**✅ RIGHT:** Classify the trade first, select the timeframe, and pad **before entry** and **after exit** so the chart tells the full story.

```typescript
export type TradeStyle = 'scalp' | 'session_90m' | 'investment';

export function classifyAndWindowTrade(entryTime: Date, exitTime: Date) {
  const holdSeconds = Math.max(
    1,
    Math.round((exitTime.getTime() - entryTime.getTime()) / 1000)
  );

  if (holdSeconds < 15 * 60) {
    return {
      style: 'scalp' as TradeStyle,
      defaultTimeframe: '1m' as const,
      // 45 mins prior + 25 mins after exit for micro-structure & post-exit check
      windowStart: new Date(entryTime.getTime() - 45 * 60 * 1000),
      windowEnd: new Date(exitTime.getTime() + 25 * 60 * 1000),
    };
  }

  if (holdSeconds <= 2 * 60 * 60) {
    return {
      style: 'session_90m' as TradeStyle,
      defaultTimeframe: '5m' as const,
      // 3 hours prior (captures ONH/ONL/ORB) + 60 mins after exit
      windowStart: new Date(entryTime.getTime() - 3 * 60 * 60 * 1000),
      windowEnd: new Date(exitTime.getTime() + 60 * 60 * 1000),
    };
  }

  return {
    style: 'investment' as TradeStyle,
    defaultTimeframe: '1h' as const,
    // 7 days prior + 2 days after exit
    windowStart: new Date(entryTime.getTime() - 7 * 24 * 60 * 60 * 1000),
    windowEnd: new Date(exitTime.getTime() + 2 * 24 * 60 * 60 * 1000),
  };
}
```
*Agent Note:* Whenever ingesting a trade, also fetch and cache `1m`, `5m`, and `15m` bars into `trade_candles` immediately so switching timeframes on mobile works offline/instantly even months later.

---

### Recipe 4: Capturing Chart + Overlay Image for Trade Card & Vision AI

**❌ WRONG:** Using `html2canvas` on a complex page expecting it to capture external WebGL/Canvas overlays reliably, or sending raw JSON candles to the LLM without the rendered chart image.

**✅ RIGHT:** Use `lightweight-charts`'s built-in `chart.takeScreenshot()` (which returns an `HTMLCanvasElement` containing candlesticks, gridlines, **and** `PositionBoxPrimitive` Canvas layers), convert it to a Blob/DataURL, and compose it inside the Trade Card export or upload it to Supabase Storage (`trade-snapshots/`) for Vision AI.

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
