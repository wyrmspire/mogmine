// Right-edge pills for the trade chart (docs/08 UX-21, docs/12 LV-09). Pure, no I/O.
// Lines stay one per exact tick (rays draw at true prices). Pills merge lines a few ticks apart into one label,
// and rank who keeps a pill when the pane is crowded: the trade's own prices, then planned levels, then
// computed levels nearest the entry. The primitive lays pills out in pixels (`layoutPills`).
import { formatPrice } from "./format.ts";
import { specFor, toTicks } from "./trades.ts";
import type { TradeRecord } from "./trades.ts";
import type { LevelLine, LevelRole } from "./chart-levels.ts";

/** Lines whose whole span is within this many ticks share one pill (UX-21 "within a few ticks"). 1.00 pt on MES/MNQ. */
export const MERGE_TICKS = 4;

/** A price the trade itself owns. Laid out first so a level pill never covers it. */
export interface LevelAnchor {
  price: number;
  label: string;
  tone: "entry" | "risk" | "profit" | "key";
}

export interface LevelPill {
  price: number;
  label: string;
  role: LevelRole;
  /** Set for a trade price; level pills have none. */
  tone: LevelAnchor["tone"] | null;
  /** Lower keeps its pill first when space runs out. */
  rank: number;
  /** Ticks of every level line folded into this pill; a dropped pill fades these rays. */
  lineTicks: number[];
}

type AnchorTrade = Pick<TradeRecord, "symbol" | "entry_price" | "stop_loss_price" | "planned_target_price" | "key_level_price">
  & Partial<Pick<TradeRecord, "initial_stop_price">>;

/** Key level, entry, stop, first stop (when trailed or moved) and target, in that priority. */
export function tradeAnchors(trade: AnchorTrade): LevelAnchor[] {
  const anchors: LevelAnchor[] = [];
  const add = (price: number | null | undefined, label: string, tone: LevelAnchor["tone"]) => {
    if (price != null && Number.isFinite(price)) anchors.push({ price, label, tone });
  };
  add(trade.key_level_price, "Key", "key");
  add(trade.entry_price, "Entry", "entry");
  add(trade.stop_loss_price, "SL", "risk");
  if (trade.initial_stop_price != null && trade.initial_stop_price !== trade.stop_loss_price) add(trade.initial_stop_price, "Initial SL", "risk");
  add(trade.planned_target_price, "TP", "profit");
  return anchors;
}

const planned = (line: LevelLine) => line.keys.some((key) => key.startsWith("plan:"));
const ROLE_RANK: Record<LevelRole, number> = { adr: 3, resistance: 2, support: 2, neutral: 1 };

/** Group lines (highest first) whose span is within `MERGE_TICKS`. */
function clusters(lines: readonly LevelLine[]): LevelLine[][] {
  const sorted = [...lines].sort((a, b) => b.price_ticks - a.price_ticks);
  const groups: LevelLine[][] = [];
  for (const line of sorted) {
    const group = groups.at(-1);
    if (group && group[0].price_ticks - line.price_ticks <= MERGE_TICKS) group.push(line);
    else groups.push([line]);
  }
  return groups;
}

/**
 * Pills for the right edge. Each anchor is its own pill; level lines within `MERGE_TICKS` of an anchor fold into
 * it (`Key 7389.75 · PDH / RTH high`). Other lines merge with each other. A merged pill shows the price of its most
 * important member (planned first, then nearest the reference); the other members follow after ` · `.
 */
export function levelPills(
  lines: readonly LevelLine[], anchors: readonly LevelAnchor[], symbol: string, referencePrice: number,
): LevelPill[] {
  const ticksOf = (price: number) => toTicks(price, symbol) ?? Math.round(price / (specFor(symbol)?.tickSize ?? 0.25));
  const anchorTicks = anchors.map((anchor) => ticksOf(anchor.price));
  const folded = new Map<number, LevelLine[]>();
  const free: LevelLine[] = [];
  for (const line of lines) {
    let best = -1;
    anchorTicks.forEach((ticks, index) => {
      const distance = Math.abs(ticks - line.price_ticks);
      if (distance <= MERGE_TICKS && (best < 0 || distance < Math.abs(anchorTicks[best] - line.price_ticks))) best = index;
    });
    if (best < 0) free.push(line);
    else folded.set(best, [...(folded.get(best) ?? []), line]);
  }
  const referenceTicks = ticksOf(referencePrice);
  const pills: LevelPill[] = anchors.map((anchor, index) => {
    const members = folded.get(index) ?? [];
    const names = [anchor.label + " " + formatPrice(anchor.price, symbol), ...members.map((line) => line.names)];
    return {
      price: anchor.price, label: names.join(" · "), role: "neutral", tone: anchor.tone, rank: index,
      lineTicks: members.map((line) => line.price_ticks),
    };
  });
  for (const group of clusters(free)) {
    const byImportance = [...group].sort((a, b) => Number(planned(b)) - Number(planned(a))
      || Math.abs(a.price_ticks - referenceTicks) - Math.abs(b.price_ticks - referenceTicks));
    const primary = byImportance[0];
    const role = group.map((line) => line.role).reduce((top, next) => ROLE_RANK[next] > ROLE_RANK[top] ? next : top);
    const distance = Math.min(...group.map((line) => Math.abs(line.price_ticks - referenceTicks)));
    pills.push({
      price: primary.price,
      label: `${formatPrice(primary.price, symbol)} ${byImportance.map((line) => line.names).join(" · ")}`,
      role,
      tone: null,
      // Anchors rank 0–4, planned levels next, then computed levels by distance from the entry.
      rank: (group.some(planned) ? 1_000 : 1_000_000) + distance,
      lineTicks: group.map((line) => line.price_ticks),
    });
  }
  return pills;
}

/** Every level with its exact price, for the View tooltip: nothing a dropped pill hides is lost. */
export function levelsSummary(lines: readonly LevelLine[]): string {
  return lines.map((line) => line.label).join(" · ");
}
