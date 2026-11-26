// TM-0: authenticated, read-only access to the shared 1m market archive (docs/26 CandleCacheRepository).
// The browser uses the anon key plus its signed-in session. No service-role credential is imported here.
import type { Candle } from "../trades.ts";
import type { DbError } from "./supabase-adapter.ts";

export const MARKET_CANDLES_TABLE = "mogmine_market_candles";
export const MARKET_ROLLS_TABLE = "mogmine_market_rolls";

export interface MarketRoll {
  sessionDate: string;
  fromContract: string;
  toContract: string;
}

export type ArchiveSource = "Databento" | "Yahoo" | "Archive";
export interface ArchiveCandles { candles: Candle[]; source: ArchiveSource; rolls: MarketRoll[] }

interface QueryLike extends PromiseLike<{ data: unknown; error: DbError | null }> {
  select(columns: string): QueryLike;
  eq(column: string, value: string): QueryLike;
  gte(column: string, value: string): QueryLike;
  lt(column: string, value: string): QueryLike;
  order(column: string, options: { ascending: boolean }): QueryLike;
}
export interface ArchiveClientLike { from(table: string): QueryLike }

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const finite = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : Number(value);

function candle(row: unknown): Candle | null {
  if (!object(row)) return null;
  const time = typeof row.ts === "string" ? Date.parse(row.ts) : NaN;
  const [open, high, low, close, volume] = [row.open, row.high, row.low, row.close, row.volume].map(finite);
  if (![time, open, high, low, close].every(Number.isFinite)) return null;
  return { time, open, high, low, close, volume: Number.isFinite(volume) && volume >= 0 ? volume : 0 };
}

function roll(row: unknown): MarketRoll | null {
  if (!object(row) || typeof row.session_date !== "string" || typeof row.from_contract !== "string" || typeof row.to_contract !== "string") return null;
  return { sessionDate: row.session_date, fromContract: row.from_contract, toContract: row.to_contract };
}

/** Null means "archive unavailable": callers continue to Yahoo/device fallback. */
export async function readArchiveCandles(
  symbol: string,
  from: number,
  to: number,
  client?: ArchiveClientLike,
): Promise<ArchiveCandles | null> {
  if (process.env.NEXT_PUBLIC_PERSISTENCE_ADAPTER !== "supabase" || !Number.isFinite(from) || !Number.isFinite(to) || to <= from) return null;
  try {
    const db = client ?? (await import("./supabase-client.ts")).getBrowserSupabase() as unknown as ArchiveClientLike;
    const start = new Date(from).toISOString();
    const end = new Date(to).toISOString();
    const rollEndDate = new Date(to + 86_400_000).toISOString().slice(0, 10);
    const [barsReply, rollsReply] = await Promise.all([
      db.from(MARKET_CANDLES_TABLE).select("ts,open,high,low,close,volume,source")
        .eq("symbol", symbol).eq("timeframe", "1m").gte("ts", start).lt("ts", end).order("ts", { ascending: true }),
      db.from(MARKET_ROLLS_TABLE).select("session_date,from_contract,to_contract")
        .eq("symbol", symbol).gte("session_date", start.slice(0, 10)).lt("session_date", rollEndDate).order("session_date", { ascending: true }),
    ]);
    if (barsReply.error || rollsReply.error || !Array.isArray(barsReply.data)) return null;
    const rows = barsReply.data.filter(object);
    const candles = rows.flatMap((row) => candle(row) ?? []);
    if (!candles.length) return null;
    const sources = new Set(rows.map((row) => row.source));
    const source: ArchiveSource = sources.size > 1 ? "Archive" : sources.has("databento") ? "Databento" : "Yahoo";
    return { candles, source, rolls: Array.isArray(rollsReply.data) ? rollsReply.data.flatMap((row) => roll(row) ?? []) : [] };
  } catch {
    return null;
  }
}
