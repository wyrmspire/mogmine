import { NextRequest, NextResponse } from "next/server";
import { FUTURES_SPECS, TIMEFRAME_MINUTES } from "@/lib/trades";
import { sessionCloseUtc } from "@/lib/session";
import type { Timeframe } from "@/lib/trades";
import { YahooFinanceProvider } from "@/lib/market-data/yahoo";

export const runtime = "nodejs";

const provider = new YahooFinanceProvider();

// Finest first. Yahoo serves 1m for 30 days, 5m for 60 and 1h for 730 (docs/10 §2), so an older
// trade degrades to the best timeframe still available and the UI says which one it got (B-11).
const ATTEMPTS: Array<{ timeframe: Timeframe; padHours: number }> = [
  { timeframe: "1m", padHours: 15 },
  { timeframe: "5m", padHours: 15 },
  { timeframe: "1h", padHours: 72 },
];

export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams.get("symbol")?.toUpperCase();
  const entry = request.nextUrl.searchParams.get("entry");
  const exit = request.nextUrl.searchParams.get("exit");
  if (!symbol || !FUTURES_SPECS[symbol] || !entry || !exit) {
    return NextResponse.json({ error: "A supported symbol, entry and exit are required" }, { status: 400 });
  }

  const entryTime = Date.parse(entry);
  const exitTime = Date.parse(exit);
  if (!Number.isFinite(entryTime) || !Number.isFinite(exitTime) || exitTime <= entryTime) {
    return NextResponse.json({ error: "The trade time range is invalid" }, { status: 400 });
  }

  try {
    for (const { timeframe, padHours } of ATTEMPTS) {
      const from = new Date(entryTime - padHours * 3_600_000);
      // Evening-session exits can be more than 15 hours before their assigned session close.
      // Include one full bar beyond 17:00 ET because Yahoo's period2 is an exclusive boundary.
      const closeCoverage = sessionCloseUtc(exitTime) + TIMEFRAME_MINUTES[timeframe] * 60_000;
      const to = new Date(Math.max(exitTime + padHours * 3_600_000, closeCoverage));
      const candles = await provider.getCandles({ symbol, timeframe, from, to });
      if (candles.length >= 4) {
        return NextResponse.json({ candles, source: "Yahoo Finance", ticker: provider.resolveProviderSymbol(symbol), baseTimeframe: timeframe });
      }
    }
    return NextResponse.json({ error: "Yahoo Finance has no candles for this range" }, { status: 404 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Market data request failed" }, { status: 502 });
  }
}
