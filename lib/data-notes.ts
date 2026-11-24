// Issue #83: the data-quality notes under the Trade Detail chart collapse into one chip.
// Pure: classifies and counts notes. Never changes R, P&L, or journal stats.
// Hindsight ("After the exit") is NOT a data note and is never returned here (docs/08, #37).
//
// Tone rule: "untrusted" (amber) only when bar coverage is missing or partial, because MAE/MFE and
// the bar check cannot be fully trusted. Every other note is "quiet" (muted, like `.chart-note.fact`).

import { formatPrice } from "./format.ts";
import { formatDetailTime, formatListTime } from "./time.ts";
import type { BarCoverage, TradeBarFinding } from "./trade-bar-validation.ts";

export type DataNoteId =
  | "coverage_missing"
  | "coverage_partial"
  | "not_1m"
  | "continuous_contract"
  | "same_bar_unresolved"
  | `${TradeBarFinding["code"]}:${string}`;

export type DataNoteTone = "untrusted" | "quiet";

/** A one-tap fix the UI may offer (FB-2 renders "Use HH:MM"). Nothing changes until the trader taps it. */
export interface DataNoteAction {
  kind: "use_matched_fill";
  role: "entry" | "exit";
  matchedBarTime: number;
  label: string;
}

export interface DataNote {
  id: DataNoteId;
  text: string;
  tone: DataNoteTone;
  action?: DataNoteAction;
}

export interface DataNoteInput {
  // candles.status === "none" for a real (non-sample) trade: the chart is not shown and coverage is missing.
  noCandles: boolean;
  // Chart is ready and the base bar timeframe is known (null while loading).
  base: string | null;
  // Yahoo fills sit off the bars (continuous-contract misalignment).
  misaligned: boolean;
  ticker: string;
  // Null when there is no bar check (sample trades, or still loading).
  coverage: BarCoverage | null;
  // The displayed bar contains both fills. Only meaningful when coverage is "complete".
  chronologyUnresolved: boolean;
  findings: readonly TradeBarFinding[];
  symbol: string;
  zone?: string;
}

const findingSentence: Record<Exclude<TradeBarFinding["code"], "fill_time_shifted">, (price: string, time: string) => string> = {
  stop_traded_through: (price, time) => `The ${time} bar reached or passed the recorded stop at ${price} while the position was open.`,
  target_traded_through: (price, time) => `The ${time} bar reached or passed the unfilled target at ${price} while the position was open.`,
  fill_outside_bar: (price, time) => `The recorded fill at ${price} is outside the ${time} bar by more than the price tolerance.`,
};

export function collectDataNotes(input: DataNoteInput): DataNote[] {
  // With no candles the chart is not shown, so the only note is the coverage one (never duplicated).
  if (input.noCandles) return [COVERAGE_MISSING];

  const notes: DataNote[] = [];
  if (input.base !== null && input.base !== "1m") {
    notes.push({ id: "not_1m", text: `1m data was not captured for this trade — showing ${input.base} bars.`, tone: "quiet" });
  }
  if (input.misaligned) {
    notes.push({ id: "continuous_contract", text: `Candles are from the ${input.ticker} continuous contract. Your fills may sit slightly off the bars.`, tone: "quiet" });
  }
  if (input.coverage === "missing") notes.push(COVERAGE_MISSING);
  if (input.coverage === "partial") {
    notes.push({ id: "coverage_partial", text: "Bar coverage is partial — some candles in the hold are missing, so this is not a complete check.", tone: "untrusted" });
  }
  if (input.coverage === "complete" && input.chronologyUnresolved) {
    notes.push({ id: "same_bar_unresolved", text: "Entry and exit sit in the same bar, so this check cannot establish order between them.", tone: "quiet" });
  }
  for (const finding of input.findings) {
    const { code, segment, barTime, price, basis } = finding;
    const id: DataNoteId = `${code}:${barTime}:${price}:${segment}`;
    if (code === "fill_time_shifted") {
      notes.push(shiftedFillNote(finding, id, input.zone));
      continue;
    }
    const sentence = findingSentence[code](formatPrice(price, input.symbol), formatDetailTime(barTime, input.zone));
    notes.push({ id, text: basis === "inferred" ? `≈ ${sentence}` : sentence, tone: "quiet" });
  }
  return notes;
}

// FB-1: the trader's logged minute stays as recorded. This note says where the fill traded and offers the matched minute.
function shiftedFillNote(finding: TradeBarFinding, id: DataNoteId, zone?: string): DataNote {
  const role = finding.role ?? "entry";
  const matched = formatListTime(finding.barTime, zone);
  const logged = formatListTime(finding.statedBarTime ?? finding.barTime, zone);
  const label = role === "exit" ? "Exit" : "Entry";
  return {
    id,
    text: `${label} drawn on the ${matched} bar; you logged ${logged}.`,
    tone: "quiet",
    action: { kind: "use_matched_fill", role, matchedBarTime: finding.barTime, label: `Use ${matched}` },
  };
}

const COVERAGE_MISSING: DataNote = {
  id: "coverage_missing",
  text: "Bar coverage is missing — this check cannot confirm the trade against the candles.",
  tone: "untrusted",
};

export function dataNoteCountLabel(count: number): string {
  return count === 1 ? "1 data note" : `${count} data notes`;
}

// The chip is amber only when a note makes the coverage untrusted.
export function hasUntrustedDataNote(notes: readonly DataNote[]): boolean {
  return notes.some((note) => note.tone === "untrusted");
}
