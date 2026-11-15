// Server-side market-data resolution: prefer the candle archive, fall back to Yahoo.
// When the archive is not configured, this is the existing Yahoo-only path.

import { FUTURES_SPECS } from "../trades.ts";
import type { Candle, CandleSource, Timeframe } from "../trades.ts";
import type { ArchiveClient } from "../candle-archive.ts";
import { toArchiveTicker } from "../archive-config.ts";
import { YahooFinanceProvider } from "./yahoo.ts";

export const MARKET_DATA_ATTEMPTS: Array<{ timeframe: Timeframe; padHours: number }> = [
  { timeframe: "1m", padHours: 15 },
  { timeframe: "5m", padHours: 15 },
  { timeframe: "1h", padHours: 72 },
];

export interface MarketDataSuccess {
  candles: Candle[];
  source: CandleSource;
  ticker: string;
  baseTimeframe: Timeframe;
}

export interface MarketDataFailure {
  error: string;
  status: number;
}

export type MarketDataResult = MarketDataSuccess | MarketDataFailure;

export function isMarketDataFailure(result: MarketDataResult): result is MarketDataFailure {
  return "error" in result;
}

export interface ResolveMarketDataInput {
  symbol: string;
  entryTime: number;
  exitTime: number;
}

export interface ResolveMarketDataDeps {
  archive?: ArchiveClient | null;
  yahoo?: Pick<YahooFinanceProvider, "getCandles" | "resolveProviderSymbol">;
}

export async function resolveMarketCandles(
  input: ResolveMarketDataInput,
  deps: ResolveMarketDataDeps = {},
): Promise<MarketDataResult> {
  const symbol = input.symbol.toUpperCase();
  const spec = FUTURES_SPECS[symbol];
  if (!spec) return { error: "A supported symbol, entry and exit are required", status: 400 };
  if (!Number.isFinite(input.entryTime) || !Number.isFinite(input.exitTime) || input.exitTime <= input.entryTime) {
    return { error: "The trade time range is invalid", status: 400 };
  }

  const yahoo = deps.yahoo ?? new YahooFinanceProvider();
  const ticker = yahoo.resolveProviderSymbol(symbol);
  const archive = deps.archive ?? null;
  const archiveTicker = toArchiveTicker(symbol);

  if (archive && archiveTicker) {
    for (const { timeframe, padHours } of MARKET_DATA_ATTEMPTS) {
      const from = new Date(input.entryTime - padHours * 3_600_000);
      const to = new Date(input.exitTime + padHours * 3_600_000);
      const candles = await archive.getCandles({ symbol: archiveTicker, timeframe, from, to });
      if (candles.length >= 4) {
        return { candles, source: "Archive", ticker, baseTimeframe: timeframe };
      }
    }
  }

  try {
    for (const { timeframe, padHours } of MARKET_DATA_ATTEMPTS) {
      const from = new Date(input.entryTime - padHours * 3_600_000);
      const to = new Date(input.exitTime + padHours * 3_600_000);
      const candles = await yahoo.getCandles({ symbol, timeframe, from, to });
      if (candles.length >= 4) {
        return { candles, source: "Yahoo Finance", ticker, baseTimeframe: timeframe };
      }
    }
    return { error: "Yahoo Finance has no candles for this range", status: 404 };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Market data request failed", status: 502 };
  }
}
