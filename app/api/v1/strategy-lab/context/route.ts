// #SL-14: POST /api/v1/strategy-lab/context (docs/design-2026-11-24/09 §4.5). Read scope although it is a POST, and it writes
// nothing. Returns the Context Card for one MES mark. The pipeline is in lib/agent/strategy-lab.ts.
import { handleContextRequest } from "@/lib/agent/strategy-lab";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  return handleContextRequest(request);
}
