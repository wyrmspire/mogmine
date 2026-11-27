// RM-D5 / RM-K2: canonical, owner-scoped review queue read model.
// This endpoint intentionally returns queue metadata only; journal prose stays in the records API.
import { createSupabaseAdapter } from "@/lib/persistence/supabase-adapter";
import { createMemoryCandleStore } from "@/lib/persistence/local-adapter";
import { createJournalCommands } from "@/lib/commands/journal-commands";
import { selectReviewQueue } from "@/lib/review-queue";
import { agentEnabled, authenticateAgent, defaultAgentDeps, recordAgentUse, sharedReadLimiter } from "@/lib/agent/server-auth";
import { agentError, agentOk } from "@/lib/agent/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function respond(response: { status: number; body: unknown; headers?: Record<string, string> }): Response {
  return Response.json(response.body, {
    status: response.status,
    headers: { ...(response.headers ?? {}), "Cache-Control": "no-store" },
  });
}

/** Deliberately excludes note, thesis, management notes, post-exit notes and checklist prose. */
function queueItem(trade: {
  id: string;
  account_id: string | null;
  symbol: string;
  direction: string;
  status: string;
  entry_time: string;
  exit_time: string | null;
  review_status: string;
  playbook_id: string | null;
  flagged: boolean;
  is_sample: boolean;
}) {
  return {
    id: trade.id,
    account_id: trade.account_id,
    symbol: trade.symbol,
    direction: trade.direction,
    status: trade.status,
    entry_time: trade.entry_time,
    exit_time: trade.exit_time,
    review_status: trade.review_status,
    playbook_id: trade.playbook_id,
    flagged: trade.flagged,
    is_sample: trade.is_sample,
  };
}

export async function GET(request: Request) {
  const deps = defaultAgentDeps();
  const method = "GET";
  const path = new URL(request.url).pathname.slice(0, 300);
  if (!deps || !agentEnabled(deps.env)) {
    return respond(agentError("unavailable", "The agent API is off on this deployment."));
  }

  try {
    const auth = await authenticateAgent(request, deps, sharedReadLimiter);
    if (!auth.ok) {
      if (auth.identity) await recordAgentUse(deps, auth.identity, { method, path, status: auth.status, outcome: auth.code });
      return respond(auth);
    }

    const adapter = createSupabaseAdapter({ client: auth.ctx.db, candles: createMemoryCandleStore() });
    const commands = createJournalCommands(adapter.repositories, auth.ctx.userId);
    const [trades, accounts] = await Promise.all([
      commands.list("trades", { includeArchived: false, includeSamples: true }),
      commands.list("accounts", { includeArchived: false, includeSamples: false }),
    ]);
    if (!trades.ok || !accounts.ok) {
      await recordAgentUse(deps, auth.ctx, { method, path, status: 500, outcome: "unknown", recordType: "review_queue" });
      return respond(agentError("unknown", "Something went wrong. Try again."));
    }

    const url = new URL(request.url);
    const includeReplay = url.searchParams.get("include_replay") === "true";
    const queue = selectReviewQueue(trades.value, {
      accounts: accounts.value,
      includeReplay,
      includeSamples: false,
    });
    const data = {
      items: queue.map(queueItem),
      count: queue.length,
      include_replay: includeReplay,
    };
    await recordAgentUse(deps, auth.ctx, { method, path, status: 200, outcome: "ok", recordType: "review_queue" });
    return respond(agentOk(data));
  } catch {
    return respond(agentError("unknown", "Something went wrong. Try again."));
  }
}
