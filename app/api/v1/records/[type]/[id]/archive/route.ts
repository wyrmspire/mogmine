// #185a: POST archives a record of an archive-policy type (accounts, playbooks). Other types answer 403 (command layer).
import { handleAgentRequest } from "@/lib/agent/handle";
import { decodeRouteParam, isCollectionKey } from "@/lib/agent/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ type: string; id: string }> };

export async function POST(request: Request, ctx: Ctx) {
  const { type, id: rawId } = await ctx.params;
  const id = decodeRouteParam(rawId);
  return handleAgentRequest(request, () => (isCollectionKey(type) && id !== null ? { kind: "archive", type, id } : null));
}
