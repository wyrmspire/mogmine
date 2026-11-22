// Display list for issue #34 and docs/15 §3.4. Prices and UTC bar opens stay in data coordinates.
import { formatDetailTime } from "./time.ts";
import { formatPoints, formatPrice, formatR } from "./format.ts";
import { stopAtExit } from "./trade-document.ts";
import type { DerivedTrade, EventBasis, ExitReason, PositionPoint } from "./trade-document.ts";
import { alignToBar } from "./trades.ts";
import type { Timeframe } from "./trades.ts";
import type { ObservedTrade, TradeBarFinding } from "./trade-bar-validation.ts";

type MarkTone = "profit" | "risk" | "neutral" | "muted" | "entry";
type MarkLayer = "plan" | "actual" | "archived";
type MarkDash = "solid" | "dashed" | "dotted";
type MarkFlagShape = "arrow_up" | "arrow_down" | "triangle_up" | "triangle_down" | "dot" | "cross";
type MarkSpan = { t0: number; t1: number; approximate?: true };
type MarkArea = MarkSpan & { p0: number; p1: number; tone: MarkTone };

export type ZoneMark = MarkArea & {
  kind: "zone";
  layer: MarkLayer;
  style: "solid" | "faint" | "dotted";
  basis?: EventBasis;
  opacityMultiplier?: number;
  label?: string;
};

export type SegmentMark = MarkArea & {
  kind: "segment";
  layer: MarkLayer;
  dash: MarkDash;
  width?: number;
  basis?: EventBasis;
  faint?: true;
};

export interface FlagMark {
  kind: "flag";
  t: number;
  price: number;
  shape: MarkFlagShape;
  text: string;
  basis: EventBasis;
  tone: MarkTone;
  approximate?: true;
  hollow?: true;
  finding?: Pick<TradeBarFinding, "code" | "segment">;
}

export interface BracketMark {
  kind: "bracket";
  t: number;
  pLow: number;
  pMid: number;
  pHigh: number;
  labels: { mfe: string; mae: string };
  basis: EventBasis;
  coverage: NonNullable<ObservedTrade["excursions"]>["coverage"];
  approximate?: true;
}

export interface LabelMark {
  kind: "label";
  anchor: { t: number; price: number };
  text: string;
  priority: number;
  tone: MarkTone;
  basis?: EventBasis;
  approximate?: true;
}

export type HatchMark = MarkArea & {
  kind: "hatch";
  basis: EventBasis;
  label?: string;
  faint?: true;
};

export type Mark = ZoneMark | SegmentMark | FlagMark | BracketMark | LabelMark | HatchMark;
export type DetailLevel = "low" | "medium" | "high";

export interface BuildMarksOptions {
  /** Sorted candle opens for the displayed timeframe. Facts must use the same timeframe. */
  candleTimes: readonly number[];
  /** Current visible right edge, as a UTC instant. */
  viewRightTime?: number;
  showContinuation?: boolean;
  archived?: boolean;
}

const exitText: Record<ExitReason, string> = {
  target: "TP", stop: "SL", trail: "TRAIL", manual: "MKT", unknown: "",
};

const findingAppearance: Record<TradeBarFinding["code"], [text: string, tone: MarkTone]> = {
  stop_traded_through: ["SL touch", "risk"],
  target_traded_through: ["TP touch", "profit"],
  fill_outside_bar: ["fill outside bar", "muted"],
};

function resultTone(pnl: number | null): MarkTone {
  return pnl == null || pnl === 0 ? "neutral" : pnl > 0 ? "profit" : "risk";
}

function combineBasis(a: EventBasis, b: EventBasis): EventBasis {
  if (a === "inferred" || b === "inferred") return "inferred";
  if (a === "stated" || b === "stated") return "stated";
  return "broker";
}

/** Anchor a mark to a real bar. Nearby execution times retain their approximate alignment (OD-28). */
function anchor(times: readonly number[], instant: string | number | null | undefined, timeframe: Timeframe) {
  const ms = typeof instant === "string" ? Date.parse(instant) : instant;
  if (ms == null) return null;
  const alignment = alignToBar(times, ms, timeframe);
  if (alignment.kind === "unresolved") return null;
  return { t: alignment.barTime, ...(alignment.kind === "nearby" ? { approximate: true as const } : {}) };
}

type Anchor = ReturnType<typeof anchor>;

function span(from: Anchor, to: Anchor): MarkSpan | null {
  if (!from || !to || from.t > to.t) return null;
  return { t0: from.t, t1: to.t, ...(from.approximate || to.approximate ? { approximate: true } : {}) };
}

function targetName(derived: DerivedTrade, fill: PositionPoint): [text: string, inferred: boolean] {
  if (derived.planned_targets.length < 2) return ["TP", false];
  const linkedOrder = fill.order == null ? undefined : derived.working_orders.findLast(
    (order) => order.role === "target" && order.order === fill.order
      && Date.parse(order.from) <= Date.parse(fill.t)
      && (order.to == null || Date.parse(order.to) >= Date.parse(fill.t)),
  );
  if (linkedOrder?.target) return [linkedOrder.target.toUpperCase(), false];
  if (fill.order != null) return ["TP", false];
  const matches = derived.planned_targets.filter((target) => target.price === fill.price);
  return matches.length === 1 ? [matches[0].key.toUpperCase(), true] : ["TP", false];
}

/** Build marks in painter order. Unavailable bars leave unresolved geometry out of the list. */
export function buildMarks(
  derived: DerivedTrade,
  facts: ObservedTrade | null,
  timeframe: Timeframe,
  detail: DetailLevel,
  shield: boolean,
  options: BuildMarksOptions = { candleTimes: [] },
): Mark[] {
  const { candleTimes, viewRightTime, archived = false } = options;
  if (!candleTimes.length) return [];

  const marks: Mark[] = [];
  const isLong = derived.side === "long";
  const entryPrice = derived.avg_entry_price;
  const snap = (time: string | number | null | undefined) => anchor(candleTimes, time, timeframe);
  const entry = snap(derived.entry_time);
  const exit = snap(derived.exit_time);
  const lastVisibleBar = viewRightTime == null ? candleTimes.at(-1) : candleTimes.findLast((time) => time <= viewRightTime);
  const right = lastVisibleBar == null ? null : { t: lastVisibleBar };
  const end = derived.status === "closed" ? exit : right;
  const exactBarTimes = new Set(candleTimes);

  if (!archived) {
    const { plan, initial_stop: initialStop } = derived;
    const cancelled = derived.status === "not_taken";
    const cancelledEntry = derived.working_orders.findLast(
      (order) => order.role === "entry" && order.end_reason === "cancelled" && order.to === derived.entry_cancelled_at,
    );
    const from = derived.entry_time == null ? snap(cancelledEntry?.from ?? plan?.t) : entry;
    const planSpan = span(from, cancelled ? snap(derived.entry_cancelled_at) : end);
    const plannedEntry = plan?.entry.price ?? derived.first_entry_price;
    const plannedStop = plan?.stop ?? initialStop?.price;
    const style = cancelled ? "dotted" : "faint";

    if (planSpan && plannedEntry != null) {
      if (plannedStop != null) {
        marks.push({
          kind: "zone", ...planSpan, layer: "plan", p0: plannedEntry, p1: plannedStop,
          tone: "risk", style, basis: plan?.stop != null ? plan.basis : initialStop?.basis,
          ...(detail === "high" ? { label: "SL" } : {}),
        });
      }

      const targets = derived.planned_targets.toSorted(
        (a, b) => (a.price - b.price) * (isLong ? 1 : -1),
      );
      let innerPrice = plannedEntry;
      for (const target of targets) {
        const multiple = targets.length > 1;
        const name = multiple ? target.key.toUpperCase() : "TP";
        const risk = target.planned_r == null ? "" : ` ${target.planned_r.toFixed(1)}R`;
        const size = multiple && !shield && plan ? ` · ${target.qty} of ${plan.qty}` : "";
        marks.push({
          kind: "zone", ...planSpan, layer: "plan", p0: innerPrice, p1: target.price,
          tone: "profit", style, basis: plan?.basis,
          ...(detail === "low" ? {} : { label: name + risk + size }),
        });
        innerPrice = target.price;
      }
      if (cancelled && from) {
        marks.push({
          kind: "label", anchor: { t: from.t, price: plannedEntry },
          text: cancelledEntry ? "PLAN · cancelled" : "PLAN · not filled",
          priority: 1, tone: "muted", basis: derived.outcome_basis ?? undefined,
          ...(from.approximate ? { approximate: true } : {}),
        });
      }
    }

    for (const order of derived.working_orders) {
      if (order.role !== "entry" || order.kind === "market") continue;
      const until = order.to ?? derived.entry_time;
      const working = span(snap(order.from), until == null ? right : snap(until));
      if (working && working.t0 < working.t1) {
        marks.push({
          kind: "segment", ...working, layer: "plan", p0: order.price, p1: order.price,
          dash: "dotted", tone: "entry", basis: order.basis,
        });
      }
    }
  }

  const fills = derived.position_timeline;
  const fillBasis = fills.reduce<EventBasis>((basis, fill) => combineBasis(basis, fill.basis), "broker");
  const fillsBySeq = new Map(fills.map((fill) => [fill.seq, fill]));
  const actualLayer = archived ? "archived" : "actual";
  if (derived.is_scratch && entryPrice != null) {
    const hold = span(entry, exit);
    if (hold) {
      marks.push({
        kind: "segment", ...hold, layer: actualLayer, p0: entryPrice, p1: entryPrice,
        dash: archived ? "dotted" : "solid", tone: "neutral", width: archived ? 1 : 1.5, basis: fillBasis,
      });
    }
  } else {
    for (const lot of derived.closed_lots) {
      const execution = span(snap(lot.entry_t), snap(lot.exit_t));
      if (!execution) continue;
      const basis = combineBasis(
        fillsBySeq.get(lot.entry_seq)?.basis ?? "inferred",
        fillsBySeq.get(lot.exit_seq)?.basis ?? "inferred",
      );
      marks.push({
        kind: "zone", ...execution, layer: actualLayer, p0: lot.entry_price, p1: lot.exit_price,
        tone: resultTone(lot.pnl_cents), style: archived ? "dotted" : "solid", basis,
        ...(lot.qty < derived.max_size ? { opacityMultiplier: lot.qty / derived.max_size } : {}),
      });
    }
  }
  if (archived) return marks;

  for (const [index, fill] of fills.entries()) {
    const next = fills[index + 1];
    const line = span(snap(fill.t), next ? snap(next.t) : end);
    if (!line) continue;

    if (next && fills.length > 2) {
      marks.push({
        kind: "segment", ...line, layer: "actual", p0: fill.price, p1: next.price,
        dash: "dotted", tone: "muted", width: 1, basis: combineBasis(fill.basis, next.basis),
      });
    }
    if (derived.total_entry_qty > (fills[0]?.qty ?? 0) && fill.avg_entry_price != null) {
      marks.push({
        kind: "segment", ...line, layer: "actual", p0: fill.avg_entry_price, p1: fill.avg_entry_price,
        dash: "solid", tone: "entry", width: 1, basis: fillBasis,
      });
      if (next?.role === "entry" && next.avg_entry_price != null && next.avg_entry_price !== fill.avg_entry_price) {
        marks.push({
          kind: "segment", ...line, t0: line.t1, layer: "actual", p0: fill.avg_entry_price,
          p1: next.avg_entry_price, dash: "solid", tone: "entry", width: 1, basis: fillBasis,
        });
      }
    }
  }

  const previousStops = new Map<string, (typeof derived.stop_path)[number]>();
  for (const stop of derived.stop_path) {
    const start = snap(stop.from);
    const stopSpan = span(start, stop.to == null ? end : snap(stop.to));
    const previous = previousStops.get(stop.order);
    previousStops.set(stop.order, stop);
    if (!start || !stopSpan) continue;

    const tone = stop.widened ? "risk" : "muted";
    const dash = stop.basis === "inferred" ? "dotted" : "dashed";
    const placementEntry = stop.entry_price_at_placement;
    if (stop.locked_profit && placementEntry != null && placementEntry !== stop.price) {
      marks.push({
        kind: "hatch", ...stopSpan, p0: placementEntry, p1: stop.price,
        tone: "profit", basis: stop.basis, faint: true,
      });
    }
    marks.push({
      kind: "segment", ...stopSpan, layer: "actual", p0: stop.price, p1: stop.price,
      dash, tone, width: 1.5, basis: stop.basis,
    });
    if (previous?.end_reason === "modified" && previous.to_seq === stop.from_seq && previous.price !== stop.price) {
      marks.push({
        kind: "segment", t0: start.t, t1: start.t, layer: "actual", p0: previous.price, p1: stop.price,
        dash, tone, width: 1.5, basis: stop.basis,
        ...(start.approximate ? { approximate: true } : {}),
      });
      const text = [
        stop.widened ? "WIDENED" : "",
        detail === "high" ? `${formatDetailTime(stop.from)} · ${formatPrice(stop.price, derived.symbol)}` : "",
      ].filter(Boolean).join(" · ");
      marks.push({ kind: "flag", ...start, price: stop.price, shape: "dot", text, basis: stop.basis, tone });
    }
  }

  for (const fact of derived.facts) {
    if (fact.code === "stop_removed_while_open") {
      const at = snap(fact.t);
      if (at) marks.push({
        kind: "flag", ...at, price: fact.price, shape: "cross", text: "✕", basis: fact.basis, tone: "risk",
      });
    } else if (fact.code === "exit_past_stop" && fact.stop_price != null) {
      const hold = span(entry, snap(fact.t));
      const basis = fact.basis === "stated" ? "inferred" : fact.basis;
      const text = fact.extra_r == null ? "PAST STOP" : `PAST STOP ${formatR(fact.extra_r)}`;
      if (hold) marks.push({
        kind: "hatch", ...hold, p0: fact.stop_price, p1: fact.price, tone: "risk", basis,
        label: basis === "inferred" ? `≈ ${text}` : text,
      });
    }
  }

  for (const finding of facts?.findings ?? []) {
    if (!exactBarTimes.has(finding.barTime)) continue;
    const [text, tone] = findingAppearance[finding.code];
    marks.push({
      kind: "flag", t: finding.barTime, price: finding.price, shape: "dot", tone, basis: finding.basis,
      text: finding.basis === "inferred" ? `≈ ${text}` : text,
      finding: { code: finding.code, segment: finding.segment },
    });
  }

  const lotsByExit = new Map<number, DerivedTrade["closed_lots"]>();
  for (const lot of derived.closed_lots) {
    const sameFill = lotsByExit.get(lot.exit_seq);
    if (sameFill) sameFill.push(lot);
    else lotsByExit.set(lot.exit_seq, [lot]);
  }
  const fillFlags = new Map<string, { mark: FlagMark; count: number; labels: Set<string> }>();
  for (const fill of fills) {
    const at = snap(fill.t);
    if (!at) continue;
    const opening = fill.role === "entry";
    const lots = lotsByExit.get(fill.seq) ?? [];
    const reason = fill.reason ?? "unknown";
    const [name, inferred] = reason === "target" ? targetName(derived, fill) : [exitText[reason], false];
    const text = opening ? "" : derived.is_scratch ? "BE" : name;
    const basis = !opening && !derived.is_scratch ? lots[0]?.exit_reason_basis ?? fill.basis : fill.basis;
    const pnl = lots.length > 0 && lots.every((lot) => lot.pnl_cents != null)
      ? lots.reduce((sum, lot) => sum + (lot.pnl_cents ?? 0), 0) : null;
    const tone = opening ? "muted" : derived.is_scratch ? "neutral" : resultTone(pnl);
    const key = `${fill.role}:${at.t}`;
    const group = fillFlags.get(key);
    if (group) {
      group.count++;
      if (text) group.labels.add(text);
      group.mark.basis = combineBasis(group.mark.basis, inferred ? "inferred" : basis);
      if (at.approximate) group.mark.approximate = true;
      if (group.mark.tone !== tone) group.mark.tone = "neutral";
    } else {
      fillFlags.set(key, {
        mark: {
          kind: "flag", ...at, price: fill.price, text: "", tone, basis: inferred ? "inferred" : basis,
          shape: opening ? (isLong ? "arrow_up" : "arrow_down") : (isLong ? "triangle_down" : "triangle_up"),
          ...(!opening ? { hollow: true } : {}),
        },
        count: 1,
        labels: new Set(text ? [text] : []),
      });
    }
  }
  for (const { mark, count, labels } of fillFlags.values()) {
    const text = [...labels].join(" / ");
    mark.text = [text, count > 1 && !shield ? `×${count}` : ""].filter(Boolean).join(" ");
    marks.push(mark);
  }

  const excursion = facts?.excursions;
  if (excursion && exit && entryPrice != null) {
    const { maePrice, mfePrice, coverage } = excursion;
    const points = (price: number) => formatPoints((price - entryPrice) * (isLong ? 1 : -1), derived.symbol);
    marks.push({
      kind: "bracket", ...exit, pLow: Math.min(maePrice, mfePrice), pMid: entryPrice,
      pHigh: Math.max(maePrice, mfePrice), basis: "inferred", coverage,
      labels: { mfe: `MFE ≈ ${points(mfePrice)}`, mae: `MAE ≈ ${points(maePrice)}` },
    });
  }

  const continuation = span(exit, right);
  if (detail === "medium" && options.showContinuation !== false && continuation
    && continuation.t0 < continuation.t1) {
    const extend = (price: number, tone: MarkTone, basis?: EventBasis, width = 1) => marks.push({
      kind: "segment", ...continuation, layer: "plan", p0: price, p1: price,
      dash: "dotted", tone, width, faint: true, ...(basis ? { basis } : {}),
    });
    if (entryPrice != null) extend(entryPrice, "muted", fillBasis);
    const lastStop = stopAtExit(derived);
    if (lastStop) {
      extend(lastStop.price, "risk", lastStop.basis);
      if (derived.initial_stop && derived.initial_stop.price !== lastStop.price) {
        extend(derived.initial_stop.price, "risk", derived.initial_stop.basis, 0.5);
      }
    }
    for (const target of derived.planned_targets) extend(target.price, "profit", derived.plan?.basis);

    const touches = [facts?.hindsight.last_stop_touch, ...(facts?.hindsight.target_touches ?? [])];
    for (const touch of touches) {
      if (touch && touch.time > continuation.t0 && touch.time <= continuation.t1 && exactBarTimes.has(touch.time)) {
        marks.push({
          kind: "flag", t: touch.time, price: touch.price, shape: "dot", text: "", basis: "inferred",
          tone: touch.kind === "stop" ? "risk" : "profit", hollow: true,
        });
      }
    }
  }
  return marks;
}
