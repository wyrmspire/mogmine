// Why a candle level is withheld on a trade chart (docs/12 §5 "missing-level warnings show at every preset";
// docs/24 §5 "extremes need whole bars through the cutoff"; OD-55). Pure, no I/O. The rule stays strict: this
// module only names what is withheld and why, in a short form the View menu can show.
import { levelLabel } from "./levels.ts";
import type { ComputedLevelType } from "./levels.ts";

export type WithheldReason = "gaps" | "no-bars" | "not-loaded" | "needs-1m" | "not-yet";

export interface WithheldLevel {
  key: ComputedLevelType;
  reason: WithheldReason;
  /** Which window the level reads. */
  window: "prior session" | "prior RTH" | "overnight" | "week";
  /** Bars the window expected but Yahoo did not serve (for `gaps`). */
  missingBars: number;
}

interface Coverage { expectedBars: number; presentBars: number; complete: boolean }

export interface LevelCoverage {
  previous: Coverage;
  rth: Coverage;
  overnight: Coverage;
  /** Monday to the trade's session, in order. */
  week: readonly Coverage[];
}

const WINDOW: Record<string, WithheldLevel["window"]> = {
  pdh: "prior session", pdl: "prior session", rth_open: "prior RTH", rth_high: "prior RTH", rth_low: "prior RTH",
  rth_close: "prior RTH", globex_open: "overnight", onh: "overnight", onl: "overnight",
  week_high: "week", week_low: "week",
};

function fromWindow(coverage: Coverage): Pick<WithheldLevel, "reason" | "missingBars"> {
  const missingBars = Math.max(0, coverage.expectedBars - coverage.presentBars);
  if (coverage.expectedBars === 0) return { reason: "not-yet", missingBars: 0 };
  if (coverage.presentBars === 0) return { reason: "no-bars", missingBars };
  return { reason: "gaps", missingBars };
}

/** The reason for each withheld candle level, read from the coverage LV-1 already records. */
export function withheldReasons(
  missing: readonly ComputedLevelType[], coverage: LevelCoverage, timeframe: string,
): WithheldLevel[] {
  // The loader reads only the prior session and today (useTradeLevels), so earlier week days arrive empty.
  const earlierDays = coverage.week.slice(0, Math.max(0, coverage.week.length - 2));
  return missing.map((key) => {
    const window = WINDOW[key] ?? "prior session";
    let why: Pick<WithheldLevel, "reason" | "missingBars">;
    if (key === "rth_close" && timeframe !== "1m") why = { reason: "needs-1m", missingBars: 0 };
    else if (key === "week_high" || key === "week_low") {
      const total = coverage.week.reduce((sum, day) => sum + Math.max(0, day.expectedBars - day.presentBars), 0);
      why = earlierDays.some((day) => day.presentBars === 0 && day.expectedBars > 0)
        ? { reason: "not-loaded", missingBars: total }
        : { reason: "gaps", missingBars: total };
    } else if (key === "rth_open" || key === "rth_close") {
      why = coverage.rth.presentBars === 0 ? fromWindow(coverage.rth) : { reason: "gaps", missingBars: 1 };
    } else if (key === "globex_open") {
      why = coverage.overnight.presentBars === 0 ? fromWindow(coverage.overnight) : { reason: "gaps", missingBars: 1 };
    } else {
      why = fromWindow(key === "pdh" || key === "pdl" ? coverage.previous : key === "onh" || key === "onl" ? coverage.overnight : coverage.rth);
    }
    return { key, window, ...why };
  });
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

function reasonText(reason: WithheldReason, window: WithheldLevel["window"], missingBars: number) {
  switch (reason) {
    case "gaps": return `Yahoo skipped ${plural(missingBars, "bar")} (${window})`;
    case "no-bars": return `no bars from Yahoo (${window})`;
    case "not-loaded": return "earlier sessions this week not loaded";
    case "needs-1m": return "needs 1m bars";
    case "not-yet": return "not formed by the entry";
  }
}

/** `PDH, PDL: Yahoo skipped 18 bars (prior session) · Wk high, Wk low: earlier sessions this week not loaded`. */
export function withheldText(withheld: readonly WithheldLevel[]): string {
  const groups = new Map<string, { names: string[]; text: string }>();
  for (const level of withheld) {
    const text = reasonText(level.reason, level.window, level.missingBars);
    const group = groups.get(text) ?? { names: [], text };
    group.names.push(levelLabel(level.key));
    groups.set(text, group);
  }
  return [...groups.values()].map(({ names, text }) => `${names.join(", ")}: ${text}`).join(" · ");
}

interface LevelsViewState {
  status: "off" | "loading" | "none" | "ready";
  lines: readonly unknown[];
  withheld: readonly WithheldLevel[];
  planned: number;
  summary: string;
}

/** The View menu's short status: `18 shown · 6 withheld`. */
export function levelsStatusText(state: LevelsViewState): string {
  if (state.status === "off") return "Off";
  if (state.status === "loading") return "Loading…";
  if (state.status === "none" && !state.withheld.length) return "Unavailable";
  return `${state.lines.length} shown${state.withheld.length ? ` · ${state.withheld.length} withheld` : ""}`;
}

/** The View item's tooltip: what is drawn, what is withheld and why, and every level with its price. */
export function levelsTitle(state: LevelsViewState): string {
  return [
    "Prior-day, overnight and planned levels as of the entry.",
    state.planned ? `${state.planned} from planning sessions.` : "",
    state.withheld.length ? `Withheld, never guessed: ${withheldText(state.withheld)}.` : "",
    state.summary ? `Levels: ${state.summary}` : "",
  ].filter(Boolean).join(" ");
}
