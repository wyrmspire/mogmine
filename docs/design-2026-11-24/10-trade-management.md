# 10 — Trade Management: "What if I had managed it differently?"

> Status: **proposal** (owner request 2026-11-26). Builds on [09 — Strategy Lab](09-strategy-lab.md) (M1 `bracketOutcome`, recipes, splits), [15 — Trade Document & Render Grammar](../15-trade-document-and-render-grammar.md) (stop paths, hindsight layer) and the Databento archive (`feat/databento-mes-1m`). R stays the owner's locked definition: account R, $300 standard unit ([MOGMINE-BLUEPRINT §2](../../MOGMINE-BLUEPRINT.md)).

## 1. What the owner asked for

Strategy Lab only knows a fixed stop and a fixed target. The owner wants to ask, for the same entries:

- What if I had **trailed by a percentage**?
- What if I had **exited on a 5m or 15m engulfing candle** against me?
- What if I had **closed half** (scaled out), or **trailed behind candle wicks**?
- **How does that look on the chart**, and **for the month**?
- What does **volume** say (exit on a climax, judge by volume regime)?

And not only in the lab: "everything does really". The same plans should run on **real journal trades**, as hindsight that never changes the real R.

## 2. Principles

1. **Entries are fixed and management varies.** A what-if compares *the same trades* under different plans: paired, so the difference is the management and not the sample.
2. **No lookahead.** A 5m or 15m candle is known only after it **closes**. The rule acts from the **next 1m bar** after that close. Wick, engulfing and trail inputs come from completed candles only (same rule as `knownAt: "bar-close"`).
3. **Worst case inside a bar.** If one 1m bar touches both the stop and a scale-out target, the stop fills first (as in M1 `ambiguous-stop`).
4. **R never moves.** R = P&L in dollars ÷ account R size. Scale-outs make legs, and the trade's R is the sum of its legs. Real trades keep their real R. A what-if is labelled hindsight everywhere (B-63, UX-52).
5. **Plans are data.** A management plan is JSON. It is validated like a recipe, versioned and shareable, and it can be used by the agent API.

## 3. The management plan (`mogmine.manage-plan.v1`)

```ts
interface ManagePlan {
  schema: "mogmine.manage-plan.v1";
  id: string; version: number; name: string;          // "Half at 1R, trail 15m wicks"
  rules: ManageRule[];                                 // evaluated in order on every 1m bar
}

type ManageRule = { when: ManageTrigger; then: ManageAction; once?: boolean };

type ManageTrigger =
  | { kind: "always" }
  | { kind: "profitR"; atLeast: number }                         // open profit ≥ x R (on the remaining size)
  | { kind: "profitPoints"; atLeast: number }
  | { kind: "afterMinutes"; minutes: number }
  | { kind: "scaledOut" }                                         // after the first partial
  | { kind: "candle"; tf: "5m" | "15m"; pattern: CandlePattern } // judged at that candle's close
  | { kind: "closeBeyond"; tf: "1m" | "5m" | "15m"; ref: "vwap" | "ema" | LevelKey }
  | { kind: "volumeClimax"; tf: "1m" | "5m"; multiple: number; against: boolean }; // V2 volumeSpike

type CandlePattern = "engulfing-against" | "close-against-prior-low" | "inside-bar-break-against";

type ManageAction =
  | { kind: "scaleOut"; fraction: number }                   // 0.5 = close half, at the trigger price
  | { kind: "exitAll" }
  | { kind: "stopTo"; to: "breakeven"; offsetTicks?: number }
  | { kind: "trail"; by: TrailSpec };                         // the stop only ever tightens

type TrailSpec =
  | { mode: "givebackPct"; pct: number }                       // give back at most pct% of open profit (MFE)
  | { mode: "pricePct"; pct: number }                          // stop sits pct% of price behind the best price
  | { mode: "points"; points: number }
  | { mode: "r"; r: number }
  | { mode: "candleLow"; tf: "1m" | "5m" | "15m"; bars: number; ticks: number }   // behind the low of the last N closed candles
  | { mode: "wick"; tf: "5m" | "15m"; part: "extreme" | "half"; ticks: number }  // behind the last closed candle's wick: tip or midpoint
  | { mode: "ref"; ref: "vwap" | "ema"; ticks: number };
```

A recipe gets an optional `manage: ManagePlan | null`. `null` keeps today's fixed bracket. The recipe's `stop` is still the **initial** stop that defines risk, and `target` becomes optional: with a trail there may be no fixed target.

### Owner presets (start here, editable)

| Preset | Rules |
| :-- | :-- |
| **Fixed bracket** (baseline) | today's stop and target |
| **BE at 1R** | profitR ≥ 1 → stopTo breakeven |
| **Half at 1R, BE, run** | profitR ≥ 1 → scaleOut 0.5 · scaledOut → stopTo BE · scaledOut → trail candleLow 5m, 1 bar |
| **Trail 30% giveback** | profitR ≥ 0.5 → trail givebackPct 30 |
| **15m engulfing exit** | candle 15m engulfing-against → exitAll |
| **5m engulfing exit** | candle 5m engulfing-against → exitAll |
| **Trail 15m wicks (half)** | profitR ≥ 1 → trail wick 15m, half, 1 tick |
| **Volume climax out** | volumeClimax 1m ×3 against → exitAll |

> **To confirm with the owner:** does "close half of candle wicks" mean **trailing to the midpoint of the last candle's wick** (`wick … part: "half"`), or **scaling out half at a wick high or low**? Both can be written in the schema above. The presets assume the first.

## 4. Engine: `managedOutcome`

A new measure that generalises M1 `bracketOutcome` (M1 stays as the "Fixed bracket" path and its tests stay valid):

- Walk the 1m bars after the entry bar. 5m and 15m candles are built from the same 1m series (`aggregate.ts`) and become "known" at their close.
- Each bar: (1) check the current stop and each open scale-out against the bar range, worst case first; (2) update MFE and MAE; (3) when a candle closes, evaluate the rules in order; changes take effect **from the next bar**; (4) apply time and flat exits.
- Output: legs `[{ qty, exitTime, exitPrice, reason }]`, a **stop path** `[{ t, price, rule }]`, `resultR` (sum of legs), `capturePct` (realised ÷ MFE), `givebackR`, MFE and MAE, minutes in trade, and the rule that ended the trade.
- Golden tests (each one a fixture of bars): BE after 1R and then stopped at BE; half off at 1R and the rest trailed; a 15m engulfing that closes at :15 acting on the :16 bar and not before; a same-bar stop and scale-out (stop first); trail never loosens; short/long symmetry; R at $300 vs $250.

## 5. What-if runner and the month view

- **Variants:** one recipe's entries × N plans (up to 8). They are run once, on the same bars and the same entries.
- **Per-variant stats:** total R, avg R, win rate (95% interval), profit factor, **max drawdown in R**, longest losing run, capture %, avg giveback, exits by reason.
- **Paired difference vs baseline:** per-trade R difference, mean, 95% interval, and "helped / hurt / same" counts, so "trailing added +0.18R per trade, CI −0.02…+0.39" is honest about noise.
- **By month:** a month × variant table of R, n and win rate, plus an **equity curve** per variant on one chart (R on the y-axis), so "for the month" shows a curve and not only a number. The existing splits (time of day, volume regime, level) work per variant too.
- **Volume:** with Databento volume (real, not Yahoo's), add a split by volume regime (relative volume at entry), the `volumeClimax` trigger, and "exit reason = volume" in the exits mix. Volume is shown only where the archive has true volume; Yahoo sessions say "volume approximate".

## 6. On the chart

Using the render grammar in docs/15 (the stop path is already a `segment` layer, and hindsight is already a layer):

- **Stop path:** a step line from the initial stop as it moves (BE, trail steps). Each step can be tapped and names its rule ("15m wick ½").
- **Scale-outs:** a "½" chip at each partial exit, sized by fraction. The **final exit** of the variant is a ghost marker (outline, hindsight tone) next to the real exit.
- **Variant switcher:** chips above the chart (Baseline · BE 1R · Half+trail · 15m engulf …) swap the ghost layer. The real trade is never redrawn.
- **Candle context:** while a 5m/15m rule is active, the 5m/15m candle outlines are drawn faintly behind the 1m bars, so you can see which wick or engulfing candle moved the stop.
- **Lab match chart:** the same layer on any match in Strategy Lab results, so you can step through matches and watch each plan play out.
- **Month page:** equity curves per variant plus a calendar heatmap of daily R for the selected variant.

## 7. Real journal trades ("everything does really")

- On trade detail: **"What if…"** runs the presets on that trade's actual entry, initial stop and size, and shows a small table (variant · R · Δ vs real) plus the ghost layer. It is labelled hindsight.
- On the review and month screens: "Your last 30 trades under *Half at 1R, trail 5m*: +4.2R vs real", with the paired interval. It needs bars for each trade, so it uses the archive (and skips trades without coverage, with a count).

## 8. Work packages

| ID | Package | Depends on |
| :-- | :-- | :-- |
| **TM-0** | Archive read path: the lab and charts read `mogmine_market_candles` first (Databento, then Yahoo forward-fill), so months of 1m bars exist | Databento branch |
| **TM-1** | `ManagePlan` schema, validator, presets, recipe `manage` field (additive) + tests | — |
| **TM-2** | HTF candle facts: closed 5m/15m candles, engulfing / wick / candle-low helpers, known-at-close + tests | — |
| **TM-3** | `managedOutcome` engine + golden fixtures (§4) | TM-1, TM-2 |
| **TM-4** | Variant runner, paired stats, month table, equity series, drawdown | TM-3 |
| **TM-5** | Lab UI: plan picker/editor (presets first), variant compare table, month view, equity chart (390×844 first) | TM-4 |
| **TM-6** | Chart layer: stop path, scale-out chips, ghost exit, variant chips, HTF candle outlines (canvas primitive, Invariant 1) | TM-3 |
| **TM-7** | Journal "What if…" on trade detail and review | TM-3, TM-6, TM-0 |
| **TM-8** | Volume: relative-volume split, `volumeClimax` trigger, real-vs-approximate volume labelling | TM-0, TM-3 |

TM-1 and TM-2 can start now in parallel. TM-0 runs alongside them and is the gate for "for the month" on real data.

## 9. Open questions for the owner

1. "Close half of candle wicks": trail to the wick midpoint, or scale out half at a wick? (§3)
2. Should "trail by a percentage" mean **giving back X% of open profit** (default) or **X% of price**? Both are in the schema; which one should be the preset?
3. Should scale-out fills be limit (no slippage) or market (1 tick)? The default is limit for target-type scale-outs and market for rule-triggered exits.
4. Should the month view use calendar months or the account's evaluation periods?
