// Server only. Never import from a "use client" file.
// #185a: the one request pipeline behind every /api/v1 route: off switch → auth (bearer, rate limit, key lookup,
// scope, owner session) → body → route → command layer → audit. Every response is JSON with `Cache-Control: no-store`.
import { createSupabaseAdapter } from "../persistence/supabase-adapter.ts";
import { createMemoryCandleStore } from "../persistence/local-adapter.ts";
import { createJournalCommands } from "../commands/journal-commands.ts";
import { dispatchAgentRoute, notFoundHint } from "./dispatch.ts";
import type { AgentRoute } from "./dispatch.ts";
import { agentEnabled, authenticateAgent, defaultAgentDeps, defaultAgentLimiter, recordAgentUse } from "./server-auth.ts";
import type { AgentServerDeps } from "./server-auth.ts";
import { agentError, agentFail } from "./http.ts";
import type { AgentResponse, RateLimiter } from "./http.ts";

/** Request bodies above this are refused before they are parsed. */
export const AGENT_BODY_LIMIT_BYTES = 256 * 1024;

export interface AgentRequestOptions {
  /** Tests inject fakes. `null` means the API is off. Omitted: the real clients from the environment. */
  deps?: AgentServerDeps | null;
  limiter?: RateLimiter;
}

function respond(response: AgentResponse): Response {
  return Response.json(response.body, {
    status: response.status,
    headers: { ...response.headers, "Cache-Control": "no-store" },
  });
}

type BodyRead = { ok: true; body: unknown } | { ok: false; response: AgentResponse };

/** Only writes carry a body. An empty body is `undefined`; invalid JSON is a 400; a non-object is passed on to the command layer. */
async function readBody(req: Request): Promise<BodyRead> {
  if (req.method !== "POST" && req.method !== "PUT" && req.method !== "PATCH") return { ok: true, body: undefined };
  const tooLarge: BodyRead = {
    ok: false,
    response: agentFail(413, "invalid", "The request body is larger than 256 KB."),
  };
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > AGENT_BODY_LIMIT_BYTES) return tooLarge;
  const text = await req.text();
  if (new TextEncoder().encode(text).byteLength > AGENT_BODY_LIMIT_BYTES) return tooLarge;
  if (text.trim() === "") return { ok: true, body: undefined };
  try {
    return { ok: true, body: JSON.parse(text) };
  } catch {
    return { ok: false, response: agentFail(400, "invalid", "Body must be a JSON object.") };
  }
}

/**
 * Runs one agent request. `build` turns the URL and the parsed body into a route; `null` means no such route (404).
 * Auth runs before the body is read, so an unauthenticated caller cannot make the server parse a body.
 */
export async function handleAgentRequest(
  req: Request,
  build: (url: URL, body: unknown) => AgentRoute | null,
  options: AgentRequestOptions = {},
): Promise<Response> {
  const deps = options.deps === undefined ? defaultAgentDeps() : options.deps;
  if (!deps || !agentEnabled(deps.env)) {
    return respond(agentError("unavailable", "The agent API is off on this deployment."));
  }
  const url = new URL(req.url);
  const path = url.pathname.slice(0, 300);
  const method = req.method;
  try {
    const auth = await authenticateAgent(req, deps, options.limiter ?? defaultAgentLimiter(method));
    if (!auth.ok) {
      if (auth.identity) await recordAgentUse(deps, auth.identity, { method, path, status: auth.status, outcome: auth.code });
      return respond(auth);
    }
    const ctx = auth.ctx;
    const audit = (status: number, outcome: string, recordType?: string, recordId?: string) =>
      recordAgentUse(deps, ctx, { method, path, status, outcome, recordType, recordId });

    const body = await readBody(req);
    if (!body.ok) {
      await audit(body.response.status, "invalid");
      return respond(body.response);
    }
    const route = build(url, body.body);
    if (!route) {
      await audit(404, "not_found");
      return respond(agentError("not_found", notFoundHint(url.pathname)));
    }
    const adapter = createSupabaseAdapter({ client: ctx.db, candles: createMemoryCandleStore() });
    const commands = createJournalCommands(adapter.repositories, ctx.userId);
    const result = await dispatchAgentRoute(route, commands, ctx);
    await audit(result.status, result.outcome, result.recordType, result.recordId);
    return respond({ status: result.status, body: result.body, headers: {} });
  } catch {
    // Nothing about the failure leaves the server: no message, stack or cause.
    return respond(agentError("unknown", "Something went wrong. Try again."));
  }
}
