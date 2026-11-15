import type { Candle } from "@/lib/trades";
import type { MarketDataProvider, MarketDataRequest } from "./types";

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

export class YahooFinanceProvider implements MarketDataProvider {
  async getCandles({ ticker, start, end }: MarketDataRequest): Promise<Candle[]> {
    const params = new URLSearchParams({
      interval: "1m",
      period1: String(Math.floor(start.getTime() / 1000)),
      period2: String(Math.floor(end.getTime() / 1000)),
      events: "history",
      includePrePost: "true",
    });
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?${params}`;
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 MogMine/1.0", Accept: "application/json" },
      next: { revalidate: 300 },
    });
    if (!response.ok) throw new Error(`Yahoo Finance returned ${response.status}`);

    const payload = await response.json() as YahooChartResponse;
    const result = payload.chart?.result?.[0];
    const quote = result?.indicators?.quote?.[0];
    if (payload.chart?.error) throw new Error(payload.chart.error.description || "Yahoo Finance error");
    if (!result?.timestamp || !quote) return [];

    return result.timestamp.flatMap((timestamp, index): Candle[] => {
      const open = quote.open?.[index];
      const high = quote.high?.[index];
      const low = quote.low?.[index];
      const close = quote.close?.[index];
      if ([open, high, low, close].some((value) => value == null)) return [];
      const time = timestamp * 1000;
      if (time < start.getTime() || time > end.getTime()) return [];
      return [{ time, open: open!, high: high!, low: low!, close: close!, volume: quote.volume?.[index] ?? 0 }];
    });
  }
}
