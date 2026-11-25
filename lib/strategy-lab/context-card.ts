/**
 * Context Card model (SL-7, docs/design-2026-11-24/09 §1, §10.1, §12.2). Pure: no I/O and no DOM.
 * This file assembles the card for a mark: the decision bar (the bar that closed at the marked minute,
 * SLQ-15), the header and R basis, the data line, the groups from `context-card-rows.ts`, and the screen state.
 * Rules: facts from later bars are `after-mark` rows, never mixed into at-mark rows; R is the fixed account R
 * size (D-A), never a stop width; Shield (UX-64) removes every dollar amount but keeps R and points.
 */
import { clockText, etToUtc } from "./et-clock.ts";
import { buildGroups, BAR_MS, fmt, MES_CARD_SPEC, type CardGroup, type CardMark, type CardRSize } from "./context-card-rows.ts";
import { createLevelIndex, levelBookAt, withLevels } from "./levels.ts";
import { vwapLevelsAt } from "./vwap.ts";
import type { BarSeries, SkillContext } from "./types.ts";

export type {
  CardGroup, CardGroupId, CardMark, CardRow, CardRSize, CardSide, CardSpec, CardWhen,
} from "./context-card-rows.ts";
export { AFTER_MARK_BARS, MES_CARD_SPEC } from "./context-card-rows.ts";
export { etToUtc } from "./et-clock.ts";

export interface CardOptions {
  rSize: CardRSize;
  shield: boolean;
  /** Sessions the loader excluded (5m-only, no data). Shown in the data line; makes the card partial. */
  excludedSessions?: number;
}

export interface ContextCard {
  header: string;
  basis: string;
  dataLine: string;
  decisionIndex: number | null;
  /** UTC ms at which the decision bar closed (the mark's minute). */
  decisionTime: number | null;
  groups: CardGroup[];
  /** Card-level gaps, such as no bar at the marked minute. */
  missing: string[];
  skippedRows: number;
  excludedSessions: number;
}

/** The marked minute's UTC start. A mark at 08:12 means "acting at 08:12:00 ET". */
export function markTimeUtc(mark: Pick<CardMark, "date" | "minuteOfDay">): number {
  return etToUtc(mark.date, mark.minuteOfDay);
}

/** Index of the bar that closed at the marked minute (it opened one minute earlier), or null when absent. */
export function decisionIndexFor(series: BarSeries, markTime: number): number | null {
  return series.byTime.get(markTime - BAR_MS) ?? null;
}

/** "R = $300 (SIM Eval 50K)", or "R · SIM Eval 50K" under Shield. Shown once per screen. */
export function rSizeBasis(rSize: CardRSize, shield: boolean): string {
  const basis = rSize.source === "account" && rSize.accountName ? rSize.accountName : "default risk budget";
  if (shield) return `R · ${basis}`;
  const amount = Number.isInteger(rSize.usd) ? rSize.usd.toFixed(0) : rSize.usd.toFixed(2);
  return `R = $${amount} (${basis})`;
}

function markHeader(mark: CardMark): string {
  const [y, m, d] = mark.date.split("-").map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).toLocaleString("en-US", { weekday: "short", timeZone: "UTC" });
  const hh = String(Math.floor(mark.minuteOfDay / 60)).padStart(2, "0");
  const mm = String(mark.minuteOfDay % 60).padStart(2, "0");
  return `${mark.side === "long" ? "Long" : "Short"} · ${weekday} ${m}/${d} ${hh}:${mm} ET · ${fmt(mark.price, 2)}`;
}

function countMissingVolume(series: BarSeries, date: string): number {
  let missing = 0;
  for (let k = 0; k < series.time.length; k += 1) {
    if (series.sessionDate[k] === date && Number.isNaN(series.volume[k])) missing += 1;
  }
  return missing;
}

/** Build the Context Card for a mark. Never throws on missing data: every gap becomes a named skipped row. */
export function buildContextCard(series: BarSeries, mark: CardMark, options: CardOptions): ContextCard {
  if (!Number.isFinite(options.rSize.usd) || options.rSize.usd <= 0) throw new RangeError("R size must be a positive dollar amount");
  if (!Number.isFinite(mark.price) || !Number.isInteger(mark.minuteOfDay) || mark.minuteOfDay < 0 || mark.minuteOfDay > 1439) {
    throw new RangeError("Mark needs a finite price and a minute of the day (0–1439)");
  }
  const excludedSessions = options.excludedSessions ?? 0;
  const markTime = markTimeUtc(mark);
  const decisionIndex = decisionIndexFor(series, markTime);
  const header = markHeader(mark);
  const basis = rSizeBasis(options.rSize, options.shield);
  const sessionsUsed = series.sessions.filter((s) => !s.excluded).length;
  const missingVolume = decisionIndex === null ? 0 : countMissingVolume(series, series.sessionDate[decisionIndex]);
  const dataLine = `Data: 1m · ${sessionsUsed} sessions${excludedSessions > 0 ? ` · ${excludedSessions} excluded` : ""}${missingVolume > 0 ? ` · ${missingVolume} bars without volume` : ""}`;

  if (decisionIndex === null) {
    return {
      header, basis, dataLine, decisionIndex: null, decisionTime: null, groups: [], skippedRows: 0, excludedSessions,
      missing: [`No 1m bar closes at ${clockText(markTime)} ET on ${mark.date}. Pick a minute inside a loaded session.`],
    };
  }

  const index = createLevelIndex(series);
  const levels = withLevels(levelBookAt(index, decisionIndex), vwapLevelsAt(series, decisionIndex));
  const ctx: SkillContext = {
    series, i: decisionIndex, params: {}, spec: MES_CARD_SPEC, rSizeUsd: options.rSize.usd, levels,
    mark: { price: mark.price, side: mark.side },
  };
  const groups = buildGroups({ ctx, side: mark.side, spec: MES_CARD_SPEC, rSizeUsd: options.rSize.usd, levels, shield: options.shield });
  const skippedRows = groups.reduce((n, group) => n + group.rows.filter((r) => r.status === "skipped").length, 0);
  return {
    header, basis, dataLine, decisionIndex, decisionTime: series.time[decisionIndex] + BAR_MS,
    groups, missing: [], skippedRows, excludedSessions,
  };
}

export type CardState = "loading" | "error" | "offline" | "partial" | "ready";

export interface CardStateInput {
  loading: boolean;
  error: string | null;
  offline: boolean;
  card: ContextCard | null;
}

/** Which state the screen shows. Loading and error win; offline shows cached data with a notice. */
export function deriveCardState(input: CardStateInput): CardState {
  if (input.loading) return "loading";
  if (input.error) return "error";
  if (input.offline) return "offline";
  const card = input.card;
  if (!card || card.missing.length > 0 || card.skippedRows > 0 || card.excludedSessions > 0) return "partial";
  return "ready";
}
