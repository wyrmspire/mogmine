// Candles per trade, on the device. Completed candle sets never change, so they are cached in
// IndexedDB and old trades open instantly and offline (docs/08 §2). Lists never touch this module (B-42).
//
// Samples and real trades follow the same rule: only market candles can produce a chart. A missing
// Yahoo response leaves the trade details usable but renders no chart (docs/08 §4, issue #28).
import { useSyncExternalStore } from "react";
import { idbGet, idbSet } from "./idb.ts";
import { candleSignature, getTrade, updateTrade } from "./store.ts";
import { buildSparkline } from "./trades.ts";
import type { Candle, CandleSource, Timeframe, TradeRecord } from "./trades.ts";

export interface CandleEntry {
  status: "loading" | "ready" | "none";
  candles: Candle[];
  source: CandleSource | null;
  /** Finest timeframe these candles support. Coarser than 1m when Yahoo no longer serves 1m (B-11). */
  baseTimeframe: Timeframe;
  /** A request for real candles is in flight. */
  fetching: boolean;
  signature: string;
}

interface StoredCandles {
  signature: string;
  candles: Candle[];
  source: CandleSource;
  baseTimeframe: Timeframe;
  fetchedAt: number;
}

const entries = new Map<string, CandleEntry>();
const listeners = new Set<() => void>();

function put(id: string, entry: CandleEntry) {
  entries.set(id, entry);
  listeners.forEach((listener) => listener());
}

function adopt(trade: TradeRecord, stored: StoredCandles) {
  const live = getTrade(trade.id) ?? trade;
  const patch: Partial<TradeRecord> = { candle_source: stored.source };
  patch.sparkline = buildSparkline({ ...live, ...patch }, stored.candles);
  updateTrade(trade.id, patch);
  put(trade.id, { status: "ready", candles: stored.candles, source: stored.source, baseTimeframe: stored.baseTimeframe, fetching: false, signature: stored.signature });
}

async function load(trade: TradeRecord, signature: string) {
  const cached = await idbGet<StoredCandles>(trade.id);
  if (entries.get(trade.id)?.signature !== signature) return; // the trade changed while we waited
  if (cached?.signature === signature && cached.candles.length >= 4) return adopt(trade, cached);

  try {
    const params = new URLSearchParams({ symbol: trade.symbol, entry: trade.entry_time, exit: trade.exit_time });
    const response = await fetch(`/api/market-data?${params}`);
    if (!response.ok) throw new Error("unavailable");
    const body = await response.json() as { candles?: Candle[]; baseTimeframe?: Timeframe };
    if (!Array.isArray(body.candles) || body.candles.length < 4) throw new Error("incomplete");
    if (entries.get(trade.id)?.signature !== signature) return;
    const stored: StoredCandles = { signature, candles: body.candles, source: "Yahoo Finance", baseTimeframe: body.baseTimeframe ?? "1m", fetchedAt: Date.now() };
    void idbSet(trade.id, stored);
    adopt(trade, stored);
  } catch {
    const current = entries.get(trade.id);
    if (!current || current.signature !== signature) return;
    put(trade.id, current.status === "ready" ? { ...current, fetching: false } : { ...current, status: "none", fetching: false });
  }
}

/** Make sure candles for this trade are loaded or loading. `force` retries a failed fetch. */
export function ensureCandles(trade: TradeRecord, force = false) {
  if (typeof window === "undefined") return;
  const signature = candleSignature(trade);
  const existing = entries.get(trade.id);
  if (existing && existing.signature === signature && !(force && !existing.fetching && existing.source !== "Yahoo Finance")) return;
  put(trade.id, { status: "loading", candles: [], source: null, baseTimeframe: "1m", fetching: true, signature });
  void load(trade, signature);
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export function useCandles(tradeId: string | undefined) {
  return useSyncExternalStore(subscribe, () => (tradeId ? entries.get(tradeId) : undefined), () => undefined);
}
