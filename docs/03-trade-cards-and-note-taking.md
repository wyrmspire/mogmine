# 03 — One-Click Quality Trade Cards & Dual-Speed Note-Taking

Speed during the trading session and depth after the market closes require completely different interfaces. This document defines the **One-Click Quality Trade Card** and the **Simple vs. Advanced Note-Taking** workflows.

---

## 1. One-Click "Quality Trade Card"

From any trade view, tapping the **`Trade Card`** button generates a high-craft, self-contained summary card designed to look sharp on a mobile screen and export cleanly as a PNG for personal archives, Discord study groups, or X/Twitter.

> [!NOTE]
> The Trade Card refresh, the shared card frame, and new card types (drill, playbook, day, plan, mistake) are in [23 — Card System](23-card-system.md) (`OD-46`).

### Card Visual Anatomy

```text
+---------------------------------------------------------------+
|  MES  [LONG]  •  90-Min Session Trade (42m 10s)    +2.6R      |
|  NY AM Session  •  Nov 14, 2026  •  09:48–10:30 ET  +$325.00  |
+---------------------------------------------------------------+
|  [ Chart Canvas Snapshot: 5m ES=F ]                           |
|   - Candlestick price action (pre-entry -> post-exit)         |
|   - Reward price-edge fill (--zone-reward) + risk fill (--zone-risk)|
|   - Dashed Execution Path + Key Levels (ONL, VWAP, ORB)       |
|   - Companion Badge: [⚡ SMT Divergence vs NQ=F @ 09:45]      |
+---------------------------------------------------------------+
|  PLAYBOOK: NY Open Liquidity Sweep + SMT                      |
|  Rules Followed: [✓] 4/4   Tags: #Sweep #NQ-Lead #Scaled      |
|  Thesis: "MES swept ONL while NQ held higher low; pushed      |
|           through VWAP on volume and scaled at PDH."          |
+---------------------------------------------------------------+
|  [A]  AI VERDICT (Gold Gradient Badge)                        |
|  ✓ Clean patience waiting for the 09:45 NQ divergence close.  |
|  ! Next time leave 1 runner for 10:30 IB extension (+1.2R).   |
+---------------------------------------------------------------+
```

> [!WARNING]
> **Export rules from the 2026-11-14 review** ([08 — UX Notes](08-ux-notes-viewing-and-journaling.md) §11):
> - Build the image **before** the Share tap. The share sheet must open directly from the tap or the browser may refuse it (UX-70).
> - Privacy mode must re-render the chart. The chart itself draws a dollar pill, so hiding a text row is not enough (UX-71).
> - Upload files straight to Storage, never through a Vercel route. Bodies are capped at 4.5 MB ([09](09-backend-risk-register.md) B-50).
> - Call `takeScreenshot(true)` so primitives are included (B-61).

### How the Card Is Built & Exported
1. **Live Interactive Preview:** A dedicated React component styled with the active **Obsidian + Gold Gradient** theme tokens and tabular monospace pricing (`tabular-nums`).
2. **Chart + Overlay Merge:** Calls `lightweight-charts`'s `takeScreenshot(true)` to include the custom Canvas **translucent Position Boxes** and key levels, then embeds that bitmap inside the card layout. If a time-synced companion chart (`NQ=F`) is attached, the user can toggle **Single Chart** or **Dual Stacked Chart** layout on the card. Proposed anchored comments and saved-view export behavior are in [11 §3](11-product-workflows-and-api-context.md#3-notes-attach-to-market-objects); comment-sheet text needs deliberate card composition.
3. **"Collector's Grade" Card Controls:**
   - **Privacy / Prop Shield Toggle (`$ Dollars` ↔ `R-Multiple & Points`):** One tap strips dollar PnL and account identifiers from the card, displaying pure skill telemetry (`+2.6R • +13.00 pts • 52 ticks`) so you can safely share cards in Discord study groups or on X/Twitter.
   - **Aspect Ratio Switcher:** Export cleanly in **`9:16` Mobile Story**, **`16:9` Landscape**, or **`1:1` Square** layouts without clipping the chart or AI verdict.
   - **Dual "Process Grade + Outcome" Seal:** Pairs the metallic gold **Process Grade & Rule Adherence seal** (`Grade A • 4/4 Rules`) directly alongside the R-multiple so disciplined `-1R` stop-outs are visually respected alongside big winners.
4. **One-Click PNG Export & Storage:**
   - Captures the card DOM + canvas at `2x` Retina resolution (`html-to-image` or server-side Satori render) for instant download/iOS Share Sheet.
   - Uploads the chosen card to private **Supabase Storage**, retaining a bucket path. The Vision AI snapshot is a separate standardized render (UX-73), not automatically the user-composed card.

---

## 2. Simple vs. Advanced Note-Taking

If journaling takes 5 minutes per trade during a volatile morning session, traders stop doing it. MogMine separates **In-Session Capture (Simple Mode)** from **Post-Market Review (Advanced Mode)**.

> [!NOTE]
> The rules that make this hold up in practice are in [08 — UX Notes §7](08-ux-notes-viewing-and-journaling.md#7-notes-and-journaling): no Save button, local-first saving, AI tags offered as suggestions that never overwrite the trader's choices, a no-permission fallback for voice, one-tap risk entry when no stop was recorded, and a review status for every trade.

### A. Simple Mode (Mobile / In-Session — Target: Under 10 Seconds)
Designed for one-handed thumb use right after closing a trade:
- **1-Tap Playbook Selector:** Horizontal scrollable gold-accented pills for your active playbooks (*ORB Reclaim*, *ONL Sweep + SMT*, *VWAP Trend Push*, *No-Setup / Impulse*).
- **1-Tap Reason & Execution Chips:** Multi-select quick tags split into two clear rows:
  - *Setup Drivers:* `SMT Divergence`, `Pushed w/ NQ`, `Level Sweep`, `VWAP Hold`, `Opening Drive`
  - *Execution / Mindset:* `A+ Patience`, `Chased Entry`, `Cut Early`, `Moved Stop`, `Revenge`
- **1-Tap Companion Attach:** Quick button (`+ Attach NQ=F Sync`) automatically pairs the `NQ=F` window around that trade so you remember *why* you saw divergence without typing a paragraph.
- **Voice-to-Structured-Note Button:**
  - Press and hold (or tap) the gold microphone icon and speak naturally for 5–15 seconds:  
    *"Took MES long after we swept the overnight low at 9:45, NQ refused to make a lower low and pushed hard. Got a little scared at VWAP and took everything off instead of leaving a runner."*
  - **AI Auto-Parser:** Transcribes the audio and offers suggested **Playbook**, **Tags** (`SMT Divergence`, `Level Sweep`, `Cut Early`), **Thesis Summary**, and **Emotional State** (per-spoke Mood Shape scores, each with an evidence quote, [18](18-mood-shape.md)) for acceptance. It never overwrites user selections or prose. Audio retention follows the user's setting (UX-33, UX-39).

### B. Advanced Mode (Post-Market Deep Review)
Expandable drawer or tab when sitting down after the session to grade yourself thoroughly:
1. **Interactive Playbook Rule Checklist:**
   - Dynamically loads the checklist rules belonging to the selected Playbook (e.g., *1. HTF bias defined?*, *2. Wait for 5m candle close?*, *3. Hard stop placed in TopstepX?*, *4. No entry within 5m of red-folder news?*).
   - Computes an objective **Rule Adherence Score** (e.g., `3/4 — 75%`) used by the AI and analytics dashboard.
2. **Structured Deep-Dive Sections (Collapsible):**
   - **Pre-Trade Thesis & Context:** Bias, liquidity pools targeted, invalidation point.
   - **Divergence & Intermarket Push Read:** Dedicated block explaining how `NQ`, `YM`, or `^VIX` behaved relative to `MES` before and during the hold, linked directly to any Companion Chart panes or uploaded screenshots.
   - **Trade Management & Scaling:** Why you added, trimmed, or trailed stops.
   - **Post-Exit Price Action:** What price did `15–60 minutes` after you exited (did you nail the top/bottom, or leave 3R on the table?).
3. **Multi-Timeframe & AI Follow-Up Chat:**
   - Inline chat panel tied to that specific trade where you can ask the AI Coach follow-up questions (*"Look at the 9:50 1m candle—was my stop too tight below VWAP?"*).

Daily plans, notes captured before a trade exists, cross-device revision conflicts and later weekly reviews are proposed in [11 §1](11-product-workflows-and-api-context.md#1-the-daily-loop-beyond-the-chart) (`OD-19`). Reusable `playbooks` remain setup definitions; a daily plan references them without replacing their rules.
