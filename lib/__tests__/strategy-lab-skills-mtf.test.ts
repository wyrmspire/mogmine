import test from "node:test";
import assert from "node:assert/strict";
import { aggregate } from "../strategy-lab/aggregate.ts";
import { createSkillRegistry, getSkill, listSkills } from "../strategy-lab/registry.ts";
import { buildBarSeries } from "../strategy-lab/series.ts";
import type { LevelBook, SkillContext, SkillResult, SourceBar, Value } from "../strategy-lab/types.ts";
import {
  decisionMinute, minutesFromRthOpen, phaseOf, sessionClockSkill, todBucketOf,
} from "../strategy-lab/skills/clock.ts";
import {
  candleAt, confirm1mSkill, midrankPercentile, MTF_SKILLS, mtfCandleSkill, structure5mSkill,
} from "../strategy-lab/skills/mtf.ts";
import { assertNoLookahead } from "./strategy-lab-lookahead-harness.ts";

const MIN = 60_000;

// Nov 24 2026 is EST (−05:00); Jul 13 2026 is EDT (−04:00). Times are wall-clock ET.
const ET_WINTER = "-05:00";
const ET_SUMMER = "-04:00";
const et = (date: string, hhmm: string, offset = ET_WINTER) => Date.parse(`${date}T${hhmm}:00${offset}`);

type Row = [open: number, high: number, low: number, close: number];

function bar(time: number, open: number, high: number, low: number, close: number, volume = 100): SourceBar {
  return { time, open, high, low, close, volume };
}

function barsFrom(start: number, rows: readonly Row[]): SourceBar[] {
  return rows.map(([o, h, l, c], k) => bar(start + k * MIN, o, h, l, c));
}

function ctxOf(series: ReturnType<typeof buildBarSeries>, i: number, params: Record<string, Value> = {}): SkillContext {
  const levels: LevelBook = { asOf: series.time[i] + series.barMs, levels: [], byKey: new Map() };
  return {
    series,
    i,
    params,
    spec: { symbol: "MES", tickSize: 0.25, pointValueUsd: 5 },
    rSizeUsd: 300,
    levels,
  };
}

function valuesOf(result: SkillResult): Record<string, Value> {
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error("unreachable");
  return result.values;
}

// ---------- S1 sessionClock ----------

test("sessionClock: the decision time is the bar close, and DST keeps RTH open on the ET clock", () => {
  // Summer: 09:30 EDT open → decision 09:31 → rthOpen, 1 minute after the open.
  const summer = buildBarSeries("MES", [bar(et("2026-07-13", "09:30", ET_SUMMER), 1, 1, 1, 1)]);
  assert.deepEqual(sessionClockSkill.compute(ctxOf(summer, 0)), {
    ok: true,
    values: { phase: "rthOpen", todBucket: "09:30", minutesFromRthOpen: 1 },
  });
  // Winter: the same 09:30 ET open gives the same answer, not a UTC-shifted one.
  const winter = buildBarSeries("MES", [bar(et("2026-12-14", "09:30"), 1, 1, 1, 1)]);
  assert.deepEqual(valuesOf(sessionClockSkill.compute(ctxOf(winter, 0))), {
    phase: "rthOpen", todBucket: "09:30", minutesFromRthOpen: 1,
  });
  assert.equal(decisionMinute(summer, 0), 9 * 60 + 31);
});

test("sessionClock: phase boundaries on the decision (bar close) clock", () => {
  // Each row: a bar opening at this ET time, and the phase of its close (the decision time).
  const cases: [open: string, expected: string | "halt"][] = [
    ["23:59", "overnight"], // closes 00:00
    ["06:59", "premarket"], // closes 07:00
    ["09:29", "rthOpen"], // closes 09:30
    ["10:29", "rthMid"], // closes 10:30
    ["13:59", "rthLate"], // closes 14:00
    ["15:59", "post"], // closes 16:00
    ["16:59", "post"], // closes 17:00
    ["17:00", "halt"], // closes 17:01: no decision bar exists in the halt
    ["17:59", "evening"], // closes 18:00
  ];
  for (const [open, expected] of cases) {
    const series = buildBarSeries("MES", [bar(et("2026-11-24", open), 1, 1, 1, 1)]);
    const result = sessionClockSkill.compute(ctxOf(series, 0));
    if (expected === "halt") {
      assert.equal(result.ok, false, `open ${open}`);
      assert.equal(!result.ok && result.reason, "out-of-session", `open ${open}`);
    } else {
      assert.equal(valuesOf(result).phase, expected, `open ${open}`);
    }
  }
});

test("sessionClock: an evening bar belongs to Monday's session; minutes from open wrap to the next open", () => {
  // Sun 2026-07-12 18:59 EDT (= 22:59 UTC) is Monday 2026-07-13's session, evening phase.
  const series = buildBarSeries("MES", [bar(Date.parse("2026-07-12T22:59:00Z"), 1, 1, 1, 1)]);
  assert.equal(series.sessionDate[0], "2026-07-13");
  assert.equal(valuesOf(sessionClockSkill.compute(ctxOf(series, 0))).phase, "evening");

  // Decision 21:41 is 11 h 49 min before the next 09:30 open → −709.
  assert.equal(minutesFromRthOpen(21 * 60 + 41), -709);
  assert.equal(minutesFromRthOpen(0), -570);
  assert.equal(minutesFromRthOpen(18 * 60), 510);
  assert.equal(phaseOf(17 * 60 + 30), null);
  assert.equal(todBucketOf(14 * 60 + 45), "14:30");
});

test("sessionClock: reads bar i only (known-at)", () => {
  const start = et("2026-11-24", "08:00");
  const series = buildBarSeries("MES", Array.from({ length: 30 }, (_, k) => bar(start + k * MIN, 1, 2, 0.5, 1.5)));
  for (const i of [0, 12, 29]) assertNoLookahead(sessionClockSkill, ctxOf(series, i));
});

// ---------- S2 mtfCandle ----------

const QUIET: Row = [100, 100.5, 99.5, 100];
const FLAT: Row = [100, 102.5, 97.5, 100];

test("mtfCandle: 15 synthetic 1m bars aggregate to the exact 15m OHLC and wicks", () => {
  const start = et("2026-11-24", "08:00");
  const rows: Row[] = Array.from({ length: 15 }, () => QUIET);
  rows[0] = [100, 100.5, 98, 100]; // the low of the candle
  rows[14] = [100, 120, 99.5, 119]; // the high of the candle, and its close
  const series = buildBarSeries("MES", barsFrom(start, rows));
  const result = valuesOf(mtfCandleSkill.compute(ctxOf(series, 14, { minutes: 15 })));
  assert.equal(result.range, 22); // 120 − 98
  assert.equal(result.body, 19); // 119 − 100
  assert.equal(result.upperWick, 1); // 120 − 119
  assert.equal(result.lowerWick, 2); // 100 − 98
  assert.equal(result.direction, "up");
  assert.equal(result.forming, false);
  assert.equal(result.bodyPct, 19 / 22);
  // No prior completed candles yet: percentiles are null (warmup), not zero.
  assert.equal(result.rangePctile, null);
});

test("mtfCandle: a bucket is forming until its last minute, and the forming candle excludes later bars", () => {
  const start = et("2026-11-24", "08:00");
  const rows: Row[] = Array.from({ length: 15 }, () => QUIET);
  rows[0] = [100, 100.5, 98, 100];
  rows[14] = [100, 120, 99.5, 119];
  const series = buildBarSeries("MES", barsFrom(start, rows));
  const forming = valuesOf(mtfCandleSkill.compute(ctxOf(series, 7, { minutes: 15 })));
  assert.equal(forming.forming, true);
  // Bars 0..7 only: high 100.5, low 98. The 120 spike at bar 14 is not known yet.
  assert.equal(forming.range, 2.5);
  assert.equal(forming.direction, "doji");
});

test("mtfCandle: candleAt agrees with aggregate() for the bucket containing i", () => {
  const start = et("2026-11-24", "08:00");
  const rows: Row[] = Array.from({ length: 15 }, () => QUIET);
  rows[0] = [100, 100.5, 98, 100];
  rows[14] = [100, 120, 99.5, 119];
  const series = buildBarSeries("MES", barsFrom(start, rows));
  for (const i of [0, 7, 14]) {
    const reference = aggregate(series, i, 15);
    const built = candleAt(series, reference?.startTime ?? 0, 15, series.time[i]);
    assert.deepEqual(
      built && { open: built.open, high: built.high, low: built.low, close: built.close, present: built.present, expected: built.expected },
      reference && { open: reference.open, high: reference.high, low: reference.low, close: reference.close, present: reference.present, expected: reference.expected },
      `bucket at bar ${i}`,
    );
  }
});

/** 26 flat 15m candles (range 5), then the last candle's final bar spikes its range to 25. */
function percentileSeries() {
  const start = et("2026-11-24", "08:00");
  const rows: Row[] = Array.from({ length: 26 * 15 }, () => FLAT);
  rows[25 * 15 + 14] = [100, 112.5, 87.5, 100];
  return buildBarSeries("MES", barsFrom(start, rows));
}

test("mtfCandle: percentiles are midrank against prior completed candles; the max range is 100", () => {
  const series = percentileSeries();
  const result = valuesOf(mtfCandleSkill.compute(ctxOf(series, series.time.length - 1, { minutes: 15 })));
  assert.equal(result.range, 25);
  assert.equal(result.rangePctile, 100);
  assert.equal(result.upperWickPctile, 100); // 12.5 vs prior 2.5
  assert.equal(result.lowerWickPctile, 100); // 12.5 vs prior 2.5
  assert.equal(result.direction, "doji", "opens and closes at 100, so the body is zero");
  assert.equal(result.forming, false);
  // The candle has ended, so the last completed candle is this one.
  assert.equal(result.prevRange, 25);
});

test("mtfCandle: an identical value against a full sample is the 50th percentile (ties count half)", () => {
  assert.equal(midrankPercentile(5, Array(25).fill(5)), 50);
  assert.equal(midrankPercentile(5, Array(10).fill(5)), null, "fewer than 20 candles is warmup");
});

test("mtfCandle: prev values describe the last completed candle while the current one forms", () => {
  const series = percentileSeries();
  // Minute 11 of the last candle (bars 375..389): forming, and the spike at minute 14 is not yet known.
  const i = 25 * 15 + 11;
  const result = valuesOf(mtfCandleSkill.compute(ctxOf(series, i, { minutes: 15 })));
  assert.equal(result.forming, true);
  assert.equal(result.range, 5);
  assert.equal(result.rangePctile, 50);
  assert.equal(result.prevRange, 5);
  assert.equal(result.prevRangePctile, 50, "24 prior candles, all range 5");
  assert.equal(result.prevDirection, "doji");
});

test("mtfCandle: more than 20% of the current candle's minutes missing is a coverage skip", () => {
  const start = et("2026-11-24", "08:00");
  const rows: Row[] = Array.from({ length: 26 * 15 }, () => FLAT);
  const kept = barsFrom(start, rows).filter((_, k) => !(k >= 25 * 15 && k <= 25 * 15 + 3));
  const series = buildBarSeries("MES", kept);
  assert.deepEqual(mtfCandleSkill.compute(ctxOf(series, series.time.length - 1, { minutes: 15 })), {
    ok: false, reason: "coverage", detail: "15m candle has more than 20% of its minutes missing",
  });
});

test("mtfCandle: bad minutes or lookback is bad-params; 5m and 60m work", () => {
  const series = buildBarSeries("MES", barsFrom(et("2026-11-24", "08:00"), Array.from({ length: 15 }, () => QUIET)));
  assert.equal(mtfCandleSkill.preflight(ctxOf(series, 14, { minutes: 7 })).ok, false);
  assert.equal(mtfCandleSkill.preflight(ctxOf(series, 14, { pctileLookback: 5 })).ok, false);
  const five = valuesOf(mtfCandleSkill.compute(ctxOf(series, 14, { minutes: 5 })));
  assert.equal(five.forming, false);
  assert.equal(five.range, 1, "bars 10..14 of QUIET: 100.5 − 99.5");
  const hour = valuesOf(mtfCandleSkill.compute(ctxOf(series, 14, { minutes: 60 })));
  assert.equal(hour.forming, true);
});

test("mtfCandle: reads bar i only (known-at)", () => {
  const series = percentileSeries();
  for (const i of [7, 200, 25 * 15 + 3, 25 * 15 + 11, series.time.length - 1]) {
    assertNoLookahead(mtfCandleSkill, ctxOf(series, i, { minutes: 15 }));
  }
});

// ---------- S3 structure5m ----------

/** 5m candles from `firstK` to `lastK` (candle k opens 08:00 ET + 5k min). Each candle: high = low + 4, close = open = low + 2. */
function fiveMinuteBars(lows: readonly number[], firstK: number, lastK: number): SourceBar[] {
  const base = et("2026-11-24", "08:00");
  const bars: SourceBar[] = [];
  for (let k = firstK; k <= lastK; k += 1) {
    const low = lows[k - firstK];
    for (let m = 0; m < 5; m += 1) bars.push(bar(base + (k * 5 + m) * MIN, low + 2, low + 4, low, low + 2));
  }
  return bars;
}

const mod4 = (k: number) => ((k % 4) + 4) % 4;

/** Candles −4..16. Valleys (k≡2 mod 4) at 100, 96, 92, 95 for k = 2, 6, 10, 14; odd candles sit between. */
const V_LOWS = [120, 120, 120, 120, 104, 102, 100, 102, 104, 101, 96, 101, 104, 100, 92, 100, 104, 98, 95, 99, 103];

/** Candles −4..16. Valleys 104/108/112 (k = 6, 10, 14), peaks 124/128/132 (k = 8, 12, 16). Odd candles are midpoints. */
const STAIRCASE_LOWS: number[] = Array.from({ length: 21 }, (_, n) => {
  const k = n - 4;
  if (mod4(k) === 2) return 98 + k;
  if (mod4(k) === 0) return 116 + k;
  return 0; // filled from its even neighbours below
});
for (let n = 0; n < STAIRCASE_LOWS.length; n += 1) {
  if (mod4(n - 4) % 2 === 1) STAIRCASE_LOWS[n] = (STAIRCASE_LOWS[n - 1] + STAIRCASE_LOWS[n + 1]) / 2;
}

test("structure5m: a V-shape confirms the higher low only once two candles follow it", () => {
  // Last completed candle 16: the valley at 14 (95) is confirmed; lows 100 → 96 → 92 → 95.
  const full = buildBarSeries("MES", fiveMinuteBars(V_LOWS, -4, 16));
  const confirmed = valuesOf(structure5mSkill.compute(ctxOf(full, full.time.length - 1, { swingBars: 2, lookbackCandles: 16 })));
  assert.equal(confirmed.firstHigherLow, true);
  assert.equal(confirmed.higherLows, 1);
  assert.equal(confirmed.lastSwingLow, 95);
  assert.equal(confirmed.lastSwingHigh, 108);
  assert.equal(confirmed.structure, "mixed", "the swing highs are equal, so there is no rising or falling high pair");

  // One candle earlier (last completed 15): the valley at 14 is not confirmed yet.
  const earlier = buildBarSeries("MES", fiveMinuteBars(V_LOWS, -4, 15));
  const notYet = valuesOf(structure5mSkill.compute(ctxOf(earlier, earlier.time.length - 1, { swingBars: 2, lookbackCandles: 16 })));
  assert.equal(notYet.firstHigherLow, false);
  assert.equal(notYet.lastSwingLow, 92);
});

test("structure5m: the forming 5m candle cannot confirm a swing", () => {
  const series = buildBarSeries("MES", fiveMinuteBars(V_LOWS, -4, 16));
  // Candle 16 minute 2 (bar index (16 + 4) × 5 + 2): forming, so only candles up to 15 count.
  const formingIndex = (16 + 4) * 5 + 2;
  const forming = valuesOf(structure5mSkill.compute(ctxOf(series, formingIndex, { swingBars: 2, lookbackCandles: 16 })));
  assert.equal(forming.firstHigherLow, false);
  assert.equal(forming.lastSwingLow, 92);
});

test("structure5m: a staircase reads as up with rising higher lows", () => {
  const series = buildBarSeries("MES", fiveMinuteBars(STAIRCASE_LOWS, -4, 16));
  const result = valuesOf(structure5mSkill.compute(ctxOf(series, series.time.length - 1, { swingBars: 2, lookbackCandles: 12 })));
  assert.equal(result.structure, "up");
  assert.equal(result.higherLows, 2);
  assert.equal(result.lowerHighs, 0);
  assert.equal(result.lastSwingLow, 112);
  assert.equal(result.lastSwingHigh, 132);
  assert.equal(result.firstHigherLow, false, "fewer than four lows in the lookback");
});

test("structure5m: no confirmed swings is none; bad params are bad-params", () => {
  const series = buildBarSeries("MES", fiveMinuteBars([100, 100, 100], 0, 2));
  const result = valuesOf(structure5mSkill.compute(ctxOf(series, series.time.length - 1, { swingBars: 2, lookbackCandles: 4 })));
  assert.equal(result.structure, "none");
  assert.equal(result.lastSwingLow, null);
  assert.equal(structure5mSkill.preflight(ctxOf(series, 0, { swingBars: 0 })).ok, false);
});

test("structure5m: reads bar i only (known-at)", () => {
  const series = buildBarSeries("MES", fiveMinuteBars(STAIRCASE_LOWS, -4, 16));
  for (const i of [30, 60, 77, series.time.length - 1]) {
    assertNoLookahead(structure5mSkill, ctxOf(series, i, { swingBars: 2, lookbackCandles: 12 }));
  }
});

// ---------- S4 confirm1m ----------

/** Long set-up: prior extreme at bar 1 (low 98, high 100); bounce; 1m swing low at bar 3 (99 > 98); decision at bar 4. */
const LONG_ROWS: Row[] = [
  [100, 101, 99, 100],
  [100, 100, 98, 98.5],
  [100.2, 100.5, 100, 100.2],
  [100.2, 100.4, 99, 99.3],
  [99.3, 100.8, 99.2, 100.5],
];
const LONG_START = et("2026-11-24", "08:12");
const CONFIRM_LONG = { lookbackBars: 4, side: "long" };

test("confirm1m: a close back above the prior extreme's high is a reclaim, with a 1m swing above the low", () => {
  const series = buildBarSeries("MES", barsFrom(LONG_START, LONG_ROWS));
  assert.deepEqual(confirm1mSkill.compute(ctxOf(series, 4, CONFIRM_LONG)), {
    ok: true,
    values: { reclaim: true, higherLow: true, barsSinceExtreme: 3 },
    notes: [],
  });
});

test("confirm1m: a lower low after the extreme (here at the decision bar) kills the reclaim", () => {
  const rows = LONG_ROWS.map((row) => [...row] as Row);
  rows[4] = [99.3, 100.8, 97.5, 100.5];
  const series = buildBarSeries("MES", barsFrom(LONG_START, rows));
  assert.equal(valuesOf(confirm1mSkill.compute(ctxOf(series, 4, CONFIRM_LONG))).reclaim, false);
});

test("confirm1m: closing below the extreme's high is not a reclaim", () => {
  const rows = LONG_ROWS.map((row) => [...row] as Row);
  rows[4] = [99.3, 100.8, 99.2, 99.9];
  const series = buildBarSeries("MES", barsFrom(LONG_START, rows));
  assert.equal(valuesOf(confirm1mSkill.compute(ctxOf(series, 4, CONFIRM_LONG))).reclaim, false);
});

test("confirm1m: short mirrors long on the mirrored tape", () => {
  const mirrored = LONG_ROWS.map(([o, h, l, c]): Row => [200 - o, 200 - l, 200 - h, 200 - c]);
  const series = buildBarSeries("MES", barsFrom(LONG_START, mirrored));
  assert.deepEqual(valuesOf(confirm1mSkill.compute(ctxOf(series, 4, { lookbackBars: 4, side: "short" }))), {
    reclaim: true, higherLow: true, barsSinceExtreme: 3,
  });
});

test("confirm1m: a missing bar between the extreme and i is noted as a gap; a swing needs both neighbours", () => {
  const bars = barsFrom(LONG_START, LONG_ROWS).filter((_, k) => k !== 2);
  const series = buildBarSeries("MES", bars);
  const result = confirm1mSkill.compute(ctxOf(series, series.time.length - 1, CONFIRM_LONG));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.values.reclaim, true);
  assert.equal(result.values.higherLow, false, "the swing bar's neighbour before it is missing");
  assert.deepEqual(result.notes, ["gap: 1 missing 1m bars in the lookback"]);
});

test("confirm1m: bad side and out-of-range lookback are bad-params; reads bar i only", () => {
  const series = buildBarSeries("MES", barsFrom(LONG_START, LONG_ROWS));
  assert.equal(confirm1mSkill.preflight(ctxOf(series, 4, { side: "up" })).ok, false);
  assert.equal(confirm1mSkill.preflight(ctxOf(series, 4, { lookbackBars: 1 })).ok, false);
  for (const i of [2, 3, 4]) assertNoLookahead(confirm1mSkill, ctxOf(series, i, CONFIRM_LONG));
});

// ---------- registry composition ----------

test("the clock and MTF skills compose into a registry keyed id@major", () => {
  const registry = createSkillRegistry([sessionClockSkill, ...MTF_SKILLS]);
  assert.equal(getSkill("sessionClock", registry)?.meta.id, "sessionClock");
  assert.equal(getSkill("mtfCandle@1", registry)?.meta.kind, "feature");
  assert.equal(getSkill("confirm1m", registry)?.meta.knownAt, "bar-close");
  assert.deepEqual(listSkills(registry).map((meta) => `${meta.id}@${meta.version}`), [
    "confirm1m@1.0.0", "mtfCandle@1.0.0", "sessionClock@1.0.0", "structure5m@1.0.0",
  ]);
});
