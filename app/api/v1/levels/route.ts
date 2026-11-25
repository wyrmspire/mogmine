// #API-4: GET /api/v1/levels. Point-in-time session levels, planned levels and Session VWAP as of `as_of` (read scope).
// Server only: the pipeline is in lib/agent/levels.ts. Candles come through the shared loader in lib/agent/candles.ts.
import { handleLevelsRequest } from "@/lib/agent/levels";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  return handleLevelsRequest(request);
}
