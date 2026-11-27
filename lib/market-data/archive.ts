// Server only. Never import from a "use client" file.
// Authoritative Supabase candle archive read path (`public.mogmine_market_candles`).
// Returns null when Supabase env vars are unconfigured or on query errors so callers can fall back cleanly.
import { createClient } from "@supabase/supabase-js";
import { aggregateCandles } from "../candle-aggregation.ts";
import { canonicalSymbol, FUTURES_SPECS, specFor, TIMEFRAME_MINUTES } from "../trades.ts";
import type { Candle, Timeframe } from "../trades.ts";
import { previousRegularSessionDate, sessionDate } from "../session.ts";

const PAGE_SIZE = 1000;
const MAX_PAGES = 60;
const MINUTE_MS = 60_000;
const AUTH_OPTIONS = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } as const;

export interface ArchiveCandleRow {
  symbol: string;
  timeframe: string;
  ts: string;
  open: number | string;
  high: number | string;
  low: number | string;
  close: number | string;
  volume: number | string | null;
  source: string;
}

export interface ArchiveQueryLike extends PromiseLike<{ data: ArchiveCandleRow[] | null; error: { message: string } | null }> {
  select(columns: string): ArchiveQueryLike;
  in(column: string, values: string[]): ArchiveQueryLike;
  eq(column: string, value: string): ArchiveQueryLike;
  gte(column: string, value: string): ArchiveQueryLike;
  lte(column: string, value: string): ArchiveQueryLike;
  lt(column: string, value: string): ArchiveQueryLike;
  order(column: string, options: { ascending: boolean }): ArchiveQueryLike;
  range(from: number, to: number): ArchiveQueryLike;
}

export interface ArchiveClientLike {
  from(table: string): { select(columns: string): ArchiveQueryLike };
}

export interface ArchiveQuery {
  symbol: string;
  timeframe: Timeframe;
  from: Date;
  to: Date;
  /** True (default): `ts <= to`. False: `ts < to`. */
  inclusiveTo?: boolean;
}

export interface ArchiveResult {
  candles: Candle[];
  sources: string[];
  sourceLabel: string;
  providerName: string;
}

export interface ArchiveReadOptions {
  client?: ArchiveClientLike | null;
}

export interface ArchiveStatus {
  state: "server_unconfigured" | "query_failed" | "empty_archive" | "no_archive_job" | "failed_job" | "healthy" | "attention";
  available: boolean;
  symbol: string;
  newestBarIso: string | null;
  coveredSessions: number;
  missingRecentSessions: number;
  missingRecentSessionsProvisional: boolean;
  lastJob: { status: string; started_at: string | null; finished_at: string | null; bars_upserted: number } | null;
  warning: string | null;
}

// Not ArchiveClientLike: the status read queries other tables, whose rows are not candle rows.
type StatusRow = Record<string, unknown>;
interface StatusQuery extends PromiseLike<{ data: StatusRow[] | null; error: { message: string } | null }> {
  select(columns: string): StatusQuery;
  eq(column: string, value: string): StatusQuery;
  order(column: string, options: { ascending: boolean }): StatusQuery;
  range(from: number, to: number): StatusQuery;
}
type ArchiveStatusClient = { from(table: string): { select(columns: string): StatusQuery } };

let cachedCreds: { url: string; serviceKey: string } | null = null;
let cachedClient: ArchiveClientLike | null = null;

function getArchiveClient(): ArchiveClientLike | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceKey) return null;
  if (cachedClient && cachedCreds?.url === url && cachedCreds.serviceKey === serviceKey) {
    return cachedClient;
  }
  cachedCreds = { url, serviceKey };
  cachedClient = createClient(url, serviceKey, { auth: AUTH_OPTIONS }) as unknown as ArchiveClientLike;
  return cachedClient;
}

function recentSessionLabels(nowMs: number, count: number): string[] {
  const result: string[] = [];
  let date = previousRegularSessionDate(sessionDate(nowMs));
  while (result.length < count) {
    result.push(date);
    date = previousRegularSessionDate(date);
  }
  return result;
}

/** Read-only archive health summary. It never throws and returns local mode when server credentials are absent. */
export async function readArchiveStatus(symbol = "MES=F", nowMs = Date.now(), options: { client?: ArchiveStatusClient | null } = {}): Promise<ArchiveStatus> {
  const empty: ArchiveStatus = { state: "server_unconfigured", available: false, symbol, newestBarIso: null, coveredSessions: 0, missingRecentSessions: 0, missingRecentSessionsProvisional: false, lastJob: null, warning: null };
  try {
    const client = options.client === undefined ? getArchiveClient() as unknown as ArchiveStatusClient | null : options.client;
    if (!client) return empty;
    const coverage = await client.from("mogmine_market_coverage").select("session_date,status").eq("symbol", symbol).eq("timeframe", "1m");
    const jobs = await client.from("mogmine_market_archive_jobs").select("status,started_at,finished_at,bars_upserted").eq("symbol", symbol).order("started_at", { ascending: false }).range(0, 0);
    const candles = await client.from("mogmine_market_candles").select("ts").eq("symbol", symbol).eq("timeframe", "1m").order("ts", { ascending: false }).range(0, 0);
    if (coverage.error || jobs.error || candles.error) return { ...empty, state: "query_failed", warning: "Archive status could not be read from the server." };
    const rows = Array.isArray(coverage.data) ? coverage.data : [];
    const recent = new Set(recentSessionLabels(nowMs, 5));
    const covered = new Set(rows.filter((row) => row.status === "complete").map((row) => String(row.session_date)));
    const missingRecentSessions = [...recent].filter((date) => !covered.has(date)).length;
    const job = Array.isArray(jobs.data) && jobs.data[0] ? jobs.data[0] : null;
    const lastJob = job ? { status: String(job.status), started_at: typeof job.started_at === "string" ? job.started_at : null, finished_at: typeof job.finished_at === "string" ? job.finished_at : null, bars_upserted: Number(job.bars_upserted ?? 0) } : null;
    const newestBarIso = Array.isArray(candles.data) && candles.data[0]?.ts ? String(candles.data[0].ts) : null;
    const hasArchiveData = rows.length > 0 || newestBarIso !== null;
    const state = lastJob?.status === "failed" ? "failed_job" : !lastJob && hasArchiveData ? "no_archive_job" : !hasArchiveData ? "empty_archive" : missingRecentSessions > 1 ? "attention" : "healthy";
    const warning = state === "failed_job" ? "The latest archive job failed." : state === "no_archive_job" ? "Archive data exists, but no archive job has been recorded." : state === "attention" ? `${missingRecentSessions} recent exchange sessions appear missing (provisional; holiday and early-close calendars are not authoritative here).` : null;
    return { state, available: true, symbol, newestBarIso, coveredSessions: covered.size, missingRecentSessions, missingRecentSessionsProvisional: true, lastJob, warning };
  } catch {
    return { ...empty, state: "query_failed", warning: "Archive status could not be read from the server." };
  }
}

/** Resolve canonical symbol and all matching archive symbol keys without cross-instrument fallback (OD-15). */
export function resolveArchiveSymbols(symbol: string): { canonical: string | null; symbols: string[] } {
  const trimmed = symbol.trim().toUpperCase();
  if (!trimmed) return { canonical: null, symbols: [] };
  const canonical = canonicalSymbol(trimmed);
  if (canonical) {
    const spec = specFor(canonical)!;
    return { canonical, symbols: Array.from(new Set([spec.yahooTicker, canonical])) };
  }
  const matched = Object.entries(FUTURES_SPECS).find(([, spec]) => spec.yahooTicker.toUpperCase() === trimmed);
  if (matched) {
    return { canonical: matched[0], symbols: Array.from(new Set([matched[1].yahooTicker, matched[0]])) };
  }
  return { canonical: null, symbols: [trimmed] };
}

export function archiveSourceLabel(sources: readonly string[]): string {
  if (sources.includes("databento")) {
    return sources.some((source) => source !== "databento") ? "Databento + Market Archive" : "Databento Archive";
  }
  return sources.length > 0 ? "Market Archive" : "Supabase Archive";
}

export function archiveProviderName(sources: readonly string[]): string {
  return sources.includes("databento") ? "databento_archive" : "supabase_archive";
}

async function fetchArchiveRows(
  client: ArchiveClientLike,
  symbols: string[],
  timeframe: Timeframe,
  fromMs: number,
  toMs: number,
  inclusiveTo: boolean,
): Promise<{ rows: ArchiveCandleRow[]; ok: boolean }> {
  const rows: ArchiveCandleRow[] = [];
  const fromIso = new Date(fromMs).toISOString();
  const toIso = new Date(toMs).toISOString();
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const offset = page * PAGE_SIZE;
    let query = client
      .from("mogmine_market_candles")
      .select("symbol,timeframe,ts,open,high,low,close,volume,source")
      .in("symbol", symbols)
      .eq("timeframe", timeframe)
      .gte("ts", fromIso);
    query = inclusiveTo ? query.lte("ts", toIso) : query.lt("ts", toIso);
    const { data, error } = await query.order("ts", { ascending: true }).range(offset, offset + PAGE_SIZE - 1);
    if (error || !Array.isArray(data)) return { rows: [], ok: false };
    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  return { rows, ok: true };
}

function parseArchiveRows(
  rows: readonly ArchiveCandleRow[],
  fromMs: number,
  toMs: number,
  inclusiveTo: boolean,
): { candles: Candle[]; sources: string[] } {
  const byTime = new Map<number, { candle: Candle; source: string }>();
  for (const row of rows) {
    const time = Date.parse(row.ts);
    if (!Number.isFinite(time) || time < fromMs || (inclusiveTo ? time > toMs : time >= toMs)) continue;
    const open = Number(row.open);
    const high = Number(row.high);
    const low = Number(row.low);
    const close = Number(row.close);
    if (![open, high, low, close].every(Number.isFinite)) continue;
    if (low > Math.min(open, close) || high < Math.max(open, close)) continue;
    const rawVolume = row.volume == null ? 0 : Number(row.volume);
    const volume = Number.isFinite(rawVolume) && rawVolume >= 0 ? rawVolume : 0;
    const source = typeof row.source === "string" && row.source.trim() ? row.source.trim() : "archive";
    const existing = byTime.get(time);
    // Prefer authoritative Databento rows when multiple archive sources overlap on the same timestamp.
    if (!existing || (existing.source !== "databento" && source === "databento")) {
      byTime.set(time, { candle: { time, open, high, low, close, volume }, source });
    }
  }
  const ordered = [...byTime.values()].sort((a, b) => a.candle.time - b.candle.time);
  const sources = Array.from(new Set(ordered.map((item) => item.source)));
  return { candles: ordered.map((item) => item.candle), sources };
}

/** Merge archive and live fallback bars, preferring archive bars for any overlapping timestamp. */
export function mergeArchiveAndYahoo(archiveCandles: readonly Candle[], yahooCandles: readonly Candle[]): Candle[] {
  const merged = new Map<number, Candle>();
  for (const bar of yahooCandles) merged.set(bar.time, bar);
  for (const bar of archiveCandles) merged.set(bar.time, bar);
  return [...merged.values()].sort((a, b) => a.time - b.time);
}

/**
 * Read candles from `public.mogmine_market_candles` for `[from, to]` (or `[from, to)` when `inclusiveTo` is false).
 * Aggregates archived `1m` bars when a coarser timeframe is requested and not stored directly.
 * Returns null when unconfigured, offline, or when a query fails; never throws.
 */
export async function readArchiveCandles(
  query: ArchiveQuery,
  options: ArchiveReadOptions = {},
): Promise<ArchiveResult | null> {
  try {
    const client = options.client === undefined ? getArchiveClient() : options.client;
    if (!client) return null;

    const fromMs = query.from.getTime();
    const toMs = query.to.getTime();
    const inclusiveTo = query.inclusiveTo ?? true;
    const { canonical, symbols } = resolveArchiveSymbols(query.symbol);
    if (!symbols.length || !Number.isFinite(fromMs) || !Number.isFinite(toMs)) return null;
    if (inclusiveTo ? toMs < fromMs : toMs <= fromMs) return null;

    const direct = await fetchArchiveRows(client, symbols, query.timeframe, fromMs, toMs, inclusiveTo);
    if (!direct.ok) return null;
    if (direct.rows.length > 0) {
      const parsed = parseArchiveRows(direct.rows, fromMs, toMs, inclusiveTo);
      if (parsed.candles.length > 0) {
        return {
          candles: parsed.candles,
          sources: parsed.sources,
          sourceLabel: archiveSourceLabel(parsed.sources),
          providerName: archiveProviderName(parsed.sources),
        };
      }
    }

    if (query.timeframe === "1m") {
      return { candles: [], sources: [], sourceLabel: archiveSourceLabel([]), providerName: archiveProviderName([]) };
    }

    const bucketMs = TIMEFRAME_MINUTES[query.timeframe] * MINUTE_MS;
    const alignedFrom = Math.floor(fromMs / bucketMs) * bucketMs;
    const alignedTo = inclusiveTo
      ? Math.floor(toMs / bucketMs) * bucketMs + bucketMs
      : Math.ceil(toMs / bucketMs) * bucketMs;
    const minuteRes = await fetchArchiveRows(client, symbols, "1m", alignedFrom, alignedTo, false);
    if (!minuteRes.ok) return null;
    if (minuteRes.rows.length === 0) {
      return { candles: [], sources: [], sourceLabel: archiveSourceLabel([]), providerName: archiveProviderName([]) };
    }

    const parsed1m = parseArchiveRows(minuteRes.rows, alignedFrom, alignedTo, false);
    const aggregated = aggregateCandles(parsed1m.candles, query.timeframe, {
      symbol: canonical ?? undefined,
      sourceMinutes: 1,
    }).filter((bar) => bar.time >= fromMs && (inclusiveTo ? bar.time <= toMs : bar.time < toMs));

    return {
      candles: aggregated,
      sources: parsed1m.sources,
      sourceLabel: archiveSourceLabel(parsed1m.sources),
      providerName: archiveProviderName(parsed1m.sources),
    };
  } catch {
    return null;
  }
}
