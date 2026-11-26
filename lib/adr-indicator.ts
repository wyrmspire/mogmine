// IK-3: pure ADR instance calculation. Every output carries an explicit session span so historical
// bands stop at their own Globex/RTH close instead of leaking across the chart.
import { calculateAdrValue, computeAdrBands, dailyRangeFromCandles } from "./levels.ts";
import type { DailyRange } from "./levels.ts";
import type { LevelLine, LevelZone } from "./chart-levels.ts";
import { equityIndexSessionBounds, previousRegularSessionDate } from "./session.ts";
import { asMixedCandle } from "./mixed-resolution.ts";
import type { IndicatorInstance, IndicatorLineSlot } from "./indicator-kit.ts";
import type { Candle, Timeframe } from "./trades.ts";

export interface AdrSessionDay {
  sessionDate: string;
  candles: readonly Candle[];
  timeframe: Timeframe;
}

export interface AdrIndicatorResult {
  instanceId: string;
  length: number;
  lines: LevelLine[];
  zones: LevelZone[];
  unavailableDates: string[];
}

function priorSession(date: string, count: number) {
  let value = date;
  for (let index = 0; index < count; index += 1) value = previousRegularSessionDate(value);
  return value;
}

const lineSlot = (instance: IndicatorInstance, key: string) => instance.style[key]?.kind === "line"
  ? instance.style[key] as IndicatorLineSlot : null;

function anchorOpen(day: AdrSessionDay, anchor: "session" | "rth") {
  const bounds = equityIndexSessionBounds(day.sessionDate);
  const at = anchor === "rth" ? bounds.rthOpen : bounds.open;
  const bar = day.candles.map((item) => "minutes" in item ? item : asMixedCandle(item, day.timeframe)).find(({ time }) => time === at);
  return bar ? { price: bar.open, at, to: anchor === "rth" ? bounds.rthClose : bounds.close } : null;
}

/** Calculate one ADR instance. Multiple instances call this independently with their own length/style. */
export function buildAdrIndicator(
  instance: IndicatorInstance,
  symbol: "MES" | "MNQ",
  currentSessionDate: string,
  days: readonly AdrSessionDay[],
): AdrIndicatorResult {
  const length = Math.trunc(Number(instance.params.length));
  const daysBack = Math.trunc(Number(instance.params.daysBack));
  const multiplier = Number(instance.params.innerMultiplier);
  const anchor = instance.params.anchor === "rth" ? "rth" : "session";
  const history = days.flatMap((day) => {
    const range = dailyRangeFromCandles(symbol, day.sessionDate, day.candles, day.timeframe);
    return range ? [range] : [];
  });
  const byDate = new Map(days.map((day) => [day.sessionDate, day]));
  const lines: LevelLine[] = [];
  const zones: LevelZone[] = [];
  const unavailableDates: string[] = [];
  for (let index = Math.max(1, Math.min(10, daysBack)) - 1; index >= 0; index -= 1) {
    const sessionDate = priorSession(currentSessionDate, index);
    const day = byDate.get(sessionDate);
    const open = day && anchorOpen(day, anchor);
    const adr = calculateAdrValue(history as readonly DailyRange[], sessionDate, length);
    if (!day || !open || adr == null) { unavailableDates.push(sessionDate); continue; }
    const computed = computeAdrBands(open.price, adr, symbol, multiplier, new Date(open.at).toISOString());
    const outerStyle = lineSlot(instance, "outer");
    const innerStyle = lineSlot(instance, "inner");
    const midStyle = lineSlot(instance, "mid");
    const makeLine = (level: (typeof computed)[number], style: IndicatorLineSlot | null): LevelLine => ({
      price: level.price, price_ticks: level.price_ticks, role: "adr",
      label: `${level.price.toFixed(symbol === "MES" ? 2 : 2)} ${level.label} ${length}`,
      names: `${level.label} ${length}`, keys: [`${instance.instanceId}:${sessionDate}:${level.key}`], proxy: false,
      startAt: open.at, endAt: open.to, color: style?.color, lineStyle: style?.style, lineWidth: style?.width,
    });
    const outer = computed.filter(({ type }) => type === "adr_high" || type === "adr_low").map((level) => makeLine(level, outerStyle));
    const inner = computed.filter(({ type }) => type === "adr_inner_high" || type === "adr_inner_low").map((level) => makeLine(level, innerStyle));
    if (outerStyle?.visible !== false) lines.push(...outer);
    if (innerStyle?.visible !== false) lines.push(...inner);
    if (instance.params.midLine === true && midStyle?.visible !== false) {
      const priceTicks = Math.round(open.price / (symbol === "MES" ? 0.25 : 0.25));
      lines.push({
        price: open.price, price_ticks: priceTicks, role: "adr", label: `${open.price.toFixed(2)} ADR ${length} open`,
        names: `ADR ${length} open`, keys: [`${instance.instanceId}:${sessionDate}:mid`], proxy: false,
        startAt: open.at, endAt: open.to, color: midStyle?.color, lineStyle: midStyle?.style, lineWidth: midStyle?.width,
      });
    }
    const fill = instance.style.bandFill;
    if (fill?.kind === "fill" && fill.visible && outer.length === 2 && inner.length === 2) {
      const upper = [outer.find(({ price }) => price > open.price)!, inner.find(({ price }) => price > open.price)!];
      const lower = [inner.find(({ price }) => price < open.price)!, outer.find(({ price }) => price < open.price)!];
      for (const [side, pair] of [["upper", upper], ["lower", lower]] as const) zones.push({
        id: `${instance.instanceId}:${sessionDate}:${side}`, label: `ADR ${length} ${side} band`,
        priceLow: Math.min(...pair.map(({ price }) => price)), priceHigh: Math.max(...pair.map(({ price }) => price)),
        role: "adr", lines: pair, startAt: open.at, endAt: open.to, color: fill.color, fillOpacity: fill.opacity,
      });
    }
  }
  return { instanceId: instance.instanceId, length, lines, zones, unavailableDates };
}

/** Oldest session needed for an ADR instance: history length plus the displayed prior days. */
export function adrRequiredSessionDates(currentSessionDate: string, instances: readonly IndicatorInstance[]) {
  const count = instances.reduce((max, instance) => Math.max(max,
    Math.trunc(Number(instance.params.length)) + Math.trunc(Number(instance.params.daysBack)) - 1), 0);
  return Array.from({ length: Math.max(0, count) + 1 }, (_, index) => priorSession(currentSessionDate, index));
}
