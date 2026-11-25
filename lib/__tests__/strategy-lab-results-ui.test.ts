import test from "node:test";
import assert from "node:assert/strict";
import { attribute, featureKey, multipleComparisonLine } from "../strategy-lab/attribution.ts";
import { rSizeBasis } from "../strategy-lab/context-card.ts";
import {
  bucketTone, comparisonNote, dataLines, defaultSliceLabel, edgeRows, headerLine, matchPage, riskMultipleText,
  signedR, sparkline, splitRowViews, statLines, todRowViews, valueText, MINUS, MATCH_PAGE_SIZE,
} from "../strategy-lab/results-view.ts";
import type { BarSeries, Match, Outcome, SkillOutputRef, Stats } from "../strategy-lab/types.ts";

// --- fixtures ---------------------------------------------------------------

const RVOL: SkillOutputRef = { skill: "volume.rvol", out: "bucket" };
const SESSION_0 = Date.parse("2026-11-24T13:00:00Z"); // 08:00 ET, EST

function outcome(win: boolean, resultR: number, extra: Partial<Outcome> = {}): Outcome {
  return {
    exitReason: win ? "target" : "stop",
    exitTime: 0,
    pnlPoints: win ? 4 : -4,
    pnlUsd: win ? 300 : -300,
    resultR,
    riskMultiple: 1,
    mfePoints: 5,
    maePoints: 2,
    mfeR: 1.4,
    maeR: 0.6,
    minutesToExit: 9,
    minutesToTarget: win ? 9 : null,
    ...extra,
  };
}

function match(i: number, rvol: string | number | null, win: boolean, day: number): Match {
  return {
    i,
    time: SESSION_0 + day * 86_400_000 + (i % 60) * 60_000,
    sessionDate: `2026-11-${String(24 + day).padStart(2, "0")}`,
    entry: 5900,
    stop: 5896,
    target: 5904,
    qty: 1,
    oversized: false,
    features: { [featureKey(RVOL)]: rvol },
    outcome: outcome(win, win ? 1 : -1),
  };
}

/** 12 "high" matches (10 wins) and 12 "low" matches (2 wins): a clear separator, both buckets n ≥ 5. */
function separatedRun(): Match[] {
  const out: Match[] = [];
  for (let k = 0; k < 12; k += 1) out.push(match(k, "high", k < 10, k % 4));
  for (let k = 0; k < 12; k += 1) out.push(match(100 + k, "low", k < 2, k % 4));
  return out;
}

function fakeStats(overrides: Partial<Stats> = {}): Stats {
  return {
    n: 14, wins: 7, losses: 6, scratches: 1, winRate: 0.5, winRate95: [0.27, 0.73], avgR: 0.06,
    medianR: 0.1, totalR: 0.84, avgPoints: 0.2, medianPoints: 0.25, profitFactor: null,
    exits: { target: 6, stop: 7, time: 1, "ambiguous-stop": 0 },
    mfePoints: { p25: 1, p50: 2, p75: 3 }, maePoints: { p25: 1, p50: 1.5, p75: 2 },
    mfeR: { p25: 0.9, p50: 1.4, p75: 2 }, maeR: { p25: 0.4, p50: 0.6, p75: 0.9 },
    medianMinutesToTarget: 8,
    ...overrides,
  };
}

/** A minimal 1m series: `closes` for one session, with NaN allowed. Only the fields the sparkline reads are real. */
function seriesOf(closes: number[], session = "2026-11-24"): BarSeries {
  return {
    symbol: "MES", barMs: 60_000,
    time: new Float64Array(closes.length), open: new Float64Array(closes.length),
    high: new Float64Array(closes.length), low: new Float64Array(closes.length),
    close: Float64Array.from(closes), volume: new Float64Array(closes.length),
    sessionDate: closes.map(() => session), etMinute: new Uint16Array(closes.length),
    sessionStart: new Int32Array(closes.length), byTime: new Map(), sessions: [],
    dropped: { invalid: 0, duplicates: 0 },
  } as unknown as BarSeries;
}

// --- number and value formatting ------------------------------------------

test("signedR: sign, minus sign, rounding, and missing values", () => {
  assert.equal(signedR(0.21), "+0.21R");
  assert.equal(signedR(-0.25), `${MINUS}0.25R`);
  assert.equal(signedR(-0.001), "0.00R", "a tiny negative rounds to zero without a sign");
  assert.equal(signedR(0), "0.00R");
  assert.equal(signedR(null), "—");
  assert.equal(signedR(Number.NaN), "—");
});

test("valueText: missing and NaN read n/a; booleans read yes/no; numbers stay short", () => {
  assert.equal(valueText(null), "n/a");
  assert.equal(valueText(undefined), "n/a");
  assert.equal(valueText(Number.NaN), "n/a", "volume 0 is mapped to NaN upstream and must never print as 0");
  assert.equal(valueText(true), "yes");
  assert.equal(valueText(false), "no");
  assert.equal(valueText(3), "3");
  assert.equal(valueText(2.346), "2.35");
  assert.equal(valueText("very high"), "very high");
});

test("riskMultipleText is unsigned and labelled as multiples of risk", () => {
  assert.equal(riskMultipleText(1.4), "1.4× risk");
  assert.equal(riskMultipleText(-0.6), "0.6× risk");
  assert.equal(riskMultipleText(null), "—");
});

// --- R basis (never 1R) -----------------------------------------------------

test("R basis: the fixed account size is shown in dollars, and Shield hides dollars but keeps R", () => {
  assert.equal(rSizeBasis({ usd: 300, source: "account", accountName: "SIM Eval 50K" }, false), "R = $300 (SIM Eval 50K)");
  assert.equal(rSizeBasis({ usd: 250, source: "default", accountName: null }, false), "R = $250 (default risk budget)");
  const shielded = rSizeBasis({ usd: 300, source: "account", accountName: "SIM Eval 50K" }, true);
  assert.equal(shielded, "R · SIM Eval 50K");
  assert.ok(!shielded.includes("$"));
});

// --- header, stats, multiple comparison ------------------------------------

test("headerLine shows partial coverage as used of requested", () => {
  assert.equal(headerLine("Premarket bottom", 3, 20, 20), "Premarket bottom v3 · 20 sessions");
  assert.equal(headerLine("Premarket bottom", 3, 18, 20), "Premarket bottom v3 · 18 of 20 sessions");
});

test("statLines: headline, exits, MFE/MAE in R multiples, no dollars", () => {
  const lines = statLines(fakeStats());
  assert.equal(lines[0], "n 14 · win 50% (27–73%) · +0.06R avg");
  assert.equal(lines[1], "exits: T 6 · S 7 · time 1 · amb 0");
  assert.equal(lines[2], "MFE p50 1.4× risk · MAE p50 0.6× risk");
  assert.ok(lines.every((line) => !line.includes("$")));
});

test("statLines: an empty run says so instead of printing dashes", () => {
  const lines = statLines(fakeStats({ n: 0, winRate: null, winRate95: null, avgR: null }));
  assert.deepEqual(lines, ["No matches in this run. Widen the window or relax a condition."]);
});

test("comparisonNote is always the multiple-comparison line, even with zero slices", () => {
  assert.equal(comparisonNote(0), multipleComparisonLine(0));
  assert.match(comparisonNote(12), /^12 slices tested\. By chance alone about 1 in 20 can look clear\./);
  assert.match(comparisonNote(12), /Treat single-slice results as leads, not rules\.$/);
});

// --- tones and split rows ---------------------------------------------------

test("bucketTone: n ≥ 10 full, 5–9 thin (greyed), below 5 counts only", () => {
  assert.equal(bucketTone(14), "full");
  assert.equal(bucketTone(10), "full");
  assert.equal(bucketTone(9), "thin");
  assert.equal(bucketTone(5), "thin");
  assert.equal(bucketTone(4), "counts");
  assert.equal(bucketTone(0), "counts");
});

test("split rows: full rows show values, thin rows are greyed and noted, counts-only rows show dashes", () => {
  const run = attribute(
    [
      ...Array.from({ length: 12 }, (_, k) => match(k, "high", k < 10, k % 4)),
      ...Array.from({ length: 7 }, (_, k) => match(50 + k, "mid", k < 3, k % 4)),
      ...Array.from({ length: 2 }, (_, k) => match(70 + k, "low", k < 1, k % 4)),
    ],
    [RVOL],
  );
  const rows = splitRowViews(run.splits[0]);
  const high = rows.find((r) => r.key === "high");
  const mid = rows.find((r) => r.key === "mid");
  const low = rows.find((r) => r.key === "low");
  assert.ok(high && mid && low);

  assert.equal(high.tone, "full");
  assert.equal(high.win, "83%");
  assert.equal(high.avgR, "+0.67R");
  assert.equal(high.note, "");

  assert.equal(mid.tone, "thin");
  assert.equal(mid.note, "thin");
  assert.equal(mid.n, 7);
  assert.notEqual(mid.avgR, "—", "a thin row still shows its numbers");

  assert.equal(low.tone, "counts");
  assert.equal(low.note, "counts only");
  assert.equal(low.win, "—");
  assert.equal(low.avgR, "—");
  assert.equal(low.shrunkR, "—");
  assert.equal(low.n, 2);
});

test("split rows never print NaN, even for a null bucket", () => {
  const run = attribute(
    [
      ...Array.from({ length: 6 }, (_, k) => match(k, "x", k < 3, k % 4)),
      ...Array.from({ length: 6 }, (_, k) => match(20 + k, null, k < 3, k % 4)),
    ],
    [RVOL],
  );
  const rows = splitRowViews(run.splits[0]);
  for (const row of rows) {
    for (const text of [row.win, row.winCi, row.avgR, row.shrunkR]) assert.ok(!text.includes("NaN"));
  }
  assert.ok(rows.some((r) => r.n === 6), "the n/a bucket keeps its count");
});

// --- works and fails --------------------------------------------------------

test("edgeRows: the clear separator puts the best bucket under Works and the worst under Fails, with n and shrunk R", () => {
  const matches = separatedRun();
  const run = attribute(matches, [RVOL]);
  const overall = run.stats.avgR;
  const { works, fails } = edgeRows(run.separators, run.splits, overall, () => "RVOL");

  assert.equal(works.length, 1);
  assert.equal(fails.length, 1);
  assert.equal(works[0].bucket, "high");
  assert.equal(works[0].wins, 10);
  assert.equal(works[0].n, 12);
  assert.equal(fails[0].bucket, "low");
  assert.equal(fails[0].wins, 2);
  assert.equal(works[0].slice, "RVOL");
  assert.equal(works[0].overallR, signedR(overall));
  assert.equal(works[0].clarity, "clear");
  assert.equal(works[0].greyed, false, "both buckets have n = 12, which is a full row");
  assert.equal(works[0].role, "works");
  assert.equal(fails[0].role, "fails");
});

test("edgeRows: a thin separator is greyed, not hidden", () => {
  const run = attribute(
    [
      ...Array.from({ length: 6 }, (_, k) => match(k, "high", k < 5, k % 4)),
      ...Array.from({ length: 6 }, (_, k) => match(30 + k, "low", k < 1, k % 4)),
    ],
    [RVOL],
  );
  const { works, fails } = edgeRows(run.separators, run.splits, run.stats.avgR);
  assert.equal(works.length, 1, "the thin separator is still shown");
  assert.equal(works[0].greyed, true);
  assert.equal(works[0].thin, true);
  assert.equal(fails[0].greyed, true);
  assert.equal(defaultSliceLabel(RVOL), "volume.rvol · bucket");
});

test("edgeRows: nothing to rank gives empty lists, and the comparison line is still available", () => {
  const run = attribute([match(0, "a", true, 0), match(1, "b", false, 1)], [RVOL]);
  const { works, fails } = edgeRows(run.separators, run.splits, run.stats.avgR);
  assert.deepEqual(works, []);
  assert.deepEqual(fails, []);
  assert.equal(comparisonNote(run.splits.length), multipleComparisonLine(1));
});

// --- time of day ------------------------------------------------------------

test("time-of-day rows: bar length is |avg R| as a share of the largest, counts-only rows get no bar", () => {
  const rows = todRowViews([
    { bucket: "08:00", n: 12, wins: 9, winRate: 0.75, avgR: 0.5 },
    { bucket: "08:30", n: 6, wins: 2, winRate: 2 / 6, avgR: -0.25 },
    { bucket: "09:00", n: 3, wins: 1, winRate: null, avgR: null },
  ]);
  assert.equal(rows[0].barPct, 100);
  assert.equal(rows[1].barPct, 50);
  assert.equal(rows[1].sign, "neg");
  assert.equal(rows[1].avgR, `${MINUS}0.25R`);
  assert.equal(rows[1].tone, "thin");
  assert.equal(rows[2].tone, "counts");
  assert.equal(rows[2].barPct, 0);
  assert.equal(rows[2].avgR, "—");
  assert.equal(rows[2].sign, "none");
});

// --- matches ----------------------------------------------------------------

test("matchPage: first page is capped, the rest are counted, features read n/a for NaN", () => {
  const matches = [
    ...Array.from({ length: 60 }, (_, k) => match(k, "high", true, k % 4)),
    match(999, Number.NaN, false, 0),
  ];
  const page = matchPage(matches, [RVOL]);
  assert.equal(page.rows.length, MATCH_PAGE_SIZE);
  assert.equal(page.total, 61);
  assert.equal(page.hidden, 11);

  const last = matchPage(matches, [RVOL], 61);
  assert.equal(last.hidden, 0);
  const nanRow = last.rows[60];
  assert.equal(nanRow.features[0].value, "n/a");
  assert.equal(nanRow.r, `${MINUS}1.00R`);
  assert.equal(nanRow.sign, "neg");
  assert.equal(nanRow.exit, "stop");
  assert.match(nanRow.when, /ET$/);
});

test("matchPage: exit text and feature labels", () => {
  const m = match(0, "high", true, 0);
  m.outcome = outcome(true, 1, { exitReason: "ambiguous-stop" });
  const page = matchPage([m], [RVOL], 10, () => "RVOL");
  assert.equal(page.rows[0].exit, "ambiguous stop");
  assert.deepEqual(page.rows[0].features, [{ label: "RVOL", value: "high" }]);
});

test("sparkline: same-session bars only, NaN skipped, the match bar is marked", () => {
  const series = seriesOf([5900, 5901, Number.NaN, 5903, 5902]);
  const spark = sparkline(series, 3, 30);
  assert.equal(spark.points.length, 4, "the NaN close is skipped");
  assert.equal(spark.markerAt, 2, "bar 3 is the third plotted point");
  for (const p of spark.points) {
    assert.ok(p.x >= 0 && p.x <= 1);
    assert.ok(p.y >= 0 && p.y <= 1);
  }
  // Plotted closes: 5900, 5901, 5903, 5902. The highest close (5903, the third point) sits at the top (y = 0).
  assert.equal(spark.points[2].y, 0);
  assert.equal(spark.points[0].y, 1, "the lowest close is at the bottom");
});

test("sparkline: a bar from another session is not joined to this match's window", () => {
  const series = seriesOf([5900, 5901, 5902], "2026-11-24");
  series.sessionDate[2] = "2026-11-25";
  const spark = sparkline(series, 1, 30);
  assert.equal(spark.points.length, 2);
});

test("sparkline: a flat window sits mid-height and a missing bar has no marker", () => {
  const flat = sparkline(seriesOf([5900, 5900, 5900]), 1, 30);
  assert.ok(flat.points.every((p) => p.y === 0.5));
  const gone = sparkline(seriesOf([5900, Number.NaN, 5902]), 1, 30);
  assert.equal(gone.markerAt, -1);
});

// --- data footer -------------------------------------------------------------

test("dataLines: sessions used, exclusions, missing-bar counts, and the R basis", () => {
  const lines = dataLines(
    {
      sessionsRequested: 3,
      sessionsUsed: ["2026-11-20", "2026-11-23"],
      excluded: [{ date: "2026-11-24", reason: "bars missing" }],
      barsMissing: 4,
      volumeMissing: 9,
      rSize: { usd: 300, source: "account" },
    },
    "R = $300 (SIM Eval 50K)",
  );
  assert.deepEqual(lines, [
    "Sessions used 2 of 3",
    "Bars missing 4 · volume missing 9",
    "R = $300 (SIM Eval 50K)",
    "Not used: 2026-11-24 (bars missing)",
  ]);
});
