# 05 — Mobile-First UX & Adjustable Gold Design System

A day-trading journal only works if opening it right after a trade feels **effortless, fast, and rewarding**. **MogMine** pairs an **Obsidian & Liquid Gold** aesthetic with disciplined mobile ergonomics and live visual controls so you can tune both the gold accents and the transparency of chart Position Boxes.

---

## 1. Principles of a Superior Day-Trading Mobile UX

1. **Thumb-Zone Ergonomics:**
   - Primary actions (**Feed**, **Today**, **Playbooks**, **Tune/Settings**) live in a sticky bottom glassmorphic dock reachable one-handed on iPhone/Android.
   - Quick tagging (`Simple Mode`), Voice Memo recording, and the **`Trade Card`** button sit directly below the chart in the natural thumb arc.
2. **Instant Realtime Push Feedback:**
   - When Google Cloud Run writes a newly closed TopstepX trade to Supabase, **Supabase Realtime** triggers an immediate in-app toast banner (*"MES Long Closed • +2.4R • Tap to Tag"*).
3. **Zero-Lag Cached Charts:**
   - Because Yahoo Finance bars are pre-cached in `trade_candles`, swiping between today's trades or revisiting a trade from 6 months ago renders the candlestick chart + **translucent Position Box** in under `100ms`.
4. **Progressive Disclosure (Never Overwhelming):**
   - **Layer 1 (Default Mobile View):** Compact header (`MES • LONG • 90m Trade • +$325`), instant chart with Position Box + toggleable `NQ=F` sync pane, and 10-second Simple Notes.
   - **Layer 2 (Expandable):** AI Grade & structured coaching cards, Key Level proximity pills, Economic News hazard badge, and Advanced Note-Taking checklist.
5. **Swipeable Daily Review Flow:**
   - Swipe left/right between trades within the same session (or filter by `All`, `Scalps`, `90m Trades`, `A+ Setups`, `Needs Review`) without losing context.

### Mobile Screen Flow Wireframe

```text
+-----------------------------------+   +-----------------------------------+
|  TODAY'S SESSION        +$640.00  |   |  <  MES LONG   90m Trade   +2.6R  |
|  3 Trades • 67% WR • PF 3.1       |   |  09:48–10:30 ET          +$325.00 |
+-----------------------------------+   +-----------------------------------+
| [ All ] [ Scalps ] [ 90m ] [ Unrv]|   | [1m] [5m*] [15m] [Ghost] [Fit]    |
+-----------------------------------+   |                                   |
| +-------------------------------+ |   |     [ Interactive Chart (65%) ]   |
| | MES LONG • 90m • Grade A-     | |   |     Translucent Position Box      |
| | [Mini Sparkline + Gold Tag]   | |   |     Hold = X-Ray 5% Box Opacity   |
| | ONL Sweep + NQ SMT     +$325  | |   +-----------------------------------+
| +-------------------------------+ |   | [ Companion NQ=F (35%) | Ghost % ]|
| +-------------------------------+ |   +-----------------------------------+
| | MES SHORT • Scalp • Grade C   | |   | [⚡ Trade Card]  [🎙 Voice Note]  |
| | Chased ORB Break       -$110  | |   +-----------------------------------+
| +-------------------------------+ |   | Simple Tags: [Sweep] [SMT] [A+]   |
+-----------------------------------+   | AI Coach [A-]: Clean ONL sweep... |
| [Feed] [Today] [Playbooks] [Tune] |   | > Expand Advanced Notes & Rules   |
+-----------------------------------+   +-----------------------------------+
```

---

## 2. High-Craft Mobile Chart Gestures & Layout Modes

### A. Chart Touch Gestures & Ergonomics
1. **`[ 🎯 Fit Trade ]` Double-Tap / Floating Pill:**
   - When a trader pinches or scrolls across the session to check overnight structure, a subtle floating **`Fit Trade`** pill appears in the top-right corner of the chart (or triggers via double-tap). One tap smoothly animates and snaps the viewport back to the exact padded trade window (`entry - padding` to `exit + padding`).
2. **"X-Ray Hold" (Press-and-Hold Gesture):**
   - Holding a finger stationary on the chart for `250ms` temporarily drops Position Box and Key Level opacity down to **`5%`** and reveals a clean top-bar **OHLC + VWAP/Level Distance Magnifier** (`O 5948.25  H 5951.00  L 5947.50  C 5950.50  •  +2.25 vs VWAP`).
   - Releasing your finger immediately restores your `--position-box-opacity` slider setting—letting you inspect raw candle wicks underneath the Position Box without ever needing to toggle settings.

### B. Companion Chart Mobile Layout Modes (Solving Vertical Screen Real Estate)
Phone screens (`390×844`) punish equal 50/50 split charts. MogMine gives you three compact ways to view `NQ=F`, `^VIX`, or `DX-Y.NYB` alongside `MES`:
1. **Mode 1 — `65/35` Asymmetric Split *(Default)*:** `MES` takes `65%` of chart height and the companion (`NQ=F`) sits directly below at `35%`, sharing a **single bottom time axis** so zero vertical pixels are wasted on duplicate timestamps.
2. **Mode 2 — Percent-Normalized "Ghost Line" Overlay:** Renders `NQ=F` (or `^VIX`) as a crisp, semi-transparent gold or cyan line directly *inside* the `MES` pane, both normalized to `0.00%` at NY Session Open or exact `entry_time`—making SMT divergence or intermarket pushes unmistakable in a single pane.
3. **Mode 3 — Auto-Detected `⚡ SMT` Timeline Pin:** Places clickable gold divergence markers directly along the time axis whenever the backend detects opposite swing highs/lows between `ES=F` and `NQ=F` within the trade window.

### C. The "10-Second Post-Trade Pit Stop" & Rapid Review Queue
1. **Realtime Slide-Up Sheet:** The moment TopstepX closes a trade, a thumb-zone bottom sheet slides up featuring the auto-classified badge (`Scalp` / `90m Trade`), mini Position Box preview, 1-tap Playbook & Mindset chips, and a **Live Waveform Voice Mic** whose AI parser highlights matching tags (`#Sweep`, `#SMT`, `#EarlyExit`) in real time as you speak.
2. **End-of-Session Swipe Queue:** An optional card-stack view on the **Today** tab lets you swipe through any unreviewed scalps one by one after the bell to finish tagging in under 60 seconds.

---

## 3. Luxury Instrument-Cluster Aesthetics (Avoiding "Casino Gold" Clutter)

A premium trading app should feel like a precision Swiss watch or supercar telemetry cluster—never a noisy slot machine.

1. **Precision Typography System:**
   - **Prose & Headers:** Geometric sans-serif (`Plus Jakarta Sans` or `Inter`) with generous tracking on uppercase micro-labels.
   - **Tabular Financial Monospace:** Strict `JetBrains Mono` or `Geist Mono` with `font-variant-numeric: tabular-nums` on **every price, PnL, tick count, R-multiple, and timestamp**. Digits stay locked to identical character widths so numbers never jitter horizontally while scrubbing a chart crosshair.
2. **`1px` Specular Top-Edge Lighting (Gold Restraint):**
   - Standard cards avoid heavy, full-perimeter yellow borders. Instead, they use a razor-thin `1px` top-edge directional light (`linear-gradient(90deg, transparent, var(--gold-light), transparent)`) that melts into subtle dark carbon hairlines (`rgba(255, 255, 255, 0.08)`) along the sides and bottom.
   - **Full metallic gold gradients** are strictly reserved for **high-signal moments**: `A`/`A+` Process Grade badges, active primary CTAs, and Trade Card verification seals.
3. **Process-Driven Ambient Header Aura:**
   - A soft `120px` radial wash behind the Trade Detail header reflects **Execution Process Grade** rather than just PnL:
     - **Warm Gold Aura:** `A+`/`A` rule adherence—even on a clean `-1R` disciplined stop-out.
     - **Emerald-Gold Aura:** `A+`/`A` execution paired with a winning outcome.
     - **Muted Crimson-Amber Aura:** Rule violations (`FOMO`, `Moved Stop`, `Chased`) regardless of whether the trade got lucky.

---

## 4. Obsidian Surface & Semantic Palette

Bright white dashboards wash out candlestick readability and cause eye fatigue during NY morning sessions. MogMine uses a **Deep Carbon Obsidian** surface stack so green/crimson translucent Position Boxes, price wicks, and gold status accents pop cleanly.

### Surface & Semantic Palette

| Token | Hex | Role |
| :--- | :--- | :--- |
| `--bg-obsidian` | `#07080C` | Primary app canvas behind cards and charts |
| `--bg-surface` | `#0D0F17` | Elevated trade cards and chart container |
| `--bg-elevated` | `#141824` | Bottom sheet, interactive pills, active tabs |
| `--border-subtle` | `rgba(255, 255, 255, 0.08)` | Crisp hairlines separating dark panels |
| `--text-primary` | `#F4F5F7` | Crisp off-white figures and headers |
| `--text-muted` | `#8E95A9` | Timestamps, secondary stats, axis labels |
| `--profit-emerald` | `#10B981` | Profit zone fill & positive PnL |
| `--risk-crimson` | `#EF4444` | Stop/MAE zone fill & drawdown alerts |

---

## 5. User-Adjustable Gold Gradients & Box Opacity

Not every trader wants bright metallic gold everywhere. We expose a **"Visual Tuning"** bottom drawer (persisted in `user_preferences`) powered by CSS custom properties so the entire app—from Trade Card borders to the chart's Position Box transparency—updates live with zero page reload.

### Gold Gradient Presets

| Preset Key | Vibe | Gradient Stops (`135deg`) | Best For |
| :--- | :--- | :--- | :--- |
| **`bullion`** *(Default)* | Rich, classic liquid gold | `#F7DF8E` → `#D4AF37` → `#96731E` | Signature Obsidian & Gold look, Trade Card exports |
| **`champagne`** | Pale, refined warm ivory-gold | `#F5E9C8` → `#DFC99B` → `#AE9665` | Low-glare daytime or subtle luxury aesthetic |
| **`amber`** | Deep burnished copper-amber | `#FBBF24` → `#D97706` → `#92400E` | High-energy highlight contrast on OLED screens |
| **`platinum`** | Cool brushed silver/monochrome | `#F1F5F9` → `#94A3B8` → `#475569` | Minimalist distraction-free review mode |

### Interactive Sliders
1. **Gold Intensity (`--gold-intensity`: `0.0` to `1.0`):** Scales border glow opacity, metallic gradient saturation, and badge brilliance. Set to `0.25` for subtle hints or `1.0` for full bullion accents.
2. **Position Box Opacity (`--position-box-opacity`: `0.15` to `0.65`):** Directly read by the `lightweight-charts` Canvas primitive (`PositionBoxPrimitive`) to control the `rgba` fill alpha of the Profit and Risk/MAE boxes so candles underneath stay sharp at your preferred contrast.

---

## 6. Implementation Blueprint (CSS Variables & Tailwind)

### `globals.css` Dynamic Theme Tokens

```css
:root {
  --bg-obsidian: #07080c;
  --bg-surface: #0d0f17;
  --bg-elevated: #141824;

  /* Adjustable User Controls */
  --gold-intensity: 0.75;
  --position-box-opacity: 0.28;

  /* Default Preset: Classic Bullion */
  --gold-light: #f7df8e;
  --gold-mid: #d4af37;
  --gold-deep: #96731e;
  --gold-glow: rgba(212, 175, 55, calc(0.28 * var(--gold-intensity)));
  --gold-gradient: linear-gradient(
    135deg,
    var(--gold-light) 0%,
    var(--gold-mid) 50%,
    var(--gold-deep) 100%
  );
}

[data-gold-preset="champagne"] {
  --gold-light: #f5e9c8;
  --gold-mid: #dfc99b;
  --gold-deep: #ae9665;
  --gold-glow: rgba(223, 201, 155, calc(0.24 * var(--gold-intensity)));
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
  --gold-glow: rgba(148, 163, 184, calc(0.20 * var(--gold-intensity)));
}

/* Specular 1px Top-Edge Lighting for Standard Cards (avoids heavy yellow boxes) */
.specular-card {
  position: relative;
  background: var(--bg-surface);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.specular-card::before {
  content: "";
  position: absolute;
  inset: 0 12px auto 12px;
  height: 1px;
  background: linear-gradient(
    90deg,
    transparent,
    color-mix(in srgb, var(--gold-light) calc(var(--gold-intensity) * 85%), transparent),
    transparent
  );
  pointer-events: none;
}

/* Signature Gold-Border Card Utility for A/A+ Seals & Active Trade Cards */
.gold-card-ring {
  position: relative;
  background: var(--bg-surface);
  border: 1px solid color-mix(
    in srgb,
    var(--gold-mid) calc(var(--gold-intensity) * 45%),
    rgba(255, 255, 255, 0.08)
  );
  box-shadow: 0 8px 30px -12px var(--gold-glow);
}

.tabular-price {
  font-family: var(--font-mono, "JetBrains Mono", ui-monospace, monospace);
  font-variant-numeric: tabular-nums;
}

.gold-gradient-text {
  background: var(--gold-gradient);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
```

### Reading `--position-box-opacity` Inside the Chart Canvas Primitive

```typescript
export function getPositionBoxColors(isWinner: boolean) {
  const styles = getComputedStyle(document.documentElement);
  const alpha = parseFloat(styles.getPropertyValue('--position-box-opacity')) || 0.28;
  const goldMid = styles.getPropertyValue('--gold-mid').trim() || '#D4AF37';

  return {
    profitFill: isWinner
      ? `rgba(16, 185, 129, ${alpha})`
      : `rgba(16, 185, 129, ${Math.max(0.12, alpha * 0.7)})`,
    riskFill: `rgba(239, 68, 68, ${alpha})`,
    accentBorder: goldMid,
  };
}
```
