// #185a: GET (list) and POST (create) for one collection. `type` must be a v1 collection key (lib/agent/http.ts).
import { handleAgentRequest } from "@/lib/agent/handle";
import { isCollectionKey, parseListQuery } from "@/lib/agent/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ type: string }> };

export async function GET(request: Request, ctx: Ctx) {
  const { type } = await ctx.params;
  return handleAgentRequest(request, (url) => (isCollectionKey(type) ? { kind: "list", type, query: parseListQuery(url.searchParams) } : null));
}

export async function POST(request: Request, ctx: Ctx) {
  const { type } = await ctx.params;
  return handleAgentRequest(request, (_url, body) => (isCollectionKey(type) ? { kind: "create", type, body } : null));
}
