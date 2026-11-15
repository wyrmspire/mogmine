import { NextRequest, NextResponse } from "next/server";
import { FUTURES_SPECS } from "@/lib/trades";
import { YahooFinanceProvider } from "@/lib/market-data/yahoo";

export const runtime = "nodejs";

const provider = new YahooFinanceProvider();

export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams.get("symbol")?.toUpperCase();
  const entry = request.nextUrl.searchParams.get("entry");
  const exit = request.nextUrl.searchParams.get("exit");
  const spec = symbol ? FUTURES_SPECS[symbol] : undefined;
  if (!symbol || !spec || !entry || !exit) {
    return NextResponse.json({ error: "A supported symbol, entry and exit are required" }, { status: 400 });
  }

  const entryTime = Date.parse(entry);
  const exitTime = Date.parse(exit);
  if (!Number.isFinite(entryTime) || !Number.isFinite(exitTime) || exitTime <= entryTime) {
    return NextResponse.json({ error: "The trade time range is invalid" }, { status: 400 });
  }

  const start = new Date(entryTime - 15 * 60 * 60_000);
  const end = new Date(exitTime + 15 * 60 * 60_000);
  try {
    const candles = await provider.getCandles({ ticker: spec.yahooTicker, start, end });
    if (!candles.length) return NextResponse.json({ error: "Yahoo Finance has no 1m candles for this range" }, { status: 404 });
    return NextResponse.json({ candles, source: "Yahoo Finance", ticker: spec.yahooTicker });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Market data request failed" }, { status: 502 });
  }
}
