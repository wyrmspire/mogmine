// UX-E2 (08 §4.3, §5, D-V3): price-axis tags for the selected trade, and R-ruler detection.
// Pure: no canvas, no DOM. Relative `.ts` imports so `node --test` loads it directly.
import type { ISeriesPrimitiveAxisView } from "lightweight-charts";
import { CHART_TOKENS } from "./chart-paint.ts";
import type { ChartTheme } from "./theme.ts";
import type { Mark } from "./trade-marks.ts";

export interface AxisTag {
  price: number;
  text: string;
  bg: string;
  fg: string;
}

/** Same off-pane sentinel as SessionLevelsPrimitive.priceAxisViews(). */
const OFF_PANE = -1000;
const SAME_PRICE = 1e-6;

type ZoneOrSegment = Extract<Mark, { kind: "zone" | "segment" }>;

/**
 * Price-axis tags for the selected trade only: entry, planned stop, planned target and actual exit.
 * Archived neighbours are never tagged. Each price is tagged once, so an exit that equals the entry,
 * stop or target adds nothing. Order is entry, stop, target, exit.
 */
export function extractTradeAxisTags(marks: readonly Mark[], theme: ChartTheme, precision = 2): AxisTag[] {
  const trade = marks.filter((m): m is ZoneOrSegment =>
    (m.kind === "zone" || m.kind === "segment") && m.layer !== "archived");
  const actualZones = trade.filter((m): m is Extract<ZoneOrSegment, { kind: "zone" }> => m.kind === "zone" && m.layer === "actual");
  const planZones = trade.filter((m): m is Extract<ZoneOrSegment, { kind: "zone" }> => m.kind === "zone" && m.layer === "plan");

  const entrySegment = trade.find((m) => m.kind === "segment" && m.tone === "entry");
  const entry = entrySegment?.p0 ?? actualZones[0]?.p0;
  const stop = planZones.find((m) => m.tone === "risk")?.p1;
  // The outer target is the planned profit zone whose far price lies furthest from its inner price.
  const target = planZones
    .filter((m) => m.tone === "profit")
    .reduce<Extract<ZoneOrSegment, { kind: "zone" }> | undefined>((best, m) =>
      !best || Math.abs(m.p1 - m.p0) > Math.abs(best.p1 - best.p0) ? m : best, undefined)?.p1;
  // The exit is the actual zone's far price furthest from the entry.
  const exitZone = entry == null ? undefined : actualZones.reduce<typeof actualZones[number] | undefined>((best, m) =>
    !best || Math.abs(m.p1 - entry) > Math.abs(best.p1 - entry) ? m : best, undefined);

  const tags: AxisTag[] = [];
  const add = (price: number | undefined, bg: string, fg: string) => {
    if (price == null || !Number.isFinite(price) || tags.some((t) => Math.abs(t.price - price) < SAME_PRICE)) return;
    tags.push({ price, text: price.toFixed(precision), bg, fg });
  };
  add(entry, theme.chipNeutral, CHART_TOKENS.chip.neutralText);
  add(stop, theme.chipRisk, CHART_TOKENS.chip.text);
  add(target, theme.chipReward, CHART_TOKENS.chip.text);
  if (exitZone) add(exitZone.p1, exitZone.tone === "profit" ? theme.chipReward : theme.chipRisk, CHART_TOKENS.chip.text);
  return tags;
}

/**
 * Canvas-free price-axis views for the tags. Off-pane prices return -1000 and are hidden by `visible()`,
 * matching SessionLevelsPrimitive.priceAxisViews().
 */
export function createPositionAxisViews(
  tags: readonly AxisTag[],
  priceToCoordinate: (price: number) => number | null,
  paneHeight: number,
): ISeriesPrimitiveAxisView[] {
  return tags.map((tag): ISeriesPrimitiveAxisView => {
    const coordinate = () => {
      const y = priceToCoordinate(tag.price);
      return y == null || y < 0 || y > paneHeight ? OFF_PANE : y;
    };
    return {
      coordinate,
      text: () => tag.text,
      textColor: () => tag.fg,
      backColor: () => tag.bg,
      visible: () => { const y = coordinate(); return y >= 0 && y <= paneHeight; },
      tickVisible: () => true,
    };
  });
}

/** R-ruler whole-multiple line: faint dotted plan segment, neutral tone (trade-marks.ts buildMarks). */
export function isRulerSegment(mark: Mark): boolean {
  return mark.kind === "segment" && mark.layer === "plan" && mark.faint === true
    && mark.dash === "dotted" && mark.tone === "neutral";
}

/** R-ruler label: priority 2 neutral label at the same anchor as its line. */
export function isRulerLabel(mark: Mark): boolean {
  return mark.kind === "label" && mark.priority === 2 && mark.tone === "neutral";
}
