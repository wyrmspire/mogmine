// #185a: read, update and delete one record. `id` is URL-decoded once (ids may contain `:`, e.g. `seed:cut`).
import { handleAgentRequest } from "@/lib/agent/handle";
import { decodeRouteParam, isCollectionKey, parseIncludeDerived } from "@/lib/agent/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ type: string; id: string }> };

async function target(ctx: Ctx) {
  const { type, id } = await ctx.params;
  return { type, id: decodeRouteParam(id) };
}

export async function GET(request: Request, ctx: Ctx) {
  const { type, id } = await target(ctx);
  return handleAgentRequest(request, (url) => (
    isCollectionKey(type) && id !== null ? { kind: "read", type, id, includeDerived: parseIncludeDerived(url.searchParams) } : null
  ));
}

export async function PATCH(request: Request, ctx: Ctx) {
  const { type, id } = await target(ctx);
  return handleAgentRequest(request, (_url, body) => (isCollectionKey(type) && id !== null ? { kind: "update", type, id, body } : null));
}

export async function DELETE(request: Request, ctx: Ctx) {
  const { type, id } = await target(ctx);
  return handleAgentRequest(request, () => (isCollectionKey(type) && id !== null ? { kind: "remove", type, id } : null));
}
