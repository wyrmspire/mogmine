import { FUTURES_SPECS } from "../trades.ts";
import type { Candle } from "../trades.ts";
import type { MarketDataProvider, MarketDataQuery } from "./types.ts";

interface YahooChartResponse {
  chart?: {
    error?: { description?: string } | null;
    result?: Array<{
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          open?: Array<number | null>;
          high?: Array<number | null>;
          low?: Array<number | null>;
          close?: Array<number | null>;
          volume?: Array<number | null>;
        }>;
      };
    }>;
  };
}

const INTERVAL = { "1m": "1m", "5m": "5m", "15m": "15m", "1h": "60m" } as const;

export class YahooFinanceProvider implements MarketDataProvider {
  readonly name = "yahoo_finance";

  /** Invariant 3 (OD-15): never the bare symbol. `MES` charts on `MES=F` and `MNQ` on `MNQ=F`, with no mini fallback. */
  resolveProviderSymbol(canonicalSymbol: string) {
    const spec = FUTURES_SPECS[canonicalSymbol.toUpperCase()];
    if (!spec) throw new Error(`Unsupported symbol ${canonicalSymbol}`);
    return spec.yahooTicker;
  }

  supportsTickData() { return false; }

  async getCandles({ symbol, timeframe, from, to }: MarketDataQuery): Promise<Candle[]> {
    const ticker = this.resolveProviderSymbol(symbol);
    const params = new URLSearchParams({
      interval: INTERVAL[timeframe],
      period1: String(Math.floor(from.getTime() / 1000)),
      period2: String(Math.floor(to.getTime() / 1000)),
      events: "history",
      includePrePost: "true",
    });
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?${params}`;
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 MogMine/1.0", Accept: "application/json" },
      next: { revalidate: 300 },
    });
    // 422: the range starts beyond what Yahoo serves for this interval. Not available, never retried (docs/10 §2).
    if (response.status === 422 || response.status === 404) return [];
    if (!response.ok) throw new Error(`Yahoo Finance returned ${response.status}`);

    const payload = await response.json() as YahooChartResponse;
    const result = payload.chart?.result?.[0];
    const quote = result?.indicators?.quote?.[0];
    if (payload.chart?.error) throw new Error(payload.chart.error.description || "Yahoo Finance error");
    if (!result?.timestamp || !quote) return [];

    // Clean before use: drop null-price rows and the stray row outside the window (AGENTS §3b-8).
    return result.timestamp.flatMap((timestamp, index): Candle[] => {
      const open = quote.open?.[index];
      const high = quote.high?.[index];
      const low = quote.low?.[index];
      const close = quote.close?.[index];
      if (open == null || high == null || low == null || close == null) return [];
      const time = timestamp * 1000;
      if (time < from.getTime() || time > to.getTime()) return [];
      return [{ time, open, high, low, close, volume: quote.volume?.[index] ?? 0 }];
    });
  }
}
