// #API-3: POST /api/v1/checks/trade. Verifies a draft (or stored) trade against the bars before anything is saved. Read
// scope although it is a POST, and it writes nothing. The pipeline is in lib/agent/trade-check.ts.
import { handleTradeCheckRequest } from "@/lib/agent/trade-check";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  return handleTradeCheckRequest(request);
}
