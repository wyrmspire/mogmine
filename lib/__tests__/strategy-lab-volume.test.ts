// SL-5: volume skills V1–V5 (docs/design-2026-11-24/09-strategy-lab.md §9). Synthetic 1m bars, hand-checked answers.
import test from "node:test";
import assert from "node:assert/strict";
import { createSkillRegistry, getSkill } from "../strategy-lab/registry.ts";
import { buildBarSeries } from "../strategy-lab/series.ts";
import { entryVolumeSkill, rvolSkill, volumeSpikeSkill } from "../strategy-lab/skills/volume.ts";
import { VOLUME_SKILLS, deltaProxySkill, volumeAtLevelSkill } from "../strategy-lab/skills/volume-flow.ts";
import type {
  LabLevel, LevelBook, LevelKey, Skill, SkillContext, SkillResult, SourceBar,
} from "../strategy-lab/types.ts";
import { assertNoLookahead } from "./strategy-lab-lookahead-harness.ts";

const MINUTE = 60_000;
const SPEC = { symbol: "MES", tickSize: 0.25, pointValueUsd: 5 };

/** Bars from `fromHHMM` ET on `date`. `volume: null` is a missing-volume bar. */
function minuteBars(
  date: string,
  fromHHMM: string,
  count: number,
  volume: number | null,
  options: { offset?: string; price?: number; range?: number } = {},
): SourceBar[] {
  const { offset = "-04:00", price = 100, range = 1 } = options;
  const start = Date.parse(`${date}T${fromHHMM}:00${offset}`);
  return Array.from({ length: count }, (_, k) => ({
    time: start + k * MINUTE,
    open: price,
    high: price + range,
    low: price - range,
    close: price,
    volume,
  }));
}

function levelBook(asOf: number, levels: LabLevel[] = []): LevelBook {
  return { asOf, levels, byKey: new Map(levels.map((level) => [level.key, level])) };
}

function ctxAt(
  series: ReturnType<typeof buildBarSeries>,
  i: number,
  params: Record<string, number | string | boolean> = {},
  levels: LabLevel[] = [],
): SkillContext {
  return {
    series,
    i,
    params,
    spec: SPEC,
    rSizeUsd: 300,
    levels: levelBook(series.time[i] + series.barMs, levels),
  };
}

function expectOk(result: SkillResult): Extract<SkillResult, { ok: true }> {
  assert.equal(result.ok, true, result.ok ? "" : `expected ok, got ${result.reason}: ${result.detail}`);
  return result as Extract<SkillResult, { ok: true }>;
}

function expectSkip(result: SkillResult, reason: string) {
  assert.equal(result.ok, false, "expected a skip");
  assert.equal(!result.ok && result.reason, reason);
}

/** Ten prior weekdays of 09:30–09:34 ET bars at `volume`, then today's window at `todayVolume`. */
const PRIOR_DAYS = [
  "2026-06-29", "2026-06-30", "2026-07-01", "2026-07-02", "2026-07-03",
  "2026-07-06", "2026-07-07", "2026-07-08", "2026-07-09", "2026-07-10",
];
const TODAY = "2026-07-13";

function rvolHistory(volume = 1000, todayVolume = 2000, skipDays: string[] = []): SourceBar[] {
  const bars: SourceBar[] = [];
  for (const day of PRIOR_DAYS) {
    if (skipDays.includes(day)) bars.push(...minuteBars(day, "09:30", 4, volume));
    else bars.push(...minuteBars(day, "09:30", 5, volume));
  }
  bars.push(...minuteBars(TODAY, "09:30", 5, todayVolume));
  return bars;
}

// ---------------------------------------------------------------------------
// V1 rvol
// ---------------------------------------------------------------------------

test("rvol: flat 1,000/min history with 2,000/min today is exactly 2.0", () => {
  const series = buildBarSeries("MES", rvolHistory());
  const i = series.time.length - 1;
  const result = expectOk(rvolSkill.compute(ctxAt(series, i)));
  assert.equal(result.values.rvol, 2);
  assert.equal(result.values.rvolBucket, "very-high");
  assert.equal(result.values.baselineSessions, 10);
  assertNoLookahead(rvolSkill, ctxAt(series, i));
});

test("rvol: a prior session missing a bar in its window is skipped; four usable sessions is warmup", () => {
  const series = buildBarSeries("MES", rvolHistory(1000, 2000, ["2026-07-10"]));
  const i = series.time.length - 1;
  const result = expectOk(rvolSkill.compute(ctxAt(series, i)));
  assert.equal(result.values.baselineSessions, 9, "the short session is excluded from the baseline");

  const sparse = buildBarSeries("MES", [
    ...PRIOR_DAYS.slice(0, 4).flatMap((day) => minuteBars(day, "09:30", 5, 1000)),
    ...minuteBars(TODAY, "09:30", 5, 2000),
  ]);
  expectSkip(rvolSkill.compute(ctxAt(sparse, sparse.time.length - 1)), "warmup");
});

test("rvol: a missing bar or missing volume in today's window is volume-missing", () => {
  const bars = rvolHistory();
  const todayStart = bars.length - 5;
  bars[todayStart + 2] = { ...bars[todayStart + 2], volume: null };
  const withNaN = buildBarSeries("MES", bars);
  expectSkip(rvolSkill.compute(ctxAt(withNaN, withNaN.time.length - 1)), "volume-missing");

  const gapped = buildBarSeries("MES", rvolHistory().filter((_, index) => index !== bars.length - 3));
  expectSkip(rvolSkill.compute(ctxAt(gapped, gapped.time.length - 1)), "volume-missing");
});

test("rvol: baseline uses the same ET clock minute across the March DST change", () => {
  // Prior sessions straddle 2026-03-08 (EST before, EDT after). Each has 09:30–09:34 ET at 1,000/min.
  const winterDays = ["2026-02-27", "2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05", "2026-03-06"];
  const bars: SourceBar[] = [];
  for (const day of winterDays) bars.push(...minuteBars(day, "09:30", 5, 1000, { offset: day < "2026-03-08" ? "-05:00" : "-04:00" }));
  bars.push(...minuteBars("2026-03-09", "09:30", 5, 1000, { offset: "-04:00" }));
  bars.push(...minuteBars("2026-03-10", "09:30", 5, 2000, { offset: "-04:00" }));
  const series = buildBarSeries("MES", bars);
  const result = expectOk(rvolSkill.compute(ctxAt(series, series.time.length - 1, { minSessions: 5 })));
  assert.equal(result.values.baselineSessions, 7);
  assert.equal(result.values.rvol, 2);
});

test("rvol: out-of-range parameters are bad-params, not a silent default", () => {
  const series = buildBarSeries("MES", rvolHistory());
  const i = series.time.length - 1;
  assert.equal(rvolSkill.preflight(ctxAt(series, i, { windowMinutes: 0 })).ok, false);
  assert.equal(rvolSkill.preflight(ctxAt(series, i, { minSessions: 11, sessions: 10 })).ok, false);
  expectSkip(rvolSkill.compute(ctxAt(series, i, { windowMinutes: 0 })), "bad-params");
});

// ---------------------------------------------------------------------------
// V2 volumeSpike
// ---------------------------------------------------------------------------

function spikeSeries(volumes: (number | null)[]) {
  const start = Date.parse("2026-07-13T13:30:00Z");
  return buildBarSeries("MES", volumes.map((volume, k) => ({
    time: start + k * MINUTE, open: 100, high: 101, low: 99, close: 100, volume,
  })));
}

test("volumeSpike: 30 bars at 500 then 2,000 is a 4.0× spike with flat-window logZ undefined", () => {
  const series = spikeSeries([...Array.from({ length: 30 }, () => 500), 2000]);
  const i = series.time.length - 1;
  const result = expectOk(volumeSpikeSkill.compute(ctxAt(series, i)));
  assert.equal(result.values.ratio, 4);
  assert.equal(result.values.spike, true);
  assert.equal(result.values.logZ, null);
  assert.ok(result.notes?.some((note) => note.includes("Flat prior window")));
  assertNoLookahead(volumeSpikeSkill, ctxAt(series, i));
});

test("volumeSpike: log z-score follows the previous window, and a 2× bar is not a spike", () => {
  const window = Array.from({ length: 30 }, (_, k) => (k % 2 === 0 ? 400 : 600));
  const series = spikeSeries([...window, 800]);
  const result = expectOk(volumeSpikeSkill.compute(ctxAt(series, series.time.length - 1)));
  // Median of the window is 500; 800 is 1.6× and so is not a spike at the default multiple of 3.
  assert.equal(result.values.ratio, 1.6);
  assert.equal(result.values.spike, false);
  const mean = (Math.log(400) + Math.log(600)) / 2;
  const sd = Math.abs(Math.log(600) - Math.log(400)) / 2;
  assert.ok(typeof result.values.logZ === "number");
  assert.ok(Math.abs((result.values.logZ as number) - (Math.log(800) - mean) / sd) < 1e-9);
});

test("volumeSpike: missing volume at i is volume-missing; too few valid prior bars is warmup", () => {
  const nanAt = spikeSeries([...Array.from({ length: 30 }, () => 500), null]);
  expectSkip(volumeSpikeSkill.compute(ctxAt(nanAt, nanAt.time.length - 1)), "volume-missing");

  const short = spikeSeries([...Array.from({ length: 10 }, () => 500), 2000]);
  expectSkip(volumeSpikeSkill.compute(ctxAt(short, short.time.length - 1)), "warmup");
});

test("volumeSpike: missing prior bars are skipped, so the window reaches back to 30 valid bars", () => {
  const prior = Array.from({ length: 40 }, (_, k) => (k % 8 === 3 ? null : 500));
  const series = spikeSeries([...prior, 2000]);
  const result = expectOk(volumeSpikeSkill.compute(ctxAt(series, series.time.length - 1)));
  assert.equal(result.values.ratio, 4);
});

// ---------------------------------------------------------------------------
// V4 entryVolume
// ---------------------------------------------------------------------------

function entrySeries(tail: (number | null)[], padding = 30, padVolume = 100) {
  return spikeSeries([...Array.from({ length: padding }, () => padVolume), ...tail]);
}

test("entryVolume: 100…600 ascending ends rising with the entry bar's size against the median", () => {
  const series = entrySeries([100, 200, 300, 400, 500, 600]);
  const i = series.time.length - 1;
  const result = expectOk(entryVolumeSkill.compute(ctxAt(series, i)));
  assert.equal(result.values.trend, "rising");
  assert.equal(result.values.entryBarVolume, 600);
  assert.equal(result.values.priorSum, 1500);
  assert.equal(result.values.entryVsMedianBucket, "high");
  assert.equal(result.values.entryVsMedian, 6);
  assertNoLookahead(entryVolumeSkill, ctxAt(series, i));
});

test("entryVolume: constant volume is flat", () => {
  const series = entrySeries(Array.from({ length: 6 }, () => 300), 30, 300);
  const result = expectOk(entryVolumeSkill.compute(ctxAt(series, series.time.length - 1)));
  assert.equal(result.values.trend, "flat");
  assert.equal(result.values.entryVsMedianBucket, "normal");
});

test("entryVolume: a missing bar inside the k prior bars is volume-missing", () => {
  const series = entrySeries([100, 200, null, 400, 500, 600]);
  expectSkip(entryVolumeSkill.compute(ctxAt(series, series.time.length - 1)), "volume-missing");
});

test("entryVolume: fewer than 20 valid bars for the median is warmup", () => {
  const series = spikeSeries([100, 200, 300, 400, 500, 600, 700]);
  expectSkip(entryVolumeSkill.compute(ctxAt(series, series.time.length - 1, { k: 5 })), "warmup");
});

// ---------------------------------------------------------------------------
// V3 volumeAtLevel
// ---------------------------------------------------------------------------

const PDH: LabLevel = { key: "pdh", value: 100, availableAt: Date.parse("2026-07-13T13:30:00Z") };

/** One 1m bar per entry: "T" trades through 100 ± 0.5, "N" trades well away, "M" is a missing-volume touch. */
function visitSeries(pattern: string, from = "09:30") {
  const start = Date.parse(`2026-07-13T${from === "09:30" ? "13:30" : "13:00"}:00Z`);
  const bars: SourceBar[] = [];
  for (let k = 0; k < pattern.length; k += 1) {
    const code = pattern[k];
    const touch = code === "T" || code === "M";
    const price = touch ? 100 : 90;
    bars.push({
      time: start + k * MINUTE,
      open: price,
      high: price + 0.2,
      low: price - 0.2,
      close: price,
      volume: code === "M" ? null : 100,
    });
  }
  return buildBarSeries("MES", bars);
}

test("volumeAtLevel: two visits separated by three non-touching bars count as two touches", () => {
  const series = visitSeries("TTNNNTN");
  const i = series.time.length - 1;
  const result = expectOk(volumeAtLevelSkill.compute(ctxAt(series, i, { level: "pdh" }, [PDH])));
  assert.equal(result.values.touches, 2);
  assert.equal(result.values.volume, 300);
  assert.equal(result.values.volumeShare, 300 / 700);
  assert.equal(result.values.volumeShareBucket, "mid");
  assertNoLookahead(volumeAtLevelSkill, ctxAt(series, i, { level: "pdh" }, [PDH]));
});

test("volumeAtLevel: adjacent touches and two-bar gaps are one touch", () => {
  const adjacent = visitSeries("TTT");
  const oneVisit = expectOk(volumeAtLevelSkill.compute(ctxAt(adjacent, 2, { level: "pdh" }, [PDH])));
  assert.equal(oneVisit.values.touches, 1);

  const twoBarGap = visitSeries("TNNT");
  const merged = expectOk(volumeAtLevelSkill.compute(ctxAt(twoBarGap, 3, { level: "pdh" }, [PDH])));
  assert.equal(merged.values.touches, 1);
});

test("volumeAtLevel: a missing-volume bar is excluded and noted, and does not break a visit", () => {
  const series = visitSeries("TMNNT");
  const result = expectOk(volumeAtLevelSkill.compute(ctxAt(series, 4, { level: "pdh" }, [PDH])));
  // The M bar is excluded entirely, so only two non-touching bars separate the visits: one touch.
  assert.equal(result.values.touches, 1);
  assert.equal(result.values.volume, 200);
  assert.ok(result.notes?.some((note) => note.includes("missing volume excluded")));
});

test("volumeAtLevel: no level in the book is no-level, a later level is not-known-yet, RTH before 09:30 is out-of-session", () => {
  const series = visitSeries("TTNN");
  expectSkip(volumeAtLevelSkill.compute(ctxAt(series, 3, { level: "pdh" }, [])), "no-level");

  const later: LabLevel = { ...PDH, availableAt: series.time[3] + 10 * MINUTE };
  expectSkip(volumeAtLevelSkill.compute(ctxAt(series, 3, { level: "pdh" }, [later])), "not-known-yet");

  const premarket = visitSeries("TT", "07:00");
  const early: LabLevel = { ...PDH, availableAt: 0 };
  expectSkip(volumeAtLevelSkill.compute(ctxAt(premarket, 1, { level: "pdh", since: "rth" }, [early])), "out-of-session");
});

test("volumeAtLevel: is degraded, carries the whole-bar warning, and rejects an unknown level key", () => {
  assert.equal(volumeAtLevelSkill.meta.status, "degraded");
  assert.ok(volumeAtLevelSkill.meta.warnings?.some((warning) => warning.includes("overstated")));
  const series = visitSeries("TT");
  expectSkip(volumeAtLevelSkill.compute(ctxAt(series, 1, { level: "not-a-level" }, [PDH])), "bad-params");
});

// ---------------------------------------------------------------------------
// V5 deltaProxy
// ---------------------------------------------------------------------------

function ohlcSeries(rows: { open: number; high: number; low: number; close: number; volume: number | null }[]) {
  const start = Date.parse("2026-07-13T13:30:00Z");
  return buildBarSeries("MES", rows.map((row, k) => ({ ...row, time: start + k * MINUTE })));
}

test("deltaProxy: closes at the highs give normalised +1 and a positive sign", () => {
  const rows = Array.from({ length: 10 }, () => ({ open: 100, high: 102, low: 100, close: 102, volume: 500 }));
  const series = ohlcSeries(rows);
  const i = series.time.length - 1;
  const result = expectOk(deltaProxySkill.compute(ctxAt(series, i, { bars: 10, method: "clv" })));
  assert.equal(result.values.normalized, 1);
  assert.equal(result.values.sign, "positive");
  assert.equal(result.values.net, 5000);
  assertNoLookahead(deltaProxySkill, ctxAt(series, i, { bars: 10, method: "clv" }));
});

test("deltaProxy: doji bars with high equal to low contribute zero", () => {
  const rows = Array.from({ length: 10 }, () => ({ open: 100, high: 100, low: 100, close: 100, volume: 500 }));
  const result = expectOk(deltaProxySkill.compute(ctxAt(ohlcSeries(rows), 9, { bars: 10 })));
  assert.equal(result.values.normalized, 0);
  assert.equal(result.values.sign, "flat");
});

test("deltaProxy: tick method carries the previous sign through an unchanged close", () => {
  // Closes 99, 100, 101, 101, 100, 100 at 100 contracts each. Window of 5 ends at i = 5.
  // Signs: +1, +1, carry +1, −1, carry −1  → net = +100, normalised = 100 ÷ 500 = 0.2.
  const closes = [99, 100, 101, 101, 100, 100];
  const series = ohlcSeries(closes.map((close) => ({ open: close, high: close, low: close, close, volume: 100 })));
  const i = 5;
  const result = expectOk(deltaProxySkill.compute(ctxAt(series, i, { bars: 5, method: "tick" })));
  assert.equal(result.values.net, 100);
  assert.equal(result.values.normalized, 0.2);
  assert.equal(result.values.sign, "positive");
  assertNoLookahead(deltaProxySkill, ctxAt(series, i, { bars: 5, method: "tick" }));
});

test("deltaProxy: more than 20% missing bars in the window is volume-missing; 20% exactly is allowed", () => {
  const base = (volume: number | null) => ({ open: 100, high: 101, low: 99, close: 101, volume });
  const twoMissing = ohlcSeries([...Array.from({ length: 8 }, () => base(100)), base(null), base(null)]);
  expectOk(deltaProxySkill.compute(ctxAt(twoMissing, 9, { bars: 10 })));

  const threeMissing = ohlcSeries([...Array.from({ length: 7 }, () => base(100)), base(null), base(null), base(null)]);
  expectSkip(deltaProxySkill.compute(ctxAt(threeMissing, 9, { bars: 10 })), "volume-missing");
});

test("deltaProxy: is degraded, proxy-flagged, and carries the estimate warning", () => {
  assert.equal(deltaProxySkill.meta.status, "degraded");
  assert.equal(deltaProxySkill.meta.proxy, true);
  assert.ok(deltaProxySkill.meta.warnings?.includes("Estimated from 1-minute bars. Not real order flow."));
});

// ---------------------------------------------------------------------------
// Registry and shared contract
// ---------------------------------------------------------------------------

test("all five SL-5 skills register under id@major and are feature or label kinds that never read the future", () => {
  const registry = createSkillRegistry(VOLUME_SKILLS);
  assert.deepEqual(Object.keys(registry).sort(), ["deltaProxy@1", "entryVolume@1", "rvol@1", "volumeAtLevel@1", "volumeSpike@1"]);
  for (const skill of VOLUME_SKILLS) {
    assert.notEqual(skill.meta.kind, "measure");
    assert.equal(skill.meta.knownAt, "bar-close");
  }
  assert.equal(getSkill("rvol", registry), rvolSkill as Skill);
});

test("every skill is no-lookahead at several decision bars when future bars are present", () => {
  const future = [
    ...rvolHistory(),
    ...minuteBars(TODAY, "09:35", 30, 9_000),
    ...minuteBars("2026-07-14", "09:30", 10, 50),
  ];
  const series = buildBarSeries("MES", future);
  const level: LevelKey = "pdh";
  const levels = [{ key: level, value: 100, availableAt: 0 }];
  for (const skill of [rvolSkill, volumeSpikeSkill, entryVolumeSkill]) {
    for (const i of [series.time.length - 40, series.time.length - 12, series.time.length - 1]) {
      assertNoLookahead(skill, ctxAt(series, i, {}, levels));
    }
  }
});

test("a missing-volume-only window never reports zero activity", () => {
  const series = ohlcSeries(Array.from({ length: 10 }, () => ({ open: 100, high: 101, low: 99, close: 100, volume: null })));
  const result: SkillResult = deltaProxySkill.compute(ctxAt(series, 9, { bars: 10 }));
  expectSkip(result, "volume-missing");
});
