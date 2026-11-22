// Display list builder for trade render grammar (issue #34, docs/15 §3.4).
// Pure: no I/O, no DOM, no canvas. All time coordinates are snapped to bar open times (B-23).
// Follows owner decision D-010: fills only, faint red/green plan fills, no outline, no purple.

import type { Timeframe } from "./trades.ts";
import { snapToBar } from "./trades.ts";
import type { DerivedTrade, EventBasis } from "./trade-document.ts";
import type { ObservedTrade } from "./trade-bar-validation.ts";

export type MarkTone = "profit" | "risk" | "neutral" | "muted" | "entry";
export type MarkLayer = "plan" | "actual" | "archived";
export type MarkZoneStyle = "solid" | "faint" | "dotted";
export type MarkDash = "solid" | "dashed" | "dotted";
export type MarkFlagShape = "arrow_up" | "arrow_down" | "triangle_up" | "triangle_down" | "dot" | "cross";

export interface ZoneMark {
  kind: "zone";
  layer: MarkLayer;
  t0: number;
  t1: number;
  p0: number;
  p1: number;
  tone: MarkTone;
  style: MarkZoneStyle;
  opacityMultiplier?: number;
  label?: string;
}

export interface SegmentMark {
  kind: "segment";
  layer: MarkLayer;
  t0: number;
  t1: number;
  p0: number;
  p1: number;
  dash: MarkDash;
  tone: MarkTone;
  width?: number;
  basis?: EventBasis;
}

export interface FlagMark {
  kind: "flag";
  t: number;
  price: number;
  shape: MarkFlagShape;
  text: string;
  basis: EventBasis;
  tone: MarkTone;
}

export interface BracketMark {
  kind: "bracket";
  t: number;
  pLow: number;
  pMid: number;
  pHigh: number;
  labels: {
    mfe: string;
    mae: string;
  };
  basis: EventBasis;
}

export interface LabelMark {
  kind: "label";
  anchor: { t: number; price: number };
  text: string;
  priority: number;
  tone?: MarkTone;
}

export interface HatchMark {
  kind: "hatch";
  t0: number;
  t1: number;
  p0: number;
  p1: number;
  tone: MarkTone;
  style?: "solid" | "dotted";
  label?: string;
}

export type Mark =
  | ZoneMark
  | SegmentMark
  | FlagMark
  | BracketMark
  | LabelMark
  | HatchMark;

export type DetailLevel = "low" | "medium" | "high";

export interface BuildMarksOptions {
  /** Candle bar open times used for B-23 snapping. */
  candleTimes?: number[];
  /** Right-hand edge (open time) for continuation or open trades. */
  viewRightTime?: number;
  /** Whether hindsight continuation is drawn (default true at medium/high). */
  showContinuation?: boolean;
}

/**
 * Snap an instant (ISO string or epoch ms) to a bar open time.
 * If candleTimes is provided, uses snapToBar with bounded fallback.
 * If candleTimes is empty or not provided, falls back to mathematical bar bucket.
 */
export function snapTime(
  instant: string | number,
  timeframe: Timeframe,
  candleTimes?: number[],
): number | null {
  const ms = typeof instant === "string" ? Date.parse(instant) : instant;
  if (!Number.isFinite(ms)) return null;

  if (candleTimes && candleTimes.length > 0) {
    return snapToBar(candleTimes, ms, timeframe);
  }

  // Pure mathematical alignment when no candle set is given
  const barMinutes = timeframe === "1m" ? 1 : timeframe === "5m" ? 5 : timeframe === "15m" ? 15 : 60;
  const barMs = barMinutes * 60_000;
  return Math.floor(ms / barMs) * barMs;
}

function exitReasonFlagText(reason?: string, isScratch?: boolean): string {
  if (isScratch) return "BE";
  switch (reason) {
    case "target": return "TP";
    case "stop": return "SL";
    case "trail": return "TRAIL";
    case "manual": return "MKT";
    default: return "";
  }
}

/**
 * Deterministic display list builder for trade render grammar (docs/15 §3.4, D-010).
 */
export function buildMarks(
  derived: DerivedTrade,
  facts: ObservedTrade | null,
  timeframe: Timeframe,
  detail: DetailLevel = "medium",
  shield: boolean = false,
  options: BuildMarksOptions = {},
): Mark[] {
  const marks: Mark[] = [];
  const { candleTimes, viewRightTime } = options;
  const snap = (t: string | number | null | undefined): number | null => {
    if (!t) return null;
    return snapTime(t, timeframe, candleTimes);
  };

  const isLong = derived.side === "long";
  const entryBar = snap(derived.entry_time);
  const exitBar = snap(derived.exit_time);

  // 1. Working order line before entry fill (e.g. ex-tp limit entry placed earlier)
  for (const wo of derived.working_orders) {
    if (wo.role === "entry" && wo.from && derived.entry_time) {
      const fromBar = snap(wo.from);
      const toBar = snap(wo.to ?? derived.entry_time);
      if (fromBar != null && toBar != null && toBar > fromBar) {
        marks.push({
          kind: "segment",
          layer: "plan",
          t0: fromBar,
          t1: toBar,
          p0: wo.price,
          p1: wo.price,
          dash: "dotted",
          tone: "entry",
          basis: wo.basis,
        });
      }
    }
  }

  // 2. PLAN layer: Faint red/green zones (D-010: no purple, no outline, faint fills only)
  // For not-taken trades, spans plan time to cancel time (or view right)
  if (derived.plan) {
    const planFromBar = snap(derived.plan.t);
    let planToBar: number | null = null;

    if (derived.status === "not_taken") {
      // Plan spans order placed -> cancelled
      const cancelEvent = derived.working_orders.find(w => w.end_reason === "cancelled");
      planToBar = snap(cancelEvent?.to ?? derived.working_orders[0]?.to ?? viewRightTime ?? planFromBar);
    } else {
      planToBar = exitBar ?? snap(viewRightTime) ?? entryBar;
    }

    const t0 = (derived.status === "not_taken" ? planFromBar : entryBar) ?? planFromBar;
    const t1 = planToBar;

    if (t0 != null && t1 != null && t1 >= t0) {
      const entryP = derived.plan.entry.price;

      // Risk zone (entry -> stop)
      if (derived.plan.stop != null) {
        marks.push({
          kind: "zone",
          layer: "plan",
          t0,
          t1,
          p0: entryP,
          p1: derived.plan.stop,
          tone: "risk",
          style: derived.status === "not_taken" ? "dotted" : "faint",
          label: detail === "high" ? "SL" : undefined,
        });
      }

      // Reward zones (entry -> targets)
      for (const target of derived.plan.targets) {
        const targetLabel = derived.plan.targets.length > 1
          ? `${target.key.toUpperCase()} ${target.qty} of ${derived.plan.qty}`
          : target.key.toUpperCase();

        marks.push({
          kind: "zone",
          layer: "plan",
          t0,
          t1,
          p0: entryP,
          p1: target.price,
          tone: "profit",
          style: derived.status === "not_taken" ? "dotted" : "faint",
          label: detail !== "low" ? targetLabel : undefined,
        });
      }

      // Not-taken plan tag
      if (derived.status === "not_taken") {
        marks.push({
          kind: "label",
          anchor: { t: t0, price: entryP },
          text: "PLAN · not filled",
          priority: 1,
          tone: "muted",
        });
      }
    }
  }

  // 3. ACTUAL band layer (per lot or full position)
  // Only for trades with fills
  if (derived.status === "closed" && entryBar != null && exitBar != null && exitBar >= entryBar) {
    if (derived.is_scratch) {
      // Breakeven scratch: thin gray line at entry price
      marks.push({
        kind: "segment",
        layer: "actual",
        t0: entryBar,
        t1: exitBar,
        p0: derived.avg_entry_price ?? 0,
        p1: derived.avg_entry_price ?? 0,
        dash: "solid",
        tone: "neutral",
        width: 1.5,
      });
    } else {
      // Determine win/loss tone
      const isWinner = (derived.pnl_cents ?? 0) > 0;
      const actualTone: MarkTone = isWinner ? "profit" : "risk";

      if (derived.closed_lots.length > 1) {
        // Multi-exit scale out: draw band per closed lot
        for (const lot of derived.closed_lots) {
          const lotEntryBar = snap(lot.entry_t) ?? entryBar;
          const lotExitBar = snap(lot.exit_t) ?? exitBar;
          const opacityMult = lot.qty / derived.max_size;

          marks.push({
            kind: "zone",
            layer: "actual",
            t0: lotEntryBar,
            t1: lotExitBar,
            p0: lot.entry_price,
            p1: lot.exit_price,
            tone: (lot.pnl_cents ?? 0) > 0 ? "profit" : "risk",
            style: "solid",
            opacityMultiplier: opacityMult,
          });
        }
      } else {
        // Single exit band
        marks.push({
          kind: "zone",
          layer: "actual",
          t0: entryBar,
          t1: exitBar,
          p0: derived.avg_entry_price ?? derived.first_entry_price ?? 0,
          p1: derived.avg_exit_price ?? 0,
          tone: actualTone,
          style: "solid",
        });
      }
    }

    // Execution path: polyline through fills in time order (§2.4)
    if (derived.position_timeline.length >= 2) {
      for (let i = 0; i < derived.position_timeline.length - 1; i++) {
        const pA = derived.position_timeline[i];
        const pB = derived.position_timeline[i + 1];
        const tA = snap(pA.t);
        const tB = snap(pB.t);
        if (tA != null && tB != null && tB >= tA) {
          marks.push({
            kind: "segment",
            layer: "actual",
            t0: tA,
            t1: tB,
            p0: pA.price,
            p1: pB.price,
            dash: "dotted",
            tone: "muted",
            width: 1,
          });
        }
      }
    }
  }

  // 4. STOP PATH: stepped line jumping at modifications (§2.2)
  for (let i = 0; i < derived.stop_path.length; i++) {
    const seg = derived.stop_path[i];
    const segFromBar = snap(seg.from);
    const segToBar = snap(seg.to ?? derived.exit_time ?? viewRightTime);

    if (segFromBar != null && segToBar != null && segToBar >= segFromBar) {
      marks.push({
        kind: "segment",
        layer: "actual",
        t0: segFromBar,
        t1: segToBar,
        p0: seg.price,
        p1: seg.price,
        dash: "dashed",
        tone: seg.widened ? "risk" : "muted",
        width: 1.5,
        basis: seg.basis,
      });

      // Locked-in profit hatch when stop sits at or beyond entry
      if (seg.locked_profit && derived.avg_entry_price != null) {
        marks.push({
          kind: "hatch",
          t0: segFromBar,
          t1: segToBar,
          p0: derived.avg_entry_price,
          p1: seg.price,
          tone: "profit",
          label: detail === "high" ? "LOCKED PROFIT" : undefined,
        });
      }

      // Vertical connector between stop segments
      if (i > 0) {
        const prevSeg = derived.stop_path[i - 1];
        marks.push({
          kind: "segment",
          layer: "actual",
          t0: segFromBar,
          t1: segFromBar,
          p0: prevSeg.price,
          p1: seg.price,
          dash: "dashed",
          tone: seg.widened ? "risk" : "muted",
          width: 1.5,
        });

        if (seg.widened) {
          marks.push({
            kind: "label",
            anchor: { t: segFromBar, price: seg.price },
            text: "WIDENED",
            priority: 2,
            tone: "risk",
          });
        }
      }

      // End of stop line marker (e.g. cancelled stop in ex-ignored gets ✕)
      if (seg.end_reason === "cancelled") {
        marks.push({
          kind: "flag",
          t: segToBar,
          price: seg.price,
          shape: "cross",
          text: "✕",
          basis: seg.basis,
          tone: "risk",
        });
      }
    }
  }

  // 5. PAST STOP HATCH & FACTS (§2.3 ex-ignored)
  for (const fact of derived.facts) {
    if (fact.code === "exit_past_stop" && exitBar != null && derived.initial_stop) {
      marks.push({
        kind: "hatch",
        t0: entryBar ?? exitBar,
        t1: exitBar,
        p0: derived.initial_stop.price,
        p1: fact.price,
        tone: "risk",
        style: fact.basis === "inferred" ? "dotted" : "solid",
        label: fact.extra_r != null && !shield ? `PAST STOP ${fact.extra_r}R` : "PAST STOP",
      });
    }
  }

  // 6. OBSERVER FINDINGS as flags/marks (§3.3, §3.4)
  if (facts && facts.findings) {
    for (const finding of facts.findings) {
      const findingBar = snap(finding.barTime);
      if (findingBar != null) {
        if (finding.code === "stop_traded_through") {
          marks.push({
            kind: "flag",
            t: findingBar,
            price: finding.price,
            shape: "dot",
            text: finding.basis === "inferred" ? "≈ SL touch" : "SL touch",
            basis: finding.basis,
            tone: "risk",
          });
        } else if (finding.code === "target_traded_through") {
          marks.push({
            kind: "flag",
            t: findingBar,
            price: finding.price,
            shape: "dot",
            text: finding.basis === "inferred" ? "≈ TP touch" : "TP touch",
            basis: finding.basis,
            tone: "profit",
          });
        } else if (finding.code === "fill_outside_bar") {
          marks.push({
            kind: "flag",
            t: findingBar,
            price: finding.price,
            shape: "dot",
            text: "≈ fill outside bar",
            basis: finding.basis,
            tone: "muted",
          });
        }
      }
    }
  }

  // 7. ENTRY & EXIT FLAGS placed by fill price on bar (§2.4)
  // Collapse fills in the same bar per UX-23
  const entryFillsByBar = new Map<number, { count: number; price: number; basis: EventBasis }>();
  for (const pt of derived.position_timeline) {
    if (pt.role === "entry") {
      const b = snap(pt.t);
      if (b != null) {
        const cur = entryFillsByBar.get(b);
        if (!cur) entryFillsByBar.set(b, { count: pt.qty, price: pt.price, basis: pt.basis });
        else {
          cur.count += pt.qty;
          cur.price = pt.price; // or average
        }
      }
    }
  }
  for (const [bar, data] of entryFillsByBar.entries()) {
    const text = data.count > 1 && data.count < derived.max_size ? `▲ ${data.count}` : "";
    marks.push({
      kind: "flag",
      t: bar,
      price: data.price,
      shape: isLong ? "arrow_up" : "arrow_down",
      text,
      basis: data.basis,
      tone: "muted",
    });
  }

  // Exit flags
  for (const lot of derived.closed_lots) {
    const b = snap(lot.exit_t);
    if (b != null) {
      const reasonText = exitReasonFlagText(lot.exit_reason, derived.is_scratch);
      marks.push({
        kind: "flag",
        t: b,
        price: lot.exit_price,
        shape: isLong ? "triangle_down" : "triangle_up",
        text: reasonText,
        basis: lot.exit_reason_basis,
        tone: derived.is_scratch ? "neutral" : lot.pnl_cents && lot.pnl_cents > 0 ? "profit" : lot.pnl_cents && lot.pnl_cents < 0 ? "risk" : "neutral",
      });
    }
  }

  // 8. EXCURSION BRACKET (§2.1, §3.4)
  if (facts && facts.excursions && exitBar != null && derived.status === "closed") {
    const { mfePrice, maePrice } = facts.excursions;
    const entryP = derived.avg_entry_price ?? derived.first_entry_price ?? 0;
    marks.push({
      kind: "bracket",
      t: exitBar,
      pLow: maePrice,
      pMid: entryP,
      pHigh: mfePrice,
      labels: {
        mfe: `MFE ≈ ${mfePrice.toFixed(2)}`,
        mae: `MAE ≈ ${maePrice.toFixed(2)}`,
      },
      basis: "inferred",
    });
  }

  // 9. HINDSIGHT: Dotted continuation (§2.5, D-010: Medium detail on by default)
  const showHindsight = options.showContinuation ?? (detail !== "low");
  if (showHindsight && derived.status === "closed" && exitBar != null && viewRightTime != null && viewRightTime > exitBar) {
    const rightBar = snap(viewRightTime) ?? viewRightTime;

    // Entry continuation (faint gray)
    if (derived.avg_entry_price != null) {
      marks.push({
        kind: "segment",
        layer: "plan",
        t0: exitBar,
        t1: rightBar,
        p0: derived.avg_entry_price,
        p1: derived.avg_entry_price,
        dash: "dotted",
        tone: "muted",
        width: 1,
      });
    }

    // Last stop continuation (faint red)
    const lastStop = derived.stop_path.at(-1);
    if (lastStop) {
      marks.push({
        kind: "segment",
        layer: "plan",
        t0: exitBar,
        t1: rightBar,
        p0: lastStop.price,
        p1: lastStop.price,
        dash: "dotted",
        tone: "risk",
        width: 1,
      });
    }

    // Targets continuation (faint green)
    for (const tgt of derived.planned_targets) {
      marks.push({
        kind: "segment",
        layer: "plan",
        t0: exitBar,
        t1: rightBar,
        p0: tgt.price,
        p1: tgt.price,
        dash: "dotted",
        tone: "profit",
        width: 1,
      });
    }

    // Later touch hollow dots from facts
    if (facts && facts.hindsight) {
      if (facts.hindsight.last_stop_touch) {
        const touchBar = snap(facts.hindsight.last_stop_touch.time);
        if (touchBar != null && touchBar > exitBar) {
          marks.push({
            kind: "flag",
            t: touchBar,
            price: facts.hindsight.last_stop_touch.price,
            shape: "dot",
            text: "",
            basis: "inferred",
            tone: "risk",
          });
        }
      }

      for (const tt of facts.hindsight.target_touches) {
        const touchBar = snap(tt.time);
        if (touchBar != null && touchBar > exitBar) {
          marks.push({
            kind: "flag",
            t: touchBar,
            price: tt.price,
            shape: "dot",
            text: "",
            basis: "inferred",
            tone: "profit",
          });
        }
      }
    }
  }

  return marks;
}
