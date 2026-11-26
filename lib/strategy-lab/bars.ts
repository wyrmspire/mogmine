/**
 * Strategy Lab bar loader (SL-2, docs/design-2026-11-24/09 §10.2; SL-15b additive coverage). A settled session comes from
 * the device store, then `mogmine_bars_1m`, then Yahoo for missing minutes only. Bars merge and are never replaced.
 * Never throws: every failure is an excluded session with a reason.
 */
import { idbGet, idbSet } from "../idb.ts";
import { equityIndexSessionBounds, previousRegularSessionDate } from "../session.ts";
import {
  cleanCandles, computeMissingRanges, defaultCoverageStorage, mergeBars1m, mergeCoveredRanges, recordSessionCoverage,
  type CleanStats, type CoveredRange,
} from "./bar-coverage.ts";
import { readRemoteSessionBars1m } from "./bars-cache.ts";
import { buildBarSeries } from "./series.ts";
import type { BarSeries, SourceBar } from "./types.ts";

export { cleanCandles, type CleanStats };
export const LAB_SYMBOL = "MES";
export const SESSION_CONCURRENCY = 3;
/** A session is cached only once its 17:00 ET close is at least this far in the past. */
export const CACHE_SETTLE_MS = 60 * 60_000;
/** Volume grade limit: at most this share of RTH bars may lack volume for `degraded`. */
export const VOLUME_DEGRADED_LIMIT = 0.02;
export const CACHE_SCHEMA = "strategy-lab.session.v1";
/** Yahoo serves 1m bars for about the last 30 days. Older windows never reach the network. */
export const YAHOO_1M_SAFE_MS = 29 * 86_400_000;

export type ExclusionReason = "not-1m" | "no-data" | "upstream" | "bad-response";
export type VolumeGrade = "ok" | "degraded" | "missing";
export type LoadSource = "cache" | "supabase" | "network";

export interface SessionWindow { date: string; from: number; to: number }

export type SessionLoad =
  | { date: string; status: "loaded"; source: LoadSource; bars: SourceBar[]; clean: CleanStats }
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
  /** Server bars for one session (`mogmine_bars_1m`). Defaults to `readRemoteSessionBars1m`. Null when unavailable. */
  remoteBars?: (window: SessionWindow) => Promise<SourceBar[] | null>;
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

export interface CachedSession {
  schema: typeof CACHE_SCHEMA;
  date: string;
  baseTimeframe: "1m";
  bars: SourceBar[];
  /** Minutes known to be complete, as half-open ranges. Legacy entries without it cover the whole session. */
  coveredRanges?: CoveredRange[];
}

const MINUTE_MS = 60_000;
const NO_CLEAN: CleanStats = { droppedRows: 0, outsideWindow: 0 };
/** The device cache: IndexedDB. A miss or a write failure outside a browser only means "not cached". */
export const defaultSessionCache: SessionCache = { get: (key) => idbGet(key), set: (key, value) => idbSet(key, value) };

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

function excluded(date: string, reason: ExclusionReason, detail: string, baseTimeframe: string | null = null): SessionLoad {
  return { date, status: "excluded", reason, detail, baseTimeframe };
}

/** The server read: bars when `mogmine_bars_1m` has any for the window, else null. Never throws. */
export async function defaultRemoteBars(window: SessionWindow): Promise<SourceBar[] | null> {
  try {
    const result = await readRemoteSessionBars1m(LAB_SYMBOL, window);
    return result.ok && result.value?.length ? result.value : null;
  } catch {
    return null;
  }
}

/** The device entry: cleaned bars and covered minutes. Null on a miss or a corrupt entry. */
export async function readSessionEntry(cache: SessionCache, window: SessionWindow): Promise<{ bars: SourceBar[]; covered: CoveredRange[] } | null> {
  try {
    const value = await cache.get(cacheKey(window.date)) as Partial<CachedSession> | undefined;
    if (!value || value.schema !== CACHE_SCHEMA || value.date !== window.date || value.baseTimeframe !== "1m") return null;
    const { bars } = cleanCandles(value.bars, window);
    // Legacy entries (no coveredRanges) cover the whole session; an entry with no bars covers nothing.
    const covered = bars.length === 0 ? [] : Array.isArray(value.coveredRanges) ? mergeCoveredRanges(value.coveredRanges) : [[window.from, window.to] as CoveredRange];
    return { bars, covered };
  } catch {
    return null;
  }
}

/** Writes the session entry and the coverage index. A failed write only means "not cached". */
export async function writeSessionEntry(
  cache: SessionCache,
  window: SessionWindow,
  bars: SourceBar[],
  covered: readonly CoveredRange[],
  now: number,
): Promise<void> {
  const merged = mergeCoveredRanges(covered);
  const record: CachedSession = { schema: CACHE_SCHEMA, date: window.date, baseTimeframe: "1m", bars, coveredRanges: merged };
  try { await cache.set(cacheKey(window.date), record); } catch { /* not cached */ }
  recordSessionCoverage(defaultCoverageStorage(), LAB_SYMBOL, window.date, merged, bars.length, now);
}

type RangeFetch = { ok: true; bars: SourceBar[]; clean: CleanStats } | { ok: false; load: SessionLoad };

/**
 * One `/api/market-data` call for `[from, to)` of a session. Only 1m answers are usable; a 5m or 1h answer, an empty
 * answer, or any failure comes back as `ok: false` with the excluded reason. Never throws.
 */
export async function fetchRangeBars(window: SessionWindow, range: CoveredRange, deps: BarLoaderDeps = {}): Promise<RangeFetch> {
  const sub: SessionWindow = { date: window.date, from: range[0], to: range[1] };
  const fetchImpl = deps.fetch ?? ((url: string) => globalThis.fetch(url));
  let response: HttpResponseLike;
  try {
    response = await fetchImpl(marketDataUrl(sub, deps.origin));
  } catch {
    return { ok: false, load: excluded(window.date, "upstream", "network error") };
  }
  if (response.status === 404) return { ok: false, load: excluded(window.date, "no-data", "nothing served for this window") };
  if (!response.ok) return { ok: false, load: excluded(window.date, "upstream", `HTTP ${response.status}`) };

  let body: { candles?: unknown; baseTimeframe?: unknown } | null;
  try {
    body = await response.json() as { candles?: unknown; baseTimeframe?: unknown } | null;
  } catch {
    return { ok: false, load: excluded(window.date, "bad-response", "body is not JSON") };
  }
  if (!body || typeof body !== "object" || !Array.isArray(body.candles)) {
    return { ok: false, load: excluded(window.date, "bad-response", "no candles array") };
  }
  const timeframe = typeof body.baseTimeframe === "string" ? body.baseTimeframe : null;
  if (body.candles.length > 0 && timeframe === null) {
    return { ok: false, load: excluded(window.date, "bad-response", "no base timeframe") };
  }
  if (timeframe !== null && timeframe !== "1m") {
    // Empty answers are normal (weekends, future). A served 5m or 1h set is not usable for MVP skills.
    if (body.candles.length === 0) return { ok: false, load: excluded(window.date, "no-data", "empty window", timeframe) };
    return { ok: false, load: excluded(window.date, "not-1m", `only ${timeframe} left at Yahoo`, timeframe) };
  }
  const { bars, clean } = cleanCandles(body.candles, sub);
  if (!bars.length) return { ok: false, load: excluded(window.date, "no-data", "empty window", timeframe) };
  return { ok: true, bars, clean };
}

export interface FillOutcome {
  bars: SourceBar[];
  covered: CoveredRange[];
  source: LoadSource;
  /** Why the first missing range could not be filled, if one could not. */
  failure: SessionLoad | null;
  clean: CleanStats;
  changed: boolean;
}

/**
 * Additive fill of one session up to `to` (exclusive): device entry, then `mogmine_bars_1m` (settled only), then Yahoo
 * for missing sub-ranges. A still-open range is covered only up to its last fetched minute. Writes when changed.
 */
export async function fillSessionBars(
  window: SessionWindow,
  to: number,
  deps: BarLoaderDeps,
  cache: SessionCache,
  now: number,
): Promise<FillOutcome> {
  const entry = await readSessionEntry(cache, window);
  let bars = entry?.bars ?? [];
  let covered = entry?.covered ?? [];
  let source: LoadSource = "cache";
  let changed = false;
  let clean = NO_CLEAN;
  let failure: SessionLoad | null = null;

  if (isCacheable(window.date, now) && computeMissingRanges({ from: window.from, to }, covered).length > 0) {
    const remote = await (deps.remoteBars ?? defaultRemoteBars)(window);
    const cleanRemote = remote ? cleanCandles(remote, window).bars : [];
    if (cleanRemote.length) {
      bars = mergeBars1m(bars, cleanRemote, window);
      covered = mergeCoveredRanges([...covered, [window.from, window.to]]);
      source = "supabase";
      changed = true;
    }
  }

  for (const range of computeMissingRanges({ from: window.from, to }, covered)) {
    if (now - window.to > YAHOO_1M_SAFE_MS) {
      failure ??= excluded(window.date, "no-data", "older than Yahoo's 30-day 1m history");
      break;
    }
    const fetched = await fetchRangeBars(window, range, deps);
    if (!fetched.ok) {
      failure ??= fetched.load;
      continue;
    }
    bars = mergeBars1m(bars, fetched.bars, window);
    clean = { droppedRows: clean.droppedRows + fetched.clean.droppedRows, outsideWindow: clean.outsideWindow + fetched.clean.outsideWindow };
    // Settled ranges are complete. A range still open is covered only up to its last fetched minute.
    const lastBar = fetched.bars[fetched.bars.length - 1].time;
    const coveredTo = range[1] <= now - CACHE_SETTLE_MS ? range[1] : Math.min(range[1], lastBar + MINUTE_MS);
    covered = mergeCoveredRanges([...covered, [range[0], coveredTo]]);
    source = "network";
    changed = true;
  }

  if (changed && bars.length) await writeSessionEntry(cache, window, bars, covered, now);
  return { bars, covered, source, failure, clean, changed };
}

/** Load one session. Never throws. */
export async function loadSession(date: string, deps: BarLoaderDeps = {}): Promise<SessionLoad> {
  const window = sessionWindow(date);
  const now = (deps.now ?? Date.now)();

  // Unsettled: never cached, never read from the server store. Fetch the whole window.
  if (!isCacheable(date, now)) {
    const fetched = await fetchRangeBars(window, [window.from, window.to], deps);
    return fetched.ok
      ? { date, status: "loaded", source: "network", bars: fetched.bars, clean: fetched.clean }
      : fetched.load;
  }

  const outcome = await fillSessionBars(window, window.to, deps, deps.cache ?? defaultSessionCache, now);
  if (!outcome.bars.length) return outcome.failure ?? excluded(date, "no-data", "empty window");
  return { date, status: "loaded", source: outcome.source, bars: outcome.bars, clean: outcome.clean };
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
  const grade: VolumeGrade = volumeMissing === 0 ? "ok" : missingRatio <= VOLUME_DEGRADED_LIMIT ? "degraded" : "missing";
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
