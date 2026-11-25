import { equityIndexSessionBounds, sessionDate } from "../session.ts";
import type { BarSeries, SessionInfo, SourceBar } from "./types.ts";

const BAR_MS = 60_000 as const;
const etClock = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hourCycle: "h23",
  hour: "2-digit",
  minute: "2-digit",
});

function minuteEt(time: number): number {
  const parts = Object.fromEntries(etClock.formatToParts(new Date(time)).map((part) => [part.type, part.value]));
  return (Number(parts.hour) % 24) * 60 + Number(parts.minute);
}

function validBar(bar: SourceBar): boolean {
  return Number.isFinite(bar.time)
    && [bar.open, bar.high, bar.low, bar.close].every(Number.isFinite)
    && bar.low <= Math.min(bar.open, bar.close)
    && bar.high >= Math.max(bar.open, bar.close);
}

interface Counts { invalid: number; duplicates: number }

/** Build a sorted, validated, DST-correct one-minute series without filling gaps. */
export function buildBarSeries(symbol: string, source: readonly SourceBar[]): BarSeries {
  const frequency = new Map<number, number>();
  for (const bar of source) {
    if (Number.isFinite(bar.time)) frequency.set(bar.time, (frequency.get(bar.time) ?? 0) + 1);
  }

  const countsBySession = new Map<string, Counts>();
  const dropped = { invalid: 0, duplicates: 0 };
  const kept: SourceBar[] = [];
  const countDrop = (bar: SourceBar, kind: keyof Counts) => {
    dropped[kind] += 1;
    if (!Number.isFinite(bar.time)) return;
    const date = sessionDate(bar.time);
    const counts = countsBySession.get(date) ?? { invalid: 0, duplicates: 0 };
    counts[kind] += 1;
    countsBySession.set(date, counts);
  };

  for (const bar of source) {
    if (!validBar(bar)) countDrop(bar, "invalid");
    else if ((frequency.get(bar.time) ?? 0) > 1) countDrop(bar, "duplicates");
    else kept.push(bar);
  }
  kept.sort((a, b) => a.time - b.time);

  const length = kept.length;
  const time = new Float64Array(length);
  const open = new Float64Array(length);
  const high = new Float64Array(length);
  const low = new Float64Array(length);
  const close = new Float64Array(length);
  const volume = new Float64Array(length);
  const dates = new Array<string>(length);
  const etMinute = new Uint16Array(length);
  const sessionStart = new Int32Array(length);
  const byTime = new Map<number, number>();
  const sessionRows = new Map<string, { first: number; present: number; volumeMissing: number }>();

  for (let i = 0; i < length; i += 1) {
    const bar = kept[i];
    time[i] = bar.time;
    open[i] = bar.open;
    high[i] = bar.high;
    low[i] = bar.low;
    close[i] = bar.close;
    volume[i] = typeof bar.volume === "number" && Number.isFinite(bar.volume) && bar.volume > 0
      ? bar.volume
      : Number.NaN;
    dates[i] = sessionDate(bar.time);
    etMinute[i] = minuteEt(bar.time);
    byTime.set(bar.time, i);

    const row = sessionRows.get(dates[i]) ?? { first: i, present: 0, volumeMissing: 0 };
    row.present += 1;
    if (Number.isNaN(volume[i])) row.volumeMissing += 1;
    sessionRows.set(dates[i], row);
    sessionStart[i] = row.first;
  }

  const allDates = new Set([...sessionRows.keys(), ...countsBySession.keys()]);
  const sessions: SessionInfo[] = [...allDates].sort().map((date) => {
    const bounds = equityIndexSessionBounds(date);
    const row = sessionRows.get(date);
    const counts = countsBySession.get(date) ?? { invalid: 0, duplicates: 0 };
    return {
      date,
      open: bounds.open,
      close: bounds.close,
      expectedBars: Math.max(0, Math.round((bounds.close - bounds.open) / BAR_MS)),
      presentBars: row?.present ?? 0,
      volumeMissing: row?.volumeMissing ?? 0,
      baseTimeframe: "1m",
      droppedInvalid: counts.invalid,
      droppedDuplicates: counts.duplicates,
    };
  });

  return {
    symbol,
    barMs: BAR_MS,
    time, open, high, low, close, volume,
    sessionDate: dates,
    etMinute,
    sessionStart,
    byTime,
    sessions,
    dropped,
  };
}

/** Rebuild a series through i; primarily used by the known-at test harness. */
export function truncateSeries(series: BarSeries, i: number): BarSeries {
  const end = Math.max(0, Math.min(series.time.length, i + 1));
  const bars: SourceBar[] = [];
  for (let j = 0; j < end; j += 1) {
    bars.push({
      time: series.time[j], open: series.open[j], high: series.high[j],
      low: series.low[j], close: series.close[j],
      volume: Number.isNaN(series.volume[j]) ? null : series.volume[j],
    });
  }
  return buildBarSeries(series.symbol, bars);
}
