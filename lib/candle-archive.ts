// Typed repository for the M0 candle archive. Server and scripts only: this module
// talks to PostgREST with the service role and must not be imported from client components.

import type { Candle, Timeframe } from "./trades.ts";
import { type ArchiveTicker, readArchiveServiceConfig, toArchiveTicker } from "./archive-config.ts";
import type { CoverageSnapshot, MissingRange } from "./archive-coverage.ts";
import { withRetries } from "./archive-retry.ts";

export { isArchiveConfigured, readArchiveServiceConfig, toArchiveTicker, ARCHIVE_TICKERS, ARCHIVE_NOT_CONFIGURED_MESSAGE } from "./archive-config.ts";
export type { ArchiveTicker } from "./archive-config.ts";
export { buildCoverage, datesInRange, expectedBarTimes, isWeekendCalendarDate, sessionBounds, zonedTimeToUtc } from "./archive-coverage.ts";
export type { CoverageSnapshot, CoverageStatus, MissingRange } from "./archive-coverage.ts";
export { isRetryableError, statusFromError, withRetries } from "./archive-retry.ts";

export type ArchiveJobKind = "daily" | "backfill" | "repair";
export type ArchiveJobStatus = "started" | "success" | "partial" | "failed";

export interface MarketCandleRow {
  symbol: ArchiveTicker;
  timeframe: Timeframe;
  ts: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  source: "yahoo_finance";
  ingested_at?: string;
}

export interface CoverageRow {
  symbol: ArchiveTicker;
  timeframe: Timeframe;
  session_date: string;
  expected_bars: number | null;
  received_bars: number;
  missing_ranges: MissingRange[];
  status: CoverageSnapshot["status"];
  updated_at?: string;
}

export interface ArchiveJobRow {
  id: string;
  started_at: string;
  finished_at: string | null;
  kind: ArchiveJobKind;
  symbol: ArchiveTicker | null;
  timeframe: Timeframe;
  range_from: string | null;
  range_to: string | null;
  status: ArchiveJobStatus;
  bars_upserted: number;
  last_error: string | null;
  result: Record<string, unknown>;
}

export interface ArchiveClient {
  upsertCandles(rows: MarketCandleRow[]): Promise<number>;
  getCandles(query: { symbol: string; timeframe: Timeframe; from: Date; to: Date }): Promise<Candle[]>;
  upsertCoverage(rows: CoverageRow[]): Promise<void>;
  getCoverage(query?: { symbol?: string; timeframe?: Timeframe; fromDate?: string; toDate?: string }): Promise<CoverageRow[]>;
  insertJob(job: ArchiveJobRow): Promise<ArchiveJobRow>;
  updateJob(id: string, patch: Partial<ArchiveJobRow>): Promise<void>;
  listJobs(query?: { kind?: ArchiveJobKind; status?: ArchiveJobStatus[]; symbol?: string }): Promise<ArchiveJobRow[]>;
}

const PAGE = 1_000;
const UPSERT_CHUNK = 500;

function requiredTicker(symbol: string): ArchiveTicker {
  const ticker = toArchiveTicker(symbol);
  if (!ticker) throw new Error(`Archive symbols are MES=F and MNQ=F only (OD-15); got ${symbol}`);
  return ticker;
}

function asNumber(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function rowToCandle(row: MarketCandleRow | Record<string, unknown>): Candle {
  return {
    time: Date.parse(String(row.ts)),
    open: asNumber(row.open),
    high: asNumber(row.high),
    low: asNumber(row.low),
    close: asNumber(row.close),
    volume: asNumber(row.volume),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null;
}

export function candlesToRows(symbol: string, timeframe: Timeframe, candles: Candle[]): MarketCandleRow[] {
  const ticker = requiredTicker(symbol);
  return candles.map((candle) => ({
    symbol: ticker,
    timeframe,
    ts: new Date(candle.time).toISOString(),
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume,
    source: "yahoo_finance",
  }));
}

export class MemoryArchiveClient implements ArchiveClient {
  candles = new Map<string, MarketCandleRow>();
  coverage = new Map<string, CoverageRow>();
  jobs: ArchiveJobRow[] = [];

  private candleKey(row: Pick<MarketCandleRow, "symbol" | "timeframe" | "ts">) {
    return `${row.symbol}|${row.timeframe}|${row.ts}`;
  }

  async upsertCandles(rows: MarketCandleRow[]): Promise<number> {
    for (const row of rows) {
      requiredTicker(row.symbol);
      this.candles.set(this.candleKey(row), { ...row, ingested_at: row.ingested_at ?? new Date().toISOString() });
    }
    return rows.length;
  }

  async getCandles(query: { symbol: string; timeframe: Timeframe; from: Date; to: Date }): Promise<Candle[]> {
    const ticker = requiredTicker(query.symbol);
    const from = query.from.toISOString();
    const to = query.to.toISOString();
    return [...this.candles.values()]
      .filter((row) => row.symbol === ticker && row.timeframe === query.timeframe && row.ts >= from && row.ts <= to)
      .sort((a, b) => a.ts.localeCompare(b.ts))
      .map(rowToCandle);
  }

  async upsertCoverage(rows: CoverageRow[]): Promise<void> {
    for (const row of rows) {
      this.coverage.set(`${row.symbol}|${row.timeframe}|${row.session_date}`, { ...row, updated_at: row.updated_at ?? new Date().toISOString() });
    }
  }

  async getCoverage(query: { symbol?: string; timeframe?: Timeframe; fromDate?: string; toDate?: string } = {}): Promise<CoverageRow[]> {
    const ticker = query.symbol ? requiredTicker(query.symbol) : null;
    return [...this.coverage.values()].filter((row) => {
      if (ticker && row.symbol !== ticker) return false;
      if (query.timeframe && row.timeframe !== query.timeframe) return false;
      if (query.fromDate && row.session_date < query.fromDate) return false;
      if (query.toDate && row.session_date > query.toDate) return false;
      return true;
    }).sort((a, b) => a.session_date.localeCompare(b.session_date));
  }

  async insertJob(job: ArchiveJobRow): Promise<ArchiveJobRow> {
    this.jobs.push({ ...job });
    return job;
  }

  async updateJob(id: string, patch: Partial<ArchiveJobRow>): Promise<void> {
    const index = this.jobs.findIndex((job) => job.id === id);
    if (index >= 0) this.jobs[index] = { ...this.jobs[index], ...patch, id };
  }

  async listJobs(query: { kind?: ArchiveJobKind; status?: ArchiveJobStatus[]; symbol?: string } = {}): Promise<ArchiveJobRow[]> {
    const ticker = query.symbol ? requiredTicker(query.symbol) : null;
    return this.jobs
      .filter((job) => {
        if (query.kind && job.kind !== query.kind) return false;
        if (query.status && !query.status.includes(job.status)) return false;
        if (ticker && job.symbol !== ticker) return false;
        return true;
      })
      .sort((a, b) => b.started_at.localeCompare(a.started_at));
  }
}

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export class PostgrestArchiveClient implements ArchiveClient {
  private readonly url: string;
  private readonly accessKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(url: string, accessKey: string, fetchImpl: typeof fetch = fetch) {
    this.url = url;
    this.accessKey = accessKey;
    this.fetchImpl = fetchImpl;
  }

  private async request(path: string, init: RequestInit = {}): Promise<{ status: number; body: unknown; headers: Headers }> {
    const headers = new Headers(init.headers);
    headers.set("apikey", this.accessKey);
    headers.set("Authorization", `Bearer ${this.accessKey}`);
    headers.set("Accept", "application/json");
    const response = await this.fetchImpl(`${this.url.replace(/\/$/, "")}/rest/v1/${path}`, { ...init, headers });
    const text = await response.text();
    let body: unknown = text;
    if (text) {
      try { body = JSON.parse(text) as unknown; } catch { body = text; }
    } else {
      body = null;
    }
    if (!response.ok) {
      const detail = isRecord(body) && (body.message || body.hint || body.details)
        ? String(body.message ?? body.hint ?? body.details)
        : `PostgREST returned ${response.status}`;
      throw new HttpError(response.status, detail);
    }
    return { status: response.status, body, headers: response.headers };
  }

  async upsertCandles(rows: MarketCandleRow[]): Promise<number> {
    if (rows.length === 0) return 0;
    for (const row of rows) requiredTicker(row.symbol);
    for (let offset = 0; offset < rows.length; offset += UPSERT_CHUNK) {
      const chunk = rows.slice(offset, offset + UPSERT_CHUNK);
      await withRetries(() => this.request(
        "market_candles?on_conflict=symbol,timeframe,ts",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Prefer: "return=minimal,resolution=merge-duplicates",
          },
          body: JSON.stringify(chunk),
        },
      ));
    }
    return rows.length;
  }

  async getCandles(query: { symbol: string; timeframe: Timeframe; from: Date; to: Date }): Promise<Candle[]> {
    const ticker = requiredTicker(query.symbol);
    const params = new URLSearchParams({
      select: "symbol,timeframe,ts,open,high,low,close,volume,source,ingested_at",
      symbol: `eq.${ticker}`,
      timeframe: `eq.${query.timeframe}`,
      ts: `gte.${query.from.toISOString()}`,
      order: "ts.asc",
    });
    // PostgREST: add a second ts filter via and=
    const path = `market_candles?${params}&ts=lte.${query.to.toISOString()}`;
    const rows: Record<string, unknown>[] = [];
    let from = 0;
    for (;;) {
      const { body, headers } = await withRetries(() => this.request(path, {
        headers: { Range: `${from}-${from + PAGE - 1}`, Prefer: "count=exact" },
      }));
      const page = Array.isArray(body) ? body as Record<string, unknown>[] : [];
      rows.push(...page);
      const range = headers.get("content-range");
      const total = range?.split("/")[1];
      if (page.length < PAGE || (total && rows.length >= Number(total))) break;
      from += PAGE;
    }
    return rows.map(rowToCandle).filter((candle) => Number.isFinite(candle.time));
  }

  async upsertCoverage(rows: CoverageRow[]): Promise<void> {
    if (rows.length === 0) return;
    await withRetries(() => this.request(
      "market_coverage?on_conflict=symbol,timeframe,session_date",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Prefer: "return=minimal,resolution=merge-duplicates",
        },
        body: JSON.stringify(rows.map((row) => ({ ...row, updated_at: row.updated_at ?? new Date().toISOString() }))),
      },
    ));
  }

  async getCoverage(query: { symbol?: string; timeframe?: Timeframe; fromDate?: string; toDate?: string } = {}): Promise<CoverageRow[]> {
    const params = new URLSearchParams({ select: "*", order: "session_date.asc" });
    if (query.symbol) params.set("symbol", `eq.${requiredTicker(query.symbol)}`);
    if (query.timeframe) params.set("timeframe", `eq.${query.timeframe}`);
    let path = `market_coverage?${params}`;
    if (query.fromDate) path += `&session_date=gte.${query.fromDate}`;
    if (query.toDate) path += `&session_date=lte.${query.toDate}`;
    const { body } = await withRetries(() => this.request(path));
    return (Array.isArray(body) ? body : []) as CoverageRow[];
  }

  async insertJob(job: ArchiveJobRow): Promise<ArchiveJobRow> {
    await withRetries(() => this.request("market_archive_jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify(job),
    }));
    return job;
  }

  async updateJob(id: string, patch: Partial<ArchiveJobRow>): Promise<void> {
    await withRetries(() => this.request(`market_archive_jobs?id=eq.${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify(patch),
    }));
  }

  async listJobs(query: { kind?: ArchiveJobKind; status?: ArchiveJobStatus[]; symbol?: string } = {}): Promise<ArchiveJobRow[]> {
    const params = new URLSearchParams({ select: "*", order: "started_at.desc" });
    if (query.kind) params.set("kind", `eq.${query.kind}`);
    if (query.status?.length) params.set("status", `in.(${query.status.join(",")})`);
    if (query.symbol) params.set("symbol", `eq.${requiredTicker(query.symbol)}`);
    const { body } = await withRetries(() => this.request(`market_archive_jobs?${params}`));
    return (Array.isArray(body) ? body : []) as ArchiveJobRow[];
  }
}

export function createConfiguredArchiveClient(
  env: NodeJS.Dict<string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
): ArchiveClient | null {
  const config = readArchiveServiceConfig(env);
  if (!config) return null;
  return new PostgrestArchiveClient(config.url, config.accessKey, fetchImpl);
}
