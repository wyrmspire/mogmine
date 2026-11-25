/**
 * Strategy Lab bar loader (SL-2, docs/design-2026-11-24/09 §10.2, §7.2).
 * One session at a time from `/api/market-data`, cleaned, cached on the device when settled,
 * and graded for volume. Never throws: every failure is an excluded session with a reason.
 */
import { idbGet, idbSet } from "../idb.ts";
import { equityIndexSessionBounds, previousRegularSessionDate } from "../session.ts";
import { buildBarSeries } from "./series.ts";
import type { BarSeries, SourceBar } from "./types.ts";

export const LAB_SYMBOL = "MES";
export const SESSION_CONCURRENCY = 3;
/** A session is cached only once its 17:00 ET close is at least this far in the past. */
export const CACHE_SETTLE_MS = 60 * 60_000;
/** Volume grade limit: at most this share of RTH bars may lack volume for `degraded`. */
export const VOLUME_DEGRADED_LIMIT = 0.02;
export const CACHE_SCHEMA = "strategy-lab.session.v1";

export type ExclusionReason = "not-1m" | "no-data" | "upstream" | "bad-response";
export type VolumeGrade = "ok" | "degraded" | "missing";

export interface SessionWindow { date: string; from: number; to: number }

export interface CleanStats { droppedRows: number; outsideWindow: number }

export type SessionLoad =
  | { date: string; status: "loaded"; source: "cache" | "network"; bars: SourceBar[]; clean: CleanStats }
  | { date: string; status: "excluded"; reason: ExclusionReason; detail: string; baseTimeframe: string | null };

export interface HttpResponseLike {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export interface SessionCache {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<unknown>;
}

export interface BarLoaderDeps {
  /** Defaults to the global `fetch`. */
  fetch?: (url: string) => Promise<HttpResponseLike>;
  /** Defaults to the IndexedDB helper, which is a miss outside a browser. */
  cache?: SessionCache;
  now?: () => number;
  /** Prefix for the relative `/api/market-data` URL. Empty in the browser. */
  origin?: string;
  concurrency?: number;
  onProgress?: (done: number, total: number) => void;
}

export interface VolumeIntegrity {
  date: string;
  rthBars: number;
  /** RTH minutes with no bar at all (a subset of `volumeMissing`). */
  absent: number;
  /** RTH minutes with no bar or with missing (NaN) volume. */
  volumeMissing: number;
  missingRatio: number;
  grade: VolumeGrade;
}

export interface LabBarData {
  series: BarSeries;
  loads: SessionLoad[];
  volume: VolumeIntegrity[];
}

interface CachedSession {
  schema: typeof CACHE_SCHEMA;
  date: string;
  baseTimeframe: "1m";
  bars: SourceBar[];
}

const MINUTE_MS = 60_000;
const DEFAULT_CACHE: SessionCache = { get: (key) => idbGet(key), set: (key, value) => idbSet(key, value) };

/** The session's window in UTC ms: 18:00 ET the previous day to 17:00 ET (DST-correct, never a fixed offset). */
export function sessionWindow(date: string): SessionWindow {
  const bounds = equityIndexSessionBounds(date);
  return { date, from: bounds.open, to: bounds.close };
}

export function cacheKey(date: string): string {
  return `strategy-lab:v1:${LAB_SYMBOL}:${date}`;
}

/** Completed sessions only. Today, and any session that closed under an hour ago, is never cached. */
export function isCacheable(date: string, now: number): boolean {
  return equityIndexSessionBounds(date).close < now - CACHE_SETTLE_MS;
}

export function marketDataUrl(window: SessionWindow, origin = ""): string {
  const params = new URLSearchParams({
    symbol: LAB_SYMBOL,
    from: new Date(window.from).toISOString(),
    to: new Date(window.to).toISOString(),
  });
  return `${origin}/api/market-data?${params.toString()}`;
}

const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/**
 * Keep only rows with numeric prices and times inside the window (`to` is exclusive, as Yahoo's period2).
 * Volume that is not a finite number becomes null; the series treats 0 and null alike as missing.
 */
export function cleanCandles(raw: unknown, window: SessionWindow): { bars: SourceBar[]; clean: CleanStats } {
  const bars: SourceBar[] = [];
  const clean: CleanStats = { droppedRows: 0, outsideWindow: 0 };
  if (!Array.isArray(raw)) return { bars, clean };
  for (const row of raw) {
    if (!row || typeof row !== "object") { clean.droppedRows += 1; continue; }
    const r = row as Record<string, unknown>;
    if (![r.time, r.open, r.high, r.low, r.close].every(isFiniteNumber)) { clean.droppedRows += 1; continue; }
    const time = r.time as number;
    if (time < window.from || time >= window.to) { clean.outsideWindow += 1; continue; }
    bars.push({
      time,
      open: r.open as number,
      high: r.high as number,
      low: r.low as number,
      close: r.close as number,
      volume: isFiniteNumber(r.volume) ? r.volume : null,
    });
  }
  return { bars, clean };
}

function excluded(date: string, reason: ExclusionReason, detail: string, baseTimeframe: string | null = null): SessionLoad {
  return { date, status: "excluded", reason, detail, baseTimeframe };
}

async function readCache(cache: SessionCache, window: SessionWindow): Promise<SourceBar[] | null> {
  try {
    const value = await cache.get(cacheKey(window.date)) as Partial<CachedSession> | undefined;
    if (!value || value.schema !== CACHE_SCHEMA || value.date !== window.date || value.baseTimeframe !== "1m") return null;
    const { bars } = cleanCandles(value.bars, window);
    return bars.length ? bars : null;
  } catch {
    return null;
  }
}

/** Load one session. Never throws. */
export async function loadSession(date: string, deps: BarLoaderDeps = {}): Promise<SessionLoad> {
  const window = sessionWindow(date);
  const now = (deps.now ?? Date.now)();
  const cache = deps.cache ?? DEFAULT_CACHE;
  const cacheable = isCacheable(date, now);

  if (cacheable) {
    const bars = await readCache(cache, window);
    if (bars) return { date, status: "loaded", source: "cache", bars, clean: { droppedRows: 0, outsideWindow: 0 } };
  }

  const fetchImpl = deps.fetch ?? ((url: string) => globalThis.fetch(url));
  let response: HttpResponseLike;
  try {
    response = await fetchImpl(marketDataUrl(window, deps.origin));
  } catch {
    return excluded(date, "upstream", "network error");
  }
  if (response.status === 404) return excluded(date, "no-data", "nothing served for this window");
  if (!response.ok) return excluded(date, "upstream", `HTTP ${response.status}`);

  let body: { candles?: unknown; baseTimeframe?: unknown } | null;
  try {
    body = await response.json() as { candles?: unknown; baseTimeframe?: unknown } | null;
  } catch {
    return excluded(date, "bad-response", "body is not JSON");
  }
  if (!body || typeof body !== "object" || !Array.isArray(body.candles)) {
    return excluded(date, "bad-response", "no candles array");
  }
  const timeframe = typeof body.baseTimeframe === "string" ? body.baseTimeframe : null;
  if (body.candles.length > 0 && timeframe === null) {
    return excluded(date, "bad-response", "no base timeframe");
  }
  if (timeframe !== null && timeframe !== "1m") {
    // Empty answers are normal (weekends, future). A served 5m or 1h set is not usable for MVP skills.
    if (body.candles.length === 0) return excluded(date, "no-data", "empty window", timeframe);
    return excluded(date, "not-1m", `only ${timeframe} left at Yahoo`, timeframe);
  }
  const { bars, clean } = cleanCandles(body.candles, window);
  if (!bars.length) return excluded(date, "no-data", "empty window", timeframe);

  if (cacheable) {
    const record: CachedSession = { schema: CACHE_SCHEMA, date, baseTimeframe: "1m", bars };
    try { await cache.set(cacheKey(date), record); } catch { /* not cached */ }
  }
  return { date, status: "loaded", source: "network", bars, clean };
}

/** Run `task` over `items` with at most `limit` in flight. Results keep input order. */
async function mapPool<T, R>(items: readonly T[], limit: number, task: (item: T) => Promise<R>, onDone: (done: number) => void): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await task(items[index]);
      done += 1;
      onDone(done);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** Load sessions in input order with bounded concurrency and progress. */
export async function loadSessions(dates: readonly string[], deps: BarLoaderDeps = {}): Promise<SessionLoad[]> {
  const limit = Math.max(1, Math.floor(deps.concurrency ?? SESSION_CONCURRENCY));
  return mapPool(dates, limit, (date) => loadSession(date, deps), (done) => deps.onProgress?.(done, dates.length));
}

/** The last `count` regular sessions ending at `endDate` (inclusive), oldest first. */
export function recentSessionDates(endDate: string, count: number): string[] {
  const dates = [endDate];
  while (dates.length < Math.max(1, Math.floor(count))) dates.unshift(previousRegularSessionDate(dates[0]));
  return dates;
}

/** Volume grade over the RTH minutes (09:30 to 16:00 ET) of one session, from a built series. */
export function volumeIntegrity(series: BarSeries, date: string): VolumeIntegrity {
  const bounds = equityIndexSessionBounds(date);
  const rthBars = Math.round((bounds.rthClose - bounds.rthOpen) / MINUTE_MS);
  let absent = 0;
  let volumeMissing = 0;
  for (let t = bounds.rthOpen; t < bounds.rthClose; t += MINUTE_MS) {
    const index = series.byTime.get(t);
    if (index === undefined) { absent += 1; volumeMissing += 1; }
    else if (Number.isNaN(series.volume[index])) volumeMissing += 1;
  }
  const missingRatio = rthBars === 0 ? 1 : volumeMissing / rthBars;
  const grade: VolumeGrade = volumeMissing === 0
    ? "ok"
    : missingRatio <= VOLUME_DEGRADED_LIMIT ? "degraded" : "missing";
  return { date, rthBars, absent, volumeMissing, missingRatio, grade };
}

/** Load sessions and build the one-minute series the lab computes on. Excluded sessions add no bars. */
export async function loadBarSeries(dates: readonly string[], deps: BarLoaderDeps = {}): Promise<LabBarData> {
  const loads = await loadSessions(dates, deps);
  const bars = loads.flatMap((load) => (load.status === "loaded" ? load.bars : []));
  const series = buildBarSeries(LAB_SYMBOL, bars);
  const volume = loads
    .filter((load) => load.status === "loaded")
    .map((load) => volumeIntegrity(series, load.date));
  return { series, loads, volume };
}
