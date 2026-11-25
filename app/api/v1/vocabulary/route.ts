// #API-2a: GET /api/v1/vocabulary. The playbooks, tags, accounts and time rules agents must use (read scope).
import { handleAgentRequest } from "@/lib/agent/handle";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  return handleAgentRequest(request, () => ({ kind: "vocabulary" }));
}
