// PS-4 after-session review (docs/24 §4). Pure: code computes every number, the model never does (guardrail 11).
import { planStateAsOf } from "./plans.ts";
import type { PlanningSession } from "./plans.ts";
import { equityIndexSessionBounds } from "./session.ts";
import { adherence, toTicks } from "./trades.ts";
import type { TradeRecord } from "./trades.ts";

export interface ReviewRow {
  trade_id: string;
  entry_time: string;
  /** `n/total followed`, the same seal as Trade Detail. Null without a checklist. */
  rules: { followed: number; total: number } | null;
  /** Nearest level of the plan as it stood at entry. `distance_ticks` is entry minus level: positive is above. */
  nearest: { label: string; price: number; distance_ticks: number } | null;
  /** Whether the trade's playbook was on the plan's watch list at entry. Null when the trade has no playbook. */
  watched: boolean | null;
}

export interface SessionReview {
  plan_id: string;
  /** UTC ms. The plan's anchor, or its creation time for an event preset with no anchor. */
  from: number;
  /** UTC ms, exclusive. The next checkpoint's anchor, or the session's 17:00 ET close. */
  to: number;
  rows: ReviewRow[];
  /** Totals over trades that have a checklist. Zero trades is a valid review. */
  rules: { followed: number; total: number };
  watched: { yes: number; of: number };
  lesson: string;
}

const startOf = (plan: PlanningSession) => Date.parse(plan.anchor_time_utc ?? plan.created_at);

/** Where a review window starts and ends: this checkpoint up to `until`, or to the session close. */
export function reviewWindow(plan: PlanningSession, until?: PlanningSession | null) {
  const from = startOf(plan);
  const close = equityIndexSessionBounds(plan.session_date).close;
  const next = until && until.session_date === plan.session_date ? startOf(until) : NaN;
  return { from, to: Number.isFinite(next) && next > from ? next : close };
}

export function sessionReview(plan: PlanningSession, trades: readonly TradeRecord[], until?: PlanningSession | null): SessionReview {
  const { from, to } = reviewWindow(plan, until);
  const rows = trades
    .filter((trade) => {
      const entry = Date.parse(trade.entry_time);
      // A plan marked on one instrument reviews only that instrument's trades (OD-15).
      return entry >= from && entry < to && (!plan.symbol || trade.symbol.toUpperCase() === plan.symbol);
    })
    .sort((a, b) => Date.parse(a.entry_time) - Date.parse(b.entry_time))
    .map((trade): ReviewRow => {
      const state = planStateAsOf(plan, Date.parse(trade.entry_time));
      const entryTicks = toTicks(trade.entry_price, trade.symbol);
      let nearest: ReviewRow["nearest"] = null;
      for (const level of state?.levels ?? []) {
        if (entryTicks == null) break;
        const distance = entryTicks - level.price_ticks;
        if (!nearest || Math.abs(distance) < Math.abs(nearest.distance_ticks)) {
          nearest = { label: level.label, price: level.price, distance_ticks: distance };
        }
      }
      const seal = adherence(trade);
      return {
        trade_id: trade.id,
        entry_time: trade.entry_time,
        rules: seal && { followed: seal.followed, total: seal.total },
        nearest,
        watched: trade.playbook_id ? (state?.watch_playbook_ids ?? []).includes(trade.playbook_id) : null,
      };
    });
  const withRules = rows.flatMap((row) => (row.rules ? [row.rules] : []));
  const withPlaybook = rows.filter((row) => row.watched !== null);
  return {
    plan_id: plan.id,
    from,
    to,
    rows,
    rules: {
      followed: withRules.reduce((sum, rules) => sum + rules.followed, 0),
      total: withRules.reduce((sum, rules) => sum + rules.total, 0),
    },
    watched: { yes: withPlaybook.filter((row) => row.watched).length, of: withPlaybook.length },
    lesson: plan.lesson ?? "",
  };
}

/**
 * Planning sessions to review on past days (PS-4c): live plans from the `days` session dates up to and
 * including `today`, newest day first, checkpoints in time order within a day.
 */
export function recentPlanDays(plans: readonly PlanningSession[], today: string, days = 14) {
  const earliest = new Date(Date.parse(`${today}T00:00:00Z`) - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  const byDate = new Map<string, PlanningSession[]>();
  for (const plan of plans) {
    if (plan.archived || plan.session_date > today || plan.session_date < earliest) continue;
    byDate.set(plan.session_date, [...(byDate.get(plan.session_date) ?? []), plan]);
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, list]) => ({ date, plans: list.sort((a, b) => startOf(a) - startOf(b)) }));
}
