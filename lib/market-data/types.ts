import type { Candle } from "@/lib/trades";

export interface MarketDataRequest {
  ticker: string;
  start: Date;
  end: Date;
}

export interface MarketDataProvider {
  getCandles(request: MarketDataRequest): Promise<Candle[]>;
}
