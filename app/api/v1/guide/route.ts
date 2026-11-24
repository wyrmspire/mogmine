// #API-1: GET /api/v1/guide. The house rules with examples and the workflows (read scope). Public rules, owner-scoped
// access: the key is checked for read scope like every other GET. Server only (see lib/agent/handle.ts).
//
// Pipeline note: this mirrors handleAgentRequest (lib/agent/handle.ts) for the off switch, auth (bearer, rate limit,
// key lookup, scope, owner session) and audit. handleAgentRequest always routes through the journal command layer, and
// a guide payload is not a command, so the route does its own short version here. Moving it onto handleAgentRequest
// needs a `guide` kind in lib/agent/dispatch.ts (see the API-1 handoff). The rate limit here is a separate counter.
import { agentEnabled, authenticateAgent, defaultAgentDeps, recordAgentUse } from "@/lib/agent/server-auth";
import { agentError, agentOk, createRateLimiter } from "@/lib/agent/http";
import type { AgentResponse } from "@/lib/agent/http";
import { buildGuidePayload } from "@/lib/agent/house-rules";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const limiter = createRateLimiter({ limit: 120, windowMs: 60_000 });

function respond(response: AgentResponse): Response {
  return Response.json(response.body, {
    status: response.status,
    headers: { ...response.headers, "Cache-Control": "no-store" },
  });
}

export async function GET(request: Request) {
  const deps = defaultAgentDeps();
  if (!deps || !agentEnabled(deps.env)) {
    return respond(agentError("unavailable", "The agent API is off on this deployment."));
  }
  const url = new URL(request.url);
  const path = url.pathname.slice(0, 300);
  try {
    const auth = await authenticateAgent(request, deps, limiter);
    if (!auth.ok) {
      if (auth.identity) await recordAgentUse(deps, auth.identity, { method: "GET", path, status: auth.status, outcome: auth.code });
      return respond(auth);
    }
    await recordAgentUse(deps, auth.ctx, { method: "GET", path, status: 200, outcome: "ok" });
    return respond(agentOk(buildGuidePayload(url.origin)));
  } catch {
    // Nothing about the failure leaves the server: no message, stack or cause.
    return respond(agentError("unknown", "Something went wrong. Try again."));
  }
}
