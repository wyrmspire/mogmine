// Session coverage for the 1m archive (AC-03). Expected bars follow a simple Globex
// window: prior calendar day 18:00 ET to session day 17:00 ET. Empty weekend
// calendar dates are `closed`. Holiday and early-close awareness is issue #65.

import { sessionDate } from "./session.ts";
import type { ArchiveTicker } from "./archive-config.ts";
import type { Timeframe } from "./trades.ts";

const NEW_YORK = "America/New_York";

const nyParts = new Intl.DateTimeFormat("en-US", {
  timeZone: NEW_YORK,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function partsInZone(ms: number) {
  return Object.fromEntries(nyParts.formatToParts(new Date(ms)).map((part) => [part.type, part.value]));
}

/** UTC instant for a civil time in America/New_York. 17:00 and 18:00 are outside the DST overlap. */
export function zonedTimeToUtc(year: number, month: number, day: number, hour: number, minute = 0): number {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute);
  const asIfUtc = (ms: number) => {
    const parts = partsInZone(ms);
    return Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour) % 24,
      Number(parts.minute),
      Number(parts.second) || 0,
    );
  };
  return utcGuess - (asIfUtc(utcGuess) - utcGuess);
}

function civilParts(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return { year, month, day };
}

function addCivilDays(date: string, days: number): string {
  const { year, month, day } = civilParts(date);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export function isWeekendCalendarDate(date: string): boolean {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return weekday === 0 || weekday === 6;
}

/** Session open (prior civil day 18:00 ET) and close (session day 17:00 ET, exclusive). */
export function sessionBounds(session: string): { open: number; close: number } {
  const closeParts = civilParts(session);
  const openDate = addCivilDays(session, -1);
  const openParts = civilParts(openDate);
  return {
    open: zonedTimeToUtc(openParts.year, openParts.month, openParts.day, 18, 0),
    close: zonedTimeToUtc(closeParts.year, closeParts.month, closeParts.day, 17, 0),
  };
}

export function expectedBarTimes(session: string, stepMs = 60_000): number[] {
  if (isWeekendCalendarDate(session)) return [];
  const { open, close } = sessionBounds(session);
  const times: number[] = [];
  for (let time = open; time < close; time += stepMs) times.push(time);
  return times;
}

export type CoverageStatus = "complete" | "partial" | "missing" | "closed";

export interface MissingRange {
  from: string;
  to: string;
  bars: number;
}

export interface CoverageSnapshot {
  symbol: ArchiveTicker;
  timeframe: Timeframe;
  session_date: string;
  expected_bars: number;
  received_bars: number;
  missing_ranges: MissingRange[];
  status: CoverageStatus;
  updated_at?: string;
}

const GAP_MS = 5 * 60_000;
const PARTIAL_GAP_MS = 30 * 60_000;

export function buildCoverage(input: {
  symbol: ArchiveTicker;
  timeframe?: Timeframe;
  sessionDate: string;
  barTimes: number[];
}): CoverageSnapshot {
  const timeframe = input.timeframe ?? "1m";
  if (isWeekendCalendarDate(input.sessionDate)) {
    return {
      symbol: input.symbol,
      timeframe,
      session_date: input.sessionDate,
      expected_bars: 0,
      received_bars: 0,
      missing_ranges: [],
      status: "closed",
    };
  }

  const expected = expectedBarTimes(input.sessionDate);
  const received = new Set(input.barTimes);
  const receivedBars = expected.reduce((count, time) => count + (received.has(time) ? 1 : 0), 0);
  // Bars that fall in the session but are not on the exact expected grid still count as received.
  const extras = input.barTimes.filter((time) => time >= (expected[0] ?? 0) && time < (expected[expected.length - 1] ?? 0) + 60_000 && !received.has(time)).length;
  const receivedCount = receivedBars + extras;

  const missingRanges: MissingRange[] = [];
  let gapStart: number | null = null;
  let gapBars = 0;
  const flush = (end: number) => {
    if (gapStart == null || gapBars === 0) return;
    const duration = end - gapStart;
    if (duration >= GAP_MS) {
      missingRanges.push({ from: new Date(gapStart).toISOString(), to: new Date(end).toISOString(), bars: gapBars });
    }
    gapStart = null;
    gapBars = 0;
  };

  for (const time of expected) {
    if (!received.has(time)) {
      if (gapStart == null) gapStart = time;
      gapBars += 1;
    } else {
      flush(time);
    }
  }
  if (expected.length) flush(expected[expected.length - 1] + 60_000);

  let status: CoverageStatus;
  if (receivedCount === 0) status = "missing";
  else if (missingRanges.some((range) => Date.parse(range.to) - Date.parse(range.from) >= PARTIAL_GAP_MS)) status = "partial";
  else status = "complete";

  return {
    symbol: input.symbol,
    timeframe,
    session_date: input.sessionDate,
    expected_bars: expected.length,
    received_bars: receivedCount,
    missing_ranges: missingRanges,
    status,
  };
}

/** Civil dates (ET) and session dates that intersect [from, to]. */
export function datesInRange(from: Date, to: Date): { calendarDates: string[]; sessionDates: string[] } {
  const calendar = new Set<string>();
  const sessions = new Set<string>();
  const start = from.getTime();
  const end = to.getTime();
  for (let time = start; time <= end; time += 60 * 60_000) {
    const parts = partsInZone(time);
    calendar.add(`${parts.year}-${parts.month}-${parts.day}`);
    sessions.add(sessionDate(time));
  }
  const partsEnd = partsInZone(end);
  calendar.add(`${partsEnd.year}-${partsEnd.month}-${partsEnd.day}`);
  sessions.add(sessionDate(end));
  return {
    calendarDates: [...calendar].sort(),
    sessionDates: [...sessions].sort(),
  };
}
