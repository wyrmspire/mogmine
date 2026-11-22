import test from "node:test";
import assert from "node:assert/strict";
import { calculateAdrValue, computeLevelsFromInputs, extractSessionInputsFromCandles } from "../levels.ts";
import type { Candle } from "../trades.ts";
import fixture from "../../fixtures/levelsets/MES-2026-11-12.json" with { type: "json" };

const minute = 60_000;
const mesSource = { provider: "yahoo_finance", providerSymbol: "MES=F" } as const;
const bar = (time: number, price = 6000): Candle => ({
  time, open: price, high: price, low: price, close: price, volume: 10,
});
const bars = (from: string, to: string) => Array.from(
  { length: (Date.parse(to) - Date.parse(from)) / minute },
  (_, i) => bar(Date.parse(from) + i * minute),
);
const byKey = (levels: ReturnType<typeof computeLevelsFromInputs>) =>
  Object.fromEntries(levels.map((level) => [level.key, level]));

test("LV-1 matches the November 12 markup, using raw PP in the derived pivot formulas", () => {
  const levels = computeLevelsFromInputs({
    symbol: fixture.symbol, sessionDate: fixture.session_date, inputs: fixture.inputs,
  });
  const expected = {
    pdh: 7671.5, pdl: 7547.5, pdc: 7640.5, rth_open: 7612, rth_high: 7671.5,
    rth_low: 7593, rth_close: 7642.75, globex_open: 7616.5, onh: 7628.75, onl: 7572.5,
    pp: 7619.75, r1: 7692.25, s1: 7568.25, r2: 7743.75, s2: 7495.75,
    adr_high: 7687.25, adr_low: 7545.75, adr_inner_high: 7640, adr_inner_low: 7593,
  };
  assert.deepEqual(Object.fromEntries(levels.map(({ key, price }) => [key, price])), expected);
  for (const row of fixture.levels) {
    if (row.key in expected) assert.equal(byKey(levels)[row.key].price, row.price);
  }
  for (const level of levels) assert.equal(level.price_ticks, level.price / 0.25);
  assert.equal(byKey(levels).onl.formed_at, fixture.inputs.overnight.onl_at);
});

test("ADR 7 and 14 select completed sessions by date, with no current-session or future range", () => {
  const dates = [
    "2026-10-23", "2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-11-02",
    "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-09", "2026-11-10", "2026-11-11",
  ];
  const history = dates.map((session_date, index) => ({ session_date, high: 6100 + index, low: 6000 }));
  const today = { session_date: "2026-11-12", high: 6500, low: 6000 };
  const shuffled = [today, ...history.toReversed(), { ...today, session_date: "2026-11-13" }];
  assert.equal(calculateAdrValue(shuffled, "2026-11-12", 7), 110);
  assert.equal(calculateAdrValue(shuffled, "2026-11-12", 14), 106.5);
  assert.equal(calculateAdrValue(shuffled, "2026-11-13", 7), (500 + 108 + 109 + 110 + 111 + 112 + 113) / 7);
  assert.equal(calculateAdrValue(history.slice(0, -1), "2026-11-12", 14), null);
  assert.equal(calculateAdrValue(history.filter(({ session_date }) => session_date !== "2026-11-10"), "2026-11-12", 7), null);
  assert.equal(calculateAdrValue([...history, history.at(-1)!], "2026-11-12", 7), null);

  const levels = byKey(computeLevelsFromInputs({
    symbol: "MES", sessionDate: "2026-11-12",
    inputs: { ...fixture.inputs, adr: { history: shuffled, length: 7 } },
  }));
  assert.equal(levels.adr_high.price, 7671.5);
  assert.equal(levels.adr_low.price, 7561.5);
});

test("LV-1 preserves the candle series and labels a dated daily close as a settlement proxy", () => {
  const open = Date.parse("2026-11-11T23:00Z");
  const settlement = {
    symbol: "MES", sessionDate: "2026-11-11", availableAt: open - minute, price: 7640.5,
    source: "Yahoo MES=F 1d close", isProxy: true,
  } as const;
  const options = {
    ...mesSource, symbol: "MES", timeframe: "1m", sessionDate: "2026-11-12",
    asOf: open + minute, candles: [bar(open, 7616.5)], settlement,
  } as const;
  const snapshot = extractSessionInputsFromCandles(options);
  assert.equal(snapshot.provider, mesSource.provider);
  assert.equal(snapshot.providerSymbol, mesSource.providerSymbol);
  assert.equal(snapshot.calcVersion, "levels-v1");
  assert.equal(snapshot.timeframe, "1m");
  assert.equal(snapshot.asOf, open + minute);
  assert.equal(snapshot.coverage.overnight.from, open);
  assert.equal(snapshot.coverage.overnight.to, open + minute);
  assert.deepEqual(snapshot.inputs.prior_session.settle_provenance, {
    source: settlement.source, isProxy: true,
  });
  const pdc = byKey(computeLevelsFromInputs(snapshot)).pdc;
  assert.equal(pdc.label, "PDC (proxy)");
  assert.equal(pdc.formula, "Settlement proxy 2026-11-11");
  assert.equal(pdc.price, 7640.5);
  assert.equal(pdc.formed_at, "2026-11-11T22:59:00.000Z");

  const earlier = extractSessionInputsFromCandles({ ...options, asOf: settlement.availableAt - 1 });
  assert.equal(earlier.inputs.prior_session.settle_provenance, undefined);
  assert.equal(byKey(computeLevelsFromInputs(earlier)).pdc, undefined);
  const verified = extractSessionInputsFromCandles({
    ...options, settlement: { ...settlement, source: "CME settlement", isProxy: false },
  });
  assert.equal(byKey(computeLevelsFromInputs(verified)).pdc.label, "PDC");
  const otherContract = extractSessionInputsFromCandles({ ...options, settlement: { ...settlement, symbol: "MNQ" } });
  assert.equal(byKey(computeLevelsFromInputs(otherContract)).pdc, undefined);
  assert.throws(() => extractSessionInputsFromCandles({ ...options, providerSymbol: "ES=F" }), /MES=F/);
});

for (const { sessionDate, previousDate, priorOpen, priorClose, globexOpen, rthOpen } of [
  {
    sessionDate: "2026-03-09", previousDate: "2026-03-06", priorOpen: "2026-03-05T23:00Z",
    priorClose: "2026-03-06T22:00Z", globexOpen: "2026-03-08T22:00Z", rthOpen: "2026-03-09T13:30Z",
  },
  {
    sessionDate: "2026-11-02", previousDate: "2026-10-30", priorOpen: "2026-10-29T22:00Z",
    priorClose: "2026-10-30T21:00Z", globexOpen: "2026-11-01T23:00Z", rthOpen: "2026-11-02T14:30Z",
  },
]) {
  test(`Monday ${sessionDate} reads Friday and Sunday Globex across the DST change`, () => {
    const prior = bars(priorOpen, priorClose);
    prior[2] = bar(prior[2].time, 6101);
    const overnight = bars(globexOpen, rthOpen);
    overnight[0] = bar(overnight[0].time, 6005.1);
    overnight[3] = bar(overnight[3].time, 5975);
    const asOf = Date.parse(globexOpen) + 5 * minute + 20_000;
    const snapshot = extractSessionInputsFromCandles({
      provider: "yahoo_finance", providerSymbol: "MNQ=F", symbol: "MNQ", timeframe: "1m", sessionDate, asOf,
      candles: [...overnight, ...prior, bar(Date.parse(priorClose), 9999), bar(asOf - 20_000, 8000)].reverse(),
      settlement: {
        symbol: "MNQ", sessionDate: previousDate, availableAt: Date.parse(priorClose), price: 6001.25,
        source: "CME settlement", isProxy: false,
      },
    });
    const levels = byKey(computeLevelsFromInputs(snapshot));
    assert.equal(snapshot.inputs.prior_session.session_date, previousDate);
    assert.equal(snapshot.coverage.previous.presentBars, 1380);
    assert.equal(snapshot.coverage.overnight.presentBars, 5);
    assert.equal(levels.pdh.price, 6101);
    assert.equal(levels.pdh.formed_at, new Date(prior[2].time).toISOString());
    assert.equal(levels.pdc.price, 6001.25);
    assert.equal(levels.globex_open.price, 6005);
    assert.equal(levels.rth_open.price, 6000);
    assert.equal(levels.onh.price, 6005);
    assert.equal(levels.onl.formed_at, new Date(overnight[3].time).toISOString());
    assert.equal(levels.week_high.price, 6005);
    assert.equal(levels.week_low.price, 5975);
  });
}

test("An exact final RTH minute supplies the close, with missing and misdated inputs withheld", () => {
  const finalRth = Date.parse("2026-11-11T20:59Z");
  const start = Date.parse("2026-11-11T23:00Z");
  const candles = [bar(finalRth - minute, 6200), bar(finalRth, 6100), bar(finalRth + minute, 6400),
    bar(Date.parse("2026-11-11T14:35Z"), 6005), bar(start + minute, 6005)];
  const options = {
    ...mesSource, symbol: "MES", timeframe: "1m", sessionDate: "2026-11-12", asOf: start + 2 * minute,
    settlement: { symbol: "MES", sessionDate: "2026-11-10", availableAt: finalRth, price: 6105, source: "CME settlement", isProxy: false },
    adr: { value: 120 },
  } as const;
  const snapshot = extractSessionInputsFromCandles({ ...options, candles });
  const levels = byKey(computeLevelsFromInputs(snapshot));
  assert.deepEqual(Object.keys(levels), ["rth_close"]);
  assert.equal(levels.rth_close.price, 6100);
  assert.equal(levels.rth_close.formed_at, "2026-11-11T21:00:00.000Z");
  assert.equal(snapshot.coverage.rth.complete, false);
  assert.equal(snapshot.coverage.overnight.complete, false);

  const missingClose = extractSessionInputsFromCandles({
    ...options, candles: candles.filter(({ time }) => time !== finalRth),
    settlement: { ...options.settlement, sessionDate: "2026-11-11", availableAt: options.asOf + minute },
  });
  assert.deepEqual(computeLevelsFromInputs(missingClose), []);
});

test("Weekly extremes exclude maintenance and use only complete session coverage to the cutoff", () => {
  const all = bars("2026-11-01T23:00Z", "2026-11-02T22:00Z");
  all[8] = bar(all[8].time, 5900);
  const tuesday = bars("2026-11-02T23:00Z", "2026-11-02T23:03Z");
  tuesday[1] = bar(tuesday[1].time, 6100);
  const options = {
    ...mesSource, symbol: "MES", timeframe: "1m", asOf: Date.parse("2026-11-02T23:03Z"), sessionDate: "2026-11-03",
  } as const;
  const candles = [...all, ...tuesday, bar(Date.parse("2026-11-02T22:20Z"), 9000)];
  const levels = byKey(computeLevelsFromInputs(extractSessionInputsFromCandles({ ...options, candles })));
  assert.equal(levels.week_low.price, 5900);
  assert.equal(levels.week_high.price, 6100);
  assert.equal(levels.week_high.formed_at, "2026-11-02T23:01:00.000Z");

  const duplicate = byKey(computeLevelsFromInputs(extractSessionInputsFromCandles({
    ...options, candles: [...candles, all[8]],
  })));
  assert.equal(duplicate.week_low, undefined);
  assert.equal(duplicate.pdl, undefined);
  assert.equal(duplicate.onh.price, 6100);
});

test("Hourly bars cannot supply RTH opens, RTH closes or overnight extremes across 09:30 ET", () => {
  const hour = 60 * minute;
  const prev = Date.parse("2026-11-10T23:00Z");
  const open = Date.parse("2026-11-11T23:00Z");
  const candles = Array.from({ length: 39 }, (_, i) => bar(prev + i * hour))
    .filter(({ time }) => time !== open - hour);
  const snapshot = extractSessionInputsFromCandles({
    ...mesSource, symbol: "MES", timeframe: "1h", asOf: Date.parse("2026-11-12T15:00Z"), sessionDate: "2026-11-12", candles,
  });
  const levels = byKey(computeLevelsFromInputs(snapshot));
  assert.equal(levels.pdh.price, 6000);
  assert.equal(levels.globex_open.price, 6000);
  assert.equal(levels.rth_open, undefined);
  assert.equal(levels.rth_close, undefined);
  assert.equal(levels.onh, undefined);
  assert.equal(snapshot.coverage.overnight.complete, false);
});
