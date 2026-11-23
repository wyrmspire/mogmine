// #185b: GET /.well-known/mogmine.json. Public discovery: base URL, spec URL, auth scheme, scopes and version. It reports
// only whether the API is on (a boolean). `defaultAgentDeps()` is the one place that reads the environment (server-auth),
// and it returns null exactly when `agentEnabled` is false, so no key value is read or echoed here.
import { buildDiscovery } from "@/lib/agent/openapi";
import { defaultAgentDeps } from "@/lib/agent/server-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  const enabled = defaultAgentDeps() !== null;
  return Response.json(buildDiscovery(origin, enabled), {
    headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=300" },
  });
}
