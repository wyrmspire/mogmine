import test from "node:test";
import assert from "node:assert/strict";
import {
  attribute, computeStats, featureKey, multipleComparisonLine, shrunkAverage, timeOfDay, wilsonInterval,
} from "../strategy-lab/attribution.ts";
import type { Match, Outcome, OutcomeExitReason, OutputSpec, SkillOutputRef, Value } from "../strategy-lab/types.ts";

const R_USD = 300;
const SETUP: SkillOutputRef = { skill: "setup", out: "kind" };
const RVOL: SkillOutputRef = { skill: "rvol", out: "rvolBucket" };
const X: SkillOutputRef = { skill: "x", out: "v" };
const MOOD: SkillOutputRef = { skill: "mood", out: "label" };
const SETUP_KEY = featureKey(SETUP);
const MOOD_KEY = featureKey(MOOD);

interface TradeOpts {
  features?: Record<string, Value>;
  session?: number;
  time?: number;
  qty?: number;
  exit?: OutcomeExitReason;
  minutesToTarget?: number | null;
}

/** One completed match. `pnlUsd` decides win/loss/scratch; resultR = pnlUsd ÷ R size. */
function trade(pnlUsd: number, i: number, o: TradeOpts = {}): Match {
  const qty = o.qty ?? 1;
  const outcome: Outcome = {
    exitReason: o.exit ?? "target",
    exitTime: 0,
    pnlPoints: pnlUsd / (5 * qty),
    pnlUsd,
    resultR: pnlUsd / R_USD,
    riskMultiple: 0,
    mfePoints: 0,
    maePoints: 0,
    mfeR: 0,
    maeR: 0,
    minutesToExit: 10,
    minutesToTarget: o.minutesToTarget === undefined ? 10 : o.minutesToTarget,
  };
  return {
    i,
    time: o.time ?? Date.UTC(2026, 6, 6, 14, 0),
    sessionDate: `2026-11-${String((o.session ?? 0) + 1).padStart(2, "0")}`,
    entry: 100,
    stop: 99,
    target: 102,
    qty,
    oversized: false,
    features: o.features ?? {},
    outcome,
  };
}

/** 40 trades over 10 sessions. Setup "a" wins every time, "b" loses every time. */
function clearRun(): Match[] {
  return Array.from({ length: 40 }, (_, k) => {
    const bucket = k < 20 ? "a" : "b";
    return trade(bucket === "a" ? 300 : -300, k, { session: k % 10, features: { [SETUP_KEY]: bucket } });
  });
}

/** 40 trades: "a" wins 11 of 20, "b" wins 9 of 20. Wilson intervals overlap. */
function suggestiveRun(): Match[] {
  return Array.from({ length: 40 }, (_, k) => {
    const bucket = k < 20 ? "a" : "b";
    const win = bucket === "a" ? k < 11 : k - 20 < 9;
    return trade(win ? 300 : -300, k, { session: k % 10, features: { [SETUP_KEY]: bucket } });
  });
}

/**
 * "a" is better in the first five sessions and worse in the last five, yet better overall,
 * so the best bucket flips between halves.
 */
function flipRun(): Match[] {
  const out: Match[] = [];
  const add = (bucket: string, session: number, win: boolean) => {
    out.push(trade(win ? 300 : -300, out.length, { session, features: { [SETUP_KEY]: bucket } }));
  };
  for (let s = 0; s < 5; s++) {
    add("a", s, true);
    add("a", s, true);
    add("b", s, false);
    add("b", s, false);
  }
  const aSecond = [true, true, false, false, false, false, false, false, false, false];
  const bSecond = [true, true, true, true, true, true, true, false, false, false];
  aSecond.forEach((win, j) => add("a", 5 + Math.floor(j / 2), win));
  bSecond.forEach((win, j) => add("b", 5 + Math.floor(j / 2), win));
  return out;
}

test("wilsonInterval matches known Wilson 95% values and is null for n = 0", () => {
  const close = (actual: readonly number[] | null, expected: readonly number[]) => {
    assert.ok(actual);
    actual.forEach((v, i) => assert.ok(Math.abs(v - expected[i]) < 1e-4, `${v} vs ${expected[i]}`));
  };
  close(wilsonInterval(0, 10), [0, 0.2775]);
  close(wilsonInterval(5, 10), [0.2366, 0.7634]);
  close(wilsonInterval(10, 10), [0.7225, 1]);
  close(wilsonInterval(0, 20), [0, 0.1611]);
  close(wilsonInterval(20, 20), [0.8389, 1]);
  assert.equal(wilsonInterval(0, 0), null);
});

test("shrinkage is (n × avg + k × overall) ÷ (n + k) with k = 10", () => {
  assert.equal(shrunkAverage(5, 1, 0), 5 / 15);
  assert.equal(shrunkAverage(10, 1, 0), 0.5);
  assert.equal(shrunkAverage(10, 1, 1), 1);
});

test("overall stats count wins, losses and scratches; win rate is over all n", () => {
  const matches = [
    trade(300, 0, { exit: "target" }),
    trade(300, 1, { exit: "target" }),
    trade(300, 2, { exit: "target" }),
    trade(-300, 3, { exit: "stop" }),
    trade(-300, 4, { exit: "stop" }),
    trade(2, 5, { exit: "target" }), // within 2 ticks per contract: a scratch
  ];
  const stats = computeStats(matches);
  assert.equal(stats.n, 6);
  assert.equal(stats.wins, 3);
  assert.equal(stats.losses, 2);
  assert.equal(stats.scratches, 1);
  assert.equal(stats.winRate, 0.5);
  assert.ok(Math.abs(stats.totalR - (1 + 2 / 300)) < 1e-12);
  assert.equal(stats.exits.target, 4);
  assert.equal(stats.exits.stop, 2);
  assert.equal(stats.exits.time, 0);
  assert.equal(stats.profitFactor, null, "profit factor needs n >= 10");
});

test("profit factor is gross wins over gross losses once n >= 10", () => {
  const matches = [
    ...Array.from({ length: 6 }, (_, i) => trade(300, i)),
    ...Array.from({ length: 4 }, (_, i) => trade(-300, 6 + i, { exit: "stop" })),
  ];
  assert.equal(computeStats(matches).profitFactor, 1.5);
});

test("a scratch counts in n and is neither a win nor a loss", () => {
  const stats = computeStats([trade(0, 0), trade(-2.5, 1), trade(-2.6, 2)]);
  assert.equal(stats.scratches, 2);
  assert.equal(stats.losses, 1);
});

test("n gating: under 5 shows counts only, 5 to 9 shows rates but is thin, 10 and over is full", () => {
  const ref = { skill: "g", out: "p" };
  const key = featureKey(ref);
  const group = (name: string, count: number, offset: number) => Array.from({ length: count }, (_, j) =>
    trade(300, offset + j, { features: { [key]: name } }));
  const matches = [...group("p", 3, 0), ...group("q", 7, 3), ...group("r", 10, 10)];
  const { splits } = attribute(matches, [ref]);
  const [p, q, r] = splits[0].buckets;

  assert.equal(p.n, 3);
  assert.equal(p.wins, 3);
  assert.equal(p.winRate, null);
  assert.equal(p.winRate95, null);
  assert.equal(p.avgR, null);
  assert.equal(p.shrunkAvgR, null);
  assert.equal(p.thin, true);

  assert.equal(q.n, 7);
  assert.equal(q.winRate, 1);
  assert.ok(q.winRate95);
  assert.equal(q.avgR, 1);
  assert.equal(q.thin, true);

  assert.equal(r.n, 10);
  assert.equal(r.thin, false);
});

test("shrunk avg R sits between the bucket average and the run average", () => {
  const matches = [
    ...Array.from({ length: 5 }, (_, i) => trade(300, i, { features: { [SETUP_KEY]: "a" } })),
    ...Array.from({ length: 5 }, (_, i) => trade(-300, 5 + i, { features: { [SETUP_KEY]: "b" } })),
  ];
  const { splits, stats } = attribute(matches, [SETUP]);
  assert.equal(stats.avgR, 0);
  const a = splits[0].buckets.find((b) => b.key === "a");
  const b = splits[0].buckets.find((x) => x.key === "b");
  assert.ok(a && b);
  assert.ok(Math.abs((a.shrunkAvgR ?? 0) - 5 / 15) < 1e-12);
  assert.ok(Math.abs((b.shrunkAvgR ?? 0) + 5 / 15) < 1e-12);
});

test("numeric slices without declared buckets split into terciles at the run's 1/3 and 2/3 quantiles", () => {
  const matches = Array.from({ length: 9 }, (_, i) => trade(300, i, { features: { [featureKey(X)]: i + 1 } }));
  const { splits } = attribute(matches, [X]);
  const buckets = splits[0].buckets;
  assert.deepEqual(buckets.map((b) => b.key), ["low", "mid", "high"]);
  assert.deepEqual(buckets.map((b) => b.n), [3, 3, 3]);
  assert.deepEqual(buckets.map((b) => b.label), ["low (< 3.67)", "mid (3.67–6.33)", "high (≥ 6.33)"]);
});

test("declared buckets use the skill's edges: low < 0.7 ≤ normal < 1.3 ≤ high < 2 ≤ very high", () => {
  const spec: OutputSpec = { key: "rvolBucket", type: "number", label: "RVOL", buckets: [0.7, 1.3, 2] };
  const values: (number | null)[] = [0.5, 1.0, 1.3, 2.5, null];
  const matches = values.map((v, i) => trade(300, i, { features: { [featureKey(RVOL)]: v } }));
  const { splits } = attribute(matches, [RVOL], { outputSpec: () => spec });
  const buckets = splits[0].buckets;
  assert.deepEqual(buckets.map((b) => b.label), ["< 0.7", "0.7–1.3", "1.3–2", "≥ 2", "n/a"]);
  assert.deepEqual(buckets.map((b) => b.n), [1, 1, 1, 1, 1]);
  assert.equal(buckets[2].key, "b2", "1.3 is the start of the high bucket");
});

test("null feature values form an n/a bucket with its count, kept last", () => {
  const matches = [
    trade(300, 0, { features: { [SETUP_KEY]: "a" } }),
    trade(-300, 1, { features: {} }),
    trade(300, 2, { features: { [SETUP_KEY]: null } }),
    trade(-300, 3, { features: { [SETUP_KEY]: "b" } }),
  ];
  const { splits } = attribute(matches, [SETUP]);
  const buckets = splits[0].buckets;
  const last = buckets[buckets.length - 1];
  assert.equal(last.key, "__na");
  assert.equal(last.label, "n/a");
  assert.equal(last.n, 2);
  assert.equal(buckets.reduce((sum, b) => sum + b.n, 0), matches.length, "no match is dropped");
});

test("a disjoint best and worst Wilson interval is clear; overlapping is suggestive", () => {
  const clear = attribute(clearRun(), [SETUP]).separators;
  assert.equal(clear.length, 1);
  assert.equal(clear[0].best, "a");
  assert.equal(clear[0].worst, "b");
  assert.ok(Math.abs(clear[0].gapR - 4 / 3) < 1e-12, "shrunk a 2/3 minus shrunk b -2/3");
  assert.equal(clear[0].winRateGap, 1);
  assert.equal(clear[0].clarity, "clear");
  assert.equal(clear[0].thin, false);

  const suggestive = attribute(suggestiveRun(), [SETUP]).separators;
  assert.equal(suggestive.length, 1);
  assert.equal(suggestive[0].clarity, "suggestive");
});

test("stable when the best bucket is the same in both halves of the sessions, unstable when it flips", () => {
  assert.equal(attribute(clearRun(), [SETUP]).separators[0].stability, "stable");
  assert.equal(attribute(flipRun(), [SETUP]).separators[0].stability, "unstable");
});

test("a run under 40 matches uses n >= 5 for separators and flags them thin", () => {
  const matches = [
    ...Array.from({ length: 6 }, (_, i) => trade(300, i, { features: { [SETUP_KEY]: "a" } })),
    ...Array.from({ length: 6 }, (_, i) => trade(-300, 6 + i, { features: { [SETUP_KEY]: "b" } })),
  ];
  const sep = attribute(matches, [SETUP]).separators;
  assert.equal(sep.length, 1);
  assert.equal(sep[0].thin, true);
});

test("a bucket below 5 matches cannot be a separator", () => {
  const matches = [
    ...Array.from({ length: 4 }, (_, i) => trade(300, i, { features: { [SETUP_KEY]: "a" } })),
    ...Array.from({ length: 12 }, (_, i) => trade(-300, 4 + i, { features: { [SETUP_KEY]: "b" } })),
  ];
  assert.deepEqual(attribute(matches, [SETUP]).separators, []);
});

test("separators rank clear before suggestive", () => {
  // "mood" p is 20 of 20 wins and q is 0 of 20: clear. "setup" a is 11 of 20 and b is 9 of 20: suggestive.
  const rows: [setup: string, mood: string, win: boolean][] = [
    ...Array.from({ length: 11 }, (): [string, string, boolean] => ["a", "p", true]),
    ...Array.from({ length: 9 }, (): [string, string, boolean] => ["b", "p", true]),
    ...Array.from({ length: 9 }, (): [string, string, boolean] => ["a", "q", false]),
    ...Array.from({ length: 11 }, (): [string, string, boolean] => ["b", "q", false]),
  ];
  const matches = rows.map(([setup, mood, win], k) => trade(win ? 300 : -300, k, {
    session: k % 10,
    features: { [SETUP_KEY]: setup, [MOOD_KEY]: mood },
  }));
  const { separators } = attribute(matches, [SETUP, MOOD]);
  assert.deepEqual(separators.map((s) => featureKey(s.ref)), ["mood@1:label", "setup@1:kind"]);
  assert.deepEqual(separators.map((s) => s.clarity), ["clear", "suggestive"]);
});

test("time of day buckets by the decision time (bar close) in America/New_York, across DST", () => {
  const summer = trade(300, 0, { time: Date.UTC(2026, 6, 6, 12, 11) }); // open 08:11 EDT → close 08:12
  const winter = trade(300, 1, { time: Date.UTC(2026, 0, 7, 13, 30) }); // open 08:30 EST → close 08:31
  const cells = timeOfDay([summer, winter]);
  assert.deepEqual(cells.map((c) => c.bucket), ["08:00", "08:30"]);
  assert.deepEqual(cells.map((c) => c.n), [1, 1]);
  assert.equal(cells[0].winRate, null, "under 5 trades shows counts only");
});

test("winners vs losers: medians of numeric slices and category shares", () => {
  const numeric = [
    ...Array.from({ length: 4 }, (_, i) => trade(300, i, { features: { [featureKey(X)]: 8 } })),
    ...Array.from({ length: 4 }, (_, i) => trade(-300, 4 + i, { features: { [featureKey(X)]: 2 } })),
  ];
  const numericRow = attribute(numeric, [X]).winnersLosers[0];
  assert.equal(numericRow.kind, "number");
  if (numericRow.kind !== "number") return;
  assert.equal(numericRow.winnersMedian, 8);
  assert.equal(numericRow.losersMedian, 2);

  const categorical = [
    trade(300, 0, { features: { [SETUP_KEY]: "a" } }),
    trade(300, 1, { features: { [SETUP_KEY]: "a" } }),
    trade(300, 2, { features: { [SETUP_KEY]: "b" } }),
    trade(-300, 3, { features: { [SETUP_KEY]: "b" } }),
  ];
  const row = attribute(categorical, [SETUP]).winnersLosers[0];
  assert.equal(row.kind, "category");
  if (row.kind !== "category") return;
  const a = row.shares.find((s) => s.key === "a");
  const b = row.shares.find((s) => s.key === "b");
  assert.equal(a?.winnerShare, 2 / 3);
  assert.equal(b?.winnerShare, 1 / 3);
  assert.equal(a?.loserShare, 0);
  assert.equal(b?.loserShare, 1);
});

test("the multiple-comparison line is always produced with the slice count", () => {
  assert.equal(
    multipleComparisonLine(12),
    "12 slices tested. By chance alone about 1 in 20 can look clear. Treat single-slice results as leads, not rules.",
  );
  assert.equal(attribute(clearRun(), [SETUP, X]).multipleComparison, multipleComparisonLine(2));
});

test("featureKey is skill@major:out with sorted params, which the runner must share", () => {
  assert.equal(featureKey(RVOL), "rvol@1:rvolBucket");
  assert.equal(featureKey(RVOL, 2), "rvol@2:rvolBucket");
  assert.equal(
    featureKey({ skill: "rvol", out: "rvol", params: { sessions: 10, windowMinutes: 5 } }),
    "rvol@1:rvol(sessions=10,windowMinutes=5)",
  );
});

test("attribution is pure and deterministic: same matches, same output, input untouched", () => {
  const matches = flipRun();
  const before = JSON.stringify(matches);
  const first = attribute(matches, [SETUP]);
  const second = attribute(matches, [SETUP]);
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(matches), before);
});
