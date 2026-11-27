// Server + client bridge for the Supabase Databento/Yahoo MES 1m archive (`mogmine_market_coverage` +
// `mogmine_market_candles`). Server calls use direct PostgREST with the caller's allow-listed JWT (RLS),
// never the service-role key or a separate SDK client. Client calls merge loaded bars into the additive store.
import { equityIndexSessionBounds, sessionDate } from "../session.ts";
import { cleanCandles, MINUTE_MS, mergeBars1m, mergeCoveredRanges, type CoveredRange } from "./bar-coverage.ts";
import { defaultSessionCache, isCacheable, readSessionEntry, sessionWindow, writeSessionEntry, type SessionCache } from "./bars.ts";
import { readVolume } from "./bars-cache.ts";
import { isObject, supabaseAdapterOn } from "./persistence.ts";
import type { SourceBar } from "./types.ts";

export const DEFAULT_ARCHIVE_SESSIONS = 20;
export const MAX_ARCHIVE_SESSIONS = 68;
const CANDLES_TABLE = "mogmine_market_candles";
const COVERAGE_TABLE = "mogmine_market_coverage";
const ALLOWED_TABLE = "mogmine_allowed_users";
const PAGE_SIZE = 1000;
const PAGE_CONCURRENCY = 6;

export interface ArchiveCoverageSession { date: string; symbol: string; expectedBars: number | null; receivedBars: number; status: string; source: string }
export type ArchiveErrorReason = "unconfigured" | "unauthenticated" | "forbidden" | "invalid" | "upstream";
export type ArchiveLoadResult =
  | { ok: true; symbol: "MES"; sessionsRequested: number; sessionsLoaded: number; totalAvailableSessions: number; dateRange: { from: string; to: string } | null; sessions: ArchiveCoverageSession[]; bars: SourceBar[] }
  | { ok: false; reason: ArchiveErrorReason; detail: string };
export interface ArchiveImportSummary { sessionsCached: number; sessionsTotal: number; barsImported: number; dateRange: { from: string; to: string } | null }
export interface ArchiveServerDeps { url?: string; anonKey?: string; adapter?: string; fetch?: typeof globalThis.fetch }

function toFinite(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
  return typeof value === "string" && value.trim() !== "" ? toFinite(Number(value)) : NaN;
}

export function archiveSymbolCandidates(raw: string | null | undefined): string[] | null {
  const sym = (raw ?? "MES").trim().toUpperCase();
  return sym === "MES" || sym === "MES=F" ? ["MES=F", "MES"] : null;
}

export function parseArchiveQuery(params: URLSearchParams): { ok: true; symbol: "MES"; sessions: number } | { ok: false; detail: string } {
  if (!archiveSymbolCandidates(params.get("symbol"))) return { ok: false, detail: 'Only symbol "MES" is supported in Strategy Lab.' };
  const rawSessions = params.get("sessions");
  if (rawSessions === null || rawSessions.trim() === "") return { ok: true, symbol: "MES", sessions: DEFAULT_ARCHIVE_SESSIONS };
  const parsed = Number(rawSessions);
  if (!Number.isInteger(parsed) || parsed < 1) return { ok: false, detail: `sessions must be an integer between 1 and ${MAX_ARCHIVE_SESSIONS}.` };
  return { ok: true, symbol: "MES", sessions: Math.min(MAX_ARCHIVE_SESSIONS, parsed) };
}

function barFromMarketRow(row: unknown): SourceBar | null {
  if (!isObject(row)) return null;
  const time = typeof row.ts === "string" ? Date.parse(row.ts) : NaN;
  const [open, high, low, close] = [toFinite(row.open), toFinite(row.high), toFinite(row.low), toFinite(row.close)];
  if (![time, open, high, low, close].every(Number.isFinite)) return null;
  if (low > Math.min(open, close) || high < Math.max(open, close) || low > high) return null;
  return { time, open, high, low, close, volume: readVolume(row.volume) };
}

function parseContentRangeTotal(header: string | null): number | null {
  const match = header ? /\/(\d+)$/.exec(header.trim()) : null;
  return match ? Number(match[1]) : null;
}

async function restGet(url: string, headers: Record<string, string>, fetchImpl: typeof globalThis.fetch) {
  try {
    const res = await fetchImpl(url, { headers, cache: "no-store" });
    if (!res.ok) return { ok: false as const, status: res.status, detail: `Supabase returned HTTP ${res.status}` };
    return { ok: true as const, json: (await res.json()) as unknown, contentRange: res.headers.get("content-range") };
  } catch (error) {
    return { ok: false as const, status: 502, detail: error instanceof Error ? error.message : "Network error" };
  }
}

export async function loadArchiveFromSupabase(
  options: { symbol?: string; sessions?: number; accessToken?: string | null },
  deps: ArchiveServerDeps = {},
): Promise<ArchiveLoadResult> {
  const url = (deps.url ?? process.env.NEXT_PUBLIC_SUPABASE_URL)?.trim().replace(/\/+$/, "");
  const anonKey = (deps.anonKey ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)?.trim();
  const adapter = (deps.adapter ?? process.env.NEXT_PUBLIC_PERSISTENCE_ADAPTER ?? "").trim().toLowerCase();
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  if (!url || !anonKey) return { ok: false, reason: "unconfigured", detail: "Supabase environment variables are not configured." };
  const token = options.accessToken?.trim();
  if (!token) {
    return adapter === "supabase"
      ? { ok: false, reason: "unauthenticated", detail: "Sign in to load the MES archive." }
      : { ok: false, reason: "unconfigured", detail: "MES archive requires NEXT_PUBLIC_PERSISTENCE_ADAPTER=supabase and sign-in." };
  }
  const candidates = archiveSymbolCandidates(options.symbol);
  if (!candidates) return { ok: false, reason: "invalid", detail: 'Only symbol "MES" is supported.' };
  const sessionsCount = Math.min(MAX_ARCHIVE_SESSIONS, Math.max(1, Math.trunc(options.sessions ?? DEFAULT_ARCHIVE_SESSIONS)));
  const baseHeaders = { apikey: anonKey, Authorization: `Bearer ${token}`, Accept: "application/json" };

  const allowRes = await restGet(`${url}/rest/v1/${ALLOWED_TABLE}?select=user_id&limit=1`, baseHeaders, fetchImpl);
  if (!allowRes.ok) {
    const reason: ArchiveErrorReason = allowRes.status === 401 ? "unauthenticated" : allowRes.status === 403 ? "forbidden" : "upstream";
    return { ok: false, reason, detail: reason === "unauthenticated" ? "Your session expired. Sign in again." : allowRes.detail };
  }
  if (!Array.isArray(allowRes.json) || allowRes.json.length === 0) {
    return { ok: false, reason: "forbidden", detail: "Your account is not allow-listed for MogMine." };
  }

  const symbolFilter = `symbol=in.(${candidates.map(encodeURIComponent).join(",")})`;
  const covUrl = `${url}/rest/v1/${COVERAGE_TABLE}?select=symbol,timeframe,session_date,expected_bars,received_bars,status,source&${symbolFilter}&timeframe=eq.1m&order=session_date.desc`;
  const covRes = await restGet(covUrl, { ...baseHeaders, Prefer: "count=exact", Range: `0-${MAX_ARCHIVE_SESSIONS - 1}` }, fetchImpl);
  if (!covRes.ok) return { ok: false, reason: "upstream", detail: covRes.detail };
  const byDate = new Map<string, ArchiveCoverageSession>();
  for (const row of Array.isArray(covRes.json) ? covRes.json : []) {
    if (!isObject(row) || typeof row.session_date !== "string") continue;
    const entry: ArchiveCoverageSession = {
      date: row.session_date, symbol: typeof row.symbol === "string" ? row.symbol : "MES=F",
      expectedBars: typeof row.expected_bars === "number" ? row.expected_bars : null,
      receivedBars: typeof row.received_bars === "number" ? row.received_bars : 0,
      status: typeof row.status === "string" ? row.status : "partial", source: typeof row.source === "string" ? row.source : "databento",
    };
    const prev = byDate.get(entry.date);
    if (!prev || (entry.symbol === "MES=F" && prev.symbol !== "MES=F") || entry.receivedBars > prev.receivedBars) byDate.set(entry.date, entry);
  }
  const selected = [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date)).slice(0, sessionsCount).reverse();
  const totalAvailableSessions = parseContentRangeTotal(covRes.contentRange) ?? byDate.size;
  if (selected.length === 0) return { ok: true, symbol: "MES", sessionsRequested: sessionsCount, sessionsLoaded: 0, totalAvailableSessions, dateRange: null, sessions: [], bars: [] };
  const fromIso = new Date(equityIndexSessionBounds(selected[0].date).open).toISOString();
  const toIso = new Date(equityIndexSessionBounds(selected[selected.length - 1].date).close).toISOString();
  const candleBase = `${url}/rest/v1/${CANDLES_TABLE}?select=ts,open,high,low,close,volume&${symbolFilter}&timeframe=eq.1m&ts=gte.${encodeURIComponent(fromIso)}&ts=lt.${encodeURIComponent(toIso)}&order=ts.asc,symbol.asc`;
  const firstPage = await restGet(candleBase, { ...baseHeaders, Prefer: "count=exact", Range: `0-${PAGE_SIZE - 1}` }, fetchImpl);
  if (!firstPage.ok) return { ok: false, reason: "upstream", detail: firstPage.detail };
  const allRows: unknown[] = Array.isArray(firstPage.json) ? [...firstPage.json] : [];
  const totalRows = parseContentRangeTotal(firstPage.contentRange);
  if (totalRows !== null && totalRows > PAGE_SIZE) {
    const offsets = Array.from({ length: Math.ceil((totalRows - PAGE_SIZE) / PAGE_SIZE) }, (_, k) => (k + 1) * PAGE_SIZE);
    const pages = new Array<unknown[]>(offsets.length);
    let cursor = 0, pageErr: string | null = null;
    await Promise.all(Array.from({ length: Math.min(PAGE_CONCURRENCY, offsets.length) }, async () => {
      while (cursor < offsets.length && !pageErr) {
        const idx = cursor++;
        const page = await restGet(candleBase, { ...baseHeaders, Range: `${offsets[idx]}-${offsets[idx] + PAGE_SIZE - 1}` }, fetchImpl);
        if (!page.ok) { pageErr = page.detail; return; }
        pages[idx] = Array.isArray(page.json) ? page.json : [];
      }
    }));
    if (pageErr) return { ok: false, reason: "upstream", detail: pageErr };
    for (const page of pages) if (page) allRows.push(...page);
  } else if (totalRows === null && allRows.length === PAGE_SIZE) {
    for (let off = PAGE_SIZE; off < MAX_ARCHIVE_SESSIONS * 1500; off += PAGE_SIZE) {
      const page = await restGet(candleBase, { ...baseHeaders, Range: `${off}-${off + PAGE_SIZE - 1}` }, fetchImpl);
      if (!page.ok) return { ok: false, reason: "upstream", detail: page.detail };
      const rows = Array.isArray(page.json) ? page.json : [];
      allRows.push(...rows);
      if (rows.length < PAGE_SIZE) break;
    }
  }
  const wantedDates = new Set(selected.map((s) => s.date));
  const barsByTime = new Map<number, SourceBar>();
  for (const row of allRows) {
    const bar = barFromMarketRow(row);
    if (bar && wantedDates.has(sessionDate(bar.time))) barsByTime.set(bar.time, bar);
  }
  const bars = [...barsByTime.values()].sort((a, b) => a.time - b.time);
  return { ok: true, symbol: "MES", sessionsRequested: sessionsCount, sessionsLoaded: selected.length, totalAvailableSessions, dateRange: { from: selected[0].date, to: selected[selected.length - 1].date }, sessions: selected, bars };
}

export async function importArchiveIntoBarStore(
  payload: Extract<ArchiveLoadResult, { ok: true }>,
  options: { cache?: SessionCache; now?: number } = {},
): Promise<ArchiveImportSummary> {
  const cache = options.cache ?? defaultSessionCache;
  const now = options.now ?? Date.now();
  const byDate = new Map<string, SourceBar[]>();
  for (const bar of payload.bars) {
    const d = sessionDate(bar.time);
    const list = byDate.get(d);
    if (list) list.push(bar);
    else byDate.set(d, [bar]);
  }
  const metaByDate = new Map(payload.sessions.map((s) => [s.date, s]));
  let sessionsCached = 0;
  for (const [date, sessionBars] of byDate.entries()) {
    if (!isCacheable(date, now)) continue;
    const window = sessionWindow(date);
    const existing = await readSessionEntry(cache, window);
    const clean = cleanCandles(sessionBars, window).bars;
    if (!clean.length) continue;
    const merged = mergeBars1m(existing?.bars ?? [], clean, window);
    const incomingCov: CoveredRange[] = metaByDate.get(date)?.status === "complete"
      ? [[window.from, window.to]]
      : merged.map((bar): CoveredRange => [bar.time, bar.time + MINUTE_MS]);
    await writeSessionEntry(cache, window, merged, mergeCoveredRanges([...(existing?.covered ?? []), ...incomingCov]), now);
    sessionsCached += 1;
  }
  return { sessionsCached, sessionsTotal: payload.sessionsLoaded, barsImported: payload.bars.length, dateRange: payload.dateRange };
}

export async function fetchAndImportMesArchive(sessions = DEFAULT_ARCHIVE_SESSIONS): Promise<
  | { ok: true; payload: Extract<ArchiveLoadResult, { ok: true }>; summary: ArchiveImportSummary }
  | { ok: false; reason: ArchiveErrorReason; detail: string }
> {
  let accessToken: string | null = null;
  if (supabaseAdapterOn()) {
    try {
      const mod = await import("../persistence/supabase-client.ts");
      accessToken = (await mod.getBrowserSupabaseClient().auth.getSession()).data.session?.access_token ?? null;
    } catch { accessToken = null; }
  }
  const res = await fetch(`/api/strategy-lab/archive?symbol=MES&sessions=${sessions}`, {
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    cache: "no-store",
  });
  let body: ArchiveLoadResult;
  try { body = await res.json() as ArchiveLoadResult; } catch { return { ok: false, reason: "upstream", detail: `Archive returned HTTP ${res.status}` }; }
  if (!body.ok) return body;
  return { ok: true, payload: body, summary: await importArchiveIntoBarStore(body) };
}
