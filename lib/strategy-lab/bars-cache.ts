// SL-15a: the server-side 1m bar cache (docs/design-2026-11-24/09 §7.7, §11.2). Table `mogmine_bars_1m`, keyed
// (symbol, time), no user_id: market data, not user data.
// - Browser code only READS it (`readRemoteSessionBars1m`). The authenticated role has select-only grants.
// - Writes go through `upsertBars1mForArchive`, which takes a service_role client injected by a server job.
//   Never pass the browser client there: it has no write grant on this table.
// Volume 0 (Yahoo's first-bar artifact) and missing volume both map to null, which is "missing" on SourceBar.
import type { PersistResult } from "../persistence/contract.ts";
import type { DbError } from "../persistence/supabase-adapter.ts";
import { mapDbError } from "../persistence/supabase-adapter.ts";
import { computeMissingRanges, MINUTE_MS, mergeCoveredRanges, type BarWindow, type CoveredRange } from "./bar-coverage.ts";
import { isObject, labFail, supabaseAdapterOn, withLabSession, type LabClientOption } from "./persistence.ts";
import type { SourceBar } from "./types.ts";

export const BARS_1M_TABLE = "mogmine_bars_1m";
const ARCHIVE_CHUNK = 500;
const BAR_COLUMNS = "time,open,high,low,close,volume";

export type { BarWindow };

/** The service_role slice used by the archive job. `@supabase/supabase-js` satisfies it structurally. */
export interface ServiceBarsClientLike {
  from(table: string): {
    upsert(rows: Record<string, unknown>[], options: { onConflict: string }): PromiseLike<{ error: DbError | null }>;
  };
}

export interface ArchiveBarsInput {
  symbol: string;
  source: string;
  bars: readonly SourceBar[];
}

export interface ArchiveBarsResult { written: number; dropped: number }

/** Finite number from a number or a numeric string, else NaN. */
function toFinite(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
  if (typeof value === "string" && value.trim() !== "") return toFinite(Number(value));
  return NaN;
}

/** Volume as stored on SourceBar: positive finite numbers pass; null, 0, negative and non-finite mean missing. */
export function readVolume(value: unknown): number | null {
  const volume = toFinite(value);
  return Number.isFinite(volume) && volume > 0 ? volume : null;
}

/** Volume as written to the integer column. Same missing rule as readVolume, rounded to a whole number. */
export function archiveVolume(value: unknown): number | null {
  const volume = readVolume(value);
  if (volume === null) return null;
  const rounded = Math.round(volume);
  return rounded > 0 ? rounded : null;
}

/** One row as read from the table. Returns null for rows whose time or prices are not finite numbers. */
export function barFromRow(row: unknown): SourceBar | null {
  if (!isObject(row)) return null;
  const time = typeof row.time === "string" ? Date.parse(row.time) : NaN;
  const open = toFinite(row.open);
  const high = toFinite(row.high);
  const low = toFinite(row.low);
  const close = toFinite(row.close);
  if (![time, open, high, low, close].every(Number.isFinite)) return null;
  return { time, open, high, low, close, volume: readVolume(row.volume) };
}

/** OHLC sanity for archive input: finite prices with low <= min(open, close) and high >= max(open, close). */
function validOhlc(bar: SourceBar): boolean {
  return Number.isFinite(bar.time)
    && [bar.open, bar.high, bar.low, bar.close].every(Number.isFinite)
    && bar.low <= Math.min(bar.open, bar.close)
    && bar.high >= Math.max(bar.open, bar.close)
    && bar.low <= bar.high;
}

/**
 * Read one session window of 1m bars for a symbol, oldest first. Resolves to:
 * - `ok(null)` when the Supabase adapter is off and no client was injected (the caller falls back to IndexedDB);
 * - `ok(bars)` with missing volume as null on each SourceBar;
 * - `unavailable` when signed out, offline, or the table is not applied yet (42P01 / PGRST205).
 */
export async function readRemoteSessionBars1m(
  symbol: string,
  window: BarWindow,
  client?: LabClientOption,
): Promise<PersistResult<SourceBar[] | null>> {
  if (!client && !supabaseAdapterOn()) return { ok: true, value: null };
  if (!symbol || !Number.isFinite(window.from) || !Number.isFinite(window.to) || window.to <= window.from) {
    return labFail("invalid", "This bar window is empty.");
  }
  const result = await withLabSession<SourceBar[] | null>(client, async (db) => {
    const { data, error } = await db.from(BARS_1M_TABLE)
      .select(BAR_COLUMNS)
      .eq("symbol", symbol)
      .gte("time", new Date(window.from).toISOString())
      .lt("time", new Date(window.to).toISOString())
      .order("time", { ascending: true });
    if (error) return mapDbError(error);
    const rows = Array.isArray(data) ? data : [];
    return { ok: true, value: rows.flatMap((row) => barFromRow(row) ?? []) };
  });
  // Spec: signed-out reads are `unavailable` on this path (the caller falls back to IndexedDB).
  if (!result.ok && result.error.code === "unauthenticated") {
    return labFail("unavailable", "Sign in to read the bar cache.", undefined, result.error.cause);
  }
  return result;
}

/** Archive-row check: valid OHLC, then the mapped row for `mogmine_bars_1m`. Null when the bar is dropped. */
function archiveRow(bar: SourceBar, symbol: string, source: string, fetchedAt: string): Record<string, unknown> | null {
  if (!validOhlc(bar)) return null;
  return {
    symbol,
    time: new Date(bar.time).toISOString(),
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: archiveVolume(bar.volume),
    source,
    fetched_at: fetchedAt,
  };
}

/**
 * Upsert bars into `mogmine_bars_1m` with an injected service_role client. Invalid OHLC rows are dropped and counted.
 * When a batch repeats a bar time, the last one wins (a single upsert cannot touch the same key twice).
 */
export async function upsertBars1mForArchive(
  serviceClient: ServiceBarsClientLike,
  input: ArchiveBarsInput,
): Promise<PersistResult<ArchiveBarsResult>> {
  if (!input.symbol || !input.source) return labFail("invalid", "Archive bars need a symbol and a source.");
  const fetchedAt = new Date().toISOString();
  const byTime = new Map<string, Record<string, unknown>>();
  let dropped = 0;
  for (const bar of input.bars) {
    const row = archiveRow(bar, input.symbol, input.source, fetchedAt);
    if (!row) { dropped += 1; continue; }
    byTime.set(String(row.time), row);
  }
  const rows = [...byTime.values()];
  try {
    for (let start = 0; start < rows.length; start += ARCHIVE_CHUNK) {
      const chunk = rows.slice(start, start + ARCHIVE_CHUNK);
      const { error } = await serviceClient.from(BARS_1M_TABLE).upsert(chunk, { onConflict: "symbol,time" });
      if (error) return mapDbError(error);
    }
  } catch (error) {
    return labFail("unavailable", "Could not reach the bar archive. Try again.", undefined, error instanceof Error ? error.name : "unknown");
  }
  return { ok: true, value: { written: rows.length, dropped } };
}

export interface ArchiveTopUpDeps {
  /** service_role client, injected by the server job. Never the browser client (it has no write grant). */
  serviceClient: ServiceBarsClientLike;
  /** Existing rows for the window. Defaults to `readRemoteSessionBars1m` (the browser-safe read). */
  readExisting?: (symbol: string, window: BarWindow) => Promise<PersistResult<SourceBar[] | null>>;
  /** Fetches bars for one missing `[from, to)` sub-range only. Failures return an empty list. */
  fetchRange: (missing: BarWindow) => Promise<SourceBar[]>;
}

export interface ArchiveTopUpResult { ranges: number; fetched: number; written: number; dropped: number }

/**
 * Fill the gaps of one window in `mogmine_bars_1m` for a server job. Coverage comes from the existing rows (a bar at
 * minute t covers [t, t+1m)). `fetchRange` runs only for missing sub-ranges, and nothing is written when the window
 * is already complete. Upserts only add or update rows (onConflict symbol,time); no row is ever deleted.
 */
export async function topUpArchiveSessionBars1m(
  deps: ArchiveTopUpDeps,
  input: { symbol: string; window: BarWindow; source: string },
): Promise<PersistResult<ArchiveTopUpResult>> {
  const read = deps.readExisting ?? readRemoteSessionBars1m;
  const existing = await read(input.symbol, input.window);
  if (!existing.ok) return existing;
  const covered: CoveredRange[] = mergeCoveredRanges((existing.value ?? []).map((bar): CoveredRange => [bar.time, bar.time + MINUTE_MS]));
  const missing = computeMissingRanges(input.window, covered);
  if (missing.length === 0) return { ok: true, value: { ranges: 0, fetched: 0, written: 0, dropped: 0 } };

  const fetched: SourceBar[] = [];
  for (const [from, to] of missing) fetched.push(...await deps.fetchRange({ from, to }));
  if (fetched.length === 0) return { ok: true, value: { ranges: missing.length, fetched: 0, written: 0, dropped: 0 } };
  const written = await upsertBars1mForArchive(deps.serviceClient, { symbol: input.symbol, source: input.source, bars: fetched });
  if (!written.ok) return written;
  return { ok: true, value: { ranges: missing.length, fetched: fetched.length, written: written.value.written, dropped: written.value.dropped } };
}
