import { DEFAULT_OWNER_USER_ID, FUTURES_SPECS, TradeRecord, classifyTrade } from "./trades";

type SeedTrade = Omit<TradeRecord, "trade_style" | "candles" | "user_id" | "yahoo_ticker" | "review_status">;

function hash(value: string) {
  let result = 2166136261;
  for (let i = 0; i < value.length; i += 1) result = Math.imul(result ^ value.charCodeAt(i), 16777619);
  return result >>> 0;
}

function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateCandles(trade: Pick<TradeRecord, "id" | "symbol" | "entry_time" | "exit_time" | "entry_price" | "exit_price">) {
  const entry = Date.parse(trade.entry_time);
  const exit = Date.parse(trade.exit_time);
  const start = entry - 900 * 60_000;
  const rng = random(hash(trade.id));
  const volatility = Math.max(Math.abs(trade.exit_price - trade.entry_price) / 8, trade.symbol.includes("NQ") ? 5 : 0.65);
  let previous = trade.entry_price + (rng() - 0.5) * volatility * 22;
  return Array.from({ length: 1801 }, (_, index) => {
    const time = start + index * 60_000;
    const progress = (time - entry) / Math.max(60_000, exit - entry);
    const anchor = progress < 0
      ? trade.entry_price - Math.sin(progress * 2.4) * volatility * 2.5
      : progress <= 1
        ? trade.entry_price + (trade.exit_price - trade.entry_price) * progress + Math.sin(progress * Math.PI * 3) * volatility * 0.45
        : trade.exit_price + Math.sin(progress * 1.7) * volatility * 1.7;
    const open = previous;
    const close = open * 0.22 + anchor * 0.78 + (rng() - 0.5) * volatility * 1.5;
    const candle = {
      time,
      open: Number(open.toFixed(2)),
      high: Number((Math.max(open, close) + rng() * volatility).toFixed(2)),
      low: Number((Math.min(open, close) - rng() * volatility).toFixed(2)),
      close: Number(close.toFixed(2)),
      volume: Math.round(90 + rng() * 1200),
    };
    previous = close;
    return candle;
  });
}

function makeTrade(seed: SeedTrade): TradeRecord {
  const base = {
    ...seed,
    user_id: DEFAULT_OWNER_USER_ID,
    yahoo_ticker: FUTURES_SPECS[seed.symbol]?.yahooTicker ?? seed.symbol,
    trade_style: classifyTrade(seed.entry_time, seed.exit_time),
    review_status: seed.note ? "tagged" as const : "new" as const,
  };
  return { ...base, candles: generateCandles(base) };
}

export const demoTrades: TradeRecord[] = [
  makeTrade({
    id: "mes-opening-scalp", symbol: "MES", direction: "LONG", quantity: 2,
    entry_time: "2026-11-10T15:43:00.000Z", exit_time: "2026-11-10T15:45:00.000Z",
    entry_price: 6844.25, exit_price: 6849, stop_loss_price: 6841.25,
    planned_target_price: 6850.25, key_level_price: 6839.5,
    note: "Opening pullback held above the first impulse. Took the reclaim with buyers stepping back in. Next time: enter on the candle close instead of anticipating it.",
  }),
  makeTrade({
    id: "mnq-trend-hold", symbol: "MNQ", direction: "SHORT", quantity: 1,
    entry_time: "2026-11-12T16:12:00.000Z", exit_time: "2026-11-12T17:42:00.000Z",
    entry_price: 25784, exit_price: 25714, stop_loss_price: 25811,
    planned_target_price: 25690, key_level_price: 25750,
    note: "Failed reclaim after the morning breakdown. Held through two pullbacks because lower highs stayed intact. I managed the stop well but took profit before the planned target.",
  }),
  makeTrade({
    id: "mes-failed-reclaim", symbol: "MES", direction: "LONG", quantity: 2,
    entry_time: "2026-11-13T15:51:00.000Z", exit_time: "2026-11-13T16:08:00.000Z",
    entry_price: 6827.5, exit_price: 6822.25, stop_loss_price: 6821.5,
    planned_target_price: null, key_level_price: 6832,
    note: "Bought a reclaim before it was confirmed while volume was fading. The level never held. Next time: wait for a close above 6832 and a successful retest.",
  }),
];
