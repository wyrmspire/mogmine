# 02 — Charting, Translucent Position Boxes & Divergence System

For a day trader reviewing executions on a phone, the **chart is the product**. You should open a trade and *instantly see* where you entered, how much heat you took, where you exited, what key session levels were in play, and whether correlated indices like `NQ` confirmed or diverged from `MES`.

---

## 1. Charting Engine Choice: `lightweight-charts` v4+ vs. Alternatives

| Criterion | TradingView `lightweight-charts` (v4+) + Custom Canvas Primitives | Raw React HTML5 `<canvas>` from Scratch | TradingView Advanced Charting Library (Heavy Widget) |
| :--- | :--- | :--- | :--- |
| **Mobile Touch & Pinch-Zoom** | Native 60fps kinetic scrolling, pinch-zoom, and crosshair scrubbing out of the box. | Must build gesture physics, inertial scrolling, and price-scale math manually (months of effort). | Good, but heavy iframe/bundle and harder to style seamlessly with custom obsidian/gold UI. |
| **Bundle & Load Speed** | ~40 KB gzipped; renders instantly on mobile cellular. | Smallest, but high maintenance cost. | Several MBs; requires custom datafeed server protocol. |
| **Custom Position Boxes** | **Series Primitives API (`ISeriesPrimitive`)** exposes direct `<canvas>` 2D drawing hooked to exact `(time, price)` coordinates. | Full canvas control, but no built-in candlestick/time-scale engine. | Built-in position tool, but limited programmatic styling and hard to sync with app theme sliders. |
| **Export to PNG Snapshot** | Built-in `chart.takeScreenshot()` returns a clean HTMLCanvasElement including custom primitives! | Possible, requires custom render loop. | Restricted/cumbersome inside iframe. |

**Decision:** Use **TradingView `lightweight-charts` (v4+)** paired with custom TypeScript **Canvas Series Primitives** (`PositionBoxPrimitive`, `SessionLevelsPrimitive`, `DivergenceLinePrimitive`).

---

## 2. Opaque / Translucent Position Boxes Specification

Every trade automatically renders a TradingView-style **Position Box** directly over the candlesticks using a custom `ISeriesPrimitive` plugin attached to the candlestick series.

### Visual Anatomy of a Trade Box
1. **Profit / Target Zone (Upper Box for Long, Lower Box for Short):**
   - **Time Span:** `entry_time` → `exit_time` (plus an optional `2–4 bar` right padding option so the box never looks cramped on quick scalps).
   - **Price Span:** `entry_price` → `exit_price` (or `planned_target_price` if logged, with a thin solid line marking actual `exit_price`).
   - **Fill Style:** Translucent emerald/gold gradient (`rgba(16, 185, 129, alpha)` or gold-tinted on `A+` trades), controlled dynamically by the user's **Position Box Opacity Slider** (`15%` to `65%`).
2. **Risk / Stop / MAE Zone (Lower Box for Long, Upper Box for Short):**
   - **Time Span:** Matches the trade duration (`entry_time` → `exit_time`).
   - **Price Span:** `entry_price` → `stop_loss_price` (if a hard stop was logged) **OR** `entry_price` → `mae_price` (Maximum Adverse Excursion observed in the 1m candles during the hold). If `stop_loss_price` exists, `MAE` is drawn as a subtle dashed inner watermark so you see how close price came to your stop.
   - **Fill Style:** Translucent crimson (`rgba(239, 68, 68, alpha)`), sharing the adjustable opacity slider so candles behind the box remain legible.
3. **Execution Path & Fill Markers:**
   - **Diagonal Connector:** Dashed crisp line connecting `(entry_time, entry_price)` to `(exit_time, exit_price)`.
   - **Multi-Fill Markers:** Small directional triangles for every scale-in and scale-out execution from TopstepX, with an unobtrusive floating pill showing `+2.4R • +$312.50`.
4. **Living Position Box Anatomy (Excursion & Post-Exit Insights):**
   - **MAE & MFE Inner Watermarks:** Inside the Risk Box, a darker inner shade marks the actual **MAE (Heat Taken)** relative to the full hard Stop Loss; inside the Profit Box, a subtle tick line marks the **MFE Peak** so you immediately see how much heat you absorbed and how much open profit existed before exit.
   - **Post-Exit "Ghost Box" Toggle (`[ 👻 +15m Ghost ]`):** Extends a faint, dotted projection of your Entry, Stop, and Target levels `15–30 bars` past `exit_time`. One tap shows whether exiting early saved you from a reversal or left `+2R` on the table.

---

## 3. Automatic Trade Classification (`Scalp` vs. `90-Min` vs. `Investment`)

When a trade closes (or is imported), the classifier inspects `hold_duration_seconds = exit_time - entry_time` and session boundaries to configure both the **default chart view** and the **AI coaching lens**:

| Classification | Hold Duration Rule | Default Chart Timeframe | Default Context Window | What the Chart & AI Focus On |
| :--- | :--- | :--- | :--- | :--- |
| **`scalp`** | `< 15 minutes` | `1m` candles | `35 bars` before entry → `20 bars` after exit | Micro-structure, candle wicks, entry chasing, slippage, immediate reaction off `VWAP`/`ONH`/`ONL`. |
| **`session_90m`** | `15 minutes` to `2 hours` (or single intraday macro window) | `5m` candles (toggleable to `1m` / `15m`) | Full active session open (e.g., 1.5h before entry → 30m after exit) | Session structure, Opening Range (`ORB`), Initial Balance (`IB`), patience through pullbacks, target management. |
| **`investment`** (Swing / Extended) | `> 2 hours` / held across multiple sessions | `1h` or `1d` candles (toggleable to `15m`) | `5–20 sessions` prior → post-exit follow-through | Higher-timeframe trend alignment, multi-day levels (`PDH/PDL`, weekly highs/lows), macro catalyst thesis. |

*Note:* The trader can always override the classification manually on a trade if a trade intended as a `90-Min Trade` got stopped out in 4 minutes, or a scalp turned into a runner.

---

## 4. Yahoo Finance Data Mapping & Permanent Caching

### Primary & Intermarket Ticker Mapping
Because **TopstepX** trades futures symbols like `MES` or `MNQ`, the `YahooFinanceProvider` maps internal futures contracts to Yahoo Finance continuous futures and macro tickers:

| TopstepX Contract | Yahoo Finance Ticker | Role |
| :--- | :--- | :--- |
| **`MES` / `ES`** | `ES=F` | **Primary Instrument (Default)** |
| `MNQ` / `NQ` | `NQ=F` | Common Companion (SMT Divergence / Tech Lead) |
| `MYM` / `YM` | `YM=F` | Companion (Dow Divergence) |
| `M2K` / `RTY` | `RTY=F` | Companion (Small-Cap Breadth) |
| `MGC` / `GC` | `GC=F` | Gold Futures |
| `MCL` / `CL` | `CL=F` | Crude Oil Futures |
| Volatility Gauge | `^VIX` | Macro Companion (Volatility Inversion Check) |
| Dollar Index | `DX-Y.NYB` | Macro Companion (DXY Push / Headwind) |

> [!WARNING]
> **Critical Yahoo Finance Constraint & Caching Solution:**  
> Yahoo Finance only retains `1m` intraday bars for the trailing **7 to 30 days** (and `5m` bars for ~60 days). If we fetched charts on-demand when opening old reviews, every chart older than a month would fail to load.  
> **Rule:** As soon as a trade is logged, the backend fetches `1m`, `5m`, and `15m` (plus `1h` for swings) candle windows around the trade for both the primary ticker (`ES=F`) and default companion (`NQ=F`), and **persists them permanently** in Supabase's `trade_candles` table.

---

## 5. Companion Charts: Demonstrating SMT Divergence & Pushes

Futures traders—especially `MES` traders—rarely look at S&P 500 price action in isolation. Seeing **`NQ` make a lower low while `ES` holds a higher low (SMT Divergence)**, or watching `NQ` lead an aggressive push through a level, is often the entire reason a trade was taken.

MogMine supports **two ways** to attach other charts to any trade:

### Mode A: Time-Synced Interactive Companion Chart (Yahoo Finance)
- Tap **`+ Add Companion Chart`** and pick `NQ=F`, `YM=F`, `RTY=F`, `^VIX`, or `DX-Y.NYB` (defaults to `NQ=F` for `MES` trades).
- **3 Mobile-Friendly Companion Display Modes:**
  1. **`65/35` Asymmetric Split *(Default)*:** Primary `MES` chart gets `65%` height and `NQ=F` sits directly underneath at `35%`, sharing one synchronized bottom time axis to preserve vertical mobile space.
  2. **Percent-Normalized "Ghost Line" Overlay:** Overlays `NQ=F` (or `^VIX`) as a semi-transparent gold/cyan line directly inside the `MES` pane, normalized to `0.00%` at Session Open or `entry_time` so SMT divergence or correlated pushes stand out immediately on a single chart.
  3. **Auto-Detected `⚡ SMT` Timeline Pin:** Highlights swing highs/lows where `ES=F` and `NQ=F` diverge inside the trade window directly along the time axis.
- **Crosshair & Time Lock:** Scrolling or scrubbing your finger across `MES` moves the vertical crosshair at the exact same timestamp on `NQ=F`.
- **Entry/Exit Vertical Band:** Draws a subtle translucent vertical highlight across the companion chart spanning `entry_time` to `exit_time` so you immediately see what `NQ` was doing while you were in `MES`.
- **2-Point Divergence / Push Line Tool:** A simple mobile-friendly tap-two-points overlay lets you draw a line across two swing highs/lows on `MES` and two corresponding swings on `NQ` (labeled automatically as `SMT Divergence` or `Confirming Push`).

### Mode B: Uploaded / Pasted External Chart Snapshot
- For context Yahoo Finance cannot show (e.g., Footprint / Orderflow Delta, Bookmap liquidity, TradingView Weekly/4H markups), paste or upload an image from your phone's photo library.
- Attached to the trade's Companion Gallery with an optional tag (`HTF Structure`, `Orderflow / Footprint`, `SMT Proof`) and caption, and passed straight to Vision AI during review.

---

## 6. Automated Session Key Levels

Every `MES` chart calculates and optionally toggles clean, subtle horizontal price rays with right-axis pill labels:

| Level | Definition | Visual Style |
| :--- | :--- | :--- |
| **`PDH` / `PDL` / `PDC`** | Previous Regular Trading Hours (09:30–16:00 ET) High, Low, and Close | Dashed Slate/Silver lines |
| **`ONH` / `ONL`** | Overnight / Globex Session (18:00–09:30 ET) High and Low | Dotted Subtle Gold lines |
| **`ORB High / Low`** | Opening Range (first `5m` or `15m` after 09:30 ET open) | Soft Amber bracket / rays |
| **`IBH` / `IBL`** | Initial Balance (09:30–10:30 ET High and Low) | Thin Muted Cyan lines |
| **`VWAP`** | Session Volume-Weighted Average Price (computed from `1m` cached candles) | Smooth Gold-White curve |

Because all level pills can be toggled on or off in one tap, the chart never feels cluttered on a small mobile screen.
