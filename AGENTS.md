# AGENTS.md — AI Coding Agent & Subagent Guide for MogMine

> **Read this file FIRST before planning, scaffolding, or editing any code in `c:\mogmine`.**  
> This guide protects smaller/faster models and specialized subagents from common charting, market-data, futures-math, and architecture pitfalls.

---

## 1. Quick Project Context

**MogMine** is a **mobile-first AI Trade Review & Performance Platform** built for futures day traders (starting with **`MES`** on **TopstepX**).
- **Frontend / API Hosting:** Next.js (App Router, TypeScript, Tailwind CSS, PWA) on **Vercel**.
- **Database / Realtime / Storage:** **Supabase** (PostgreSQL + Realtime push to mobile + Storage for chart snapshots & Trade Cards). Starts **single-user**, structured for multi-user expansion.
- **Broker Listener:** Standalone Node.js/TypeScript service on **Google Cloud Run** listening to the **TopstepX (ProjectX Gateway)** SignalR/WebSocket feed.
- **Market Data (Initial):** **Yahoo Finance** (`ES=F`, `NQ=F`, `^VIX`, `DX-Y.NYB`) via `MarketDataProvider` adapter, permanently cached in Postgres.
- **Charts:** TradingView **`lightweight-charts` v4+** with custom HTML5 Canvas **`ISeriesPrimitive`** plugins for translucent Position Boxes and synced Companion Divergence charts.

---

## 2. Fast Documentation Routing Table

Do not guess requirements or invent schemas. Read the matching spec doc before implementing a task:

| If You Are Working On... | Read First |
| :--- | :--- |
| Stack decisions, Adapter interfaces (`MarketDataProvider`, `TradeIngestionAdapter`, `ReviewContextPlugin`), or Cloud Run ↔ Vercel boundaries | [01 — Architecture & Stack](file:///c:/mogmine/docs/01-architecture-and-stack.md) |
| Candlestick charts, translucent Position Boxes, Scalp/90m/Investment logic, Yahoo ticker mapping, `NQ=F` companion divergence, or Session Levels | [02 — Charting, Position Boxes & Divergence](file:///c:/mogmine/docs/02-charting-position-boxes-and-divergence.md) |
| One-Click Quality Trade Cards, PNG export, Simple `<10s` tagging + Voice Memo, or Advanced Note-Taking | [03 — Trade Cards & Note-Taking](file:///c:/mogmine/docs/03-trade-cards-and-note-taking.md) |
| AI Trade Review prompts, 6-input context pipeline, Vision AI snapshot evaluation, or `AITradeReviewOutput` Zod schema | [04 — Multimodal AI Review Engine](file:///c:/mogmine/docs/04-ai-review-engine.md) |
| Mobile layout (`390x844`), bottom dock, Obsidian palette, Gold Gradient presets, or Position Box Opacity slider | [05 — Mobile UX & Gold Design System](file:///c:/mogmine/docs/05-mobile-ux-and-gold-design-system.md) |
| Supabase Postgres tables, columns, enums, ER relationships, or build phase scope | [06 — Data Model & Roadmap](file:///c:/mogmine/docs/06-data-model-and-roadmap.md) |
| Copy-paste code recipes ("Wrong vs. Right"), futures point-value math, chart sync loop guards, and subagent task slicing | [07 — Agent Guardrails & Smart Notes](file:///c:/mogmine/docs/07-agent-guardrails-and-smart-notes.md) |

---

## 3. Seven Non-Negotiable Architectural Invariants ("DO NOT BREAK")

1. **NEVER Overlay HTML `<div>`s for Chart Position Boxes**
   - Do **not** draw profit/stop boxes using CSS-positioned `<div>` elements over the chart container—they lag, drift on mobile pinch-zoom, and are excluded from `chart.takeScreenshot()`.
   - **MUST** implement `PositionBoxPrimitive` using `lightweight-charts` v4+ `ISeriesPrimitive` Canvas 2D API (`timeToCoordinate` / `priceToCoordinate`).

2. **NEVER Fetch Yahoo Finance `1m` Candles Only On-the-Fly**
   - Yahoo Finance deletes or stops serving `1m` intraday bars older than **7–30 days** (`5m` after ~60 days).
   - **MUST** persist OHLCV candle windows (`1m`, `5m`, `15m`) into Supabase `trade_candles` when a trade is logged, and always read from `trade_candles` first.

3. **ALWAYS Map Micro Futures Tickers Properly**
   - Yahoo Finance does **not** return reliable data for `"MES"` or `"MNQ"`.
   - **MUST** map `MES`/`ES` → `ES=F`, `MNQ`/`NQ` → `NQ=F`, `MYM`/`YM` → `YM=F`, `M2K`/`RTY` → `RTY=F` for candles, while keeping the contract's true point-value multiplier (`MES` = `$5/pt`, `ES` = `$50/pt`, `MNQ` = `$2/pt`) in trade PnL math.

4. **NEVER Put Persistent WebSockets or SignalR Listeners in Vercel**
   - Vercel serverless/edge functions are stateless and time out.
   - **MUST** keep all persistent TopstepX SignalR/WebSocket connections strictly inside the **Google Cloud Run** listener service. Vercel handles UI rendering, stateless API routes, manual/CSV imports, and AI reviews.

5. **NEVER Hardcode Gold Hex Colors or Position Box Alpha**
   - Users can switch gold presets (`bullion`, `champagne`, `amber`, `platinum`) and drag **Gold Intensity** and **Position Box Opacity** sliders live.
   - **MUST** reference `--gold-gradient`, `--gold-mid`, `--gold-intensity`, and `--position-box-opacity` CSS variables (and read them dynamically in Canvas primitives).

6. **NEVER Bypass the Adapter Interfaces**
   - UI components and AI review code must **never** import `yahoo-finance2` or raw TopstepX types directly.
   - **MUST** route calls through `MarketDataProvider`, `TradeIngestionAdapter`, and `ReviewContextPlugin` so future swaps (e.g., Databento, TopstepX native bars, new context feeds) require zero UI rewrites.

7. **ALWAYS Include `user_id` on Core Database Queries & Inserts**
   - Even during single-user Phases 1–4, **MUST** populate `user_id` (using a `DEFAULT_OWNER_USER_ID` constant/env var) on `accounts`, `trades`, `playbooks`, and `user_preferences` so turning on Supabase Auth + RLS later requires zero schema migrations.

---

## 4. Mobile-First Verification Checklist

Before marking any UI or chart task complete, verify against a mobile viewport (**`390×844`**, iPhone 14/15/16 class):
- [ ] **Zero horizontal page overflow** (`scrollWidth <= clientWidth`). Touch panning inside the chart must not scroll the outer page horizontally.
- [ ] **Thumb-zone primary controls:** Main nav, Simple Mode tags, Voice Memo, and the **Trade Card** button sit comfortably in the lower half of the screen with `>= 44px` tap targets.
- [ ] **Dark Obsidian contrast:** Candlesticks, key level labels, and translucent Position Boxes stay legible over `#07080C` / `#0D0F17` surfaces across `0.15` to `0.65` box opacity.
- [ ] **Visual Tuning sliders verified:** Changing `--gold-intensity` and `--position-box-opacity` updates cards and chart Canvas boxes smoothly without losing zoom state.
- [ ] **Tabular monospace financials:** All prices, PnL, ticks, R-multiples, and timestamps enforce `tabular-nums` monospace typography (`font-variant-numeric: tabular-nums`) so digits never jitter while scrubbing charts.
- [ ] **Specular `1px` gold lighting restraint:** Standard cards use subtle `1px` top-edge gold highlight fading into dark carbon hairlines—never heavy full-perimeter yellow borders.
