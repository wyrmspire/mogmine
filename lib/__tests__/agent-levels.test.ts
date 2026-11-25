// #API-4: GET /api/v1/levels (docs/design-2026-11-24/07-agent-api.md §3.4, §6). Synthetic 1m bars only: the candle source is a
// fake, so there is zero live Yahoo traffic. The cutoff tests prove B-14 by moving `as_of` one bar at a time.
import test from "node:test";
import assert from "node:assert/strict";
import { buildAgentLevels, handleLevelsRequest, parseLevelsQuery } from "../agent/levels.ts";
import type { AgentLevelsQuery, LevelsCandleSource } from "../agent/levels.ts";
import { statusFor } from "../agent/http.ts";
import type { JournalCommands } from "../commands/journal-commands.ts";
import type { PlanningSession, PlanRevision } from "../plans.ts";
import { equityIndexSessionBounds, previousRegularSessionDate } from "../session.ts";
import type { Candle } from "../trades.ts";

const MIN = 60_000;
const SESSION = "2026-11-25";
const PRIOR = previousRegularSessionDate(SESSION);
const today = equityIndexSessionBounds(SESSION);
const prior = equityIndexSessionBounds(PRIOR);
// 10:15 ET is 15:15 UTC (EST, after the 1 November change). The bar closes at 10:16 ET.
const TEN_FIFTEEN = Date.parse("2026-11-25T15:15:00.000Z");
const TEN_THIRTY = Date.parse("2026-11-25T15:30:00.000Z");

// ---- fixtures -----------------------------------------------------------------------------------------------------------

/** One flat 1m bar per minute from `from` to `to` (exclusive). High and low a quarter point either side. */
function flat(from: number, to: number, price = 7400): Candle[] {
  const bars: Candle[] = [];
  for (let time = from; time < to; time += MIN) {
    bars.push({ time, open: price, high: price + 0.25, low: price - 0.25, close: price, volume: 100 });
  }
  return bars;
}

/** Replaces the bar at `time` (keeping its volume), or adds it when absent. */
function setBar(bars: Candle[], time: number, bar: Omit<Candle, "time" | "volume">): Candle[] {
  const others = bars.filter((item) => item.time !== time);
  return [...others, { time, volume: 100, ...bar }].sort((a, b) => a.time - b.time);
}

/** Every bar the session needs: the prior Globex session, today's Globex session, and a spike after the cutoff. */
function sessionBars(): Candle[] {
  let bars = [...flat(prior.open, prior.close), ...flat(today.open, today.close)];
  // The 7420 print in the 10:15 ET bar (open 10:15, close 10:16). It is the high of the RTH so far from 10:16 on.
  bars = setBar(bars, TEN_FIFTEEN, { open: 7410, high: 7420, low: 7409.75, close: 7415 });
  // A 9999 spike at 10:30 ET. Any read as of 10:15:30 or 10:16 must not see it.
  bars = setBar(bars, TEN_THIRTY, { open: 7400, high: 9999, low: 7399.75, close: 7400 });
  return bars;
}

/** The fake candle source: the bars inside [from, to), and a log of each request. */
function sourceOf(bars: readonly Candle[], calls: Array<{ from: number; to: number }> = []): LevelsCandleSource {
  return async (_symbol, from, to) => {
    calls.push({ from, to });
    return { bars: bars.filter((bar) => bar.time >= from && bar.time < to), provider: "yahoo_finance" };
  };
}

/** A command layer that only lists plans. Everything else in JournalCommands is unused by buildAgentLevels. */
function commandsWith(plans: readonly PlanningSession[]): JournalCommands {
  return {
    listFiltered: async () => ({ ok: true, value: plans }),
  } as unknown as JournalCommands;
}

function query(asOfIso?: string, symbol = "MES"): AgentLevelsQuery {
  return { symbol, sessionDate: SESSION, ...(asOfIso ? { asOfIso } : {}) };
}

async function levelsAt(asOfIso: string, bars: readonly Candle[] = sessionBars(), plans: readonly PlanningSession[] = []) {
  const result = await buildAgentLevels(query(asOfIso), commandsWith(plans), sourceOf(bars));
  assert.ok(result.ok, result.ok ? "" : result.error.message);
  return result.value;
}

// ---- tests --------------------------------------------------------------------------------------------------------------

test("B-14: the 10:15 ET bar's 7420 high is not known at 10:15:30 ET and is known at 10:16:00 ET", async () => {
  const before = await levelsAt("2026-11-25T15:15:30.000Z");
  assert.equal(before.session_so_far.rth_high?.price, 7400.25, "the 10:15 bar has not closed, so its high is not used");

  const after = await levelsAt("2026-11-25T15:16:00.000Z");
  assert.deepEqual(after.session_so_far.rth_high, { price: 7420, formed_at: "2026-11-25T15:15:00.000Z" });
});

test("B-14: a payload never depends on bars that close after as_of (the spike at 10:30 ET changes nothing)", async () => {
  const asOf = "2026-11-25T15:16:00.000Z";
  const withFuture = await levelsAt(asOf, sessionBars());
  const withoutFuture = await levelsAt(asOf, sessionBars().filter((bar) => bar.time + MIN <= Date.parse(asOf)));
  assert.deepEqual(withFuture, withoutFuture);
  assert.notEqual(withFuture.vwap.rth.value, 9999, "the spike is not in the VWAP");
});

test("B-14: today's window is requested only up to as_of, never past it", async () => {
  const calls: Array<{ from: number; to: number }> = [];
  await buildAgentLevels(query("2026-11-25T15:15:30.000Z"), commandsWith([]), sourceOf(sessionBars(), calls));
  assert.deepEqual(calls, [
    { from: prior.open, to: prior.close },
    { from: today.open, to: TEN_FIFTEEN + 30_000 },
  ]);
});

test("withheld reasons: prior-session gaps withhold PDH and PDL, overnight gaps withhold ONH and ONL, Globex VWAP stays approximate", async () => {
  // Five single missing bars in the prior Globex session (PDH and PDL read it whole) and five in today's overnight (ONH and ONL).
  const missing = [
    ...[0, 1, 2, 3, 4].map((k) => prior.open + (k * 120 + 30) * MIN),
    ...[0, 1, 2, 3, 4].map((k) => today.open + (k * 120 + 30) * MIN),
  ];
  const bars = sessionBars().filter((bar) => !missing.includes(bar.time));
  const payload = await levelsAt("2026-11-25T15:30:00.000Z", bars);

  const withheld = Object.fromEntries(payload.withheld.map((item) => [item.key, item]));
  assert.deepEqual(
    [withheld.pdh, withheld.pdl, withheld.onh, withheld.onl].map((item) => item && [item.reason, item.missing_bars]),
    [["gaps", 5], ["gaps", 5], ["gaps", 5], ["gaps", 5]],
  );
  assert.equal(withheld.onh?.window, "overnight");
  assert.equal(withheld.week_high?.reason, "not-loaded", "earlier days of the week are not in the two windows this endpoint loads");

  const computed = payload.computed.map((level) => level.key);
  for (const key of ["pdh", "pdl", "onh", "onl", "week_high"]) {
    assert.ok(!computed.includes(key as never), `${key} is withheld, so it has no value`);
  }
  assert.ok(computed.includes("rth_open"), "the prior RTH open is complete, so it is still computed");
  assert.ok(computed.includes("globex_open"), "the 18:00 ET bar is present");

  assert.equal(payload.vwap.globex.approximate, true, "5 of ~990 expected bars, none in RTH, longest gap 1 min");
  assert.ok(payload.vwap.globex.value !== null);
  assert.equal(payload.vwap.rth.approximate, false);
  assert.ok(payload.vwap.rth.value !== null, "RTH VWAP is complete up to 10:30 ET");
});

test("the Globex VWAP is strict (approximate false) when the bars are complete", async () => {
  const payload = await levelsAt("2026-11-25T15:30:00.000Z");
  assert.equal(payload.vwap.globex.approximate, false);
  assert.equal(payload.vwap.globex.coverage?.complete, true);
});

test("planned levels: a revision saved at 09:45 ET is absent at 09:35 ET and present at 09:50 ET", async () => {
  const added = { id: "lvl-added", price: 7412, price_ticks: 74120, label: "Break above", kind: "level" as const };
  const revision: PlanRevision = {
    id: "rev-0945", saved_at: "2026-11-25T14:45:00.000Z", after_the_fact: false, observations: "",
    bias: null, watch_playbook_ids: [], levels: [],
  };
  const plan = {
    id: "plan-1", user_id: "owner", session_date: SESSION, symbol: "MES", name: "Open plan", preset: null,
    anchor_time_utc: null, created_at: "2026-11-24T20:00:00.000Z", updated_at: "2026-11-25T14:45:00.000Z",
    observations: "", bias: null, watch_playbook_ids: [], levels: [added], revisions: [revision],
  } as unknown as PlanningSession;

  const at0935 = await levelsAt("2026-11-25T14:35:00.000Z", sessionBars(), [plan]);
  assert.deepEqual(at0935.planned, []);

  const at0950 = await levelsAt("2026-11-25T14:50:00.000Z", sessionBars(), [plan]);
  assert.deepEqual(at0950.planned, [{
    plan_id: "plan-1", plan_name: "Open plan", revision_id: null, label: "Break above", price: 7412, role: "level",
  }]);
});

test("planned levels: another instrument's plan, or a plan on another date, is never listed", async () => {
  const plan = {
    id: "plan-2", session_date: SESSION, symbol: "MNQ", name: "Nasdaq", created_at: "2026-11-24T20:00:00.000Z",
    revisions: [], levels: [{ id: "x", price: 1, price_ticks: 4, label: "x", kind: "level" }], archived: false,
  } as unknown as PlanningSession;
  const payload = await levelsAt("2026-11-25T15:30:00.000Z", sessionBars(), [plan]);
  assert.deepEqual(payload.planned, []);
});

test("provenance names the provider, the 1m timeframe and both calculation versions", async () => {
  const payload = await levelsAt("2026-11-25T15:30:00.000Z");
  assert.deepEqual(payload.provenance, {
    provider: "yahoo_finance", timeframe: "1m", levels_calc_version: "lv-1", indicators_calc_version: "session-indicators-v1",
    as_of: "2026-11-25T15:30:00.000Z", session_date: SESSION,
  });
  assert.equal(payload.symbol, "MES");
});

test("before today's open there is no VWAP, and no today bars are requested", async () => {
  const calls: Array<{ from: number; to: number }> = [];
  const result = await buildAgentLevels(query("2026-11-24T22:00:00.000Z"), commandsWith([]), sourceOf(sessionBars(), calls));
  assert.ok(result.ok);
  assert.deepEqual(result.value.vwap.rth, { value: null, approximate: false, unavailable_reason: "not-yet", coverage: null });
  assert.deepEqual(result.value.vwap.globex, { value: null, approximate: false, unavailable_reason: "not-yet", coverage: null });
  assert.equal(calls.length, 1, "only the prior session is read");
});

test("invalid symbol, session_date or as_of is refused as invalid (422)", async () => {
  assert.equal(parseLevelsQuery(new URLSearchParams("symbol=ES&session_date=2026-11-25")).ok, false);
  assert.equal(parseLevelsQuery(new URLSearchParams("symbol=MGC&session_date=2026-11-25")).ok, false, "LV-1 covers MES and MNQ only");
  assert.equal(parseLevelsQuery(new URLSearchParams("symbol=MES&session_date=2026-02-30")).ok, false);
  assert.equal(parseLevelsQuery(new URLSearchParams("symbol=MES&session_date=2026-11-25&as_of=2026-11-25T15:30")).ok, false, "as_of needs a zone");
  assert.equal(parseLevelsQuery(new URLSearchParams("symbol=MES&session_date=2026-11-25&as_of=soon")).ok, false);
  assert.equal(
    parseLevelsQuery(new URLSearchParams("symbol=MES&session_date=2026-11-25&as_of=2026-11-26T00:00:00Z"), Date.parse("2026-11-25T16:00:00Z")).ok,
    false,
    "as_of in the future",
  );

  const good = parseLevelsQuery(new URLSearchParams("symbol=mnq&session_date=2026-11-25&as_of=2026-11-25T15:30:00Z"), Date.parse("2026-11-25T16:00:00Z"));
  assert.deepEqual(good, { ok: true, query: { symbol: "MNQ", sessionDate: SESSION, asOfIso: "2026-11-25T15:30:00Z" } });

  const refused = await buildAgentLevels(query("2026-11-25T15:30"), commandsWith([]), sourceOf([]));
  assert.ok(!refused.ok);
  assert.equal(refused.error.code, "invalid");
  assert.equal(statusFor(refused.error.code), 422);
});

test("the endpoint is off without the server's agent configuration (no candle or database work)", async () => {
  const response = await handleLevelsRequest(new Request("https://mogmine.test/api/v1/levels?symbol=MES&session_date=2026-11-25"), { deps: null });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
});
