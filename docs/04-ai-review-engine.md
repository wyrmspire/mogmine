# 04 — Multimodal AI Review Engine

Generic trading AI prompts ("Looks like a good trade, manage your risk!") are useless. **MogMine's AI Review Engine** combines **6 concrete data and visual inputs** per trade and adapts its grading criteria to whether the trade was a **Scalp**, **90-Min Session Trade**, or **Investment/Swing**.

---

## 1. The 6 Context Inputs Fed to the AI

When a review is requested (automatically after a trade closes + notes are added, or on demand via **Re-Analyze**), the `ReviewContextPlugin` pipeline assembles a structured context bundle. AI completion does not mark the trade reviewed (docs/08 §7).

Proposed chart observations use stable trade/fill/time/level/zone anchors plus evidence references, never pixel coordinates or arbitrary UI markup. See [11 §3](11-product-workflows-and-api-context.md#3-notes-attach-to-market-objects) and §5 (`OD-17`, `OD-19`). A claim about planned behavior needs the plan revision available at decision time; a later plan is hindsight.

### Input 1: TopstepX Execution Telemetry
- Instrument (`MES`), direction (`LONG` / `SHORT`), contract size, individual scale-in/scale-out fill timestamps and prices.
- Hold duration and auto-classification (`scalp`, `session_90m`, or `investment`).
- Gross/Net PnL, commissions, Risk-to-Reward (`R`), **MAE** (Maximum Adverse Excursion), and **MFE** (Maximum Favorable Excursion) during the hold.

### Input 2: Yahoo Finance OHLCV + Session Key Levels
- The cached `1m` / `5m` / `15m` candlestick array before, during, and `30 minutes` after the exit (so the AI sees post-exit follow-through!).
- Pre-computed distances (in points and ATR multiples) from entry/exit to **`PDH/PDL`**, **`ONH/ONL`**, **`ORB High/Low`**, **`IBH/IBL`**, and **`VWAP`**.
- Local volatility (`14-bar ATR`) and wick/body candle behavior around the entry bar.
- Proposed levels block (entry zone, stop and target versus structure, plan scenario matched) and wider news kinds (Fed speakers, auctions, EIA): [12 §8, §10](12-levels-zones-and-daily-markup.md#10-how-the-ai-review-uses-levels).

### Input 3: Companion Charts & Intermarket Divergence / Pushes
- If `NQ=F` (or `YM=F`, `^VIX`, `DX-Y.NYB`) is attached as a Companion Chart, the engine computes a synchronized comparison table (e.g., *"Between 09:40 and 09:45 ET, ES=F made a new session low by -2.25 pts while NQ=F held +14.5 pts above its prior swing low — bullish SMT divergence"*).
- Also includes any user-drawn divergence annotations and captions on uploaded external charts.

### Input 4: Economic Calendar / High-Impact News
- Checks an economic calendar table (`economic_events`) for high-impact USD releases (**CPI, FOMC Rate Decision, FOMC Minutes, NFP, PPI, ISM PMI, Retail Sales, Fed Chair Speeches**) within **±30 minutes** of `entry_time` or `exit_time`.
- Flags whether the trader entered right into a volatility spike or traded cleanly post-release.

### Input 5: Playbook Rules & Trader Notes
- The selected Playbook's defined rules and the user's checked/unchecked Rule Adherence state.
- Simple tags (`#Sweep`, `#CutEarly`), Voice Memo transcript, and any Advanced Mode journal fields.

### Input 6: Chart Screenshot / Vision AI
- Sends a high-contrast PNG snapshot of the rendered chart (candlesticks + **translucent Position Box** + **Key Level lines** + **Companion `NQ=F` divergence pane** if present) directly to a multimodal model (e.g., Gemini / GPT-4o / Claude Vision).
- Why Vision matters: numeric arrays miss visual structure like double-bottom symmetry, steep trendline rejections, and clean vs. choppy price action inside the Position Box.

---

## 2. Style-Aware Coaching Lenses

The AI adjusts its prompt rubric based on `trade_style`:

| Trade Style | Primary Evaluation Focus |
| :--- | :--- |
| **`scalp`** (`< 15m`) | Precision at key levels, chasing vs. pullback entry, slippage/spread discipline, speed of cutting losers, avoiding over-trading inside chop. |
| **`session_90m`** (`15m–2h`) | Structure alignment (ORB/IB/VWAP), holding through normal pullbacks without panic-cutting, scaling at logical liquidity pools (`PDH`, `ONH`), `NQ`/`ES` divergence confirmation. |
| **`investment`** (`> 2h` / multi-session) | Higher-timeframe trend alignment, overnight event risk, stop placement outside intraday noise, thesis patience. |

---

## 3. Structured AI Review Output Schema

Every AI review returns strict JSON validated by Zod before saving to `ai_reviews`, guaranteeing clean rendering in the mobile UI and on the **One-Click Trade Card**.

> [!WARNING]
> **Changes recommended by the 2026-11-14 review** ([09 — Backend Risk Register](09-backend-risk-register.md) §7, `OD-12` in [DECISIONS.md](../DECISIONS.md)):
> - **Facts come from code, judgments from the model.** `playbook_adherence_score`, the event name, `minutes_from_event` and the nearest levels are already known to the code. If the model also outputs them it can contradict the checklist or invent an event (B-62).
> - **Separate decision-time assessment from hindsight.** Post-exit candles belong in a labelled "what happened next" section, not in the process grade (B-63).
> - **The chart image only exists in a browser.** Run a data-only review on the server and add vision once a client has uploaded a standardised snapshot (B-60, B-61).
> - **Queue the review** and keep a history of re-runs (B-45, B-51).

```typescript
export interface AITradeReviewOutput {
  grade: 'A+' | 'A' | 'A-' | 'B+' | 'B' | 'B-' | 'C' | 'D' | 'F';
  headline: string; // Concise 1-sentence verdict for the Trade Card
  style_classification_verification: {
    detected_style: 'scalp' | 'session_90m' | 'investment';
    matches_execution: boolean;
    commentary: string; // e.g. "Entered as a 90m setup but managed like a nervous scalp."
  };
  price_action_analysis: string; // Visual + candle read inside & around the Position Box
  divergence_and_intermarket_read: string | null; // Evaluation of NQ/VIX push or SMT divergence
  key_level_context: {
    nearest_entry_level: string;   // e.g. "ONL (0.75 pts below)"
    nearest_exit_level: string;    // e.g. "Session VWAP"
    level_execution_quality: 'optimal' | 'fair' | 'chased' | 'faded_trend';
  };
  news_hazard_check: {
    high_impact_event_nearby: boolean;
    event_name: string | null;     // e.g. "US CPI 08:30 ET"
    minutes_from_event: number | null;
    risk_note: string;
  };
  playbook_adherence_score: number; // 0 to 100
  strengths: string[];              // 2-3 specific positives
  leaks_detected: string[];         // 1-3 concrete mistakes or missed opportunities
  next_trade_directive: string;     // Single actionable rule to carry into the next trade
}
```

### Example Output Payload

```json
{
  "grade": "A-",
  "headline": "High-conviction ONL sweep backed by NQ bullish SMT, trimmed slightly early before PDH.",
  "style_classification_verification": {
    "detected_style": "session_90m",
    "matches_execution": true,
    "commentary": "42-minute hold aligns cleanly with a NY morning 90-minute rotation setup."
  },
  "price_action_analysis": "Entry triggered on the 09:45 5m bullish engulfing reclaim back inside ONL with minimal MAE (-1.25 pts). Price held cleanly above the 9 EMA and VWAP throughout the push.",
  "divergence_and_intermarket_read": "Companion NQ=F chart confirms bullish SMT divergence at 09:44 ET: ES=F swept the overnight low while NQ=F held 18 points above its 09:35 low, then led the breakout.",
  "key_level_context": {
    "nearest_entry_level": "ONL (+1.00 pt reclaim)",
    "nearest_exit_level": "15m ORB High (-1.50 pts shy of PDH)",
    "level_execution_quality": "optimal"
  },
  "news_hazard_check": {
    "high_impact_event_nearby": false,
    "event_name": null,
    "minutes_from_event": null,
    "risk_note": "No Tier-1 USD economic releases within +/- 30 minutes of entry."
  },
  "playbook_adherence_score": 90,
  "strengths": [
    "Waited for the 5m close back above ONL rather than catching the falling knife.",
    "Respected initial stop below the 09:44 sweep wick (1.0R risk defined)."
  ],
  "leaks_detected": [
    "Closed full size at ORB High while NQ was still breaking highs; leaving 1 micro runner captured an extra +1.3R to PDH over the next 18 minutes."
  ],
  "next_trade_directive": "When NQ confirms an SMT sweep and leads above VWAP, leave at least 1 MES contract with a breakeven stop to target PDH/PDL."
}
```
