// #185a: GET /api/v1/me. The owner and scopes behind the key. Server only (see lib/agent/handle.ts).
import { handleAgentRequest } from "@/lib/agent/handle";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  return handleAgentRequest(request, () => ({ kind: "me" }));
}
