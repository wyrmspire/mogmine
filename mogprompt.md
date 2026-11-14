# MOGPROMPT.MD — The Master Architectural Blueprint & System Prompt for MogMine

> **Target Platform:** Mobile-First AI Trade Review & Performance Platform  
> **Initial Target Asset & Execution Feed:** Micro E-mini S&P 500 (`MES`) via TopstepX (ProjectX Gateway API)  
> **Hosting & Infrastructure Topology:** Next.js (App Router, TypeScript, Tailwind CSS, PWA) on Vercel + Supabase (PostgreSQL, Realtime Engine, Storage Buckets, Auth-Ready) + Persistent Trade Listener on Google Cloud Run  
> **Market Data & Context Pipeline:** Yahoo Finance Continuous Futures (`ES=F`, `NQ=F`, `YM=F`, `RTY=F`, `^VIX`, `DX-Y.NYB`) with Permanent PostgreSQL Intraday Candle Caching + Automated Session Key Levels + High-Impact USD Economic Calendar Hazard Detector + Vision-Capable Multimodal AI Review Engine  
> **Design Philosophy & Aesthetic:** Deep Carbon Obsidian (`#07080C` / `#0D0F17`) + Dynamic Adjustable Liquid Gold Gradient Matrix + Custom HTML5 Canvas 2D Series Primitives with Translucent Position Boxes for TradingView `lightweight-charts` v4+

---

## 1. Executive Summary & Vision Statement

Most retail trade journaling software suffers from desktop-first design bias, rigid post-facto manual entry forms, fragile third-party chart dependencies, and superficial AI summaries that offer generic truisms ("Manage your risk! Cut losers quickly!"). **MogMine** is fundamentally reimagined as a mobile-first, zero-friction trade review cockpit tailored specifically for active intraday futures traders operating on modern prop firm platforms like TopstepX.

When a trader finishes an intraday session or steps away from their execution desk, reviewing their execution must not feel like administrative data entry. Instead:
1. **Zero-Friction Automated Ingestion:** The moment a position flatlines in TopstepX, the trade is captured with sub-second latency by an isolated containerized listener running on Google Cloud Run, transformed into a normalized round-trip trade record, classified into its operational timeframe archetype (`scalp`, `session_90m`, or `investment`), enriched with cached multi-timeframe candles, and broadcast directly to the trader’s smartphone via Supabase Realtime WebSocket events.
2. **Instant Visual Truth:** Opening the push notification loads a hardware-accelerated mobile candlestick chart powered by TradingView `lightweight-charts` v4+. Overlaid directly onto the price series is a custom HTML5 Canvas `ISeriesPrimitive` that paints a translucent, color-calibrated Position Box representing the exact entry price, stop-loss or Maximum Adverse Excursion (MAE), target price, scale-ins/scale-outs, and post-exit market behavior.
3. **Intermarket Divergence (SMT) & Context Synchronization:** Because index futures like `MES` rarely move in isolation, the review interface allows seamless synchronization with a companion chart (principally `NQ=F` for Nasdaq correlation, alongside `^VIX` or `DX-Y.NYB`). Traders can instantly inspect Smart Money Tool (SMT) divergences—such as `ES` sweeping session liquidity while `NQ` creates a higher swing low—directly on mobile with locked crosshairs, asymmetric dual panes, or normalized percentage overlays.
4. **Dual-Speed Note Capture:** Recognizing that in-session capture requires speed while post-market journaling requires depth, MogMine provides a 10-second "Pit Stop" mode (featuring one-tap playbook pills, tactical reason chips, and speech-to-text voice journaling parsed by an LLM into structured tags) and an expandable "Advanced Mode" (comprising interactive rule checklists, multi-timeframe theses, scaling rationales, and post-exit follow-through notes).
5. **Collector's Grade Trade Cards:** One tap generates an exportable, high-density graphic asset ("Trade Card") synthesizing the execution chart, position box, playbook metrics, key levels, and AI verdict, complete with privacy toggles to mask dollar amounts for public discord/social sharing.
6. **Multimodal AI Coaching Engine:** Rather than providing vague platitudes, the AI review engine evaluates six discrete context streams: exact execution telemetry, high-resolution candlestick structure, proximity to key session levels (VWAP, Overnight High/Low, Previous Day High/Low, Opening Range), intermarket divergence metrics, proximity to high-impact economic news events (CPI, FOMC, NFP), and a high-resolution canvas snapshot evaluated via computer vision.

---

## 2. Comprehensive System Architecture & Service Topology

```
+--------------------------------------------------------------------------------------------------+
|                                    TOPSTEPX / PROJECTX ECOSYSTEM                                 |
|                                                                                                  |
|   +--------------------------------------+            +--------------------------------------+   |
|   |    ProjectX Gateway REST API         |            |    ProjectX SignalR WebSocket Feed   |   |
|   |  - Historical order fills            |            |  - Realtime User Execution Stream    |   |
|   |  - Account metadata & balances       |            |  - Order state transition events     |   |
|   +-------------------+------------------+            +-------------------+------------------+   |
+-----------------------|---------------------------------------------------|----------------------+
                        |                                                   |
                        | HTTP Polling / Resync                             | Persistent WSS Stream
                        v                                                   v
+--------------------------------------------------------------------------------------------------+
|                              GOOGLE CLOUD RUN LISTENER SERVICE                                   |
|   - Node.js / TypeScript Dockerized Long-Running Container                                       |
|   - Minimum instance allocation = 1 (Dedicated execution loop, zero cold-start latency)          |
|   - Continuous SignalR connection manager with exponential backoff & keep-alive heartbeats       |
|   - In-memory execution aggregator (Pairing BUY / SELL fills into discrete round-trip trades)    |
|   - Trade Style Classifier (Computes hold duration: Scalp vs. 90-Min Session vs. Swing)          |
|   - Webhook trigger & Direct Supabase Service-Role Client                                        |
+---------------------------------------------------+----------------------------------------------+
                                                    |
                                                    | Secure Service-Role HTTPS / REST
                                                    v
+--------------------------------------------------------------------------------------------------+
|                                   SUPABASE DATA & REALTIME CORE                                  |
|                                                                                                  |
|   +------------------------------------+  +--------------------------------------------------+   |
|   |    PostgreSQL Relational DB        |  |    Supabase Storage Engine                       |   |
|   |  - accounts, executions, trades    |  |  - Bucket: `trade-snapshots` (Retina PNGs)       |   |
|   |  - trade_candles (permanent cache) |  |  - Bucket: `voice-memos` (Audio blobs)           |   |
|   |  - session_levels, economic_events |  +--------------------------------------------------+   |
|   |  - playbooks, trade_notes          |  |    Supabase Realtime Channel                     |   |
|   |  - ai_reviews, user_preferences    |  |  - Broadcasts `trade_closed` & `review_ready`    |   |
|   +------------------------------------+  +--------------------------------------------------+   |
+---------------------------------------------------+----------------------------------------------+
                                                    ^
                                                    | Reactive Subscriptions & Server Actions
                                                    v
+--------------------------------------------------------------------------------------------------+
|                                 VERCEL NEXT.JS FULLSTACK APPLICATION                             |
|                                                                                                  |
|   +--------------------------------------------------+  +------------------------------------+   |
|   |    Next.js App Router (PWA Mobile Shell)         |  |    Edge & Serverless API Routes    |   |
|   |  - Mobile Viewport: 390x844 responsive grid      |  |  - `/api/market-data/candles`      |   |
|   |  - Obsidian & Dynamic Gold Gradient Matrix       |  |  - `/api/market-data/levels`       |   |
|   |  - TradingView lightweight-charts v4+ Canvas     |  |  - `/api/ai/review` (Vision + LLM) |   |
|   |  - SMT Divergence Companion Panes                |  |  - `/api/ai/voice-transcribe`      |   |
|   |  - Simple (<10s) & Advanced Journaling Drawers   |  |  - `/api/export/trade-card`        |   |
|   |  - One-Click High-Res PNG Trade Card Exporter    |  |  - `/api/ingest/csv`               |   |
|   +--------------------------------------------------+  +------------------------------------+   |
+-------------------+---------------------------------------------------------------+--------------+
                    |                                                               |
                    | External Market Context Fetch                                 | Multimodal Context Bundle
                    v                                                               v
+------------------------------------+                             +-----------------------------------+
|      YAHOO FINANCE DATA FEED       |                             |     MULTIMODAL AI INFERENCE       |
|  - `ES=F` (Primary for MES)        |                             |  - Vercel AI SDK (Gemini / Claude |
|  - `NQ=F` (Nasdaq Companion)       |                             |    Vision / OpenAI GPT-4o)        |
|  - `YM=F`, `RTY=F`, `^VIX`, DXY    |                             |  - Inputs: Image + JSON Telemetry |
|  - Intervals: 1m, 2m, 5m, 15m, 1h  |                             |  - Strict Zod Schema Validation   |
+------------------------------------+                             +-----------------------------------+
```

---

## 3. Pluggable Adapter Interfaces ("Programmed to Grow")

Every external integration in MogMine is decoupled via strict TypeScript interfaces. Application components and review services never import third-party libraries (`yahoo-finance2`, TopstepX clients, or specific AI models) directly.

### 3.1 Market Data Adapter Specification

```typescript
export type CanonicalSymbol = 'MES' | 'ES' | 'MNQ' | 'NQ' | 'MYM' | 'YM' | 'M2K' | 'RTY' | 'MGC' | 'GC' | 'MCL' | 'CL' | 'VIX' | 'DXY';
export type Timeframe = '1m' | '2m' | '5m' | '15m' | '1h' | '1d';

export interface Candle {
  time: number; // UTC Unix Timestamp in seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MarketDataQuery {
  symbol: CanonicalSymbol;
  timeframe: Timeframe;
  from: Date;
  to: Date;
}

export interface MarketDataProvider {
  readonly providerId: string; // e.g., 'yahoo_finance' | 'databento' | 'topstepx_native'
  resolveProviderTicker(symbol: CanonicalSymbol): string;
  fetchCandles(query: MarketDataQuery): Promise<Candle[]>;
  supportsTickResolution(): boolean;
}
```

#### Canonical Ticker Mapping Implementation Matrix

| Canonical Symbol | Instrument Description | Yahoo Finance Provider Ticker | Tick Size | Point Multiplier (USD) | Tick Value (USD) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`MES`** | Micro E-mini S&P 500 | `ES=F` | `0.25` | `$5.00` | `$1.25` |
| **`ES`** | E-mini S&P 500 | `ES=F` | `0.25` | `$50.00` | `$12.50` |
| **`MNQ`** | Micro E-mini Nasdaq-100 | `NQ=F` | `0.25` | `$2.00` | `$0.50` |
| **`NQ`** | E-mini Nasdaq-100 | `NQ=F` | `0.25` | `$20.00` | `$5.00` |
| **`MYM`** | Micro E-mini Dow Jones | `YM=F` | `1.00` | `$0.50` | `$0.50` |
| **`YM`** | E-mini Dow Jones | `YM=F` | `1.00` | `$5.00` | `$5.00` |
| **`M2K`** | Micro E-mini Russell 2000 | `RTY=F` | `0.10` | `$5.00` | `$0.50` |
| **`RTY`** | E-mini Russell 2000 | `RTY=F` | `0.10` | `$50.00` | `$5.00` |
| **`MGC`** | Micro Gold Futures | `GC=F` | `0.10` | `$10.00` | `$1.00` |
| **`GC`** | Standard Gold Futures | `GC=F` | `0.10` | `$100.00` | `$10.00` |
| **`MCL`** | Micro Crude Oil | `CL=F` | `0.01` | `$100.00` | `$1.00` |
| **`CL`** | Standard Crude Oil | `CL=F` | `0.01` | `$1,000.00` | `$10.00` |
| **`VIX`** | CBOE Volatility Index | `^VIX` | `0.01` | N/A (Index) | N/A |
| **`DXY`** | US Dollar Index | `DX-Y.NYB` | `0.005` | N/A (Index) | N/A |

### 3.2 Trade Ingestion Adapter Specification

```typescript
export interface RawExecutionRecord {
  externalExecutionId: string;
  accountId: string;
  symbol: CanonicalSymbol;
  side: 'BUY' | 'SELL';
  quantity: number;
  price: number;
  timestamp: Date;
  feeOrCommission: number;
}

export interface NormalizedRoundTripTrade {
  externalTradeId?: string;
  accountId: string;
  symbol: CanonicalSymbol;
  direction: 'LONG' | 'SHORT';
  entryTime: Date;
  exitTime: Date;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  grossPnl: number;
  netPnl: number;
  commissions: number;
  executions: RawExecutionRecord[];
}

export interface TradeIngestionAdapter {
  readonly adapterSource: 'topstepx_signalr' | 'csv_import' | 'manual_terminal';
  processPayload(payload: unknown): Promise<NormalizedRoundTripTrade[]>;
}
```

### 3.3 Context Enrichment Plugin Architecture

```typescript
export interface ReviewContextBlock {
  pluginIdentifier: string;
  category: 'telemetry' | 'price_action' | 'levels' | 'divergence' | 'macro' | 'playbook' | 'visual';
  title: string;
  summaryProse: string;
  structuredMetadata: Record<string, unknown>;
  visualAttachments?: Array<{
    mimeType: 'image/png' | 'image/jpeg';
    storageUrl: string;
    description: string;
  }>;
}

export interface ReviewContextPlugin {
  readonly pluginIdentifier: string;
  readonly executionWeight: number; // Determines order in prompt compilation
  extractContext(tradeId: string): Promise<ReviewContextBlock | null>;
}
```

---

## 4. Hardware-Accelerated Chart Engine & Custom Canvas Primitives

### 4.1 The Case for `lightweight-charts` v4+ and Custom `ISeriesPrimitive`

Building an intraday trading chart on mobile requires 60fps kinetic scrolling, multi-touch pinch zooming, and instant responsive resizing. Re-implementing these physics from scratch on an HTML5 `<canvas>` or SVG DOM introduces unacceptable lag, crosshair jitter, and device-specific rendering defects. Conversely, embedding the heavy TradingView Advanced Charting Library inside mobile iframes consumes excessive memory, resists cohesive dark-mode styling, and makes headless export difficult.

TradingView's open-source `lightweight-charts` v4+ provides the optimal balance:
- Ultra-lightweight footprint (~45KB gzipped).
- Native-feeling touch gestures and inertial scrolling.
- **Series Primitive Plugin Architecture (`ISeriesPrimitive`):** Provides a direct render loop hook into the underlying HTML5 2D canvas context, allowing custom visual elements (Position Boxes, execution paths, session levels, divergence vectors) to be drawn using coordinate conversion methods (`timeToCoordinate`, `priceToCoordinate`).
- **Complete Canvas Export:** The native `chart.takeScreenshot()` method captures all active `ISeriesPrimitive` graphics on the canvas surface, enabling pixel-perfect snapshot generation for Trade Cards and Vision AI models.

### 4.2 Comprehensive Implementation: `PositionBoxPrimitive`

The Position Box must dynamically render:
1. **Profit / Target Zone:** A translucent emerald or gold gradient fill spanning from entry time to exit time between entry price and exit price (or planned target).
2. **Risk / Stop / MAE Zone:** A translucent crimson fill spanning from entry price to stop-loss price or observed Maximum Adverse Excursion.
3. **Execution Path:** A dashed diagonal connector line tracing the transaction path from entry to exit.
4. **Dynamic CSS Variable Integration:** The alpha transparency of all boxes is read dynamically from the `--position-box-opacity` CSS variable, while accent colors pull from `--gold-mid`.

```typescript
import {
  ISeriesPrimitive,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  SeriesAttachedParameter,
  Time,
  IChartApi,
  ISeriesApi,
} from 'lightweight-charts';
import type { CanvasRenderingTarget2D } from 'fancy-canvas';

export interface PositionBoxData {
  entryTime: Time;
  exitTime: Time;
  entryPrice: number;
  exitPrice: number;
  riskPrice: number; // Hard stop-loss or recorded MAE price
  direction: 'LONG' | 'SHORT';
  isWinner: boolean;
}

class PositionBoxRenderer implements IPrimitivePaneRenderer {
  constructor(
    private coordinates: {
      xEntry: number;
      xExit: number;
      yEntry: number;
      yExit: number;
      yRisk: number;
      isWinner: boolean;
    } | null
  ) {}

  draw(target: CanvasRenderingTarget2D) {
    if (!this.coordinates) return;

    target.useBitmapCoordinateSpace((scope) => {
      const ctx = scope.context;
      const { xEntry, xExit, yEntry, yExit, yRisk, isWinner } = this.coordinates!;
      const sx = scope.horizontalPixelRatio;
      const sy = scope.verticalPixelRatio;

      // Extract dynamic CSS variables for live user styling
      const rootStyles = getComputedStyle(document.documentElement);
      const configuredAlpha = parseFloat(rootStyles.getPropertyValue('--position-box-opacity')) || 0.28;
      const goldMid = rootStyles.getPropertyValue('--gold-mid').trim() || '#D4AF37';

      const boxLeft = Math.min(xEntry, xExit) * sx;
      const boxWidth = Math.max(6 * sx, Math.abs(xExit - xEntry) * sx);

      // 1. Render Profit Zone
      const profitTop = Math.min(yEntry, yExit) * sy;
      const profitHeight = Math.max(2 * sy, Math.abs(yExit - yEntry) * sy);
      ctx.fillStyle = isWinner
        ? `rgba(16, 185, 129, ${configuredAlpha})`
        : `rgba(16, 185, 129, ${Math.max(0.10, configuredAlpha * 0.65)})`;
      ctx.fillRect(boxLeft, profitTop, boxWidth, profitHeight);

      // Profit Zone Subtle Border
      ctx.strokeStyle = isWinner ? 'rgba(16, 185, 129, 0.85)' : 'rgba(16, 185, 129, 0.4)';
      ctx.lineWidth = 1 * sx;
      ctx.strokeRect(boxLeft, profitTop, boxWidth, profitHeight);

      // 2. Render Risk / MAE Zone
      const riskTop = Math.min(yEntry, yRisk) * sy;
      const riskHeight = Math.max(2 * sy, Math.abs(yRisk - yEntry) * sy);
      ctx.fillStyle = `rgba(239, 68, 68, ${configuredAlpha})`;
      ctx.fillRect(boxLeft, riskTop, boxWidth, riskHeight);

      // Risk Zone Subtle Border
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.7)';
      ctx.lineWidth = 1 * sx;
      ctx.strokeRect(boxLeft, riskTop, boxWidth, riskHeight);

      // 3. Render Diagonal Execution Trajectory Line
      ctx.save();
      ctx.strokeStyle = isWinner ? goldMid : 'rgba(244, 245, 247, 0.75)';
      ctx.lineWidth = 1.5 * sx;
      ctx.setLineDash([4 * sx, 4 * sx]);
      ctx.beginPath();
      ctx.moveTo(xEntry * sx, yEntry * sy);
      ctx.lineTo(xExit * sx, yExit * sy);
      ctx.stroke();
      ctx.restore();

      // 4. Render Entry & Exit Discrete Node Anchors
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(xEntry * sx, yEntry * sy, 3 * sx, 0, 2 * Math.PI);
      ctx.fill();

      ctx.fillStyle = isWinner ? goldMid : '#EF4444';
      ctx.beginPath();
      ctx.arc(xExit * sx, yExit * sy, 3 * sx, 0, 2 * Math.PI);
      ctx.fill();
    });
  }
}

class PositionBoxPaneView implements IPrimitivePaneView {
  constructor(
    private source: PositionBoxPrimitive,
    private series: ISeriesApi<'Candlestick'>,
    private chart: IChartApi
  ) {}

  update() {}

  renderer(): IPrimitivePaneRenderer {
    const data = this.source.getData();
    if (!data) return new PositionBoxRenderer(null);

    const timeScale = this.chart.timeScale();
    const xEntry = timeScale.timeToCoordinate(data.entryTime);
    const xExit = timeScale.timeToCoordinate(data.exitTime);
    const yEntry = this.series.priceToCoordinate(data.entryPrice);
    const yExit = this.series.priceToCoordinate(data.exitPrice);
    const yRisk = this.series.priceToCoordinate(data.riskPrice);

    if (xEntry === null || xExit === null || yEntry === null || yExit === null || yRisk === null) {
      return new PositionBoxRenderer(null);
    }

    return new PositionBoxRenderer({
      xEntry,
      xExit,
      yEntry,
      yExit,
      yRisk,
      isWinner: data.isWinner,
    });
  }

  zOrder(): 'top' | 'bottom' | 'normal' {
    return 'normal'; // Draws over chart grid but beneath crosshair & tooltip
  }
}

export class PositionBoxPrimitive implements ISeriesPrimitive {
  private paneView: PositionBoxPaneView | null = null;
  private attachedParams: SeriesAttachedParameter<Time> | null = null;

  constructor(private data: PositionBoxData | null) {}

  setData(data: PositionBoxData | null) {
    this.data = data;
    this.requestUpdate();
  }

  getData(): PositionBoxData | null {
    return this.data;
  }

  attached(param: SeriesAttachedParameter<Time>) {
    this.attachedParams = param;
    this.paneView = new PositionBoxPaneView(this, param.series as ISeriesApi<'Candlestick'>, param.chart);
  }

  detached() {
    this.attachedParams = null;
    this.paneView = null;
  }

  paneViews() {
    return this.paneView ? [this.paneView] : [];
  }

  updateAllViews() {
    this.paneView?.update();
  }

  private requestUpdate() {
    this.attachedParams?.requestUpdate();
  }
}
```

---

## 5. Trade Archetype Classifier & Yahoo Caching Engine

### 5.1 The Critical 7-Day Yahoo Finance Intraday Expiration Wall

> **Architectural Invariant:** Yahoo Finance discards 1-minute intraday bars older than 7–30 days and 5-minute bars older than 60 days. An application that queries Yahoo Finance dynamically upon trade viewing will fail to render charts for historical trades.  
> **Solution:** MogMine persists full OHLCV candlestick windows into PostgreSQL (`trade_candles`) at the moment of trade ingestion. Subsequent viewings read directly from the database cache.

### 5.2 Trade Duration Classifier & Window Slicing Specification

```typescript
export type TradeArchetype = 'scalp' | 'session_90m' | 'investment';

export interface WindowPaddingConfig {
  archetype: TradeArchetype;
  primaryTimeframe: Timeframe;
  preEntryPaddingMinutes: number;
  postExitPaddingMinutes: number;
  supplementalTimeframes: Timeframe[];
}

export function evaluateTradeArchetype(entryTime: Date, exitTime: Date): WindowPaddingConfig {
  const durationMs = exitTime.getTime() - entryTime.getTime();
  const durationMinutes = Math.max(1, Math.round(durationMs / (60 * 1000)));

  // SCALP ARCHETYPE: Sub-15 minute executions
  if (durationMinutes < 15) {
    return {
      archetype: 'scalp',
      primaryTimeframe: '1m',
      preEntryPaddingMinutes: 45, // Captures immediate pre-breakout structure & VWAP
      postExitPaddingMinutes: 30, // Verifies whether the scalp caught the move or got chopped
      supplementalTimeframes: ['5m'],
    };
  }

  // 90-MINUTE SESSION TRADE: 15 minutes to 2 hours
  if (durationMinutes <= 120) {
    return {
      archetype: 'session_90m',
      primaryTimeframe: '5m',
      preEntryPaddingMinutes: 180, // Includes Overnight High/Low & Opening Range breakout
      postExitPaddingMinutes: 60,  // Captures target completion & session rotation
      supplementalTimeframes: ['1m', '15m'],
    };
  }

  // INVESTMENT / EXTENDED SWING: Greater than 2 hours or multi-session holds
  return {
    archetype: 'investment',
    primaryTimeframe: '1h',
    preEntryPaddingMinutes: 24 * 60 * 5, // 5 prior trading sessions
    postExitPaddingMinutes: 24 * 60 * 2, // 2 subsequent sessions for follow-through
    supplementalTimeframes: ['15m', '1d'],
  };
}
```

---

## 6. SMT Divergence, Push Detection & Companion Synchronizer

Day traders evaluating `MES` executions rely heavily on intermarket correlation with `NQ=F` (E-mini Nasdaq 100). SMT (Smart Money Technique) divergence reveals institutional accumulation or distribution when correlated assets fail to confirm each other's swing extremes:
- **Bullish SMT Divergence:** `ES` sweeps below a key swing low (e.g., Overnight Low), while `NQ` holds a higher swing low. This indicates underlying market strength and signals a probable upward reversal in `ES`.
- **Bearish SMT Divergence:** `ES` pushes to a higher high, while `NQ` fails to make a higher high. This indicates exhaustion and signals a probable breakdown.
- **Confirming Push:** Both `ES` and `NQ` break key levels simultaneously with expanding volume, confirming institutional trend continuation.

### 6.1 Bi-Directional Time-Scale Synchronization Algorithm

When displaying dual charts on mobile, syncing the horizontal time axis without triggering an infinite event loop requires an explicit synchronization lock:

```typescript
import { IChartApi, LogicalRange } from 'lightweight-charts';

export function bindSynchronizedCharts(primaryChart: IChartApi, companionChart: IChartApi): () => void {
  let isRangeSynchronizing = false;
  let isCrosshairSynchronizing = false;

  const handlePrimaryRangeChange = (range: LogicalRange | null) => {
    if (!range || isRangeSynchronizing) return;
    isRangeSynchronizing = true;
    try {
      companionChart.timeScale().setVisibleLogicalRange(range);
    } finally {
      isRangeSynchronizing = false;
    }
  };

  const handleCompanionRangeChange = (range: LogicalRange | null) => {
    if (!range || isRangeSynchronizing) return;
    isRangeSynchronizing = true;
    try {
      primaryChart.timeScale().setVisibleLogicalRange(range);
    } finally {
      isRangeSynchronizing = false;
    }
  };

  primaryChart.timeScale().subscribeVisibleLogicalRangeChange(handlePrimaryRangeChange);
  companionChart.timeScale().subscribeVisibleLogicalRangeChange(handleCompanionRangeChange);

  return () => {
    primaryChart.timeScale().unsubscribeVisibleLogicalRangeChange(handlePrimaryRangeChange);
    companionChart.timeScale().unsubscribeVisibleLogicalRangeChange(handleCompanionRangeChange);
  };
}
```

### 6.2 Mobile Layout Display Options for Companion Charts

To conserve screen real estate on mobile devices (`390x844`), MogMine provides three display modes:
1. **Asymmetric 65/35 Vertical Split (Default):** The primary `MES` chart occupies 65% of the viewport, with the companion `NQ=F` chart occupying 35% directly beneath. A single shared time scale is rendered at the bottom, maximizing vertical chart area.
2. **Normalized Percentage Ghost Overlay:** Renders `NQ=F` as a semi-transparent line chart plotted directly within the `MES` pane. Both instruments are indexed to `0.00%` at the market open or trade entry time, making divergence visually apparent in a single unified view.
3. **SMT Divergence Event Pins:** The server pre-computes swing highs and lows across both instruments and renders an icon pin (`⚡ SMT`) directly on the chart's time axis whenever a divergence condition is met.

---

## 7. Automated Session Key Levels Engine

Intraday price action revolves around structural liquidity levels. MogMine calculates and visualizes these levels automatically:

```typescript
export interface SessionKeyLevels {
  pdh: number;      // Previous Day Regular Trading Hours High (09:30 - 16:00 ET)
  pdl: number;      // Previous Day Regular Trading Hours Low
  pdc: number;      // Previous Day Settlement / Close
  onh: number;      // Overnight / Globex Session High (18:00 - 09:30 ET)
  onl: number;      // Overnight / Globex Session Low
  orbHigh: number;  // 5-Minute Opening Range High (09:30 - 09:35 ET)
  orbLow: number;   // 5-Minute Opening Range Low
  ibh: number;      // Initial Balance High (09:30 - 10:30 ET)
  ibl: number;      // Initial Balance Low
  sessionVwap: number; // Volume-Weighted Average Price from 09:30 ET
}
```

---

## 8. Dual-Speed Note-Taking & The 10-Second Pit Stop

MogMine separates in-session note taking from post-market analysis to fit the trader's workflow:

```
[ Trade Closes on TopstepX ]
              |
              v
[ Supabase Realtime Mobile Push Notification ]
              |
              v
+-------------------------------------------------------------------------+
|                  10-SECOND PIT STOP (Mobile Sheet)                      |
|                                                                         |
|  1. ONE-TAP PLAYBOOK SELECTOR:                                          |
|     [ ORB Reclaim ] [ ONL Sweep + SMT ] [ VWAP Trend ] [ News Fade ]    |
|                                                                         |
|  2. ONE-TAP EXECUTION TAGS:                                             |
|     [ Liquidity Sweep ] [ NQ Leading ] [ A+ Setup ] [ Chased ]          |
|                                                                         |
|  3. 10-SECOND VOICE MEMO MIC:                                           |
|     (Hold to Record) -> "Entered MES long after sweeping ONL, NQ held   |
|     higher low. Trimmed half at VWAP, trailed stop to breakeven."       |
|                                                                         |
|  4. AI STREAM PARSER:                                                   |
|     Auto-populates structured tags and transcribes voice note.          |
+-------------------------------------------------------------------------+
              |
              v (Post-Market Review)
+-------------------------------------------------------------------------+
|                   ADVANCED MODE (Deep Journaling)                       |
|                                                                         |
|  1. Interactive Playbook Checklist (Verifies rule compliance)           |
|  2. Multi-Timeframe Structural Thesis Form                              |
|  3. SMT Divergence & Intermarket Correlation Log                        |
|  4. Post-Exit Analysis (Price action 15-60m following exit)             |
|  5. Interactive AI Coaching Chat Session                                |
+-------------------------------------------------------------------------+
```

---

## 9. One-Click Quality Trade Card & Privacy Shield

The Trade Card provides a clean, visual summary of an individual trade for review or sharing:

```text
+-------------------------------------------------------------------------------+
|  MES  [LONG]  •  90-Min Session Trade (42m 10s)             +2.60 R           |
|  NY AM Session  •  Nov 14, 2026  •  09:48 - 10:30 ET        +$325.00          |
+-------------------------------------------------------------------------------+
|  CHART SNAPSHOT: 5m ES=F                                                      |
|  - Candlesticks with Translucent Position Box                                 |
|  - Entry: 5948.50  |  Exit: 5961.50  |  Stop: 5943.50                         |
|  - Overlaid Session Levels: ONL (5947.25), VWAP (5952.00)                     |
|  - Companion Marker: [⚡ SMT Divergence vs NQ=F @ 09:45]                      |
+-------------------------------------------------------------------------------+
|  PLAYBOOK: NY Open Liquidity Sweep + SMT Confirmation                         |
|  Rule Adherence: [✓] 4 / 4 Rules Followed  |  Tags: #Sweep #NQ-Lead #Scaled   |
|  Thesis: "MES swept Overnight Low while NQ held a higher swing low.           |
|  Reclaimed VWAP on heavy volume and scaled out at PDH."                       |
+-------------------------------------------------------------------------------+
|  AI COACH VERDICT (Grade: A-)                                                 |
|  ✓ Disciplined entry on the 5m reclaim close rather than anticipating early.  |
|  ! Exited entire position at initial target; leaving a runner would have      |
|    captured an additional +1.2R extension into the Initial Balance High.      |
+-------------------------------------------------------------------------------+
```

### Privacy / Prop Shield Toggle
Traders often want to share setups with communities or social channels without revealing account numbers, balance details, or dollar amounts. A single toggle switches the Trade Card between:
- **Standard Mode:** Displays full net PnL (`+$325.00`), contract sizing (`2 contracts`), and account identifier.
- **Privacy Mode:** Conceals all currency values and account IDs, displaying only performance metrics: `+2.60 R`, `+13.00 pts`, `52 ticks`, and execution timestamps.

---

## 10. Multimodal AI Trade Review Engine

The AI Review Engine accepts structured trade data, technical indicators, and visual chart captures to generate actionable feedback.

```typescript
export interface AITradeReviewSchema {
  evaluationGrade: 'A+' | 'A' | 'A-' | 'B+' | 'B' | 'B-' | 'C+' | 'C' | 'D' | 'F';
  verdictHeadline: string;
  archetypeValidation: {
    classifiedArchetype: 'scalp' | 'session_90m' | 'investment';
    executionConsistency: boolean;
    structuralCommentary: string;
  };
  priceActionReview: string;
  smtDivergenceEvaluation: string | null;
  sessionLevelsContext: {
    entryLevelProximity: string;
    exitLevelProximity: string;
    executionDiscipline: 'optimal' | 'acceptable' | 'chased' | 'faded_momentum';
  };
  economicNewsHazardAssessment: {
    nearHighImpactEvent: boolean;
    identifiedEventTitle: string | null;
    minutesDeltaFromRelease: number | null;
    volatilityHazardRating: 'none' | 'moderate' | 'extreme';
  };
  playbookAdherenceScore: number; // 0 - 100
  positiveExecutionHabits: string[];
  tacticalMistakesIdentified: string[];
  actionableDirectiveForNextTrade: string;
}
```

---

## 11. Obsidian & Adjustable Liquid Gold Design Tokens

### 11.1 Dynamic Theme Variables (`globals.css`)

```css
:root {
  /* Core Surface Architecture */
  --bg-obsidian: #07080c;
  --bg-surface: #0d0f17;
  --bg-elevated: #141824;

  /* Typography */
  --font-sans: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif;
  --font-mono: 'JetBrains Mono', 'Geist Mono', monospace;

  /* User Tuning Controls */
  --gold-intensity: 0.75;
  --position-box-opacity: 0.28;

  /* Default Gold Preset: Bullion */
  --gold-light: #f7df8e;
  --gold-mid: #d4af37;
  --gold-deep: #96731e;
  --gold-glow: rgba(212, 175, 55, calc(0.28 * var(--gold-intensity)));
  --gold-gradient: linear-gradient(135deg, var(--gold-light) 0%, var(--gold-mid) 50%, var(--gold-deep) 100%);
}

[data-gold-preset="champagne"] {
  --gold-light: #f5e9c8;
  --gold-mid: #dfc99b;
  --gold-deep: #ae9665;
  --gold-glow: rgba(223, 201, 155, calc(0.22 * var(--gold-intensity)));
}

[data-gold-preset="amber"] {
  --gold-light: #fbbf24;
  --gold-mid: #d97706;
  --gold-deep: #92400e;
  --gold-glow: rgba(217, 119, 6, calc(0.30 * var(--gold-intensity)));
}

[data-gold-preset="platinum"] {
  --gold-light: #f1f5f9;
  --gold-mid: #94a3b8;
  --gold-deep: #475569;
  --gold-glow: rgba(148, 163, 184, calc(0.18 * var(--gold-intensity)));
}

/* Tabular Financial Formatting */
.tabular-numbers {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
}

/* Subtle Top-Edge Specular Lighting */
.specular-border {
  position: relative;
  background: var(--bg-surface);
  border: 1px solid rgba(255, 255, 255, 0.07);
}

.specular-border::before {
  content: '';
  position: absolute;
  top: 0;
  left: 10%;
  right: 10%;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--gold-light), transparent);
  opacity: calc(0.8 * var(--gold-intensity));
  pointer-events: none;
}
```

---

## 12. Complete PostgreSQL Database Schema (Supabase)

```sql
-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. ACCOUNTS TABLE
CREATE TABLE accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL,
    broker_name TEXT NOT NULL DEFAULT 'TopstepX',
    external_account_id TEXT NOT NULL,
    account_type TEXT NOT NULL, -- 'Combine', 'ExpressFunded', 'Live'
    currency TEXT NOT NULL DEFAULT 'USD',
    balance NUMERIC(12, 2) NOT NULL DEFAULT 50000.00,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, external_account_id)
);

-- 2. PLAYBOOKS TABLE
CREATE TABLE playbooks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    target_asset TEXT NOT NULL DEFAULT 'MES',
    default_archetype TEXT NOT NULL DEFAULT 'session_90m',
    checklist_rules JSONB NOT NULL DEFAULT '[]'::jsonb,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. TRADES TABLE
CREATE TABLE trades (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL,
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    playbook_id UUID REFERENCES playbooks(id) ON DELETE SET NULL,
    symbol TEXT NOT NULL, -- 'MES', 'MNQ', etc.
    yahoo_ticker TEXT NOT NULL, -- 'ES=F', 'NQ=F'
    direction TEXT NOT NULL, -- 'LONG', 'SHORT'
    trade_archetype TEXT NOT NULL, -- 'scalp', 'session_90m', 'investment'
    archetype_overridden BOOLEAN NOT NULL DEFAULT FALSE,
    entry_time TIMESTAMPTZ NOT NULL,
    exit_time TIMESTAMPTZ NOT NULL,
    hold_duration_seconds INTEGER NOT NULL,
    quantity INTEGER NOT NULL,
    entry_price NUMERIC(10, 4) NOT NULL,
    exit_price NUMERIC(10, 4) NOT NULL,
    stop_loss_price NUMERIC(10, 4),
    planned_target_price NUMERIC(10, 4),
    mae_price NUMERIC(10, 4), -- Maximum Adverse Excursion price
    mfe_price NUMERIC(10, 4), -- Maximum Favorable Excursion price
    gross_pnl NUMERIC(10, 2) NOT NULL,
    net_pnl NUMERIC(10, 2) NOT NULL,
    commissions NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    r_multiple NUMERIC(6, 2),
    session_tag TEXT NOT NULL, -- 'NY_AM', 'NY_PM', 'ASIA', 'LONDON'
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. EXECUTIONS TABLE (Raw Fill Telemetry)
CREATE TABLE executions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    trade_id UUID NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
    external_fill_id TEXT UNIQUE NOT NULL,
    side TEXT NOT NULL, -- 'BUY', 'SELL'
    quantity INTEGER NOT NULL,
    price NUMERIC(10, 4) NOT NULL,
    fee NUMERIC(8, 2) NOT NULL DEFAULT 0.00,
    filled_at TIMESTAMPTZ NOT NULL
);

-- 5. TRADE CANDLES CACHE TABLE (Permanent Storage)
CREATE TABLE trade_candles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    trade_id UUID NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
    symbol TEXT NOT NULL,
    timeframe TEXT NOT NULL, -- '1m', '5m', '15m', '1h'
    provider TEXT NOT NULL DEFAULT 'yahoo_finance',
    bars JSONB NOT NULL, -- Array of { time, open, high, low, close, volume }
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(trade_id, symbol, timeframe)
);

-- 6. COMPANION CHARTS TABLE
CREATE TABLE trade_companion_charts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    trade_id UUID NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
    kind TEXT NOT NULL, -- 'yahoo_sync', 'uploaded_image'
    symbol TEXT, -- 'NQ=F', '^VIX'
    image_storage_url TEXT,
    relationship_type TEXT NOT NULL, -- 'smt_divergence', 'confirming_push', 'macro_context'
    divergence_annotations JSONB DEFAULT '[]'::jsonb,
    caption TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. SESSION LEVELS TABLE
CREATE TABLE session_levels (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_date DATE NOT NULL,
    symbol TEXT NOT NULL,
    pdh NUMERIC(10, 4) NOT NULL,
    pdl NUMERIC(10, 4) NOT NULL,
    pdc NUMERIC(10, 4) NOT NULL,
    onh NUMERIC(10, 4) NOT NULL,
    onl NUMERIC(10, 4) NOT NULL,
    orb_high NUMERIC(10, 4) NOT NULL,
    orb_low NUMERIC(10, 4) NOT NULL,
    ibh NUMERIC(10, 4),
    ibl NUMERIC(10, 4),
    vwap_settle NUMERIC(10, 4),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(session_date, symbol)
);

-- 8. ECONOMIC EVENTS TABLE
CREATE TABLE economic_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_timestamp TIMESTAMPTZ NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD',
    impact_tier TEXT NOT NULL, -- 'HIGH', 'MEDIUM', 'LOW'
    title TEXT NOT NULL, -- 'CPI m/m', 'FOMC Statement', etc.
    actual_value TEXT,
    forecast_value TEXT,
    previous_value TEXT
);

-- 9. TRADE NOTES TABLE
CREATE TABLE trade_notes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    trade_id UUID UNIQUE NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
    quick_tags TEXT[] NOT NULL DEFAULT '{}',
    voice_memo_storage_url TEXT,
    voice_transcript TEXT,
    pre_trade_thesis TEXT,
    divergence_notes TEXT,
    management_notes TEXT,
    post_exit_notes TEXT,
    checklist_state JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 10. AI REVIEWS TABLE
CREATE TABLE ai_reviews (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    trade_id UUID UNIQUE NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
    model_identifier TEXT NOT NULL,
    evaluation_grade TEXT NOT NULL,
    verdict_headline TEXT NOT NULL,
    chart_snapshot_url TEXT NOT NULL,
    structured_evaluation JSONB NOT NULL,
    playbook_score NUMERIC(5, 2) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 11. USER PREFERENCES TABLE
CREATE TABLE user_preferences (
    user_id UUID PRIMARY KEY,
    gold_preset TEXT NOT NULL DEFAULT 'bullion',
    gold_intensity NUMERIC(3, 2) NOT NULL DEFAULT 0.75,
    position_box_opacity NUMERIC(3, 2) NOT NULL DEFAULT 0.28,
    default_companion_symbols TEXT[] NOT NULL DEFAULT '{"NQ=F"}',
    privacy_shield_default BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## 13. TopstepX Google Cloud Run Listener Architecture

Google Cloud Run hosts the long-lived ingestion listener to eliminate serverless execution timeouts and ensure uninterrupted WebSocket connections.

```
+---------------------------------------------------------------------------------------------------+
|                                 GOOGLE CLOUD RUN LISTENER SERVICE                                 |
|                                                                                                   |
|  1. CONFIGURATION & LIFECYCLE:                                                                    |
|     - Min instances = 1 (Continuous execution, no cold start)                                    |
|     - CPU allocation: Always allocated (`--no-cpu-throttling`)                                    |
|     - Auto-healing keep-alive loop with exponential backoff reconnection                          |
|                                                                                                   |
|  2. CONNECTION PROTOCOL:                                                                          |
|     - Authenticates against TopstepX / ProjectX Gateway REST API to acquire JWT bearer token       |
|     - Establishes persistent SignalR WebSocket connection to execution channel                   |
|                                                                                                   |
|  3. REAL-TIME TRADE SYNTHESIS ENGINE:                                                             |
|     - Tracks position state transitions:                                                          |
|       * Current Net Position = 0 -> Fill Received -> Position Open                                |
|       * In-Position -> Sizing Fills -> Scale-In / Trim Recorded                                   |
|       * Net Position returns to 0 -> Position Closed                                              |
|     - Calculates trade metrics: gross PnL, net PnL, duration, and tick values                     |
|                                                                                                   |
|  4. CONTEXT HARVESTING & PERSISTENCE PIPELINE:                                                    |
|     - Classifies trade archetype (`scalp`, `session_90m`, `investment`)                           |
|     - Fetches and formats Yahoo Finance candlestick windows (`1m`, `5m`, `15m`)                   |
|     - Computes Session Key Levels (`ONH`, `ONL`, `PDH`, `PDL`, `ORB`, `VWAP`)                     |
|     - Writes atomic trade record to Supabase via Service-Role Client                              |
|     - Broadcasts event on Supabase Realtime channel (`trade_closed`)                              |
+---------------------------------------------------------------------------------------------------+
```

---

## 14. Phased Implementation Roadmap

### Phase 1: Vercel Foundation, Design System & Interactive Charts
- Scaffold Next.js application with TypeScript, Tailwind CSS, and mobile PWA manifest.
- Implement the Obsidian palette and dynamic Gold Gradient CSS tokens with live tuning controls.
- Integrate TradingView `lightweight-charts` v4+ and implement the custom `PositionBoxPrimitive` with adjustable opacity.
- Build the `YahooFinanceProvider` adapter with permanent Supabase candlestick caching.
- Build a CSV / manual trade importer to enable end-to-end UI testing prior to live data streaming.

### Phase 2: Intermarket Divergence, Notes & Trade Cards
- Implement bi-directional synchronized companion charts for `NQ=F` SMT divergence analysis.
- Build automated Session Key Levels calculations and chart ray rendering.
- Develop the 10-Second Pit Stop mobile interface, including one-tap playbook pills and voice memo recording.
- Build the expandable Advanced Mode journaling interface with interactive rule checklists.
- Build the One-Click Trade Card component with export support (PNG) and privacy shielding.

### Phase 3: Multimodal AI Review Integration
- Connect the economic calendar integration for ±30m news hazard detection.
- Build the six-stream context aggregation pipeline (`ReviewContextPlugin`).
- Wire the multimodal review API endpoint with chart snapshot generation and vision evaluation.
- Implement strict response validation using the `AITradeReviewSchema` Zod model.

### Phase 4: Google Cloud Run TopstepX Live Listener
- Build and containerize the standalone TopstepX SignalR listener service for Google Cloud Run.
- Implement fill aggregation, trade lifecycle management, and automatic candle caching triggers.
- Enable Supabase Realtime subscriptions in the mobile app for instant trade notifications.

### Phase 5: Advanced Analytics & Platform Scale
- Add support for high-tick market data providers (`DatabentoProvider`).
- Build cross-session performance analytics: win rate by trade archetype, SMT edge statistics, and time-of-day heatmaps.
- Enable Supabase Auth and Row Level Security for multi-user support.

---

## 15. The 7 Non-Negotiable Architectural Invariants

1. **Canvas Primitives Only for Chart Overlays:** Never overlay HTML `<div>` elements over the chart container for position boxes. All trading visualizations must be drawn via `lightweight-charts` `ISeriesPrimitive` implementations to ensure smooth mobile pinch-zoom and complete canvas screenshot capture.
2. **Permanent Intraday Candlestick Caching:** Never query Yahoo Finance dynamically for historical intraday candles. Persist all relevant OHLCV windows in PostgreSQL (`trade_candles`) at the moment of trade creation.
3. **Strict Contract Specification Lookup:** Never hardcode point multipliers or mix micro and standard contracts. Always retrieve values from a centralized `FUTURES_SPECS` mapping (`MES` = `$5/pt`, `ES` = `$50/pt`, `MNQ` = `$2/pt`, `NQ` = `$20/pt`).
4. **Isolate Persistent Sockets from Vercel:** Never initiate persistent SignalR or WebSocket listeners within Vercel serverless functions. Persistent broker connections belong exclusively on Google Cloud Run.
5. **Dynamic CSS Variables for Styling:** Never hardcode gold color hex values or position box alpha values. Reference CSS custom properties (`--gold-gradient`, `--gold-mid`, `--position-box-opacity`) to support dynamic user theme tuning.
6. **Decouple via Adapter Interfaces:** Never import third-party market data libraries or broker SDKs directly into UI components or AI review services. Route all calls through defined adapter contracts.
7. **Consistent Multi-Tenant Schema Design:** Always populate `user_id` on all core database tables, using a default owner UUID during single-user phases to ensure seamless multi-user migration later.
