// Idempotent Yahoo 1m ingest into the candle archive (AC-01, AC-02, AC-04).
// Batches are at most 8 days. A failed batch is recorded and retried on its own.

import { randomUUID } from "node:crypto";
import { ARCHIVE_NOT_CONFIGURED_MESSAGE, ARCHIVE_TICKERS, type ArchiveTicker, toArchiveTicker } from "./archive-config.ts";
import { buildCoverage, datesInRange, isWeekendCalendarDate } from "./archive-coverage.ts";
import {
  type ArchiveClient,
  type ArchiveJobKind,
  type ArchiveJobRow,
  candlesToRows,
} from "./candle-archive.ts";
import type { YahooFinanceProvider } from "./market-data/yahoo.ts";
import { sessionDate } from "./session.ts";
import type { Candle } from "./trades.ts";
import { isRetryableError, withRetries } from "./archive-retry.ts";

export const MAX_BATCH_DAYS = 8;
export const DEFAULT_LOOKBACK_DAYS = 7;
export const BACKFILL_DAYS = 30;
const DAY_MS = 86_400_000;

export interface IngestOptions {
  kind?: ArchiveJobKind;
  symbols?: string[];
  from?: Date;
  to?: Date;
  days?: number;
  backfill?: boolean;
  now?: Date;
}

export interface IngestDependencies {
  archive: ArchiveClient;
  yahoo: Pick<YahooFinanceProvider, "getCandles" | "resolveProviderSymbol">;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  randomId?: () => string;
}

export interface BatchReport {
  symbol: ArchiveTicker;
  from: string;
  to: string;
  upserted: number;
  status: ArchiveJobRow["status"];
  error?: string;
  coverage: ReturnType<typeof buildCoverage>[];
}

export interface IngestReport {
  skipped?: "not_configured";
  message?: string;
  batches: BatchReport[];
}

export function archiveSymbolsFrom(input?: string[]): ArchiveTicker[] {
  if (!input?.length) return [...ARCHIVE_TICKERS];
  return input.map((symbol) => {
    const ticker = toArchiveTicker(symbol);
    if (!ticker) throw new Error(`Archive symbols are MES=F and MNQ=F only (OD-15); got ${symbol}`);
    return ticker;
  });
}

export function splitBatches(from: Date, to: Date, maxDays = MAX_BATCH_DAYS): Array<{ from: Date; to: Date }> {
  if (to.getTime() <= from.getTime()) return [];
  const maxMs = maxDays * DAY_MS;
  const batches: Array<{ from: Date; to: Date }> = [];
  let cursor = from.getTime();
  const end = to.getTime();
  while (cursor < end) {
    const batchEnd = Math.min(cursor + maxMs, end);
    batches.push({ from: new Date(cursor), to: new Date(batchEnd) });
    cursor = batchEnd;
  }
  return batches;
}

function jobKey(symbol: ArchiveTicker, from: Date, to: Date) {
  return `${symbol}|${from.toISOString()}|${to.toISOString()}`;
}

export function notConfiguredReport(): IngestReport {
  return { skipped: "not_configured", message: ARCHIVE_NOT_CONFIGURED_MESSAGE, batches: [] };
}

function coverageForBars(symbol: ArchiveTicker, from: Date, to: Date, candles: Candle[]) {
  const { calendarDates, sessionDates } = datesInRange(from, to);
  const bySession = new Map<string, number[]>();
  for (const candle of candles) {
    const session = sessionDate(candle.time);
    const list = bySession.get(session) ?? [];
    list.push(candle.time);
    bySession.set(session, list);
  }
  const keys = new Set<string>([...calendarDates, ...sessionDates]);
  return [...keys].sort().map((date) => buildCoverage({
    symbol,
    sessionDate: date,
    // Weekend calendar dates have no session bars; weekday rows use sessionDate-grouped times.
    barTimes: isWeekendCalendarDate(date) ? [] : (bySession.get(date) ?? []),
  }));
}

export async function ingestYahooArchive(options: IngestOptions, deps: IngestDependencies): Promise<IngestReport> {
  const now = deps.now?.() ?? options.now ?? new Date();
  const kind: ArchiveJobKind = options.kind ?? (options.backfill ? "backfill" : "daily");
  const to = options.to ?? now;
  const lookback = options.days ?? (options.backfill ? BACKFILL_DAYS : DEFAULT_LOOKBACK_DAYS);
  const from = options.from ?? new Date(to.getTime() - lookback * DAY_MS);
  const symbols = archiveSymbolsFrom(options.symbols);
  const batches = splitBatches(from, to);
  const id = deps.randomId ?? (() => randomUUID());
  const reports: BatchReport[] = [];

  const existing = kind === "backfill" || kind === "repair"
    ? await deps.archive.listJobs({ kind, status: ["success", "started", "failed"] })
    : [];

  for (const symbol of symbols) {
    for (const batch of batches) {
      const key = jobKey(symbol, batch.from, batch.to);
      const prior = existing.find((job) => job.symbol === symbol && job.range_from === batch.from.toISOString() && job.range_to === batch.to.toISOString());
      if (prior?.status === "success" || prior?.status === "partial") {
        reports.push({
          symbol,
          from: batch.from.toISOString(),
          to: batch.to.toISOString(),
          upserted: prior.bars_upserted,
          status: prior.status,
          coverage: [],
        });
        continue;
      }

      const jobId = prior?.status === "started" ? prior.id : id();
      const started: ArchiveJobRow = prior?.status === "started"
        ? prior
        : {
          id: jobId,
          started_at: now.toISOString(),
          finished_at: null,
          kind,
          symbol,
          timeframe: "1m",
          range_from: batch.from.toISOString(),
          range_to: batch.to.toISOString(),
          status: "started",
          bars_upserted: 0,
          last_error: null,
          result: { key },
        };
      if (!prior || prior.status !== "started") await deps.archive.insertJob(started);

      try {
        const candles = await withRetries(
          () => deps.yahoo.getCandles({ symbol: symbol === "MES=F" ? "MES" : "MNQ", timeframe: "1m", from: batch.from, to: batch.to }),
          { sleep: deps.sleep, shouldRetry: isRetryableError },
        );
        const upserted = await deps.archive.upsertCandles(candlesToRows(symbol, "1m", candles));
        const coverage = coverageForBars(symbol, batch.from, batch.to, candles);
        await deps.archive.upsertCoverage(coverage.map((row) => ({
          symbol: row.symbol,
          timeframe: row.timeframe,
          session_date: row.session_date,
          expected_bars: row.expected_bars,
          received_bars: row.received_bars,
          missing_ranges: row.missing_ranges,
          status: row.status,
        })));
        const status = coverage.some((row) => row.status === "missing" || row.status === "partial") && candles.length > 0
          ? "partial"
          : "success";
        await deps.archive.updateJob(jobId, {
          finished_at: (deps.now?.() ?? new Date()).toISOString(),
          status,
          bars_upserted: upserted,
          last_error: null,
          result: { key, sessions: coverage.map((row) => ({ date: row.session_date, status: row.status, received: row.received_bars, expected: row.expected_bars })) },
        });
        reports.push({ symbol, from: batch.from.toISOString(), to: batch.to.toISOString(), upserted, status, coverage });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Ingest failed";
        await deps.archive.updateJob(jobId, {
          finished_at: (deps.now?.() ?? new Date()).toISOString(),
          status: "failed",
          last_error: message,
        });
        reports.push({ symbol, from: batch.from.toISOString(), to: batch.to.toISOString(), upserted: 0, status: "failed", error: message, coverage: [] });
      }
    }
  }

  return { batches: reports };
}

export function formatIngestReport(report: IngestReport): string {
  if (report.skipped === "not_configured") return report.message ?? ARCHIVE_NOT_CONFIGURED_MESSAGE;
  if (report.batches.length === 0) return "No ingest batches to run.";
  const lines = ["Candle archive ingest:"];
  for (const batch of report.batches) {
    lines.push(`  ${batch.symbol} ${batch.from} → ${batch.to}: ${batch.status}, ${batch.upserted} bars${batch.error ? ` (${batch.error})` : ""}`);
    for (const row of batch.coverage) {
      lines.push(`    ${row.session_date} ${row.status} received=${row.received_bars} expected=${row.expected_bars}`);
    }
  }
  return lines.join("\n");
}
