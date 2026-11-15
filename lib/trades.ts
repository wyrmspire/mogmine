// Core trade types and money math. Pure: no I/O, no DOM, no imports.
// Names follow docs/06 (interim canonical under OD-1).

export type TradeDirection = "LONG" | "SHORT";
export type TradeStyle = "scalp" | "session_90m" | "investment";
export type Timeframe = "1m" | "5m" | "15m" | "1h";
export type ReviewStatus = "new" | "tagged" | "reviewed";
export type CandleSource = "Yahoo Finance";

export const TIMEFRAMES: Timeframe[] = ["1m", "5m", "15m", "1h"];
export const TIMEFRAME_MINUTES: Record<Timeframe, number> = { "1m": 1, "5m": 5, "15m": 15, "1h": 60 };
export const MIN_FITTED_BARS = 30;

export interface Candle {
  /** Bar open time, UTC milliseconds. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface PriceRange {
  minValue: number;
  maxValue: number;
}

/** Extend an autoscale range with every finite required price. */
export function includeInPriceRange(base: PriceRange | null, required: Array<number | null | undefined>): PriceRange | null {
  const prices = required.filter((value): value is number => value != null && Number.isFinite(value));
  if (!prices.length) return base;
  return {
    minValue: Math.min(base?.minValue ?? Infinity, ...prices),
    maxValue: Math.max(base?.maxValue ?? -Infinity, ...prices),
  };
}

/** One checklist rule, frozen on the trade when the playbook is chosen (UX-50). */
export interface ChecklistItem {
  id: string;
  label: string;
  checked: boolean;
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
  /** Free-text review note (Simple Mode). */
  note: string;
  review_status: ReviewStatus;
  playbook_id: string | null;
  quick_tags: string[];
  checklist_state: ChecklistItem[];
  pre_trade_thesis: string;
  management_notes: string;
  post_exit_notes: string;
  flagged: boolean;
  /** Blind review answer, given before the outcome was shown (docs/13 BET-03). */
  take_again: "yes" | "smaller" | "pass" | null;
  take_again_at: string | null;
  /** Fixture or tool-made trade. Never counted in statistics (docs/10 §5). */
  is_sample: boolean;
  /** ~40 closes around the trade for list thumbnails, so lists never load candles (B-42). */
  sparkline: number[];
  /** Where the candles last came from. The candle cache is the live truth; this is a hint for lists. */
  candle_source?: CandleSource;
}

export const DEFAULT_OWNER_USER_ID = "demo-owner";

export interface FuturesContractSpec {
  tickSize: number;
  pointValueUsd: number;
  yahooTicker: string;
}

export const FUTURES_SPECS: Record<string, FuturesContractSpec> = {
  MES: { tickSize: 0.25, pointValueUsd: 5, yahooTicker: "MES=F" },
  ES: { tickSize: 0.25, pointValueUsd: 50, yahooTicker: "ES=F" },
  MNQ: { tickSize: 0.25, pointValueUsd: 2, yahooTicker: "MNQ=F" },
  NQ: { tickSize: 0.25, pointValueUsd: 20, yahooTicker: "NQ=F" },
  MYM: { tickSize: 1, pointValueUsd: 0.5, yahooTicker: "YM=F" },
  M2K: { tickSize: 0.1, pointValueUsd: 5, yahooTicker: "RTY=F" },
  MGC: { tickSize: 0.1, pointValueUsd: 10, yahooTicker: "GC=F" },
  MCL: { tickSize: 0.01, pointValueUsd: 100, yahooTicker: "CL=F" },
};

const FALLBACK_SPEC: FuturesContractSpec = { tickSize: 0.01, pointValueUsd: 1, yahooTicker: "" };

export function specFor(symbol: string): FuturesContractSpec {
  return FUTURES_SPECS[symbol] ?? FALLBACK_SPEC;
}

/** Price as an integer number of ticks. All money math goes through this (B-31). */
export function toTicks(priceValue: number, symbol: string) {
  return Math.round(priceValue / specFor(symbol).tickSize);
}

/** Snap a price to the contract's tick grid. */
export function snapToTick(priceValue: number, symbol: string) {
  const { tickSize } = specFor(symbol);
  const decimals = tickDecimals(tickSize);
  return Number((Math.round(priceValue / tickSize) * tickSize).toFixed(decimals));
}

export function tickDecimals(tickSize: number) {
  const text = String(tickSize);
  const dot = text.indexOf(".");
  return dot === -1 ? 0 : text.length - dot - 1;
}

/** Dollars per tick per contract, in integer cents. */
function tickValueCents(symbol: string) {
  const spec = specFor(symbol);
  return Math.round(spec.tickSize * spec.pointValueUsd * 100);
}

type Priced = Pick<TradeRecord, "symbol" | "direction" | "entry_price" | "exit_price" | "quantity">;

/** Signed ticks captured per contract: positive when the trade made money. */
export function tradeTicks(trade: Priced) {
  const signed = toTicks(trade.exit_price, trade.symbol) - toTicks(trade.entry_price, trade.symbol);
  return trade.direction === "LONG" ? signed : -signed;
}

/** Signed points captured per contract. */
export function tradePoints(trade: Priced) {
  const { tickSize } = specFor(trade.symbol);
  return Number((tradeTicks(trade) * tickSize).toFixed(tickDecimals(tickSize)));
}

/** Gross P&L in dollars, computed in integer ticks and cents. */
export function tradePnl(trade: Priced) {
  return (tradeTicks(trade) * trade.quantity * tickValueCents(trade.symbol)) / 100;
}

/** Initial risk in dollars, or null without a stop. */
export function initialRiskUsd(trade: Priced & Pick<TradeRecord, "stop_loss_price">) {
  if (trade.stop_loss_price == null) return null;
  const riskTicks = Math.abs(toTicks(trade.entry_price, trade.symbol) - toTicks(trade.stop_loss_price, trade.symbol));
  if (!riskTicks) return null;
  return (riskTicks * trade.quantity * tickValueCents(trade.symbol)) / 100;
}

/** R = P&L ÷ initial risk. `null` without a stop, never 0 (AGENTS §3b-4, OD-10). */
export function rMultiple(trade: Priced & Pick<TradeRecord, "stop_loss_price">) {
  if (trade.stop_loss_price == null) return null;
  const riskTicks = Math.abs(toTicks(trade.entry_price, trade.symbol) - toTicks(trade.stop_loss_price, trade.symbol));
  if (!riskTicks) return null;
  return tradeTicks(trade) / riskTicks;
}

export function holdSeconds(trade: Pick<TradeRecord, "entry_time" | "exit_time">) {
  return Math.max(1, Math.round((Date.parse(trade.exit_time) - Date.parse(trade.entry_time)) / 1000));
}

export function classifyTrade(entry: string, exit: string): TradeStyle {
  const seconds = Math.max(1, Math.round((Date.parse(exit) - Date.parse(entry)) / 1000));
  if (seconds < 15 * 60) return "scalp";
  if (seconds <= 2 * 60 * 60) return "session_90m";
  return "investment";
}

/** Pick an initial timeframe that puts ordinary intraday holds in roughly 8–40 trade bars. */
export function defaultTimeframe(holdDurationSeconds: number): Timeframe {
  if (holdDurationSeconds <= 40 * 60) return "1m";
  if (holdDurationSeconds <= 3 * 60 * 60) return "5m";
  if (holdDurationSeconds <= 10 * 60 * 60) return "15m";
  return "1h";
}

export function aggregateCandles(candles: Candle[], timeframe: Timeframe): Candle[] {
  const minutes = TIMEFRAME_MINUTES[timeframe];
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

/** Open time of the bar that contains `instant`, or the nearest bar when the exact one is missing (B-23). */
export function snapToBar(times: number[], instant: number, timeframe: Timeframe) {
  if (!times.length) return instant;
  const bucketMs = TIMEFRAME_MINUTES[timeframe] * 60_000;
  const open = Math.floor(instant / bucketMs) * bucketMs;
  let lo = 0;
  let hi = times.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] < open) lo = mid + 1;
    else hi = mid;
  }
  if (times[lo] === open) return open;
  const before = times[Math.max(0, lo - 1)];
  const after = times[lo];
  return Math.abs(before - open) <= Math.abs(after - open) ? before : after;
}

export interface FittedWindow {
  /** UTC milliseconds. */
  start: number;
  /** UTC milliseconds. */
  end: number;
  beforeBars: number;
  holdBars: number;
  afterBars: number;
  visibleBars: number;
}

/**
 * Fit a trade from its own duration: 30% of the view before entry, 50% in the
 * trade, and 20% after exit. This is continuous; stored style never affects it.
 */
export function fitWindow(entryTime: string, exitTime: string, timeframe: Timeframe, minimumBars = MIN_FITTED_BARS): FittedWindow {
  const entry = Date.parse(entryTime);
  const holdMs = Math.max(1000, Date.parse(exitTime) - entry);
  const barMs = TIMEFRAME_MINUTES[timeframe] * 60_000;
  const holdBars = holdMs / barMs;
  const visibleBars = Math.max(holdBars * 2, minimumBars);
  const contextBars = visibleBars - holdBars;
  const beforeBars = contextBars * 0.6;
  const afterBars = contextBars * 0.4;
  return {
    start: entry - beforeBars * barMs,
    end: entry + holdMs + afterBars * barMs,
    beforeBars,
    holdBars,
    afterBars,
    visibleBars,
  };
}

export interface Excursions {
  /** Worst price against the position during the hold. */
  maePrice: number;
  /** Best price in favour of the position during the hold. */
  mfePrice: number;
}

function pricesMatch(a: number, b: number, tickSize: number) {
  return Math.round(a / tickSize) === Math.round(b / tickSize);
}

/** High/low of an entry bar, or null when the wicks are not provably after the fill. */
function provableEntryRange(bar: Candle, fillPrice: number, tickSize: number): { high: number; low: number } | null {
  const atOpen = pricesMatch(fillPrice, bar.open, tickSize);
  const atClose = pricesMatch(fillPrice, bar.close, tickSize);
  // A fill at the close cannot have a later high or low in this bar. Mid-bar fills are unprovable.
  return atOpen && !atClose ? { high: bar.high, low: bar.low } : null;
}

/** High/low of an exit bar, or null when the wicks are not provably before the fill. */
function provableExitRange(bar: Candle, fillPrice: number, tickSize: number): { high: number; low: number } | null {
  const atOpen = pricesMatch(fillPrice, bar.open, tickSize);
  const atClose = pricesMatch(fillPrice, bar.close, tickSize);
  return atClose && !atOpen ? { high: bar.high, low: bar.low } : null;
}

/**
 * MAE and MFE from bars in the hold.
 *
 * Only completed bars (the same rule as the bar validator) and the provable side of the
 * entry and exit bars are counted. A long filled at a bar's close does not inherit that
 * bar's earlier high as profit. When fewer than two completed bars remain, this returns
 * null so callers can show "—" rather than a misleading number (B-33, issue #30).
 */
export function excursions(
  trade: Pick<TradeRecord, "direction" | "entry_time" | "exit_time" | "entry_price"> & Partial<Pick<TradeRecord, "exit_price" | "symbol">>,
  candles: Candle[],
  barMinutes = 1,
): Excursions | null {
  const entry = Date.parse(trade.entry_time);
  const exit = Date.parse(trade.exit_time);
  if (!Number.isFinite(entry) || !Number.isFinite(exit) || exit <= entry || barMinutes <= 0) return null;
  const barMs = barMinutes * 60_000;
  const tickSize = trade.symbol ? specFor(trade.symbol).tickSize : 1e-8;
  const entryBarTime = Math.floor(entry / barMs) * barMs;
  const exitBarTime = Math.floor(exit / barMs) * barMs;

  const complete: Candle[] = [];
  for (const bar of candles) {
    if (bar.time >= entry && bar.time + barMs <= exit) complete.push(bar);
  }
  if (complete.length < 2) return null;

  let high = trade.entry_price;
  let low = trade.entry_price;
  if (trade.exit_price != null) {
    high = Math.max(high, trade.exit_price);
    low = Math.min(low, trade.exit_price);
  }

  const include = (range: { high: number; low: number } | null) => {
    if (!range) return;
    high = Math.max(high, range.high);
    low = Math.min(low, range.low);
  };

  for (const bar of candles) {
    const isEntryBar = bar.time === entryBarTime;
    const isExitBar = bar.time === exitBarTime;
    const isComplete = bar.time >= entry && bar.time + barMs <= exit;
    if (isEntryBar) {
      include(provableEntryRange(bar, trade.entry_price, tickSize));
      continue;
    }
    if (isExitBar) {
      if (trade.exit_price != null) include(provableExitRange(bar, trade.exit_price, tickSize));
      continue;
    }
    if (isComplete) include(bar);
  }

  return trade.direction === "LONG" ? { maePrice: low, mfePrice: high } : { maePrice: high, mfePrice: low };
}

/** Planned reward ÷ initial risk, or null without a stop and target. */
export function plannedR(trade: Priced & Pick<TradeRecord, "stop_loss_price" | "planned_target_price">) {
  if (trade.stop_loss_price == null || trade.planned_target_price == null) return null;
  const riskTicks = Math.abs(toTicks(trade.entry_price, trade.symbol) - toTicks(trade.stop_loss_price, trade.symbol));
  if (!riskTicks) return null;
  const rewardTicks = trade.direction === "LONG"
    ? toTicks(trade.planned_target_price, trade.symbol) - toTicks(trade.entry_price, trade.symbol)
    : toTicks(trade.entry_price, trade.symbol) - toTicks(trade.planned_target_price, trade.symbol);
  return rewardTicks / riskTicks;
}

/**
 * A scratch is a result within 0.1R or 2 ticks of the entry, whichever is larger.
 * Without a stop, the threshold is 2 ticks.
 */
export function isScratch(trade: Priced & Partial<Pick<TradeRecord, "stop_loss_price">>) {
  const captured = Math.abs(tradeTicks(trade));
  const riskTicks = trade.stop_loss_price == null
    ? 0
    : Math.abs(toTicks(trade.entry_price, trade.symbol) - toTicks(trade.stop_loss_price, trade.symbol));
  const threshold = Math.max(riskTicks > 0 ? 0.1 * riskTicks : 0, 2);
  return captured <= threshold;
}

/** Exit flag text: TP or SL when the exit price equals that planned level, otherwise none. */
export function exitFlagReason(trade: Pick<TradeRecord, "symbol" | "exit_price" | "stop_loss_price" | "planned_target_price">): "TP" | "SL" | null {
  if (trade.planned_target_price != null && toTicks(trade.exit_price, trade.symbol) === toTicks(trade.planned_target_price, trade.symbol)) return "TP";
  if (trade.stop_loss_price != null && toTicks(trade.exit_price, trade.symbol) === toTicks(trade.stop_loss_price, trade.symbol)) return "SL";
  return null;
}

export interface AxisTag {
  price: number;
  title: string;
  color: string;
  lineVisible: boolean;
}

const AXIS_TITLE_ORDER = ["SL", "TP", "IN", "OUT", "KEY"];

function axisTitleRank(title: string) {
  const index = AXIS_TITLE_ORDER.indexOf(title);
  return index === -1 ? AXIS_TITLE_ORDER.length : index;
}

/** Merge axis tags that share a price (`SL · OUT`). */
export function mergeAxisTags(
  tags: Array<{ price: number | null | undefined; title: string; color: string; lineVisible?: boolean }>,
  symbol: string,
): AxisTag[] {
  const groups = new Map<number, AxisTag & { rank: number }>();
  for (const tag of tags) {
    if (tag.price == null || !Number.isFinite(tag.price)) continue;
    const key = toTicks(tag.price, symbol);
    const rank = axisTitleRank(tag.title);
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, { price: tag.price, title: tag.title, color: tag.color, lineVisible: !!tag.lineVisible, rank });
      continue;
    }
    const titles = existing.title.split(" · ");
    if (!titles.includes(tag.title)) titles.push(tag.title);
    titles.sort((a, b) => axisTitleRank(a) - axisTitleRank(b));
    existing.title = titles.join(" · ");
    existing.lineVisible = existing.lineVisible || !!tag.lineVisible;
    if (rank < existing.rank) {
      existing.price = tag.price;
      existing.color = tag.color;
      existing.rank = rank;
    }
  }
  return [...groups.values()].map(({ price, title, color, lineVisible }) => ({ price, title, color, lineVisible }));
}

/** ~`points` closes from just before the entry to just after the exit. */
export function buildSparkline(trade: Pick<TradeRecord, "entry_time" | "exit_time">, candles: Candle[], points = 40) {
  const entry = Date.parse(trade.entry_time);
  const exit = Date.parse(trade.exit_time);
  const pad = Math.max(10 * 60_000, (exit - entry) * 0.6);
  const window = candles.filter((bar) => bar.time >= entry - pad && bar.time <= exit + pad);
  if (window.length < 2) return [];
  const step = Math.max(1, window.length / points);
  const result: number[] = [];
  for (let index = 0; index < window.length; index += step) result.push(window[Math.floor(index)].close);
  const last = window[window.length - 1].close;
  if (result[result.length - 1] !== last) result.push(last);
  return result;
}

/** Whether a fill price sits inside its bar, with a tolerance in ticks (B-12). */
export function fillInsideBar(priceValue: number, bar: Candle | undefined, symbol: string, toleranceTicks = 4) {
  if (!bar) return true;
  const tolerance = specFor(symbol).tickSize * toleranceTicks;
  return priceValue >= bar.low - tolerance && priceValue <= bar.high + tolerance;
}

/** Share of checklist rules followed, or null when the trade has no checklist (UX-51). */
export function adherence(trade: Pick<TradeRecord, "checklist_state">) {
  const total = trade.checklist_state.length;
  if (!total) return null;
  const followed = trade.checklist_state.filter((item) => item.checked).length;
  return { followed, total, ratio: followed / total };
}

/** `new`: nothing captured. `tagged`: a playbook, a tag or a note. `reviewed` is only ever set by the trader. */
export function deriveReviewStatus(trade: Pick<TradeRecord, "review_status" | "playbook_id" | "quick_tags" | "note">): ReviewStatus {
  if (trade.review_status === "reviewed") return "reviewed";
  return trade.playbook_id || trade.quick_tags.length || trade.note.trim() ? "tagged" : "new";
}

export function candleCacheKey(trade: Pick<TradeRecord, "id" | "symbol"> & Partial<Pick<TradeRecord, "yahoo_ticker">>) {
  const ticker = specFor(trade.symbol).yahooTicker || trade.yahoo_ticker || trade.symbol;
  return `${trade.id}:${ticker}`;
}

export function candleSignature(trade: Pick<TradeRecord, "symbol" | "entry_time" | "exit_time"> & Partial<Pick<TradeRecord, "yahoo_ticker">>) {
  const ticker = specFor(trade.symbol).yahooTicker || trade.yahoo_ticker || trade.symbol;
  return `${trade.symbol}|${ticker}|${trade.entry_time}|${trade.exit_time}`;
}

/** Fill in fields added after a record was stored, so old device data keeps loading. */
export function normalizeTrade(raw: Partial<TradeRecord> & Pick<TradeRecord, "id" | "symbol" | "direction" | "entry_time" | "exit_time" | "entry_price" | "exit_price">): TradeRecord {
  const hadNonMarketCandles = raw.candle_source != null && raw.candle_source !== "Yahoo Finance";
  const canonicalTicker = specFor(raw.symbol).yahooTicker;
  const trade: TradeRecord = {
    user_id: DEFAULT_OWNER_USER_ID,
    yahoo_ticker: canonicalTicker || raw.yahoo_ticker || raw.symbol,
    trade_style: classifyTrade(raw.entry_time, raw.exit_time),
    stop_loss_price: null,
    planned_target_price: null,
    key_level_price: null,
    quantity: 1,
    note: "",
    review_status: "new",
    playbook_id: null,
    quick_tags: [],
    checklist_state: [],
    pre_trade_thesis: "",
    management_notes: "",
    post_exit_notes: "",
    flagged: false,
    take_again: null,
    take_again_at: null,
    is_sample: false,
    sparkline: [],
    ...raw,
  };
  if (canonicalTicker) trade.yahoo_ticker = canonicalTicker;
  if (!(trade.quantity > 0)) trade.quantity = 1;
  if (trade.candle_source !== "Yahoo Finance") trade.candle_source = undefined;
  if (hadNonMarketCandles) trade.sparkline = [];
  trade.review_status = deriveReviewStatus(trade);
  return trade;
}

/** Tags that record a broken process, whatever the trade made. */
export const VIOLATION_TAGS = ["Chased Entry", "Moved Stop", "Revenge"];

/** How the trade was executed: `clean` (every rule followed, no violation), `broken`, or unknown. */
export function processRead(trade: Pick<TradeRecord, "checklist_state" | "quick_tags">): "clean" | "broken" | null {
  const score = adherence(trade);
  const violated = trade.quick_tags.some((tag) => VIOLATION_TAGS.includes(tag));
  if (violated || (score && score.followed < score.total)) return "broken";
  return score ? "clean" : null;
}
