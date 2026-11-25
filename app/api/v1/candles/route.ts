// #API-3: GET /api/v1/candles. Cleaned 1m/5m/15m bars with CT labels and coverage (read scope). Server only: the pipeline is
// in lib/agent/candles.ts, and it reads through MarketDataProvider only.
import { handleCandlesRequest } from "@/lib/agent/candles";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  return handleCandlesRequest(request);
}
