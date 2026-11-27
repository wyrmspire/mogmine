// Daily `MES=F` archive top-up, called by Vercel Cron (vercel.json). The server fetches Yahoo itself:
// the request carries no symbol and no prices.
import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/market-data/cron-auth";
import { runArchiveTopUp } from "@/lib/market-data/top-up";
import { createTopUpStore } from "@/lib/market-data/top-up-store";
import { YahooFinanceProvider } from "@/lib/market-data/yahoo";

export const runtime = "nodejs";
export const maxDuration = 60;

const headers = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest) {
  if (!isAuthorizedCron(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  }
  const store = createTopUpStore();
  if (!store) return NextResponse.json({ error: "Archive is not configured" }, { status: 503, headers });
  const yahoo = new YahooFinanceProvider();
  try {
    const summary = await runArchiveTopUp(store, (ticker, from, to) =>
      yahoo.getTickerCandles(ticker, { timeframe: "1m", from, to }));
    return NextResponse.json(summary, { headers });
  } catch (error) {
    // The job row holds the detail; the log line is for Vercel.
    console.error("archive top-up failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Top-up failed. See mogmine_market_archive_jobs." }, { status: 500, headers });
  }
}
