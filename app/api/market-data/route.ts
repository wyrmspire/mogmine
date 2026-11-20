import { NextRequest, NextResponse } from "next/server";
import { FUTURES_SPECS } from "@/lib/trades";
import { createConfiguredArchiveClient } from "@/lib/candle-archive";
import { isMarketDataFailure, resolveMarketCandles } from "@/lib/market-data/resolve";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams.get("symbol")?.toUpperCase();
  const entry = request.nextUrl.searchParams.get("entry");
  const exit = request.nextUrl.searchParams.get("exit");
  if (!symbol || !FUTURES_SPECS[symbol] || !entry) {
    return NextResponse.json({ error: "A supported symbol and entry are required" }, { status: 400 });
  }

  const entryTime = Date.parse(entry);
  // No exit is an open trade (R-03c). A present exit must still be valid and after the entry.
  const exitTime = exit == null ? null : Date.parse(exit);
  if (!Number.isFinite(entryTime) || (exitTime != null && (!Number.isFinite(exitTime) || exitTime <= entryTime))) {
    return NextResponse.json({ error: "The trade time range is invalid" }, { status: 400 });
  }

  const result = await resolveMarketCandles(
    { symbol, entryTime, exitTime },
    { archive: createConfiguredArchiveClient() },
  );
  if (isMarketDataFailure(result)) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result);
}
