// Day/session candle windows cached on the device (docs/20 §2.2, IK-1).
import { idbGet, idbSet } from "./idb.ts";
import { asMixedCandle, mixedCoverage } from "./mixed-resolution.ts";
import type { MixedCandle, ResolutionUsage } from "./mixed-resolution.ts";
import { TIMEFRAMES } from "./trades.ts";
import type { Candle, Timeframe } from "./trades.ts";

const MINUTE_MS = 60_000;
const FRESH_EXIT_MS = 60 * MINUTE_MS;

export interface DayCandles {
  /** Legacy cache rows may be plain uniform candles; mixed session rows add `minutes` and `fillFrom`. */
  candles: Candle[];
  baseTimeframe: Timeframe;
  fetchedAt: number;
  complete?: boolean;
  missingMinutes?: number;
  usage?: ResolutionUsage[];
  /** One bounded retry of a cached window that needed lower resolution or had legacy interior holes. */
  gapRefetches?: number;
  from?: number;
  to?: number;
}

export function dayCandleKey(symbol: string, fromMs: number, toMs: number, mixed = false) {
  return `day:${mixed ? "mixed:" : ""}${symbol.toUpperCase()}:${fromMs}:${toMs}`;
}

/** Whether a cached day window can be used without asking the network again. Pure, for tests. */
export function dayCandlesUsable(stored: DayCandles | undefined, windowEndMs: number, now: number, symbol?: string, windowStartMs?: number) {
  if (!stored || !Array.isArray(stored.candles) || !stored.candles.length) return false;
  if (symbol && windowStartMs != null) {
    const mixed = stored.candles.map((bar) => "minutes" in bar && "fillFrom" in bar
      ? bar as MixedCandle : asMixedCandle(bar, stored.baseTimeframe));
    const coverage = mixedCoverage(mixed, symbol, windowStartMs, windowEndMs);
    const needsRepair = !coverage.complete || mixed.some((bar) => bar.fillFrom !== "1m");
    if (needsRepair && (stored.gapRefetches ?? 0) < 1) return false;
  }
  if (stored.fetchedAt - windowEndMs >= FRESH_EXIT_MS) return true;
  return now - stored.fetchedAt < MINUTE_MS;
}

export interface DayCandleDependencies {
  read(key: string): Promise<DayCandles | undefined>;
  write(key: string, value: DayCandles): Promise<unknown>;
  request(symbol: string, fromMs: number, toMs: number, mixed?: boolean): Promise<{
    candles?: Candle[]; baseTimeframe?: Timeframe; complete?: boolean; missingMinutes?: number; usage?: ResolutionUsage[];
  }>;
  now(): number;
}

/** Bars for one window: usable cache, else network, else stale cache, else an error. */
export async function loadDayCandles(
  symbol: string, fromMs: number, toMs: number, dependencies?: DayCandleDependencies, mixed = false,
): Promise<DayCandles> {
  const deps: DayCandleDependencies = dependencies ?? {
    read: (key) => idbGet<DayCandles>(key),
    write: (key, value) => idbSet(key, value),
    request: async (requestSymbol, from, to, wantsMixed) => {
      const params = new URLSearchParams({ symbol: requestSymbol, from: new Date(from).toISOString(), to: new Date(to).toISOString() });
      if (wantsMixed) params.set("mixed", "1");
      const response = await fetch(`/api/market-data?${params}`);
      if (!response.ok) throw new Error(response.status === 404 ? "no-bars" : "unavailable");
      return response.json();
    },
    now: Date.now,
  };
  const key = dayCandleKey(symbol, fromMs, toMs, mixed);
  const cached = await deps.read(key).catch(() => undefined);
  if (dayCandlesUsable(cached, toMs, deps.now(), mixed ? symbol : undefined, mixed ? fromMs : undefined)) return cached!;
  try {
    const body = await deps.request(symbol, fromMs, toMs, mixed);
    if (!Array.isArray(body.candles) || !body.candles.length || !body.baseTimeframe || !TIMEFRAMES.includes(body.baseTimeframe)) throw new Error("no-bars");
    if (!mixed && cached && cached.candles.length > body.candles.length) return cached;
    const candles = body.candles.map((bar) => "minutes" in bar && "fillFrom" in bar
      ? bar as MixedCandle : asMixedCandle(bar, body.baseTimeframe!));
    const stored: DayCandles = {
      candles, baseTimeframe: body.baseTimeframe, fetchedAt: deps.now(), from: fromMs, to: toMs,
      complete: body.complete, missingMinutes: body.missingMinutes, usage: body.usage,
      gapRefetches: mixed && cached ? (cached.gapRefetches ?? 0) + 1 : 0,
    };
    await deps.write(key, stored).catch(() => undefined);
    return stored;
  } catch (error) {
    if (cached?.candles?.length) {
      if (mixed && (cached.gapRefetches ?? 0) < 1) {
        const bounded = { ...cached, gapRefetches: 1 };
        await deps.write(key, bounded).catch(() => undefined);
        return bounded;
      }
      return cached;
    }
    throw error instanceof Error ? error : new Error("unavailable");
  }
}
