// After-the-exit hindsight (issue #37). Pure: never changes R, outcome, or statistics (B-63, UX-52).
// A later touch is the first bar after the exit whose range reaches a continued target or stop.
// "Neither" is judged against the session close when those bars exist, otherwise against the bars on hand.

import { sessionDate } from "./session.ts";
import type { Candle, TradeDirection, TradeRecord } from "./trades.ts";

export type ChartDetailLevel = "low" | "medium";

export type HindsightOutcome = "target_first" | "stop_first" | "same_bar" | "neither";

export interface LaterTouch {
  kind: "target" | "stop";
  time: number;
  delayMs: number;
  price: number;
}

export interface HindsightFact {
  /** Always labelled as hindsight wherever this is shown. */
  hindsight: true;
  outcome: HindsightOutcome;
  /** True when post-exit bars do not reach the session close, so "neither" is incomplete. */
  incomplete: boolean;
  target: LaterTouch | null;
  stop: LaterTouch | null;
  /** First later touch, if exactly one kind is reached first. */
  first: LaterTouch | null;
  sentence: string;
}

function zonedCloseUtc(session: string): number {
  // Session close is 17:00 America/New_York on the session date (same convention as the archive coverage).
  const [year, month, day] = session.split("-").map(Number);
  const utcGuess = Date.UTC(year, month - 1, day, 17, 0);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const asIfUtc = (ms: number) => {
    const parts = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((part) => [part.type, part.value]));
    return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour) % 24, Number(parts.minute));
  };
  return utcGuess - (asIfUtc(utcGuess) - utcGuess);
}

function barReaches(bar: Candle, price: number, side: "high" | "low"): boolean {
  if (side === "high") return bar.high >= price;
  return bar.low <= price;
}

function touchSide(direction: TradeDirection, kind: "target" | "stop"): "high" | "low" {
  if (kind === "target") return direction === "LONG" ? "high" : "low";
  return direction === "LONG" ? "low" : "high";
}

function formatDelay(delayMs: number): string {
  const minutes = Math.max(1, Math.round(delayMs / 60_000));
  if (minutes < 60) return `${minutes} min later`;
  const hours = minutes / 60;
  if (hours < 10 && minutes % 60 !== 0) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${h}h ${m}m later`;
  }
  const rounded = Math.round(hours * 10) / 10;
  return `${rounded}h later`;
}

export function laterTouch(
  candles: Candle[],
  exitTime: number,
  price: number,
  kind: "target" | "stop",
  direction: TradeDirection,
): LaterTouch | null {
  if (!Number.isFinite(exitTime) || !Number.isFinite(price) || candles.length === 0) return null;
  const side = touchSide(direction, kind);
  const later = candles.filter((bar) => bar.time > exitTime).sort((a, b) => a.time - b.time);
  for (const bar of later) {
    if (barReaches(bar, price, side)) {
      return { kind, time: bar.time, delayMs: bar.time - exitTime, price };
    }
  }
  return null;
}

export function buildHindsight(trade: Pick<TradeRecord, "direction" | "exit_time" | "stop_loss_price" | "planned_target_price">, candles: Candle[]): HindsightFact {
  const exitTime = Date.parse(trade.exit_time);
  const target = trade.planned_target_price == null
    ? null
    : laterTouch(candles, exitTime, trade.planned_target_price, "target", trade.direction);
  const stop = trade.stop_loss_price == null
    ? null
    : laterTouch(candles, exitTime, trade.stop_loss_price, "stop", trade.direction);

  const sessionClose = zonedCloseUtc(sessionDate(trade.exit_time));
  const lastBar = candles.reduce((latest, bar) => (bar.time > latest ? bar.time : latest), 0);
  const incomplete = lastBar < sessionClose - 60_000;

  let outcome: HindsightOutcome;
  let first: LaterTouch | null = null;
  if (target && stop && target.time === stop.time) {
    outcome = "same_bar";
    first = target;
  } else if (target && (!stop || target.time < stop.time)) {
    outcome = "target_first";
    first = target;
  } else if (stop && (!target || stop.time < target.time)) {
    outcome = "stop_first";
    first = stop;
  } else {
    outcome = "neither";
  }

  const sentence = hindsightSentence(outcome, first, incomplete, Boolean(trade.planned_target_price), Boolean(trade.stop_loss_price));
  return { hindsight: true, outcome, incomplete, target, stop, first, sentence };
}

export function hindsightSentence(
  outcome: HindsightOutcome,
  first: LaterTouch | null,
  incomplete: boolean,
  hasTarget: boolean,
  hasStop: boolean,
): string {
  if (!hasTarget && !hasStop) return "Hindsight: no planned target or stop was recorded, so later touches cannot be judged.";
  if (outcome === "target_first" && first) return `Hindsight: the target would have been reached first, ${formatDelay(first.delayMs)}.`;
  if (outcome === "stop_first" && first) return `Hindsight: the stop would have been reached first, ${formatDelay(first.delayMs)}.`;
  if (outcome === "same_bar" && first) return `Hindsight: the target and the stop were both reached in the same later bar, ${formatDelay(first.delayMs)}.`;
  if (incomplete) return "Hindsight: neither the target nor the stop was reached in the bars on hand after the exit.";
  return "Hindsight: neither the target nor the stop was reached by the session close.";
}

export function laterTouchLabel(touch: LaterTouch): string {
  const tag = touch.kind === "target" ? "TP" : "SL";
  const minutes = Math.max(1, Math.round(touch.delayMs / 60_000));
  return `${tag} +${minutes}m`;
}

/** Full text shown when the hindsight block is expanded (same at Low and Medium). */
export function hindsightExpandedText(fact: Pick<HindsightFact, "sentence" | "target" | "stop">): string {
  return [
    fact.sentence,
    fact.target ? `${laterTouchLabel(fact.target)}.` : "",
    fact.stop ? `${laterTouchLabel(fact.stop)}.` : "",
  ].filter(Boolean).join(" ");
}

/**
 * Collapsed copy for the hindsight block. Low shows the one-line summary (the sentence itself);
 * Medium keeps the helper line that points at the one-tap expand. Display only: never affects R or stats.
 */
export function hindsightCollapsedText(fact: Pick<HindsightFact, "sentence">, detailLevel: ChartDetailLevel): string {
  return detailLevel === "low" ? fact.sentence : "Hindsight is one tap away and never changes R or the grade of the decision.";
}
