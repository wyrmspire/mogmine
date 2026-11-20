// M0 candle archive: mocked client, coverage, retries, ingest resume, and Yahoo fallback (issue #70).
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ARCHIVE_NOT_CONFIGURED_MESSAGE,
  isArchiveConfigured,
  toArchiveTicker,
} from "../archive-config.ts";
import {
  buildCoverage,
  expectedBarTimes,
  isWeekendCalendarDate,
  sessionBounds,
  zonedTimeToUtc,
} from "../archive-coverage.ts";
import { ingestYahooArchive, notConfiguredReport, splitBatches } from "../archive-ingest.ts";
import { isRetryableError, statusFromError, withRetries } from "../archive-retry.ts";
import {
  MemoryArchiveClient,
  PostgrestArchiveClient,
  candlesToRows,
  type ArchiveJobRow,
} from "../candle-archive.ts";
import { resolveMarketCandles } from "../market-data/resolve.ts";
import { runIngestCli } from "../../scripts/ingest-yahoo-archive.ts";
import { normalizeTrade } from "../trades.ts";
import type { Candle } from "../trades.ts";

const minute = 60_000;
function bar(time: number, price = 6000): Candle {
  return { time, open: price, high: price + 0.25, low: price - 0.25, close: price, volume: 1 };
}

test("empty env means the archive is not configured", () => {
  assert.equal(isArchiveConfigured({}), false);
  assert.equal(isArchiveConfigured({ NEXT_PUBLIC_SUPABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: "" }), false);
  assert.equal(isArchiveConfigured({ NEXT_PUBLIC_SUPABASE_URL: "  ", SUPABASE_SERVICE_ROLE_KEY: "  " }), false);
  assert.equal(isArchiveConfigured({ NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co" }), false);
  assert.equal(isArchiveConfigured({
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test-role",
  }), true);
  const report = notConfiguredReport();
  assert.equal(report.skipped, "not_configured");
  assert.match(report.message ?? "", /not configured/);
  assert.equal(report.batches.length, 0);
});

test("OD-15: only MES=F and MNQ=F are archive tickers", () => {
  assert.equal(toArchiveTicker("MES"), "MES=F");
  assert.equal(toArchiveTicker("mes=f"), "MES=F");
  assert.equal(toArchiveTicker("MNQ=F"), "MNQ=F");
  assert.equal(toArchiveTicker("ES=F"), null);
  assert.equal(toArchiveTicker("NQ=F"), null);
  assert.equal(toArchiveTicker("ES"), null);
  assert.throws(() => candlesToRows("ES=F", "1m", [bar(Date.parse("2026-11-10T15:00:00Z"))]));
});

test("AC-01: repeating an upsert on the mocked client keeps one row per key", async () => {
  const client = new MemoryArchiveClient();
  const rows = candlesToRows("MES", "1m", [
    bar(Date.parse("2026-11-10T15:00:00Z"), 6000),
    bar(Date.parse("2026-11-10T15:01:00Z"), 6001),
  ]);
  assert.equal(await client.upsertCandles(rows), 2);
  const again = candlesToRows("MES", "1m", [bar(Date.parse("2026-11-10T15:00:00Z"), 6000)]);
  assert.equal(await client.upsertCandles(again), 1);
  const stored = await client.getCandles({
    symbol: "MES=F",
    timeframe: "1m",
    from: new Date("2026-11-10T14:00:00Z"),
    to: new Date("2026-11-10T16:00:00Z"),
  });
  assert.equal(stored.length, 2);
  assert.equal(client.candles.size, 2);
});

test("PostgREST upsert uses on_conflict and merge-duplicates, and does not send a guessed project URL when unconfigured", async () => {
  const calls: Array<{ url: string; prefer?: string | null }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    calls.push({ url, prefer: headers.get("Prefer") });
    return new Response(null, { status: 201 });
  };
  const client = new PostgrestArchiveClient("https://example.supabase.co", "test-role", fetchImpl);
  const rows = candlesToRows("MNQ=F", "1m", [bar(Date.parse("2026-11-10T15:00:00Z"))]);
  await client.upsertCandles(rows);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /market_candles\?on_conflict=symbol,timeframe,ts/);
  assert.match(calls[0].prefer ?? "", /merge-duplicates/);
  assert.match(calls[0].url, /https:\/\/example\.supabase\.co\/rest\/v1\//);
});

test("AC-03: an empty weekend is closed, a weekday with no bars is missing, a long gap is partial", () => {
  assert.equal(isWeekendCalendarDate("2026-11-14"), true); // Saturday
  assert.equal(isWeekendCalendarDate("2026-11-15"), true); // Sunday
  assert.equal(isWeekendCalendarDate("2026-11-16"), false);
  const closed = buildCoverage({ symbol: "MES=F", sessionDate: "2026-11-14", barTimes: [] });
  assert.equal(closed.status, "closed");
  assert.equal(closed.expected_bars, 0);
  const missing = buildCoverage({ symbol: "MES=F", sessionDate: "2026-11-16", barTimes: [] });
  assert.equal(missing.status, "missing");
  assert.ok((missing.expected_bars ?? 0) > 1000);
  const expected = expectedBarTimes("2026-11-16");
  const complete = buildCoverage({ symbol: "MES=F", sessionDate: "2026-11-16", barTimes: expected });
  assert.equal(complete.status, "complete");
  assert.equal(complete.received_bars, expected.length);
  const gapped = expected.filter((time) => time < expected[0] + 60 * minute || time >= expected[0] + 120 * minute);
  const partial = buildCoverage({ symbol: "MES=F", sessionDate: "2026-11-16", barTimes: gapped });
  assert.equal(partial.status, "partial");
  assert.ok(partial.missing_ranges.length >= 1);
});

test("Globex session bounds stay on 18:00–17:00 ET across DST", () => {
  // 15 Jan 2026 is EST (UTC-5): 18:00 prior day = 23:00 UTC, 17:00 = 22:00 UTC.
  const winter = sessionBounds("2026-01-15");
  assert.equal(new Date(winter.open).toISOString(), "2026-01-14T23:00:00.000Z");
  assert.equal(new Date(winter.close).toISOString(), "2026-01-15T22:00:00.000Z");
  // 16 Mar 2026 is EDT (UTC-4): 18:00 prior day = 22:00 UTC, 17:00 = 21:00 UTC.
  const summer = sessionBounds("2026-03-16");
  assert.equal(new Date(summer.open).toISOString(), "2026-03-15T22:00:00.000Z");
  assert.equal(new Date(summer.close).toISOString(), "2026-03-16T21:00:00.000Z");
  assert.equal(zonedTimeToUtc(2026, 3, 8, 18, 0), Date.parse("2026-03-08T22:00:00.000Z"));
});

test("AC-04: 429 and 5xx retry, 422 never retries", async () => {
  assert.equal(isRetryableError(Object.assign(new Error("Yahoo Finance returned 429"), { status: 429 })), true);
  assert.equal(isRetryableError(Object.assign(new Error("PostgREST returned 503"), { status: 503 })), true);
  assert.equal(isRetryableError(Object.assign(new Error("Yahoo Finance returned 422"), { status: 422 })), false);
  assert.equal(statusFromError(new Error("Yahoo Finance returned 422")), 422);
  let attempts = 0;
  const value = await withRetries(async () => {
    attempts += 1;
    if (attempts < 3) throw Object.assign(new Error("Yahoo Finance returned 429"), { status: 429 });
    return "ok";
  }, { delayMs: 1, sleep: async () => undefined });
  assert.equal(value, "ok");
  assert.equal(attempts, 3);
  attempts = 0;
  await assert.rejects(() => withRetries(async () => {
    attempts += 1;
    throw Object.assign(new Error("Yahoo Finance returned 422"), { status: 422 });
  }, { delayMs: 1, sleep: async () => undefined }));
  assert.equal(attempts, 1);
});

test("ingest no-ops with a clear message when env is missing", async () => {
  const lines: string[] = [];
  const result = await runIngestCli([], { NEXT_PUBLIC_SUPABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: "" }, {
    log: (message) => lines.push(message),
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.report.skipped, "not_configured");
  assert.equal(lines.join("\n"), ARCHIVE_NOT_CONFIGURED_MESSAGE);
  assert.doesNotMatch(lines.join("\n"), /eyJ[A-Za-z0-9_-]{8,}|sb_secret|sbp_/);
});

test("AC-02: batches are at most 8 days and a failed batch is retried without redoing a successful one", async () => {
  const batches = splitBatches(new Date("2026-10-16T00:00:00Z"), new Date("2026-11-15T00:00:00Z"));
  assert.ok(batches.length >= 4);
  assert.ok(batches.every((batch) => batch.to.getTime() - batch.from.getTime() <= 8 * 86_400_000));

  const archive = new MemoryArchiveClient();
  const fetches: string[] = [];
  const yahoo = {
    resolveProviderSymbol: (symbol: string) => `${symbol}=F`,
    async getCandles({ symbol, from, to }: { symbol: string; from: Date; to: Date }) {
      fetches.push(`${symbol}:${from.toISOString()}:${to.toISOString()}`);
      if (symbol === "MES" && from.toISOString().startsWith("2026-11-01")) {
        throw Object.assign(new Error("Yahoo Finance returned 503"), { status: 503 });
      }
      return [bar(from.getTime() + 60 * minute), bar(from.getTime() + 2 * minute), bar(from.getTime() + 3 * minute), bar(from.getTime() + 4 * minute)];
    },
  };

  const from = new Date("2026-10-24T00:00:00Z");
  const to = new Date("2026-11-09T00:00:00Z");
  let ids = 1;
  const first = await ingestYahooArchive({ backfill: true, from, to, symbols: ["MES"] }, {
    archive,
    yahoo,
    sleep: async () => undefined,
    now: () => new Date("2026-11-15T12:00:00Z"),
    randomId: () => `job-${ids++}`,
  });
  const failed = first.batches.filter((batch) => batch.status === "failed");
  const succeeded = first.batches.filter((batch) => batch.status !== "failed");
  assert.ok(failed.length >= 1);
  assert.ok(succeeded.length >= 1);
  const before = fetches.length;

  // Seed a deterministic id generator for the retry of the failed batch only.
  let next = 2;
  const second = await ingestYahooArchive({ backfill: true, from, to, symbols: ["MES"] }, {
    archive,
    yahoo: {
      ...yahoo,
      async getCandles(query) {
        fetches.push(`retry:${query.symbol}:${query.from.toISOString()}`);
        return [bar(query.from.getTime() + minute), bar(query.from.getTime() + 2 * minute), bar(query.from.getTime() + 3 * minute), bar(query.from.getTime() + 4 * minute)];
      },
    },
    sleep: async () => undefined,
    now: () => new Date("2026-11-15T13:00:00Z"),
    randomId: () => `job-${next++}`,
  });
  // Successful batches are skipped; only previously failed/incomplete ranges fetch again.
  const retryFetches = fetches.slice(before);
  assert.ok(retryFetches.length >= 1);
  assert.ok(retryFetches.length < before, "successful batches must not be fetched again");
  const retried = second.batches.find((batch) => batch.from.startsWith("2026-11-01"));
  assert.ok(retried, "the failed Nov 1 batch must run again");
  assert.notEqual(retried.status, "failed");
  assert.ok((retried.upserted ?? 0) >= 4);
});

test("the chart resolver prefers the archive and falls back to Yahoo when it is thin or missing", async () => {
  const entry = Date.parse("2026-11-10T15:43:00Z");
  const exit = Date.parse("2026-11-10T15:50:00Z");
  // Both sets span the whole 15:43–15:50 window: since the merge with main's route rules
  // (issue #90), the resolver only serves a payload that covers the trade window, from
  // either source — a thin set near the entry is not enough, stored or not.
  const archiveBars = [0, 1, 2, 3, 4, 5, 6, 7].map((offset) => bar(entry + offset * minute, 6000 + offset));
  const yahooBars = [0, 1, 2, 3, 4, 5, 6, 7].map((offset) => bar(entry + offset * minute, 6100 + offset));
  const archive = new MemoryArchiveClient();
  await archive.upsertCandles(candlesToRows("MES=F", "1m", archiveBars));

  let yahooCalls = 0;
  const yahoo = {
    resolveProviderSymbol: () => "MES=F",
    async getCandles() {
      yahooCalls += 1;
      return yahooBars;
    },
  };

  const fromArchive = await resolveMarketCandles({ symbol: "MES", entryTime: entry, exitTime: exit }, { archive, yahoo });
  assert.equal("candles" in fromArchive && fromArchive.source, "Archive");
  if ("candles" in fromArchive) {
    assert.equal(fromArchive.candles[0]?.open, 6000);
    assert.equal(fromArchive.ticker, "MES=F");
    assert.equal(fromArchive.baseTimeframe, "1m");
  }
  assert.equal(yahooCalls, 0);

  const empty = new MemoryArchiveClient();
  const fromYahoo = await resolveMarketCandles({ symbol: "MES", entryTime: entry, exitTime: exit }, { archive: empty, yahoo });
  assert.equal("candles" in fromYahoo && fromYahoo.source, "Yahoo Finance");
  if ("candles" in fromYahoo) assert.equal(fromYahoo.candles[0]?.open, 6100);
  assert.equal(yahooCalls, 1);

  const off = await resolveMarketCandles({ symbol: "MES", entryTime: entry, exitTime: exit }, { archive: null, yahoo });
  assert.equal("candles" in off && off.source, "Yahoo Finance");
  assert.equal(yahooCalls, 2);
});

test("normalizeTrade keeps Archive as a market candle source", () => {
  const trade = normalizeTrade({
    id: "t",
    symbol: "MES",
    direction: "LONG",
    entry_time: "2026-11-10T15:43:00.000Z",
    exit_time: "2026-11-10T15:45:00.000Z",
    entry_price: 6000,
    exit_price: 6001,
    candle_source: "Archive",
    sparkline: [1, 2, 3],
  });
  assert.equal(trade.candle_source, "Archive");
  assert.deepEqual(trade.sparkline, [1, 2, 3]);
});

test("AC-02 / AC-05 recovery sketch: a started job is reused and a failed job is retried", async () => {
  const archive = new MemoryArchiveClient();
  const started: ArchiveJobRow = {
    id: "open-job",
    started_at: "2026-11-15T10:00:00.000Z",
    finished_at: null,
    kind: "backfill",
    symbol: "MES=F",
    timeframe: "1m",
    range_from: "2026-11-08T00:00:00.000Z",
    range_to: "2026-11-15T00:00:00.000Z",
    status: "started",
    bars_upserted: 0,
    last_error: null,
    result: {},
  };
  await archive.insertJob(started);
  const report = await ingestYahooArchive({
    backfill: true,
    symbols: ["MES=F"],
    from: new Date("2026-11-08T00:00:00Z"),
    to: new Date("2026-11-15T00:00:00Z"),
  }, {
    archive,
    yahoo: {
      resolveProviderSymbol: () => "MES=F",
      async getCandles({ from }) {
        return [0, 1, 2, 3].map((offset) => bar(from.getTime() + (offset + 1) * minute));
      },
    },
  });
  assert.equal(archive.jobs.filter((job) => job.id === "open-job").length, 1);
  assert.notEqual(archive.jobs[0]?.status, "failed");
  assert.notEqual(archive.jobs[0]?.status, "started");
  assert.ok(report.batches[0]!.upserted >= 4);
});
