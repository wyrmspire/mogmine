// R3-06: week_high and week_low resolve Tue-Fri once the earlier sessions of the week are loaded (LV-1, docs/24 §3 & §5).
// Synthetic 1m bars only: no candle source is reached.
import test from "node:test";
import assert from "node:assert/strict";
import { buildAgentLevels } from "../agent/levels.ts";
import type { AgentLevelsQuery, LevelsCandleSource } from "../agent/levels.ts";
import { earlierWeekSessionWindows, tradeLevelReport, tradeLevelWindows } from "../chart-levels.ts";
import type { LevelCandles } from "../chart-levels.ts";
import type { JournalCommands } from "../commands/journal-commands.ts";
import { equityIndexSessionBounds } from "../session.ts";
import type { Candle } from "../trades.ts";

const MIN = 60_000;
const MON = "2026-11-16";
const TUE = "2026-11-17";
const WED = "2026-11-18";
const THU = "2026-11-19";
const FRI = "2026-11-20";
// 10:00 ET on Thursday is 15:00 UTC (EST, after the 1 November change).
const THU_ENTRY = "2026-11-19T15:00:00.000Z";

/** One flat 1m bar per minute from `from` to `to` (exclusive). High and low a quarter point either side. */
function flat(from: number, to: number, price = 7400): Candle[] {
  const bars: Candle[] = [];
  for (let time = from; time < to; time += MIN) {
    bars.push({ time, open: price, high: price + 0.25, low: price - 0.25, close: price, volume: 100 });
  }
  return bars;
}

/** Replaces the bar at `time`, or adds it when absent. */
function setBar(bars: Candle[], time: number, bar: Omit<Candle, "time" | "volume">): Candle[] {
  const others = bars.filter((item) => item.time !== time);
  return [...others, { time, volume: 100, ...bar }].sort((a, b) => a.time - b.time);
}

/** Every regular-session window of one date, as 1m candles. */
function dayCandles(date: string, price = 7400): LevelCandles {
  const bounds = equityIndexSessionBounds(date);
  return { candles: flat(bounds.open, bounds.close, price), baseTimeframe: "1m" };
}

/** Full 1m coverage for Mon to Wed (the prior session), and Thursday up to entry. */
function thursdayLoad() {
  const entry = Date.parse(THU_ENTRY);
  const thu = equityIndexSessionBounds(THU);
  return {
    trade: { symbol: "MES", entry_time: THU_ENTRY },
    prior: dayCandles(WED),
    today: { candles: flat(thu.open, entry), baseTimeframe: "1m" as const },
    earlier: { mon: dayCandles(MON), tue: dayCandles(TUE) },
  };
}

test("earlier week windows: none on Monday or Tuesday, Monday on Wednesday, then Mon-Tue and Mon-Wed", () => {
  assert.equal(earlierWeekSessionWindows(MON).length, 0);
  assert.equal(earlierWeekSessionWindows(TUE).length, 0);
  assert.deepEqual(earlierWeekSessionWindows(WED).map((w) => w.sessionDate), [MON]);
  assert.deepEqual(earlierWeekSessionWindows(THU).map((w) => w.sessionDate), [MON, TUE]);
  assert.deepEqual(earlierWeekSessionWindows(FRI).map((w) => w.sessionDate), [MON, TUE, WED]);
  const monday = earlierWeekSessionWindows(WED)[0];
  const bounds = equityIndexSessionBounds(MON);
  assert.deepEqual({ from: monday.from, to: monday.to }, { from: bounds.open, to: bounds.close });
});

test("tradeLevelWindows carries the earlier week windows of the trade's session", () => {
  const windows = tradeLevelWindows(THU_ENTRY);
  assert.deepEqual(windows.earlierWeek.map((w) => w.sessionDate), [MON, TUE]);
});

test("a Thursday trade with Mon-Wed and Thu-to-entry bars emits week_high and week_low, none withheld", () => {
  const { trade, prior, today, earlier } = thursdayLoad();
  // Monday holds the week's highest bar (7600) and Tuesday the lowest (7300).
  const monBounds = equityIndexSessionBounds(MON);
  const monday = { candles: setBar(earlier.mon.candles, monBounds.open + 600 * MIN, { open: 7400, high: 7600, low: 7399.75, close: 7400 }), baseTimeframe: "1m" as const };
  const tueBounds = equityIndexSessionBounds(TUE);
  const tuesday = { candles: setBar(earlier.tue.candles, tueBounds.open + 600 * MIN, { open: 7400, high: 7400.25, low: 7300, close: 7400 }), baseTimeframe: "1m" as const };
  const report = tradeLevelReport(trade, prior, today, [monday, tuesday]);
  assert.ok(report);
  const high = report.levels.find((level) => level.key === "week_high");
  const low = report.levels.find((level) => level.key === "week_low");
  assert.equal(high?.price, 7600);
  assert.equal(low?.price, 7300);
  assert.equal(report.withheld.filter((item) => item.reason === "not-loaded").length, 0);
  assert.equal(report.withheld.length, 0);
});

test("a missing Monday leaves PDH, PDL, ONH and ONL computed and week levels not-loaded", () => {
  const { trade, prior, today, earlier } = thursdayLoad();
  const report = tradeLevelReport(trade, prior, today, [null, earlier.tue]);
  assert.ok(report);
  const keys = report.levels.map((level) => level.key);
  for (const key of ["pdh", "pdl", "onh", "onl"] as const) assert.ok(keys.includes(key), `${key} should compute`);
  assert.ok(!keys.includes("week_high") && !keys.includes("week_low"));
  const withheld = (key: string) => report.withheld.find((item) => item.key === key)?.reason;
  assert.equal(withheld("week_high"), "not-loaded");
  assert.equal(withheld("week_low"), "not-loaded");
});

test("a Monday on 5m bars while prior is 1m is dropped: PDH/PDL still compute, week levels not-loaded", () => {
  const { trade, prior, today, earlier } = thursdayLoad();
  const monday5m: LevelCandles = { candles: flat(equityIndexSessionBounds(MON).open, equityIndexSessionBounds(MON).close).filter((_, i) => i % 5 === 0), baseTimeframe: "5m" };
  const report = tradeLevelReport(trade, prior, today, [monday5m, earlier.tue]);
  assert.ok(report);
  const keys = report.levels.map((level) => level.key);
  assert.ok(keys.includes("pdh") && keys.includes("pdl") && keys.includes("onh") && keys.includes("onl"));
  assert.equal(report.withheld.find((item) => item.key === "week_high")?.reason, "not-loaded");
});

test("buildAgentLevels on a Thursday loads Mon-Thu and reports week_high and week_low as computed", async () => {
  const asOfIso = "2026-11-19T15:30:00.000Z";
  const bars = flat(equityIndexSessionBounds(MON).open, Date.parse(asOfIso));
  const calls: Array<{ from: number; to: number }> = [];
  const source: LevelsCandleSource = async (_symbol, from, to) => {
    calls.push({ from, to });
    return { bars: bars.filter((bar) => bar.time >= from && bar.time < to), provider: "yahoo_finance" };
  };
  const commands = { listFiltered: async () => ({ ok: true, value: [] }) } as unknown as JournalCommands;
  const query: AgentLevelsQuery = { symbol: "MES", sessionDate: THU, asOfIso };
  const result = await buildAgentLevels(query, commands, source);
  assert.ok(result.ok, result.ok ? "" : result.error.message);
  // Prior (Wed), today (Thu), and the earlier days Mon and Tue.
  assert.equal(calls.length, 4);
  assert.ok(calls.some((call) => call.from === equityIndexSessionBounds(MON).open && call.to === equityIndexSessionBounds(MON).close));
  assert.ok(calls.some((call) => call.from === equityIndexSessionBounds(TUE).open && call.to === equityIndexSessionBounds(TUE).close));
  const computed = result.value.computed.map((level) => level.key);
  assert.ok(computed.includes("week_high") && computed.includes("week_low"));
  assert.ok(!result.value.withheld.some((item) => item.key === "week_high" || item.key === "week_low"));
});
