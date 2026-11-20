import { NextRequest, NextResponse } from "next/server";
import { FUTURES_SPECS, TIMEFRAME_MINUTES } from "@/lib/trades";
import { sessionCloseUtc } from "@/lib/session";
import type { Timeframe } from "@/lib/trades";
import { YahooFinanceProvider } from "@/lib/market-data/yahoo";
import { anchorsTradeWindow, coversTradeWindow, tradeWindowCoverage } from "@/lib/market-data/coverage";

export const runtime = "nodejs";

const provider = new YahooFinanceProvider();

// Finest first. Yahoo serves 1m for 30 days, 5m for 60 and 1h for 730 (docs/10 §2), so an older
// trade degrades to the best timeframe still available and the UI says which one it got (B-11).
const ATTEMPTS: Array<{ timeframe: Timeframe; padHours: number }> = [
  { timeframe: "1m", padHours: 15 },
  { timeframe: "5m", padHours: 15 },
  { timeframe: "1h", padHours: 72 },
];

/** Longest day-mode window: one calendar day plus slack for a DST change. */
const MAX_RANGE_MS = 26 * 3_600_000;

export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams.get("symbol")?.toUpperCase();
  const entry = request.nextUrl.searchParams.get("entry");
  const exit = request.nextUrl.searchParams.get("exit");
  const rangeFrom = request.nextUrl.searchParams.get("from");
  // Day mode (docs/20 §2.2): the bars of one window, so the entry form can find the fill from the
  // prices. No trade to anchor yet, so any non-empty window is an answer, finest timeframe first.
  if (symbol && FUTURES_SPECS[symbol] && rangeFrom != null) {
    const from = Date.parse(rangeFrom);
    const to = Math.min(Date.parse(request.nextUrl.searchParams.get("to") ?? ""), Date.now());
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || to - from > MAX_RANGE_MS) {
      return NextResponse.json({ error: "The range is invalid" }, { status: 400 });
    }
    try {
      for (const { timeframe } of ATTEMPTS) {
        const candles = await provider.getCandles({ symbol, timeframe, from: new Date(from), to: new Date(to) });
        if (candles.length) return NextResponse.json({ candles, source: "Yahoo Finance", ticker: provider.resolveProviderSymbol(symbol), baseTimeframe: timeframe });
      }
      return NextResponse.json({ error: "Yahoo Finance has no candles for this range" }, { status: 404 });
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Market data request failed" }, { status: 502 });
    }
  }
  if (!symbol || !FUTURES_SPECS[symbol] || !entry) {
    return NextResponse.json({ error: "A supported symbol and entry are required" }, { status: 400 });
  }

  const entryTime = Date.parse(entry);
  // No exit is an open trade (R-03c). A present exit must still be valid and after the entry.
  const exitTime = exit == null ? null : Date.parse(exit);
  if (!Number.isFinite(entryTime) || (exitTime != null && (!Number.isFinite(exitTime) || exitTime <= entryTime))) {
    return NextResponse.json({ error: "The trade time range is invalid" }, { status: 400 });
  }

  try {
    if (exitTime == null) {
      // Open trade: from 15 hours before the entry to now, and only the entry bar is required.
      const to = new Date();
      if (entryTime >= to.getTime()) return NextResponse.json({ error: "The entry is in the future" }, { status: 400 });
      for (const { timeframe, padHours } of ATTEMPTS) {
        const from = new Date(entryTime - padHours * 3_600_000);
        const candles = await provider.getCandles({ symbol, timeframe, from, to });
        if (anchorsTradeWindow(candles, entryTime, null, timeframe, symbol)) {
          return NextResponse.json({ candles, source: "Yahoo Finance", ticker: provider.resolveProviderSymbol(symbol), baseTimeframe: timeframe });
        }
      }
      return NextResponse.json({ error: "Yahoo Finance has no candles for this range" }, { status: 404 });
    }

    for (const { timeframe, padHours } of ATTEMPTS) {
      const from = new Date(entryTime - padHours * 3_600_000);
      // Evening-session exits can be more than 15 hours before their assigned session close.
      // Include one full bar beyond 17:00 ET because Yahoo's period2 is an exclusive boundary.
      const closeCoverage = sessionCloseUtc(exitTime) + TIMEFRAME_MINUTES[timeframe] * 60_000;
      const to = new Date(Math.max(exitTime + padHours * 3_600_000, closeCoverage));
      const candles = await provider.getCandles({ symbol, timeframe, from, to });
      // A thin set or one missing a boundary bar falls through to the next timeframe (issue #90).
      // Gaps inside the hold do not: when the entry and exit bars are present the payload anchors
      // the trade (AC-07) and is served as partial, with the gaps drawn and counted on screen.
      if (coversTradeWindow(candles, entryTime, exitTime, timeframe, symbol)) {
        return NextResponse.json({ candles, source: "Yahoo Finance", ticker: provider.resolveProviderSymbol(symbol), baseTimeframe: timeframe });
      }
      if (anchorsTradeWindow(candles, entryTime, exitTime, timeframe, symbol)) {
        const { missingInside } = tradeWindowCoverage(candles, entryTime, exitTime, timeframe, symbol);
        return NextResponse.json({ candles, source: "Yahoo Finance", ticker: provider.resolveProviderSymbol(symbol), baseTimeframe: timeframe, partial: true, missingBars: missingInside.length });
      }
    }
    return NextResponse.json({ error: "Yahoo Finance has no candles for this range" }, { status: 404 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Market data request failed" }, { status: 502 });
  }
}
