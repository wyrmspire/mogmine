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

### Visual Anatomy of a Trade Box (as built on `main`)

This is what `components/PositionBoxPrimitive.ts` draws today. It is fills only: no outline or frame on any box, no P&L pill and no price-axis tags. The layers are painted under the candles, so candles stay crisp at any opacity.

1. **PLAN (faint):** a faint red fill from entry to the planned stop, and a faint green fill from entry to the planned target. Both are drawn at `0.28` of the box opacity, so they stay clearly weaker than the actual band. A missing stop or target draws no fill on that side.
2. **ACTUAL:** one stronger fill from the entry fill to the exit fill, in the result colour: green for a win, red for a loss, gray for a scratch (at least 2 px tall, so a flat exit is still visible). Fill opacity follows the **Position Box Opacity** slider (`15%` to `65%`).
3. **PATH and flags:** a thin dotted line from the entry fill to the exit fill, with a flag at each fill price (entry neutral, exit in the result colour). An approximate alignment (issue #64) gets a finer, fainter dash and a `≈` mark.
4. **KEY level (optional):** a faint dotted line across the pane with a small low-contrast `KEY` pill at the right edge.
5. **OBSERVATIONS:** a dotted flag at the observed bar and price, with an `≈` label for inferred evidence. The Data notes chip below the chart gives each flag's time and price as text.

Since `TD-3` the primitive paints the `Mark[]` display list from `buildMarks` ([15 — Trade Document & Render Grammar](15-trade-document-and-render-grammar.md) §2–3), which adds a stepped stop path, the MFE / MAE bracket with point labels, `PAST STOP` and locked-profit hatches, exit-reason flags and dotted hindsight continuation. Fills are flags on the box, not lightweight-charts series markers, and carry no text. The archived style for neighbouring trades is not built yet (issue #40). The owner decisions of 2026-11-15 are in doc 15 §1.

The price autoscale always includes the planned target, planned stop and actual exit in addition to the visible candles. The primitive exposes those bounds and the candlestick series merges them into its own autoscale range; **Fit** restores price autoscale as well as the duration-derived time window. A missing planned target is labelled “No target set” and does not invent a profit zone.

---

## 3. Duration-derived chart window

The fitted chart view comes directly from `hold_duration_seconds = exit_time - entry_time`; it never comes from a duration category. The base span is twice the hold: 30% of the view before entry, 50% in the trade and 20% after exit. A 90-minute hold therefore fits into roughly three hours of price action, while a five-minute hold gets a tight view. The rule is continuous, with no session-length label or bucket in the interface.

The fitted view never contains fewer than 45 bars on the selected timeframe (raised from 30 by the owner on 2026-11-15). When that floor widens a very short hold, the added context keeps the same before/after bias. The initial timeframe comes from duration: `1m` through 40 minutes, `5m` through 3 hours, `15m` through 10 hours, then `1h`. Switching timeframe recomputes the bar-based window, so a `15m` view shows materially more clock-time context than `1m` instead of preserving the same minutes.

The stored `trade_style` field and `classifyTrade` remain for data compatibility while the later AI coaching lens is decided; neither controls the chart window or initial timeframe.

Samples are historical market-based scenarios, not broker-confirmed fills. They follow the same market-data rule as real trades: cached or fetched Yahoo bars, with a planned target so both zones can be reviewed. Their entry comes from the real entry bar; stop, target and exit are derived from real bar extrema. The sample exits at the first bar that touches either planned level, so MAE never passes its stop and MFE never passes its target. A bar touching a level shows that the price traded there; it does not prove a particular order would have filled. The UI labels them as a scenario, not as executed trades. Synthetic sample candles are forbidden; when market bars are unavailable, no chart is rendered.

Trade Detail checks the displayed candles against the derived trade. Completed bars are checked against active stop segments and unfilled targets, and each fill is checked against its own bar with the instrument's tick tolerance. OHLC evidence establishes that a bar reached a level and leaves the order of events within that bar unresolved. Trade Detail reports those observations without rewriting the trade.

---

## 4. Yahoo Finance Data Mapping & Permanent Caching

### Primary & Intermarket Ticker Mapping
Because **TopstepX** trades futures symbols like `MES` or `MNQ`, the `YahooFinanceProvider` maps internal futures contracts to Yahoo Finance continuous futures and macro tickers:

| TopstepX Contract | Yahoo Finance Ticker | Role |
| :--- | :--- | :--- |
| **`MES`** | `MES=F` | **Primary Instrument (Default, `OD-15`)** |
| **`ES`** | `ES=F` | E-mini S&P 500 |
| **`MNQ`** | `MNQ=F` | Micro Nasdaq-100 (`OD-15`) |
| `NQ` | `NQ=F` | Common Companion (SMT Divergence / Tech Lead) |
| `MYM` / `YM` | `YM=F` | Companion (Dow Divergence) |
| `M2K` / `RTY` | `RTY=F` | Companion (Small-Cap Breadth) |
| `MGC` / `GC` | `GC=F` | Gold Futures |
| `MCL` / `CL` | `CL=F` | Crude Oil Futures |
| Volatility Gauge | `^VIX` | Macro Companion (Volatility Inversion Check) |
| Dollar Index | `DX-Y.NYB` | Macro Companion (DXY Push / Headwind) |

> [!WARNING]
> **Critical Yahoo Finance Constraint & Caching Solution:**  
> Yahoo Finance only retains `1m` intraday bars for the trailing **7 to 30 days** (and `5m` bars for ~60 days). If we fetched charts on-demand when opening old reviews, every chart older than a month would fail to load.  
> **Rule:** As soon as a trade is logged, the backend fetches `1m`, `5m`, and `15m` (plus `1h` for swings) candle windows around the trade for both the primary ticker (`MES=F` for `MES`) and default companion (`NQ=F`), and **persists them permanently** in Supabase's `trade_candles` table.

> [!WARNING]
> **Additions from the 2026-11-14 review** ([09 — Backend Risk Register](09-backend-risk-register.md) §2):
> - **The post-exit window does not exist when the trade closes.** Fetch what exists, then top up with a durable job (B-10).
> - **Yahoo limits, measured 2026-11-14:** `1m` goes back 30 days at no more than 8 days per request. `5m`, `15m` and `30m` go back 60 days. `1h` goes back 730 days. Archive every session daily so nothing expires ([10 — Yahoo-First Build Plan](10-yahoo-first-build-plan.md) §2–3, B-11).
> - **Continuous tickers are not the exact dated contract.** In roll weeks the boxes can be offset from the candles. Store the broker contract id and check that fills sit inside their bars (B-12).
> - **Chart `MES` on `MES=F` and `MNQ` on `MNQ=F` (`OD-15` decided 2026-11-14).** No `ES=F` or `NQ=F` fallback. Levels are computed from and drawn on the same instrument as the chart.
> - **Fill times must be snapped to bar times** before `timeToCoordinate()`, or the Position Box disappears (B-23). A fill with no bar within tolerance (OD-28) gets no box rather than a box on a bar days away (issue #51).
> - **Levels must be point-in-time.** An opening range that had not formed at entry must not be shown or sent to the AI as if it had (B-14).

---

## 5. Companion Charts: Demonstrating SMT Divergence & Pushes

Futures traders—especially `MES` traders—rarely look at S&P 500 price action in isolation. Seeing **`NQ` make a lower low while `ES` holds a higher low (SMT Divergence)**, or watching `NQ` lead an aggressive push through a level, is often the entire reason a trade was taken.

MogMine supports **two ways** to attach other charts to any trade:

> [!NOTE]
> `lightweight-charts` v5 supports panes natively: `chart.addSeries(LineSeries, options, 1)` places the companion in a second pane on one shared time axis. That gives the 65/35 split with one chart, one screenshot and no sync loop. Build that mode first. See [08 — UX Notes](08-ux-notes-viewing-and-journaling.md) UX-27 and §15, and `OD-6` in [DECISIONS.md](../DECISIONS.md).

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

Collision handling and nearest-level defaults follow UX-21 in [08 §5](08-ux-notes-viewing-and-journaling.md#5-trade-detail-layout); toggles alone do not solve clutter. VWAP is a curve, while the other levels above are horizontal rays. Each begins only when its inputs were available (B-14).

## 7. Proposed annotations, indicator presets and view controls

[11 — Mobile Workflows, Chart Context & Assistant API](11-product-workflows-and-api-context.md) specifies the proposed additions: comments anchored to fills/candles/levels/zones (§3), independent detail and full-chart controls (§2), and code-computed indicator values with explicit definitions and coverage (§4). Session/weekly VWAP, 200 EMA and bands remain configuration proposals, not new defaults. Do not silently resolve the VWAP anchor conflict or invent a meaning for “BE” (`OD-18`). AI supplies structured content; Canvas primitives and app-owned panels determine presentation (`OD-17`, `OD-19`).

> [!NOTE]
> The owner's daily markup (pivots, ADR Pivots bands, weekly and 4h levels, zones, role colours, right-edge labels) is proposed in [12 — Levels, Zones & the Daily Markup](12-levels-zones-and-daily-markup.md). It defines `PDH` / `PDL` over the Globex session with settlement as `PDC` (`OD-21`) and styles by role, not type (`OD-22`).
