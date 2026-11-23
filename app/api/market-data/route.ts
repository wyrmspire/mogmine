import { NextRequest, NextResponse } from "next/server";
import { FUTURES_SPECS, TIMEFRAME_MINUTES } from "@/lib/trades";
import { sessionCloseUtc } from "@/lib/session";
import type { Timeframe } from "@/lib/trades";
import { YahooFinanceProvider } from "@/lib/market-data/yahoo";
import { anchorsTradeWindow, coversTradeWindow, tradeWindowCoverage } from "@/lib/market-data/coverage";
import { noCandlesResponse, windowInFuture } from "@/lib/market-data/outcome";
import type { Candle } from "@/lib/trades";

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

/** No candles: a future window (200, empty), nothing served (404), or a real upstream failure (502). */
function noCandles(reason: Parameters<typeof noCandlesResponse>[0]) {
  const { status, body } = noCandlesResponse(reason);
  return NextResponse.json(body, { status });
}

/** One attempt. A failure on one timeframe is remembered, not fatal: the next timeframe is still tried. */
async function fetchAttempt(query: Parameters<YahooFinanceProvider["getCandles"]>[0], failed: { any: boolean }): Promise<Candle[]> {
  try {
    return await provider.getCandles(query);
  } catch {
    failed.any = true;
    return [];
  }
}

export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams.get("symbol")?.toUpperCase();
  const entry = request.nextUrl.searchParams.get("entry");
  const exit = request.nextUrl.searchParams.get("exit");
  const rangeFrom = request.nextUrl.searchParams.get("from");
  // Day mode (docs/20 §2.2): the bars of one window, so the entry form can find the fill from the
  // prices. No trade to anchor yet, so any non-empty window is an answer, finest timeframe first.
  if (symbol && FUTURES_SPECS[symbol] && rangeFrom != null) {
    const from = Date.parse(rangeFrom);
    const requestedTo = Date.parse(request.nextUrl.searchParams.get("to") ?? "");
    if (!Number.isFinite(from) || !Number.isFinite(requestedTo) || requestedTo <= from || requestedTo - from > MAX_RANGE_MS) {
      return NextResponse.json({ error: "The range is invalid" }, { status: 400 });
    }
    if (windowInFuture(from, Date.now())) return noCandles("future");
    const to = Math.min(requestedTo, Date.now());
    const failed = { any: false };
    for (const { timeframe } of ATTEMPTS) {
      const candles = await fetchAttempt({ symbol, timeframe, from: new Date(from), to: new Date(to) }, failed);
      if (candles.length) return NextResponse.json({ candles, source: "Yahoo Finance", ticker: provider.resolveProviderSymbol(symbol), baseTimeframe: timeframe });
    }
    return noCandles(failed.any ? "upstream" : "no-data");
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

  // A trade dated in the future has no bars yet: a calm empty answer, and Yahoo is not asked (issue: 502 on QA data).
  if (windowInFuture(entryTime, Date.now())) return noCandles("future");
  const failed = { any: false };
  if (exitTime == null) {
    // Open trade: from 15 hours before the entry to now, and only the entry bar is required.
    const to = new Date();
    for (const { timeframe, padHours } of ATTEMPTS) {
      const from = new Date(entryTime - padHours * 3_600_000);
      const candles = await fetchAttempt({ symbol, timeframe, from, to }, failed);
      if (anchorsTradeWindow(candles, entryTime, null, timeframe, symbol)) {
        return NextResponse.json({ candles, source: "Yahoo Finance", ticker: provider.resolveProviderSymbol(symbol), baseTimeframe: timeframe });
      }
    }
    return noCandles(failed.any ? "upstream" : "no-data");
  }

  for (const { timeframe, padHours } of ATTEMPTS) {
    const from = new Date(entryTime - padHours * 3_600_000);
    // Evening-session exits can be more than 15 hours before their assigned session close.
    // Include one full bar beyond 17:00 ET because Yahoo's period2 is an exclusive boundary.
    const closeCoverage = sessionCloseUtc(exitTime) + TIMEFRAME_MINUTES[timeframe] * 60_000;
    const to = new Date(Math.max(exitTime + padHours * 3_600_000, closeCoverage));
    const candles = await fetchAttempt({ symbol, timeframe, from, to }, failed);
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
  return noCandles(failed.any ? "upstream" : "no-data");
}
