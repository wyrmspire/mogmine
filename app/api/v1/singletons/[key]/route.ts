// #185a: read (GET) and replace (PUT) the one document per owner: prefs, mood_registry.
import { handleAgentRequest } from "@/lib/agent/handle";
import { isSingletonKey } from "@/lib/agent/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ key: string }> };

export async function GET(request: Request, ctx: Ctx) {
  const { key } = await ctx.params;
  return handleAgentRequest(request, () => (isSingletonKey(key) ? { kind: "readSingleton", key } : null));
}

export async function PUT(request: Request, ctx: Ctx) {
  const { key } = await ctx.params;
  return handleAgentRequest(request, (_url, body) => (isSingletonKey(key) ? { kind: "writeSingleton", key, body } : null));
}
