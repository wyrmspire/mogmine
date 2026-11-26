// IK-3: pure filtering/styling for one Session levels instance.
import { levelLines, mergeLevelZones } from "./chart-levels.ts";
import type { LevelLine, LevelZone } from "./chart-levels.ts";
import type { ComputedLevel } from "./levels.ts";
import type { IndicatorInstance, IndicatorLineSlot } from "./indicator-kit.ts";

export type SessionLevelGroup = "priorDay" | "overnight" | "opens" | "week" | "pivots";
const GROUP_TYPES: Record<SessionLevelGroup, readonly string[]> = {
  priorDay: ["pdh", "pdl", "pdc", "rth_high", "rth_low", "rth_close"],
  overnight: ["onh", "onl"],
  opens: ["globex_open", "rth_open"],
  week: ["week_high", "week_low"],
  pivots: ["pp", "r1", "s1", "r2", "s2"],
};

export interface SessionLevelDay {
  sessionDate: string;
  from: number;
  to: number;
  levels: readonly ComputedLevel[];
}

function groupFor(key: string): SessionLevelGroup | null {
  return (Object.entries(GROUP_TYPES) as [SessionLevelGroup, readonly string[]][]).find(([, types]) => types.includes(key))?.[0] ?? null;
}

function midpoint(a: ComputedLevel | undefined, b: ComputedLevel | undefined, key: string, label: string): ComputedLevel[] {
  if (!a || !b) return [];
  const price = (a.price + b.price) / 2;
  return [{ key: key as ComputedLevel["key"], type: key as ComputedLevel["type"], label: label as ComputedLevel["label"],
    price, price_ticks: Math.round((a.price_ticks + b.price_ticks) / 2), formula: `(${a.label} + ${b.label})/2` }];
}

export function buildSessionLevelIndicator(
  instance: IndicatorInstance,
  days: readonly SessionLevelDay[],
  referencePrice: number,
  symbol: string,
  merge = true,
): { lines: LevelLine[]; zones: LevelZone[] } {
  const wanted = Math.max(1, Math.min(10, Math.trunc(Number(instance.params.daysBack))));
  const selected = days.slice(0, wanted);
  const allLines = selected.flatMap((day) => {
    const byKey = new Map(day.levels.map((level) => [level.key, level]));
    const mids = instance.params.midLines === true ? [
      ...midpoint(byKey.get("pdh"), byKey.get("pdl"), "pdh", "Prior-day mid"),
      ...midpoint(byKey.get("onh"), byKey.get("onl"), "onh", "Overnight mid"),
    ] : [];
    return levelLines([...day.levels, ...mids].filter((level) => {
      const group = String(level.label) === "Prior-day mid" ? "priorDay" : String(level.label) === "Overnight mid" ? "overnight" : groupFor(level.type);
      return group != null && instance.params[group] !== false && instance.style[group]?.visible !== false;
    }), referencePrice, symbol).map((line) => {
      const source = [...day.levels, ...mids].find(({ key, price }) => line.keys.includes(key) && price === line.price);
      const group = String(source?.label) === "Prior-day mid" ? "priorDay" : String(source?.label) === "Overnight mid" ? "overnight" : groupFor(source?.type ?? "");
      const style = group && instance.style[group]?.kind === "line" ? instance.style[group] as IndicatorLineSlot : null;
      return { ...line, startAt: day.from, endAt: day.to, color: style?.color, lineStyle: style?.style, lineWidth: style?.width };
    });
  });
  const merged = merge ? mergeLevelZones(allLines, Number(instance.params.mergeTolerance)) : { lines: allLines, zones: [] };
  const fill = instance.style.zoneFill;
  if (fill?.kind === "fill") for (const zone of merged.zones) zone.fillOpacity = fill.visible ? fill.opacity : 0;
  return merged;
}
