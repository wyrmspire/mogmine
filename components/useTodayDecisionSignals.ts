"use client";

import { useEffect, useState } from "react";
import type { TradingAccount } from "@/lib/accounts";
import type { Prefs } from "@/lib/prefs-sanitize";
import type { StoredCandles } from "@/lib/candles";
import { missesDeck } from "@/lib/drills";
import { useDrills } from "@/lib/drills-store";
import { idbGet } from "@/lib/idb";
import { alignToBar, alignTradeToBars, candleCacheKey, candleSignature, type TradeRecord } from "@/lib/trades";

export interface TodayDecisionSignals {
  unresolvedFillToBarMatch: number;
  /** Null until the device bars have been checked. */
  unverifiedFillTimes: number | null;
  /** Null while the archive status is unknown (loading, unavailable or not configured). */
  archiveGapDays: number | null;
  missedDrillsDue: number;
}

const EMPTY: TodayDecisionSignals = { unresolvedFillToBarMatch: 0, unverifiedFillTimes: null, archiveGapDays: null, missedDrillsDue: 0 };

/** Connects Today to device candle evidence, due drill history and the server archive status. */
export function useTodayDecisionSignals(
  trades: readonly TradeRecord[],
  now: number,
  accounts: readonly TradingAccount[],
  prefs: Prefs,
): TodayDecisionSignals {
  const { records } = useDrills();
  const [signals, setSignals] = useState<TodayDecisionSignals>(EMPTY);

  useEffect(() => {
    let alive = true;
    void Promise.all(trades.map(async (trade) => {
      const stored = await idbGet<StoredCandles>(candleCacheKey(trade)).catch(() => undefined);
      return [trade, stored?.signature === candleSignature(trade) ? stored : undefined] as const;
    })).then((entries) => {
      if (!alive) return;
      const barsByTrade = new Map(entries.flatMap(([trade, stored]) => stored?.candles.length ? [[trade.id, stored] as const] : []));
      const unresolvedFillToBarMatch = entries.filter(([trade, stored]) => {
        if (!stored?.candles.length) return false;
        const times = stored.candles.map((bar) => bar.time);
        if (trade.exit_time == null) return alignToBar(times, Date.parse(trade.entry_time), stored.baseTimeframe).kind === "unresolved";
        return alignTradeToBars(times, trade.entry_time, trade.exit_time, stored.baseTimeframe) == null;
      }).length;
      const missedDrillsDue = missesDeck(trades, records, now, (id) => barsByTrade.has(id), { accounts, prefs }).trade_ids.length;
      const unverifiedFillTimes = entries.filter(([, stored]) => !stored?.candles.length).length;
      setSignals((current) => ({ ...current, unresolvedFillToBarMatch, unverifiedFillTimes, missedDrillsDue }));
    });
    return () => { alive = false; };
  }, [trades, records, now, accounts, prefs]);

  useEffect(() => {
    let alive = true;
    void fetch("/api/market-data/status", { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() as Promise<{ available?: unknown; missingRecentSessions?: unknown }> : null)
      .then((status) => {
        if (!alive) return;
        const missing = status?.available === true && typeof status.missingRecentSessions === "number" && Number.isFinite(status.missingRecentSessions)
          ? Math.max(0, Math.trunc(status.missingRecentSessions))
          : null;
        setSignals((current) => ({ ...current, archiveGapDays: missing }));
      })
      .catch(() => undefined);
    return () => { alive = false; };
  }, []);

  return signals;
}
