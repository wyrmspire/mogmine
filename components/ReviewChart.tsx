"use client";

// RV-1: the trade's chart on the Review queue card, so notes and tags are written while looking at it
// (owner, 2026-11-22). Under blind review the chart is sealed at the entry exactly as a drill front is
// (docs/23 §4.1): bars that closed by the entry, drawn as an open trade, no marks, so nothing gives the
// result away. Candles load through the same cache as Trade Detail (`ensureCandles`, invariant 2).
import { useEffect, useMemo } from "react";
import { TradeChart } from "./TradeChart";
import { ensureCandles, useCandles } from "@/lib/candles";
import { cutAtEntry } from "@/lib/drills";
import { useAccounts } from "@/lib/accounts-store";
import { usePrefs } from "@/lib/prefs";
import { resolveRSize, riskR } from "@/lib/r-size";
import { observeTrade } from "@/lib/trade-bar-validation";
import { deriveTrade, fromLegacy } from "@/lib/trade-document";
import { buildMarks } from "@/lib/trade-marks";
import { TIMEFRAME_MINUTES } from "@/lib/trades";
import type { TradeRecord } from "@/lib/trades";

export function ReviewChart({ trade, sealed, zone, privacy }: { trade: TradeRecord; sealed: boolean; zone: string; privacy: boolean }) {
  const candles = useCandles(trade.id);
  const accounts = useAccounts();
  const prefs = usePrefs();
  useEffect(() => { ensureCandles(trade); }, [trade]);

  const ready = candles?.status === "ready" && candles.candles.length > 0;
  const timeframe = candles?.baseTimeframe ?? "1m";
  const sealedTrade = useMemo(() => ({ ...trade, exit_time: null, exit_price: null, status: "open" as const }), [trade]);
  const bars = useMemo(() => {
    if (!ready) return [];
    return sealed ? cutAtEntry(candles.candles, trade.entry_time, timeframe) : candles.candles;
  }, [ready, sealed, candles, trade.entry_time, timeframe]);
  const marks = useMemo(() => {
    if (sealed || !bars.length) return [];
    const derived = deriveTrade(fromLegacy(trade));
    const observed = observeTrade(derived, bars, TIMEFRAME_MINUTES[timeframe]);
    const accountRiskR = riskR(trade, resolveRSize(trade, accounts.accounts, prefs));
    return buildMarks(derived, observed, timeframe, "medium", privacy, { candleTimes: bars.map(({ time }) => time), accountRiskR });
  }, [sealed, bars, trade, timeframe, privacy, accounts.accounts, prefs]);

  if (!candles || candles.status === "loading") {
    return <div className="chart-frame review-chart" aria-busy="true"><div className="chart-skeleton"><div className="skeleton" /><span>Loading the chart…</span></div></div>;
  }
  if (!ready) {
    // No market data means no chart (#25): say so in one line instead of drawing anything.
    return <p className="review-chart-none">No market bars for this trade, so there is no chart.</p>;
  }
  if (!bars.length) {
    return <p className="review-chart-none">No bars before the entry were saved, so the sealed chart is empty.</p>;
  }
  return (
    <div className="chart-frame review-chart">
      <TradeChart
        key={`${trade.id}-${sealed ? "sealed" : "open"}`}
        trade={sealed ? sealedTrade : trade}
        bars={bars}
        timeframe={timeframe}
        marks={marks}
        zone={zone}
        privacy={privacy}
      />
      {sealed && <span className="review-chart-seal">Sealed at entry</span>}
    </div>
  );
}
