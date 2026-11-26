import test from "node:test";
import assert from "node:assert/strict";
import { buildBarSeries } from "../strategy-lab/series.ts";
import type { BarSeries, LevelBook, SkillContext, SkillResult, SourceBar, Value } from "../strategy-lab/types.ts";
import {
  adrExtensionSkill, gapOpenSkill, rangeRegimeSkill, REGIME_SKILLS, trendRegimeSkill,
} from "../strategy-lab/skills/regime.ts";
import { assertNoLookahead } from "./strategy-lab-lookahead-harness.ts";

// Synthetic MES 1m sessions. Each session runs 00:00–16:59 ET (1,020 bars), which is well over the 50%
// coverage rule for an 1,380-bar Globex session. Bars are flat at `open` except for designed extremes:
// minute 1 sets the high, minute 2 sets the low, and the last bar closes at `close`. Minute 570 is 09:30 ET.
const MIN = 60_000;
const ET_WINTER = "-05:00"; // November 2026 is on EST.
const FULL_BARS = 1020;
const MIN_09_30 = 570;

interface Ohlc { open: number; high: number; low: number; close: number }

interface SessionSpec extends Ohlc {
  date: string;
  bars?: number;
  overrides?: Record<number, Ohlc>;
  omit?: readonly number[];
}

function sessionBars(spec: SessionSpec): SourceBar[] {
  const count = spec.bars ?? FULL_BARS;
  const start = Date.parse(`${spec.date}T00:00:00${ET_WINTER}`);
  const flat = spec.open;
  const rows: SourceBar[] = [];
  for (let m = 0; m < count; m += 1) {
    if (spec.omit?.includes(m)) continue;
    let row: Ohlc = { open: flat, high: flat, low: flat, close: flat };
    if (m === 1) row = { open: flat, high: spec.high, low: flat, close: flat };
    if (m === 2) row = { open: flat, high: flat, low: spec.low, close: flat };
    if (m === count - 1) row = { open: spec.close, high: spec.close, low: spec.close, close: spec.close };
    row = spec.overrides?.[m] ?? row;
    rows.push({ time: start + m * MIN, ...row, volume: 100 });
  }
  return rows;
}

/** A session that opens and closes at `base` with a `range` high–low span centred on it. */
function flat(date: string, base: number, range: number): SessionSpec {
  return { date, open: base, high: base + range / 2, low: base - range / 2, close: base };
}

function buildSeries(specs: readonly SessionSpec[], excluded: readonly string[] = []): BarSeries {
  const series = buildBarSeries("MES", specs.flatMap(sessionBars));
  for (const date of excluded) {
    const session = series.sessions.find((row) => row.date === date);
    assert.ok(session, `no session ${date}`);
    session.excluded = { reason: "test exclusion" };
  }
  return series;
}

function indexAt(series: BarSeries, date: string, minute: number): number {
  const j = series.byTime.get(Date.parse(`${date}T00:00:00${ET_WINTER}`) + minute * MIN);
  assert.notEqual(j, undefined, `no bar ${date} minute ${minute}`);
  return j as number;
}

const PRIOR_DATES = ["2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-23", "2026-11-24"];
const TODAY = "2026-11-25";
const FUTURE = "2026-11-26";

function levelBook(entries: readonly (readonly [string, number])[]): LevelBook {
  const levels = entries.map(([key, value]) => ({ key: key as LevelBook["levels"][number]["key"], value, availableAt: 0 }));
  return { asOf: 0, levels, byKey: new Map(levels.map((level) => [level.key, level] as const)) };
}

function ctxOf(
  series: BarSeries, i: number, params: Record<string, Value> = {}, levels: LevelBook = levelBook([]),
): SkillContext {
  return { series, i, params, spec: { symbol: "MES", tickSize: 0.25, pointValueUsd: 5 }, rSizeUsd: 300, levels };
}

function evaluate(skill: (typeof REGIME_SKILLS)[number], ctx: SkillContext): SkillResult {
  const pre = skill.preflight(ctx);
  return pre.ok ? skill.compute(ctx) : { ok: false, reason: pre.reason, detail: pre.detail };
}

function expectValues(result: SkillResult, expected: Record<string, Value>): void {
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  for (const [key, want] of Object.entries(expected)) {
    const got: Value | undefined = result.values[key];
    if (typeof want === "number") {
      assert.ok(typeof got === "number" && Math.abs(got - want) < 1e-5, `${key}: got ${String(got)}, want ${want}`);
    } else {
      assert.equal(got, want, key);
    }
  }
}

function expectSkip(result: SkillResult, reason: string): void {
  assert.equal(result.ok, false, JSON.stringify(result));
  if (!result.ok) assert.equal(result.reason, reason, result.detail);
}

// ---------- rangeRegime ----------

const priorsRange10 = PRIOR_DATES.map((date, k) => flat(date, 5000 + k * 3, 10));

test("rangeRegime: ADR is the mean prior range and the ratio buckets compressed, normal and expanded", () => {
  // Six prior sessions of exactly 10 points each give ADR 10. Today's range is set by minutes 1 and 2.
  const cases: readonly [range: number, ratio: number, regime: string][] = [
    [5, 0.5, "compressed"],
    [6, 0.6, "normal"], // 0.6 is not below the compressed bound.
    [10, 1, "normal"],
    [11, 1.1, "normal"], // 1.1 is not above the expanded bound.
    [12, 1.2, "expanded"],
  ];
  for (const [range, ratio, regime] of cases) {
    const series = buildSeries([...priorsRange10, flat(TODAY, 5000, range)]);
    const result = evaluate(rangeRegimeSkill, ctxOf(series, indexAt(series, TODAY, 600)));
    expectValues(result, { todayRange: range, adr: 10, adrRatio: ratio, regime, adrSessions: 6 });
  }
});

test("rangeRegime: sparse and excluded prior sessions are skipped, and only the last `sessions` count", () => {
  // An excluded session (range 60) and a 500-bar session (range 40, under 50% of 1,380) would each lift the
  // ADR if they counted. Each is checked on its own so the rule that skips it is what is being tested.
  const excluded = buildSeries([flat("2026-11-13", 5000, 60), ...priorsRange10, flat(TODAY, 5000, 10)], ["2026-11-13"]);
  expectValues(
    evaluate(rangeRegimeSkill, ctxOf(excluded, indexAt(excluded, TODAY, 600))),
    { adr: 10, adrSessions: 6, adrRatio: 1, regime: "normal" },
  );
  const sparse = buildSeries([{ ...flat("2026-11-16", 5000, 40), bars: 500 }, ...priorsRange10, flat(TODAY, 5000, 10)]);
  expectValues(evaluate(rangeRegimeSkill, ctxOf(sparse, indexAt(sparse, TODAY, 600))), { adr: 10, adrSessions: 6 });

  // With sessions = 5 only the five most recent usable priors count, so an old wide session drops out.
  const wideOld = buildSeries([flat(PRIOR_DATES[0], 5000, 100), ...priorsRange10.slice(1), flat(TODAY, 5000, 10)]);
  expectValues(
    evaluate(rangeRegimeSkill, ctxOf(wideOld, indexAt(wideOld, TODAY, 600), { sessions: 5 })),
    { adr: 10, adrSessions: 5 },
  );
});

test("rangeRegime: fewer valid prior sessions than minSessions is warmup, and minSessions can lower it", () => {
  const four = buildSeries([...priorsRange10.slice(2), flat(TODAY, 5000, 10)]);
  expectSkip(evaluate(rangeRegimeSkill, ctxOf(four, indexAt(four, TODAY, 600))), "warmup");
  expectValues(
    evaluate(rangeRegimeSkill, ctxOf(four, indexAt(four, TODAY, 600), { minSessions: 3 })),
    { adrSessions: 4, adr: 10 },
  );
  expectSkip(
    evaluate(rangeRegimeSkill, ctxOf(four, indexAt(four, TODAY, 600), { sessions: 4, minSessions: 5 })),
    "bad-params",
  );
});

// ---------- trendRegime ----------

// Priors are flat sessions with a 4-point range, so the mean prior range is 4 and the threshold is 1.4.
const trendPriors = (closes: readonly number[]) => closes.map((close, k) => flat(PRIOR_DATES[k], close, 4));

test("trendRegime: rising closes are trend-up with the net change, slope and range position", () => {
  const series = buildSeries([...trendPriors([100, 101, 102, 103, 104]), flat(TODAY, 110, 4)]);
  const result = evaluate(trendRegimeSkill, ctxOf(series, indexAt(series, TODAY, 600)));
  // Closes 100, 101, 102, 103, 104, 110 at positions 0..5: OLS slope = 30 ÷ 17.5.
  // Multi-session window is 98 (prior low) to 112 (today's high): (110 − 98) ÷ (112 − 98).
  expectValues(result, {
    regime: "trend-up",
    netChangePoints: 10,
    slopePointsPerSession: 12 / 7,
    multiDayPosPct: (12 / 14) * 100,
  });
});

test("trendRegime: falling closes are trend-down, mirroring the up case", () => {
  const series = buildSeries([...trendPriors([105, 104, 103, 102, 101]), flat(TODAY, 95, 4)]);
  const result = evaluate(trendRegimeSkill, ctxOf(series, indexAt(series, TODAY, 600)));
  // Window high 107 (prior), low 93 (today): (95 − 93) ÷ (107 − 93).
  expectValues(result, {
    regime: "trend-down",
    netChangePoints: -10,
    slopePointsPerSession: -12 / 7,
    multiDayPosPct: (2 / 14) * 100,
  });
});

test("trendRegime: a small net change, or a net move without 60% of steps, is balance", () => {
  // Net +1 is inside the 1.4-point threshold (0.35 × 4).
  const small = buildSeries([...trendPriors([100, 101, 100, 101, 100]), flat(TODAY, 101, 4)]);
  expectValues(evaluate(trendRegimeSkill, ctxOf(small, indexAt(small, TODAY, 600))), { regime: "balance" });

  // Net +10 clears the threshold, but only 3 of 6 steps rose (50%), so it stays balance.
  const choppy = buildSeries([...trendPriors([100, 90, 100, 90, 100, 90]), flat(TODAY, 110, 4)]);
  expectValues(
    evaluate(trendRegimeSkill, ctxOf(choppy, indexAt(choppy, TODAY, 600), { sessions: 6 })),
    { regime: "balance", netChangePoints: 10 },
  );
});

test("trendRegime: fewer than minSessions prior sessions is warmup", () => {
  const series = buildSeries([...trendPriors([100, 101]), flat(TODAY, 110, 4)]);
  expectSkip(evaluate(trendRegimeSkill, ctxOf(series, indexAt(series, TODAY, 600))), "warmup");
});

// ---------- adrExtension ----------

// Today: open 5000, high 5004 (minute 1), low 4996 (minute 2). ADR from six 10-point priors is 10.
const extensionToday = (overrides: Record<number, Ohlc> = {}) => ({ ...flat(TODAY, 5000, 8), overrides });

test("adrExtension: session anchor measures from the first bar and the remaining ADR from the window extremes", () => {
  const series = buildSeries([...priorsRange10, extensionToday({
    [MIN_09_30]: { open: 5002, high: 5002, low: 5002, close: 5002 },
    600: { open: 5003, high: 5003, low: 5003, close: 5003 },
  })]);
  const result = evaluate(adrExtensionSkill, ctxOf(series, indexAt(series, TODAY, 600), { anchor: "session" }));
  // From the 5000 session open to 5003 is 3 points = 0.3 ADR. Low 4996: 4996 + 10 − 5003 = 3, so 0.3 up.
  // High 5004: 5003 − (5004 − 10) = 9, so 0.9 down.
  expectValues(result, {
    fromOpenPoints: 3,
    openExtAdr: 0.3,
    remainingUpAdr: 0.3,
    remainingDownAdr: 0.9,
    extensionBucket: "inside",
  });
});

test("adrExtension: RTH anchor measures from the 09:30 open and the window starts there", () => {
  const series = buildSeries([...priorsRange10, extensionToday({
    [MIN_09_30]: { open: 5002, high: 5002, low: 5002, close: 5002 },
    600: { open: 5003, high: 5003, low: 5003, close: 5003 },
  })]);
  const result = evaluate(adrExtensionSkill, ctxOf(series, indexAt(series, TODAY, 600), { anchor: "rth" }));
  // From the 5002 RTH open to 5003 is 1 point = 0.1 ADR. The RTH window is 09:30–10:00. Its low is 5000,
  // from the flat bars after 09:30, and its high is 5003: up = (5000 + 10 − 5003) ÷ 10 = 0.7;
  // down = (5003 − (5003 − 10)) ÷ 10 = 1.0.
  expectValues(result, {
    fromOpenPoints: 1,
    openExtAdr: 0.1,
    remainingUpAdr: 0.7,
    remainingDownAdr: 1,
    extensionBucket: "inside",
  });
});

test("adrExtension: the RTH anchor is not-known-yet before 09:30 ET but the session anchor is not skipped", () => {
  const series = buildSeries([...priorsRange10, extensionToday()]);
  expectSkip(
    evaluate(adrExtensionSkill, ctxOf(series, indexAt(series, TODAY, 568), { anchor: "rth" })),
    "not-known-yet",
  );
  expectValues(evaluate(adrExtensionSkill, ctxOf(series, indexAt(series, TODAY, 568))), { extensionBucket: "inside" });
});

test("adrExtension: a missing 09:30 bar at the decision is coverage, and an 09:30 close can be overextended", () => {
  // Decision at minute 569 (bar 09:29 closes at 09:30): the 09:30 bar is not yet at or before i.
  const series = buildSeries([...priorsRange10, extensionToday()]);
  expectSkip(evaluate(adrExtensionSkill, ctxOf(series, indexAt(series, TODAY, 569), { anchor: "rth" })), "coverage");

  // Close 5011 is 11 points above the open: 1.1 ADR, overextended. Window high becomes 5011.
  const far = buildSeries([...priorsRange10, extensionToday({
    600: { open: 5011, high: 5011, low: 5011, close: 5011 },
  })]);
  expectValues(evaluate(adrExtensionSkill, ctxOf(far, indexAt(far, TODAY, 600))), {
    fromOpenPoints: 11,
    openExtAdr: 1.1,
    remainingUpAdr: 0,
    remainingDownAdr: 1,
    extensionBucket: "overextended",
  });
});

test("adrExtension: fewer than 5 prior sessions is warmup", () => {
  const series = buildSeries([...priorsRange10.slice(2), extensionToday()]);
  expectSkip(evaluate(adrExtensionSkill, ctxOf(series, indexAt(series, TODAY, 600))), "warmup");
});

// ---------- gapOpen ----------

// Today opens flat at 5004 (or the value given), so no RTH bar touches PDC 5000 unless a designed bar does.
const gapDay = (open: number, overrides: Record<number, Ohlc> = {}, omit: number[] = []): SessionSpec => ({
  date: TODAY, open, high: open + 1, low: open - 9, close: open, overrides, omit,
});
const PDC_5000 = levelBook([["pdc", 5000]]);

test("gapOpen: gap-up is classified in ticks and is not filled until an RTH bar reaches back through PDC", () => {
  const series = buildSeries([gapDay(5004)]);
  // 09:31 decision: RTH open 5004 minus PDC 5000 = 4 points = 16 ticks (buckets [-16,-4,4,16]).
  expectValues(evaluate(gapOpenSkill, ctxOf(series, indexAt(series, TODAY, 571), {}, PDC_5000)), {
    gapPoints: 4, gapTicks: 16, direction: "gap-up", filled: false,
  });

  // A 09:35 bar (minute 575) whose low is 5000 fills the gap; the 09:31 decision cannot see it yet.
  const filled = buildSeries([gapDay(5004, { 575: { open: 5004, high: 5004, low: 5000, close: 5004 } })]);
  expectValues(evaluate(gapOpenSkill, ctxOf(filled, indexAt(filled, TODAY, 571), {}, PDC_5000)), { filled: false });
  expectValues(evaluate(gapOpenSkill, ctxOf(filled, indexAt(filled, TODAY, 580), {}, PDC_5000)), { filled: true });
});

test("gapOpen: tolerance decides whether a bar just above PDC counts as a fill", () => {
  const series = buildSeries([gapDay(5004, { 575: { open: 5004, high: 5004, low: 5000.25, close: 5004 } })]);
  const at = indexAt(series, TODAY, 580);
  expectValues(evaluate(gapOpenSkill, ctxOf(series, at, { toleranceTicks: 0 }, PDC_5000)), { filled: false });
  expectValues(evaluate(gapOpenSkill, ctxOf(series, at, { toleranceTicks: 2 }, PDC_5000)), { filled: true });
});

test("gapOpen: gap-down, and a flat open inside the band that counts as filled", () => {
  const down = buildSeries([gapDay(4996, { 575: { open: 4996, high: 5000, low: 4996, close: 4996 } })]);
  expectValues(evaluate(gapOpenSkill, ctxOf(down, indexAt(down, TODAY, 571), {}, PDC_5000)), {
    gapPoints: -4, gapTicks: -16, direction: "gap-down", filled: false,
  });
  expectValues(evaluate(gapOpenSkill, ctxOf(down, indexAt(down, TODAY, 580), {}, PDC_5000)), { filled: true });

  // One tick above PDC is inside the 4-tick flat band, so it is flat and filled by definition.
  const flatDay = buildSeries([gapDay(5000.25)]);
  expectValues(evaluate(gapOpenSkill, ctxOf(flatDay, indexAt(flatDay, TODAY, 571), {}, PDC_5000)), {
    gapPoints: 0.25, gapTicks: 1, direction: "flat", filled: true,
  });
});

test("gapOpen: not-known-yet before the 09:30 bar closes, no-level without PDC, and coverage without the 09:30 bar", () => {
  const series = buildSeries([gapDay(5004)]);
  expectSkip(evaluate(gapOpenSkill, ctxOf(series, indexAt(series, TODAY, 569), {}, PDC_5000)), "not-known-yet");
  expectSkip(evaluate(gapOpenSkill, ctxOf(series, indexAt(series, TODAY, 571), {}, levelBook([]))), "no-level");

  const missing = buildSeries([gapDay(5004, {}, [MIN_09_30])]);
  expectSkip(evaluate(gapOpenSkill, ctxOf(missing, indexAt(missing, TODAY, 571), {}, PDC_5000)), "coverage");
  // An rth_open level supplies the open when the bar is absent.
  expectValues(
    evaluate(gapOpenSkill, ctxOf(missing, indexAt(missing, TODAY, 571), {}, levelBook([["pdc", 5000], ["rth_open", 5004]]))),
    { gapTicks: 16, direction: "gap-up" },
  );
});

// ---------- registry shape and no-lookahead ----------

test("regime skills: metadata matches the batch-2 contract and every skill is decision-time only", () => {
  assert.deepEqual(REGIME_SKILLS.map((skill) => skill.meta.id), ["rangeRegime", "trendRegime", "adrExtension", "gapOpen"]);
  for (const skill of REGIME_SKILLS) {
    assert.equal(skill.meta.version, "1.0.0");
    assert.equal(skill.meta.status, "active");
    assert.equal(skill.meta.knownAt, "bar-close");
    assert.equal(skill.meta.needs.baseTimeframe, "1m");
    assert.equal(skill.meta.needs.volume, false);
  }
  assert.equal(rangeRegimeSkill.meta.kind, "feature");
  assert.equal(trendRegimeSkill.meta.kind, "label");
  assert.equal(adrExtensionSkill.meta.kind, "feature");
  assert.equal(gapOpenSkill.meta.kind, "feature");
});

test("regime skills: no lookahead, with a wide future session after today in the series", () => {
  // The future session is wide and tilted so that any read past bar i would change the answer.
  const future: SessionSpec = { ...flat(FUTURE, 5200, 200), overrides: { 600: { open: 5200, high: 5300, low: 5100, close: 5200 } } };
  const series = buildSeries([
    ...priorsRange10,
    flat("2026-11-16", 5000, 40),
    extensionToday({ 575: { open: 5002, high: 5002, low: 5000, close: 5002 } }),
    future,
  ]);
  const levels = PDC_5000;
  const paramSets: readonly (Record<string, Value>)[] = [{}, { anchor: "rth" }, { sessions: 5 }];
  for (const skill of REGIME_SKILLS) {
    for (const minute of [568, 569, 570, 575, 600, 1000]) {
      const i = indexAt(series, TODAY, minute);
      for (const params of paramSets) assertNoLookahead(skill, ctxOf(series, i, params, levels));
    }
  }
});
