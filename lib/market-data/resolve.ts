// Server-side market-data resolution: prefer the candle archive, fall back to Yahoo.
// When the archive is not configured, this is the Yahoo-only path.
//
// Which payload may be served follows the route rules that grew up on main (issue #90, AC-07,
// R-03c): a payload must cover the trade window, or at least anchor it — entry and exit bars
// present, interior gaps served as partial and counted — and an open trade needs only its
// entry bar. The archive is judged by the same rules as Yahoo; being stored does not make a
// thin set servable. An archive read failure degrades to Yahoo rather than failing the chart.

import { FUTURES_SPECS, TIMEFRAME_MINUTES } from "../trades.ts";
import type { Candle, CandleSource, Timeframe } from "../trades.ts";
import type { ArchiveClient } from "../candle-archive.ts";
import { toArchiveTicker } from "../archive-config.ts";
import { sessionCloseUtc } from "../session.ts";
import { YahooFinanceProvider } from "./yahoo.ts";
import { anchorsTradeWindow, coversTradeWindow, tradeWindowCoverage } from "./coverage.ts";

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
  /** True when the payload anchors the trade but skips bars inside the hold (AC-07). */
  partial?: boolean;
  /** How many expected inside bars are missing, when `partial`. */
  missingBars?: number;
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
  /** Null for an open trade (R-03c): candles run from before the entry to now. */
  exitTime: number | null;
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
  if (!Number.isFinite(input.entryTime) || (input.exitTime != null && (!Number.isFinite(input.exitTime) || input.exitTime <= input.entryTime))) {
    return { error: "The trade time range is invalid", status: 400 };
  }

  const yahoo = deps.yahoo ?? new YahooFinanceProvider();
  const ticker = yahoo.resolveProviderSymbol(symbol);
  const archive = deps.archive ?? null;
  const archiveTicker = toArchiveTicker(symbol);
  const exitTime = input.exitTime;

  if (exitTime == null && input.entryTime >= Date.now()) {
    return { error: "The entry is in the future", status: 400 };
  }

  try {
    for (const { timeframe, padHours } of MARKET_DATA_ATTEMPTS) {
      const from = new Date(input.entryTime - padHours * 3_600_000);
      // Evening-session exits can be more than 15 hours before their assigned session close.
      // Include one full bar beyond 17:00 ET because Yahoo's period2 is an exclusive boundary.
      const to = exitTime == null
        ? new Date()
        : new Date(Math.max(exitTime + padHours * 3_600_000, sessionCloseUtc(exitTime) + TIMEFRAME_MINUTES[timeframe] * 60_000));

      let partial: MarketDataSuccess | null = null;
      const sources: Array<{ source: CandleSource; fetch: () => Promise<Candle[]> }> = [];
      if (archive && archiveTicker) {
        sources.push({
          source: "Archive",
          fetch: async () => {
            try {
              return await archive.getCandles({ symbol: archiveTicker, timeframe, from, to });
            } catch {
              return []; // A broken archive degrades to Yahoo; it never breaks the chart.
            }
          },
        });
      }
      sources.push({ source: "Yahoo Finance", fetch: () => yahoo.getCandles({ symbol, timeframe, from, to }) });

      for (const { source, fetch } of sources) {
        const candles = await fetch();
        if (exitTime == null) {
          if (anchorsTradeWindow(candles, input.entryTime, null, timeframe, symbol)) {
            return { candles, source, ticker, baseTimeframe: timeframe };
          }
          continue;
        }
        if (coversTradeWindow(candles, input.entryTime, exitTime, timeframe, symbol)) {
          return { candles, source, ticker, baseTimeframe: timeframe };
        }
        if (partial == null && anchorsTradeWindow(candles, input.entryTime, exitTime, timeframe, symbol)) {
          const { missingInside } = tradeWindowCoverage(candles, input.entryTime, exitTime, timeframe, symbol);
          partial = { candles, source, ticker, baseTimeframe: timeframe, partial: true, missingBars: missingInside.length };
        }
      }
      if (partial) return partial;
    }
    return { error: "Yahoo Finance has no candles for this range", status: 404 };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Market data request failed", status: 502 };
  }
}
