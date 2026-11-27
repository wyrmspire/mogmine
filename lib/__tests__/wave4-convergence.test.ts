// Wave 4 convergence tests covering Lanes 1-5:
// - Lane 1: archive read path, symbol mapping without cross-instrument fallback, archive-over-Yahoo merge, rate-limit exemption
// - Lane 2: 4-field note warnings, friendly 404 hints, pre-flight check cache/rate-limit separation
// - Lane 4: $300 default R, whole-micro ceiling sizing ("at-least" rule), <1 micro overshoot tolerance
// - Lane 5: Strategy Lab starter recipes pass validation against registered skills
import test from "node:test";
import assert from "node:assert/strict";
import {
  archiveProviderName, archiveSourceLabel, mergeArchiveAndYahoo, readArchiveCandles, resolveArchiveSymbols,
} from "../market-data/archive.ts";
import type { ArchiveCandleRow, ArchiveClientLike, ArchiveQueryLike } from "../market-data/archive.ts";
import { createCandleLoader, loadAgentCandles } from "../agent/candles.ts";
import { createRateLimiter } from "../agent/http.ts";
import { notFoundHint } from "../agent/dispatch.ts";
import { checkTradeWrite } from "../agent/write-checks.ts";
import { DEFAULT_R_SIZE_CENTS, riskComparison, sizeContractsAtLeast } from "../r-size.ts";
import { normalizeTrade } from "../trades.ts";
import { buildStarterRecipes } from "../strategy-lab/starter-recipe.ts";
import { validateRecipe } from "../strategy-lab/recipe.ts";
import { SKILLS } from "../strategy-lab/registry.ts";

function fakeArchiveClient(rows: ArchiveCandleRow[]): ArchiveClientLike {
  const query: ArchiveQueryLike = {
    select: () => query,
    in: () => query,
    eq: () => query,
    gte: () => query,
    lte: () => query,
    lt: () => query,
    order: () => query,
    range: () => query,
    then: (onfulfilled, onrejected) => Promise.resolve({ data: rows, error: null }).then(onfulfilled, onrejected),
  };
  return { from: () => ({ select: () => query }) };
}

test("W4-01: resolveArchiveSymbols maps MES/MNQ without cross-instrument fallback (OD-15)", () => {
  assert.deepEqual(resolveArchiveSymbols("MES"), { canonical: "MES", symbols: ["MES=F", "MES"] });
  assert.deepEqual(resolveArchiveSymbols("MES=F"), { canonical: "MES", symbols: ["MES=F", "MES"] });
  assert.deepEqual(resolveArchiveSymbols("MNQ"), { canonical: "MNQ", symbols: ["MNQ=F", "MNQ"] });
  assert.equal(resolveArchiveSymbols("MES").symbols.includes("ES=F"), false);
  assert.equal(resolveArchiveSymbols("MNQ").symbols.includes("NQ=F"), false);
});

test("W4-01: readArchiveCandles parses numeric OHLCV, prefers databento on duplicates, and merges over Yahoo", async () => {
  const t0 = "2026-11-23T14:30:00.000Z";
  const t1 = "2026-11-23T14:31:00.000Z";
  const rows: ArchiveCandleRow[] = [
    { symbol: "MES=F", timeframe: "1m", ts: t0, open: "7100", high: "7102", low: "7099", close: "7101", volume: "120", source: "yahoo_finance" },
    { symbol: "MES=F", timeframe: "1m", ts: t0, open: "7100.25", high: "7102.5", low: "7099.5", close: "7101.75", volume: "145", source: "databento" },
    { symbol: "MES=F", timeframe: "1m", ts: t1, open: "7101.75", high: "7103", low: "7101", close: "7102.25", volume: "98", source: "databento" },
  ];
  const result = await readArchiveCandles(
    { symbol: "MES", timeframe: "1m", from: new Date(t0), to: new Date(t1) },
    { client: fakeArchiveClient(rows) },
  );
  assert.ok(result);
  assert.equal(result.candles.length, 2);
  assert.equal(result.candles[0].time, Date.parse(t0));
  assert.equal(result.candles[0].close, 7101.75);
  assert.equal(archiveSourceLabel(result.sources), "Databento Archive");
  assert.equal(archiveProviderName(result.sources), "databento_archive");

  const merged = mergeArchiveAndYahoo(result.candles, [
    { time: Date.parse(t0), open: 1, high: 2, low: 1, close: 1, volume: 1 },
    { time: Date.parse("2026-11-23T14:32:00.000Z"), open: 7102.25, high: 7104, low: 7102, close: 7103.5, volume: 80 },
  ]);
  assert.equal(merged.length, 3);
  assert.equal(merged[0].close, 7101.75, "archive bar beats Yahoo bar on identical timestamp");
  assert.equal(merged[2].close, 7103.5, "newer Yahoo bar appends cleanly");
});

test("W4-01: agent candle loader serves archive hits without burning upstream rate-limit slots", async () => {
  let upstreamCalls = 0;
  const t0 = Date.parse("2026-11-23T14:30:00.000Z");
  const bars = Array.from({ length: 20 }, (_, i) => ({
    time: t0 + i * 60_000, open: 7100, high: 7102, low: 7099, close: 7101, volume: 100,
  }));
  const loader = createCandleLoader({
    upstream: createRateLimiter({ limit: 1, windowMs: 60_000 }),
    archive: async () => ({ candles: bars, sources: ["databento"], sourceLabel: "Databento Archive", providerName: "databento_archive" }),
    provider: {
      name: "mock",
      resolveProviderSymbol: (s) => (s === "MES" ? "MES=F" : s),
      supportsTickData: () => false,
      getCandles: async () => { upstreamCalls++; return []; },
    },
  });
  for (let i = 0; i < 5; i++) {
    const res = await loadAgentCandles(
      loader,
      { symbol: "MES", timeframe: "1m", from: t0, to: t0 + (9 + i) * 60_000 },
      "key-1",
    );
    assert.equal(res.ok, true);
  }
  assert.equal(upstreamCalls, 0);
});

test("W4-02: write-checks emits non-blocking warnings for duplicate thesis, exit-reason post-exit note, and missing stated risk", () => {
  const trade = normalizeTrade({
    id: "w4-note-test",
    symbol: "MES",
    direction: "LONG",
    quantity: 1,
    entry_time: "2026-11-23T14:30:00Z",
    exit_time: "2026-11-23T14:45:00Z",
    entry_price: 7100,
    exit_price: 7110,
    stop_loss_price: 7090,
    initial_stop_price: 7090,
    playbook_id: "orb-reclaim",
    note: "Bought the reclaim of the opening range.",
    pre_trade_thesis: "Bought the reclaim of the opening range.",
    post_exit_notes: "Exit reason: news.",
    stated_risk_r: null,
  });
  const checked = checkTradeWrite(trade, {
    note: trade.note,
    pre_trade_thesis: trade.pre_trade_thesis,
    post_exit_notes: trade.post_exit_notes,
    stated_risk_r: null,
  }, {
    isCreate: true,
    nowMs: Date.parse("2026-11-24T00:00:00Z"),
    playbooks: [{ id: "orb-reclaim", name: "ORB Reclaim", archived: false }],
    accounts: [],
    defaultRSizeCents: 30_000,
    writtenFields: new Set(["note", "pre_trade_thesis", "post_exit_notes", "stated_risk_r"]),
  });
  assert.equal(checked.ok, true);
  if (!checked.ok) return;
  const codes = checked.warnings.map((w) => w.code);
  assert.ok(codes.includes("notes_duplicate_thesis"));
  assert.ok(codes.includes("notes_restate_exit_reason"));
  assert.ok(codes.includes("stated_risk_missing"));
});

test("W4-02: notFoundHint guides mistaken agent paths toward real endpoints and /api/v1/guide", () => {
  assert.match(notFoundHint("/api/v1/singletons/settings"), /\/api\/v1\/singletons\/prefs/);
  assert.match(notFoundHint("/api/v1/records/candles"), /\/api\/v1\/candles/);
  assert.match(notFoundHint("/api/v1/records/levels"), /\/api\/v1\/levels/);
  assert.match(notFoundHint("/api/v1/unknown/thing"), /\/api\/v1\/guide/);
});

test("W4-04: $300 at-least micro ceiling sizing adds 1 micro when under target and accepts <1 micro overshoot", () => {
  assert.equal(DEFAULT_R_SIZE_CENTS, 30_000);
  // $110/micro (22 pts = 88 ticks on MES): 2 micros = $220 (< $300) -> add 1 micro -> 3 micros = $330 ($30 overshoot < $110).
  assert.deepEqual(sizeContractsAtLeast(30_000, 88, "MES"), { contracts: 3, actualRiskCents: 33_000, overshootCents: 3_000 });
  // $125/micro (25 pts = 100 ticks on MES): 2 micros = $250 (< $300) -> add 1 micro -> 3 micros = $375 ($75 overshoot < $125).
  assert.deepEqual(sizeContractsAtLeast(30_000, 100, "MES"), { contracts: 3, actualRiskCents: 37_500, overshootCents: 7_500 });
  const ceilingTrade = normalizeTrade({
    id: "w4-ceil",
    symbol: "MES",
    direction: "LONG",
    quantity: 3,
    entry_time: "2026-11-23T14:30:00Z",
    exit_time: "2026-11-23T14:45:00Z",
    entry_price: 7100,
    exit_price: 7120,
    stop_loss_price: 7078,
    initial_stop_price: 7078,
    stated_risk_r: 1,
  });
  assert.equal(riskComparison(ceilingTrade, 30_000).differs, false);
  assert.equal(riskComparison({ ...ceilingTrade, quantity: 4 }, 30_000).differs, true);
  assert.equal(riskComparison({ ...ceilingTrade, quantity: 2 }, 30_000).differs, true);
});

test("W4-05: Strategy Lab starter recipes are valid against registered skills", () => {
  const starters = buildStarterRecipes(null, SKILLS);
  assert.equal(starters.length, 2);
  for (const recipe of starters) {
    const result = validateRecipe(recipe, SKILLS);
    assert.equal(result.ok, true, `Starter recipe ${recipe.id} invalid: ${JSON.stringify(result)}`);
  }
});
