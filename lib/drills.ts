// CD-2a drill cards (docs/23 §4, OD-46): pure deck selection, eligibility, the sealed cut and scoring.
// No storage and no React. Answers live in `mogmine-drills-v1` (CD-2b) and never touch `take_again`.
import { TIMEFRAME_MINUTES, isOpen, processRead } from "./trades.ts";
import { resolveRSize, resultR } from "./r-size.ts";
import type { Candle, RSizeOptions, Timeframe, TradeRecord } from "./trades.ts";

const DAY_MS = 86_400_000;
/** Same-day recall spoils a drill (BET-03): only trades older than this are dealt. */
export const DRILL_MIN_AGE_MS = 7 * DAY_MS;
/** A missed trade comes back after 1, then 3, then 7 days, then retires until missed again (§4.3). */
export const MISS_INTERVALS_DAYS = [1, 3, 7] as const;
/** Take-vs-pass averages are shown only after this many answered *Take it?* drills (§4.5). */
export const DRILL_SCORE_MIN_ANSWERS = 30;

export type DrillKind = "take_it";
/** What a *Take it?* front hides (§4.1), recorded on every answer (B-63, UX-52). */
export const DRILL_HIDDEN: readonly string[] = ["bars_after_entry", "entry_bar", "exit", "result", "tags", "notes", "mood"];
export type DrillAnswer = "take" | "smaller" | "pass";

export interface DrillRecord {
  id: string;
  user_id: string;
  trade_id: string;
  kind: DrillKind;
  answer: DrillAnswer;
  answered_at: string; // ISO UTC
  /** What the front hid (B-63, UX-52). */
  hidden: readonly string[];
}

export type DrillSkip = "open" | "sample" | "too_recent" | "no_bars";

type DrillTrade = Pick<TradeRecord, "id" | "entry_time" | "exit_time" | "is_sample"> & Partial<Pick<TradeRecord, "status">>;

/** Why a trade cannot be drilled now, or null when it can. `hasBars` is whether the candle cache holds it. */
export function drillSkipReason(trade: DrillTrade, now: number, hasBars: boolean): DrillSkip | null {
  if (isOpen(trade)) return "open";
  if (trade.is_sample) return "sample";
  const entry = Date.parse(trade.entry_time);
  if (!Number.isFinite(entry) || now - entry < DRILL_MIN_AGE_MS) return "too_recent";
  // Yahoo drops 1m after 30 days: a trade with no saved bars is skipped and counted, never drawn empty.
  if (!hasBars) return "no_bars";
  return null;
}

export interface Deck {
  trade_ids: string[];
  /** Counts of trades left out, for "3 trades skipped: no saved bars". */
  skipped: Partial<Record<DrillSkip, number>>;
}

/** A seeded shuffle, so a deck is reproducible in tests and stable while a drill is open. */
function shuffle<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  let state = (seed >>> 0) || 1;
  for (let i = out.length - 1; i > 0; i -= 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const j = state % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function eligible(trades: readonly TradeRecord[], now: number, hasBars: (id: string) => boolean) {
  const skipped: Deck["skipped"] = {};
  const ok = trades.filter((trade) => {
    const reason = drillSkipReason(trade, now, hasBars(trade.id));
    if (reason) skipped[reason] = (skipped[reason] ?? 0) + 1;
    return !reason;
  });
  return { ok, skipped };
}

/** Warm-up: five random eligible trades. */
export function warmupDeck(trades: readonly TradeRecord[], now: number, hasBars: (id: string) => boolean, seed: number, size = 5): Deck {
  const { ok, skipped } = eligible(trades, now, hasBars);
  return { trade_ids: shuffle(ok.map((trade) => trade.id), seed).slice(0, size), skipped };
}

/** One playbook's eligible trades, oldest first. */
export function playbookDeck(trades: readonly TradeRecord[], playbookId: string, now: number, hasBars: (id: string) => boolean): Deck {
  const { ok, skipped } = eligible(trades.filter((trade) => trade.playbook_id === playbookId), now, hasBars);
  return { trade_ids: ok.sort((a, b) => Date.parse(a.entry_time) - Date.parse(b.entry_time)).map((trade) => trade.id), skipped };
}

/**
 * Whether an answer disagreed with the result (§4.3): *Take it* on a losing trade that broke its rules, or
 * *Pass* on a winning trade that followed them. Null when the trade has no R or no process read to judge by.
 */
export function isMiss(answer: DrillAnswer, trade: TradeRecord, opts?: RSizeOptions): boolean | null {
  const r = resultR(trade, resolveRSize(trade, opts?.accounts, opts?.prefs));
  const process = processRead(trade);
  if (r == null || process == null) return null;
  if (answer === "take") return r < 0 && process === "broken";
  if (answer === "pass") return r > 0 && process === "clean";
  return false;
}

/** When a trade is next due in the misses deck, or null when it is not in it. */
export function missDueAt(trade: TradeRecord, records: readonly DrillRecord[], opts?: RSizeOptions): number | null {
  const answers = records
    .filter((record) => record.trade_id === trade.id && record.kind === "take_it")
    .sort((a, b) => Date.parse(a.answered_at) - Date.parse(b.answered_at));
  let lastMiss = -1;
  answers.forEach((record, index) => { if (isMiss(record.answer, trade, opts)) lastMiss = index; });
  if (lastMiss < 0) return null;
  const reviewsSince = answers.length - 1 - lastMiss;
  if (reviewsSince >= MISS_INTERVALS_DAYS.length) return null;
  return Date.parse(answers[answers.length - 1].answered_at) + MISS_INTERVALS_DAYS[reviewsSince] * DAY_MS;
}

/** Misses that are due now, longest overdue first. */
export function missesDeck(trades: readonly TradeRecord[], records: readonly DrillRecord[], now: number, hasBars: (id: string) => boolean, opts?: RSizeOptions): Deck {
  const { ok, skipped } = eligible(trades, now, hasBars);
  const due = ok.flatMap((trade) => {
    const at = missDueAt(trade, records, opts);
    return at != null && at <= now ? [{ id: trade.id, at }] : [];
  });
  return { trade_ids: due.sort((a, b) => a.at - b.at).map(({ id }) => id), skipped };
}

/**
 * The sealed front: only bars that closed by the entry. The entry bar itself is hidden, because its high,
 * low and close include prices after the fill.
 */
export function cutAtEntry(bars: readonly Candle[], entryTime: string, timeframe: Timeframe): Candle[] {
  const entry = Date.parse(entryTime);
  const barMs = TIMEFRAME_MINUTES[timeframe] * 60_000;
  return bars.filter((bar) => bar.time + barMs <= entry);
}

export interface TakeVsPass {
  /** Latest *Take it?* answer per trade, so a trade drilled ten times counts once. */
  take: { n: number; avgR: number | null };
  smaller: { n: number; avgR: number | null };
  pass: { n: number; avgR: number | null };
  /** Answered trades with no R (no stop), left out of every average. */
  noR: number;
  /** True once there are enough answers to show the comparison (§4.5). */
  ready: boolean;
}

/** Average R of trades answered *Take it* against those answered *Pass* (§4.5). */
export function takeVsPass(records: readonly DrillRecord[], trades: readonly TradeRecord[], opts?: RSizeOptions): TakeVsPass {
  const byId = new Map(trades.map((trade) => [trade.id, trade]));
  const latest = new Map<string, DrillRecord>();
  for (const record of records) {
    if (record.kind !== "take_it" || !byId.has(record.trade_id)) continue;
    const seen = latest.get(record.trade_id);
    if (!seen || Date.parse(record.answered_at) > Date.parse(seen.answered_at)) latest.set(record.trade_id, record);
  }
  const groups: Record<DrillAnswer, number[]> = { take: [], smaller: [], pass: [] };
  let noR = 0;
  for (const record of latest.values()) {
    const trade = byId.get(record.trade_id)!;
    const r = resultR(trade, resolveRSize(trade, opts?.accounts, opts?.prefs));
    if (r == null) noR += 1;
    else groups[record.answer].push(r);
  }
  const summary = (values: number[]) => ({ n: values.length, avgR: values.length ? values.reduce((sum, r) => sum + r, 0) / values.length : null });
  return {
    take: summary(groups.take), smaller: summary(groups.smaller), pass: summary(groups.pass), noR,
    ready: latest.size >= DRILL_SCORE_MIN_ANSWERS,
  };
}
