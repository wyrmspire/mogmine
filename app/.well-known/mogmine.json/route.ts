// #185b: GET /.well-known/mogmine.json. Public discovery: base URL, spec URL, auth scheme, scopes and version. It reports
// only whether the API is on (a boolean from `agentApiEnabled()`; server-auth stays the one reader of the keys).
import { buildDiscovery } from "@/lib/agent/openapi";
import { agentApiEnabled } from "@/lib/agent/server-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  const enabled = agentApiEnabled();
  return Response.json(buildDiscovery(origin, enabled), {
    headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=300" },
  });
}
