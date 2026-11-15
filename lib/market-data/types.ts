import type { Candle, Timeframe } from "@/lib/trades";

// Names follow docs/01 §4A (interim canonical under OD-1).
export interface MarketDataQuery {
  /** Canonical symbol, e.g. `MES`. */
  symbol: string;
  timeframe: Timeframe;
  from: Date;
  to: Date;
}

export interface MarketDataProvider {
  readonly name: string;
  resolveProviderSymbol(canonicalSymbol: string): string;
  /** Cleaned bars inside `[from, to]`. An empty array means "nothing served", not an error. */
  getCandles(query: MarketDataQuery): Promise<Candle[]>;
  supportsTickData(): boolean;
}
