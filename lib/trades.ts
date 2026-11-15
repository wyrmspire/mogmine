export type TradeDirection = "LONG" | "SHORT";
export type TradeStyle = "scalp" | "session_90m" | "investment";
export type Timeframe = "1m" | "5m" | "15m" | "1h" | "8h";

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface TradeRecord {
  id: string;
  user_id: string;
  symbol: string;
  yahoo_ticker: string;
  direction: TradeDirection;
  trade_style: TradeStyle;
  entry_time: string;
  exit_time: string;
  entry_price: number;
  exit_price: number;
  stop_loss_price: number | null;
  planned_target_price: number | null;
  key_level_price: number | null;
  quantity: number;
  note: string;
  review_status: "new" | "tagged" | "reviewed";
  candle_source?: "Yahoo Finance" | "Demo fixture";
  candles: Candle[];
}

export const DEFAULT_OWNER_USER_ID = "demo-owner";

export const FUTURES_SPECS: Record<string, { tickSize: number; pointValueUsd: number; yahooTicker: string }> = {
  MES: { tickSize: 0.25, pointValueUsd: 5, yahooTicker: "ES=F" },
  ES: { tickSize: 0.25, pointValueUsd: 50, yahooTicker: "ES=F" },
  MNQ: { tickSize: 0.25, pointValueUsd: 2, yahooTicker: "NQ=F" },
  NQ: { tickSize: 0.25, pointValueUsd: 20, yahooTicker: "NQ=F" },
  MYM: { tickSize: 1, pointValueUsd: 0.5, yahooTicker: "YM=F" },
  M2K: { tickSize: 0.1, pointValueUsd: 5, yahooTicker: "RTY=F" },
  MGC: { tickSize: 0.1, pointValueUsd: 10, yahooTicker: "GC=F" },
  MCL: { tickSize: 0.01, pointValueUsd: 100, yahooTicker: "CL=F" },
};

export function classifyTrade(entry: string, exit: string): TradeStyle {
  const holdSeconds = Math.max(1, Math.round((Date.parse(exit) - Date.parse(entry)) / 1000));
  if (holdSeconds < 15 * 60) return "scalp";
  if (holdSeconds <= 2 * 60 * 60) return "session_90m";
  return "investment";
}

export function defaultTimeframe(style: TradeStyle): Timeframe {
  return style === "scalp" ? "1m" : style === "session_90m" ? "5m" : "1h";
}

export function pointValue(trade: TradeRecord) {
  return FUTURES_SPECS[trade.symbol]?.pointValueUsd ?? 1;
}

export function tradePnl(trade: TradeRecord) {
  const spec = FUTURES_SPECS[trade.symbol] ?? { tickSize: 0.01, pointValueUsd: 1 };
  const entryTicks = Math.round(trade.entry_price / spec.tickSize);
  const exitTicks = Math.round(trade.exit_price / spec.tickSize);
  const signedTicks = (exitTicks - entryTicks) * (trade.direction === "LONG" ? 1 : -1);
  return signedTicks * spec.tickSize * spec.pointValueUsd * trade.quantity;
}

export function rMultiple(trade: TradeRecord) {
  if (trade.stop_loss_price == null) return null;
  const risk = Math.abs(trade.entry_price - trade.stop_loss_price);
  if (!risk) return null;
  const reward = (trade.exit_price - trade.entry_price) * (trade.direction === "LONG" ? 1 : -1);
  return reward / risk;
}

export function aggregateCandles(candles: Candle[], timeframe: Timeframe): Candle[] {
  const minutes = { "1m": 1, "5m": 5, "15m": 15, "1h": 60, "8h": 480 }[timeframe];
  if (minutes === 1) return candles;
  const bucketMs = minutes * 60_000;
  const result: Candle[] = [];
  for (const bar of candles) {
    const time = Math.floor(bar.time / bucketMs) * bucketMs;
    const current = result.at(-1);
    if (!current || current.time !== time) result.push({ ...bar, time });
    else {
      current.high = Math.max(current.high, bar.high);
      current.low = Math.min(current.low, bar.low);
      current.close = bar.close;
      current.volume += bar.volume;
    }
  }
  return result;
}

export function visibleWindow(trade: TradeRecord, timeframe: Timeframe) {
  const bars = aggregateCandles(trade.candles, timeframe);
  const entry = Date.parse(trade.entry_time);
  const exit = Date.parse(trade.exit_time);
  const before = trade.trade_style === "scalp" ? 35 : trade.trade_style === "session_90m" ? 90 : 480;
  const after = trade.trade_style === "scalp" ? 20 : trade.trade_style === "session_90m" ? 30 : 240;
  const selected = bars.filter((bar) => bar.time >= entry - before * 60_000 && bar.time <= exit + after * 60_000);
  return selected.length >= 4 ? selected : bars;
}

export function money(value: number) {
  return `${value >= 0 ? "+" : "−"}$${Math.abs(value).toFixed(2)}`;
}

export function price(value: number | null) {
  return value == null ? "—" : value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function duration(trade: TradeRecord) {
  const seconds = Math.max(1, Math.round((Date.parse(trade.exit_time) - Date.parse(trade.entry_time)) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return seconds % 60 ? `${minutes}m ${seconds % 60}s` : `${minutes}m`;
}
