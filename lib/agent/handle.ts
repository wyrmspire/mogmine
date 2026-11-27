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
import { claimIdempotent, completeIdempotent, isStaleClaim, readIdempotencyKey, releaseIdempotent, releaseStaleIdempotent, requestHash } from "./idempotency.ts";
import type { IdempotencyTable } from "./idempotency.ts";

/** Request bodies above this are refused before they are parsed. */
export const AGENT_BODY_LIMIT_BYTES = 256 * 1024;

export interface AgentRequestOptions {
  /** Tests inject fakes. `null` means the API is off. Omitted: the real clients from the environment. */
  deps?: AgentServerDeps | null;
  limiter?: RateLimiter;
}

function requestId(): string {
  return typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `mm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function respond(response: AgentResponse, id: string): Response {
  return Response.json(response.body, {
    status: response.status,
    headers: { ...response.headers, "Cache-Control": "no-store", "X-Request-Id": id },
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
    return respond(agentError("unavailable", "The agent API is off on this deployment."), requestId());
  }
  const url = new URL(req.url);
  const path = url.pathname.slice(0, 300);
  const method = req.method;
  const id = requestId();
  try {
    const auth = await authenticateAgent(req, deps, options.limiter ?? defaultAgentLimiter(method));
    if (!auth.ok) {
      if (auth.identity) await recordAgentUse(deps, auth.identity, { method, path, status: auth.status, outcome: auth.code, requestId: id });
      return respond(auth, id);
    }
    const ctx = auth.ctx;
    const audit = (status: number, outcome: string, recordType?: string, recordId?: string, decisionCode?: string, decisionVersion?: string) =>
      recordAgentUse(deps, ctx, { method, path, status, outcome, recordType, recordId, requestId: id, decisionCode, decisionVersion });

    const body = await readBody(req);
    if (!body.ok) {
      await audit(body.response.status, "invalid");
      return respond(body.response, id);
    }
    const route = build(url, body.body);
    if (!route) {
      await audit(404, "not_found");
      return respond(agentError("not_found", notFoundHint(url.pathname)), id);
    }
    const parsedKey = method === "POST" && route.kind === "create"
      ? readIdempotencyKey(req)
      : { key: null, error: null };
    if (parsedKey.error) {
      const response = agentError("invalid", parsedKey.error);
      await audit(response.status, "invalid", route.kind === "create" ? route.type : undefined);
      return respond(response, id);
    }
    const endpoint = `${method} ${path}`;
    const key = parsedKey.key;
    const hash = key ? await requestHash(endpoint, body.body) : null;
    const idempotency = key ? deps.admin.from("mogmine_agent_idempotency") as unknown as IdempotencyTable : null;
    const adapter = createSupabaseAdapter({ client: ctx.db, candles: createMemoryCandleStore() });
    const commands = createJournalCommands(adapter.repositories, ctx.userId);
    if (idempotency && key && hash && route.kind === "create") {
      const record = { user_id: ctx.userId, token_id: ctx.tokenId, endpoint, idempotency_key: key, payload_hash: hash };
      let claim = await claimIdempotent(idempotency, record);
      if (!claim.claimed && claim.existing?.payload_hash === hash && isStaleClaim(claim.existing, deps.now())) {
        // The first attempt never finished. If its record was saved, answer with it; if not, run the create again.
        const recordId = (body.body as { id?: unknown } | null | undefined)?.id;
        const saved = typeof recordId === "string"
          ? await dispatchAgentRoute({ kind: "read", type: route.type, id: recordId }, commands, ctx, {})
          : null;
        if (saved?.status === 200) {
          await completeIdempotent(idempotency, ctx.userId, endpoint, key, hash, 201, saved.body);
          await audit(201, "idempotent_replay", route.type, recordId as string, "idempotency_reconciled", "agent-write-safety-1");
          return respond({ status: 201, body: saved.body, headers: {} }, id);
        }
        if (!saved || saved.status === 404) {
          await releaseStaleIdempotent(idempotency, claim.existing);
          claim = await claimIdempotent(idempotency, record);
        }
      }
      if (!claim.claimed) {
        const prior = claim.existing;
        if (!prior) {
          const response = agentError("unavailable", "Idempotency protection is unavailable. Try again later.");
          await audit(response.status, "unavailable", route.type, undefined, "idempotency_store");
          return respond(response, id);
        }
        if (prior.payload_hash !== hash) {
          const response = agentError("invalid", "This Idempotency-Key was already used with a different request.");
          await audit(response.status, "invalid", route.type, undefined, "idempotency_key_reuse");
          return respond(response, id);
        }
        if (prior.state === "in_flight" || prior.status == null) {
          const response = agentError("conflict", "A request with this Idempotency-Key is still in progress.");
          await audit(response.status, "conflict", route.type, undefined, "idempotency_in_flight", "agent-write-safety-1");
          return respond(response, id);
        }
        await audit(prior.status, "idempotent_replay", route.type, undefined, "idempotency_replay", "agent-write-safety-1");
        return respond({ status: prior.status, body: prior.response_body, headers: {} }, id);
      }
    }
    const expectedUpdatedAt = req.headers.get("if-match")?.trim().replace(/^W\//, "").replace(/^\"|\"$/g, "") || undefined;
    let result;
    try {
      result = await dispatchAgentRoute(route, commands, ctx, { expectedUpdatedAt });
    } catch (error) {
      if (idempotency && key && hash) await releaseIdempotent(idempotency, ctx.userId, endpoint, key, hash);
      throw error;
    }
    await audit(result.status, result.outcome, result.recordType, result.recordId, result.decisionCode, result.decisionVersion);
    if (idempotency && key && hash) {
      if (result.status >= 200 && result.status < 300) {
        await completeIdempotent(idempotency, ctx.userId, endpoint, key, hash, result.status, result.body);
      } else {
        await releaseIdempotent(idempotency, ctx.userId, endpoint, key, hash);
      }
    }
    return respond({ status: result.status, body: result.body, headers: {} }, id);
  } catch {
    // Nothing about the failure leaves the server: no message, stack or cause.
    return respond(agentError("unknown", "Something went wrong. Try again."), id);
  }
}
