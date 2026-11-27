import { test } from "node:test";
import assert from "node:assert/strict";
import { isAuthorizedCron } from "../market-data/cron-auth.ts";
import {
  matchContract, nextContract, runArchiveTopUp, sessionDateOf, sessionWindow, yahooContractTicker,
  type ArchiveRow, type FetchBars, type JobResult, type RollRow, type TopUpStore,
} from "../market-data/top-up.ts";
import type { Candle } from "../trades.ts";

const at = (iso: string) => Date.parse(iso);
const bars = (fromIso: string, count: number, price: number): Candle[] =>
  Array.from({ length: count }, (_, i) => ({
    time: at(fromIso) + i * 60_000, open: price, high: price, low: price, close: price, volume: 1,
  }));

/** In-memory archive. Like the real table, it is keyed by timestamp. */
function fakeStore(options: { last?: string; databento?: string[] } = {}) {
  const rows = new Map<string, ArchiveRow>();
  const jobs: JobResult[] = [];
  const rolls: RollRow[] = [];
  const store: TopUpStore = {
    lastCandleTs: async () => [...rows.keys()].sort().at(-1) ?? options.last ?? "2026-11-30T20:00:00.000Z",
    contractAsOf: async () => "MESZ6",
    databentoSessions: async () => new Set(options.databento ?? []),
    databentoCloses: async () => [],
    upsertCandles: async (batch) => { for (const row of batch) rows.set(row.ts, row); },
    upsertCoverage: async () => {},
    upsertRoll: async (row) => { rolls.push(row); },
    startJob: async () => "job",
    finishJob: async (_id, result) => { jobs.push(result); },
  };
  return { store, rows, jobs, rolls };
}

/** Serves the given bars per ticker, inside the requested window. */
const feed = (series: Record<string, Candle[]>): FetchBars => async (ticker, from, to) =>
  (series[ticker] ?? []).filter((bar) => bar.time >= from.getTime() && bar.time <= to.getTime());

// Tue 2026-12-01 session (starts Mon 17:00 CST = 23:00 UTC). `NOW` is after its close.
const DEC1 = bars("2026-12-01T15:00:00Z", 60, 7000);
const NOW = new Date("2026-12-01T23:00:00Z");
const normal = { "MES=F": DEC1, "MESZ26.CME": DEC1, "MESH27.CME": DEC1.map((b) => ({ ...b, close: 7060 })) };

test("sessions follow the 17:00 Chicago boundary across DST", () => {
  assert.equal(sessionDateOf(at("2026-12-01T22:59:00Z")), "2026-12-01");
  assert.equal(sessionDateOf(at("2026-12-01T23:00:00Z")), "2026-12-02");
  assert.equal(sessionDateOf(at("2026-10-01T22:00:00Z")), "2026-10-02");
  assert.deepEqual(sessionWindow("2026-12-01"),
    { start: at("2026-11-30T23:00:00Z"), end: at("2026-12-01T22:00:00Z") });
});

test("contract codes roll over the year", () => {
  assert.equal(nextContract("MESZ6"), "MESH7");
  assert.equal(nextContract("MESH7"), "MESM7");
  assert.equal(yahooContractTicker("MESZ6", 2026), "MESZ26.CME");
  assert.equal(yahooContractTicker("MESH7", 2026), "MESH27.CME");
});

test("writes a completed session once, and a rerun adds no rows", async () => {
  const { store, rows, jobs } = fakeStore();
  const first = await runArchiveTopUp(store, feed(normal), NOW);
  assert.equal(first.status, "success");
  assert.equal(first.bars, 60);
  await runArchiveTopUp(store, feed(normal), NOW);
  assert.equal(rows.size, 60);
  assert.equal(jobs.length, 2);
});

test("never writes the session that is still trading", async () => {
  const live = bars("2026-12-01T23:30:00Z", 40, 7001);
  const all = [...DEC1, ...live];
  const { store, rows } = fakeStore();
  await runArchiveTopUp(store, feed({ ...normal, "MES=F": all, "MESZ26.CME": all }), new Date("2026-12-02T01:00:00Z"));
  assert.equal(rows.size, 60);
});

test("leaves Databento sessions alone", async () => {
  const { store, rows } = fakeStore({ databento: ["2026-12-01"] });
  await runArchiveTopUp(store, feed(normal), NOW);
  assert.equal(rows.size, 0);
});

test("a thin session is skipped and the run is partial", async () => {
  const thin = DEC1.slice(0, 10);
  const { store, rows } = fakeStore();
  const summary = await runArchiveTopUp(store, feed({ "MES=F": thin, "MESZ26.CME": thin }), NOW);
  assert.equal(summary.status, "partial");
  assert.equal(summary.skipped[0].session_date, "2026-12-01");
  assert.equal(rows.size, 0);
});

test("records a roll when the continuous series moves to the next contract", async () => {
  const next = DEC1.map((b) => ({ ...b, close: 7060 }));
  const { store, rolls } = fakeStore();
  const summary = await runArchiveTopUp(store, feed({ "MES=F": next, "MESZ26.CME": DEC1, "MESH27.CME": next }), NOW);
  assert.equal(summary.sessions[0].contract, "MESH7");
  assert.equal(rolls[0].from_contract, "MESZ6");
  assert.equal(rolls[0].spread, 60);
});

test("refuses a switch inside one session and marks the job failed", async () => {
  const next = DEC1.map((b) => ({ ...b, close: 7060 }));
  const mixed = [...DEC1.slice(0, 30), ...next.slice(30)];
  const { store, rows, jobs } = fakeStore();
  await assert.rejects(runArchiveTopUp(store, feed({ "MES=F": mixed, "MESZ26.CME": DEC1, "MESH27.CME": next }), NOW),
    /switch contract/);
  assert.equal(rows.size, 0);
  assert.equal(jobs[0].status, "failed");
  assert.equal(matchContract(DEC1.slice(0, 5), DEC1, next), null);
});

test("a Yahoo failure writes nothing and fails the job", async () => {
  const { store, rows, jobs } = fakeStore();
  await assert.rejects(runArchiveTopUp(store, async () => { throw new Error("Yahoo Finance returned 500"); }, NOW), /500/);
  assert.equal(rows.size, 0);
  assert.equal(jobs[0].status, "failed");
});

test("reports a gap when the archive is older than Yahoo's lookback", async () => {
  const { store } = fakeStore({ last: "2026-09-01T15:00:00.000Z" });
  const summary = await runArchiveTopUp(store, feed(normal), NOW);
  assert.equal(summary.status, "partial");
  assert.equal(summary.gap?.resumed_from_session, "2026-11-04");
});

test("cron auth fails closed", () => {
  assert.equal(isAuthorizedCron("Bearer s3cret", "s3cret"), true);
  assert.equal(isAuthorizedCron("Bearer wrong", "s3cret"), false);
  assert.equal(isAuthorizedCron(null, "s3cret"), false);
  assert.equal(isAuthorizedCron("Bearer ", undefined), false);
  assert.equal(isAuthorizedCron("Bearer ", "  "), false);
});
