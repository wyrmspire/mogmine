// #SL-14: GET /api/v1/strategy-lab/skills and POST /api/v1/strategy-lab/context (docs/design-2026-11-24/09 §4.5, 07 §3, §6).
// Synthetic 1m bars and a mocked MarketDataProvider: zero live Yahoo traffic. The HTTP tests run the real auth pipeline
// with read and write keys against a fake owner, and they prove the POST is read scope and the card is computed by code.
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { __resetAgentSessionCache } from "../agent/server-auth.ts";
import type { AdminLike, AgentQuery, AgentServerDeps, AnonAuthLike, AgentEnv, UserDataClient } from "../agent/server-auth.ts";
import { createRateLimiter } from "../agent/http.ts";
import { generateAgentToken, hashAgentToken } from "../agent/tokens.ts";
import { createCandleLoader } from "../agent/candles.ts";
import type { CandleLoader } from "../agent/candles.ts";
import {
  CONTEXT_NOTICE, CONTEXT_SESSIONS, buildAgentContext, handleContextRequest, handleSkillsRequest, parseContextBody, recentSessions,
} from "../agent/strategy-lab.ts";
import type { AgentContextInput, AgentContextPayload, StrategyLabRequestOptions } from "../agent/strategy-lab.ts";
import type { JournalCommands } from "../commands/journal-commands.ts";
import type { MarketDataProvider, MarketDataQuery } from "../market-data/types.ts";
import { equityIndexSessionBounds } from "../session.ts";
import { listSkills } from "../strategy-lab/registry.ts";
import type { Candle } from "../trades.ts";

const MIN = 60_000;
const OWNER = "00000000-0000-4000-8000-00000000000b";
/** 15:00 ET on the mark's session. Every bar of that session that has closed by now is known. */
const NOW = Date.parse("2026-11-25T20:00:00.000Z");
const SESSION = "2026-11-25";
/** 08:12 ET (EST) on the session: the mark. The decision bar is the 08:11 bar, which closes at 08:12. */
const MARK_ISO = "2026-11-25T13:12:00.000Z";
const MARK_PRICE = 5912.25;
const DATES = recentSessions(SESSION, CONTEXT_SESSIONS);
const GOOD_ENV: AgentEnv = { url: "https://example.supabase.test", anonKey: "anon-test", serviceKey: "service-test", adapter: "supabase" };
const SIM_EVAL = { id: "acc-sim", name: "SIM Eval 50K", r_size_cents: 30_000, archived: false };

// ---- fixtures -----------------------------------------------------------------------------------------------------------

/** One valid 1m bar per minute of each listed session's window (18:00 ET the day before to 17:00 ET), with volume gaps. */
function sessionBars(dates: readonly string[] = DATES): Candle[] {
  const bars: Candle[] = [];
  for (const day of dates) {
    const bounds = equityIndexSessionBounds(day);
    let i = 0;
    for (let time = bounds.open; time < bounds.close; time += MIN) {
      const open = 5900 + (i % 40) * 0.25;
      const close = open + ((i % 3) - 1) * 0.25;
      // Every eleventh bar has zero volume: the lab reads that as missing, never as no activity.
      bars.push({ time, open, high: Math.max(open, close) + 0.5, low: Math.min(open, close) - 0.5, close, volume: i % 11 === 0 ? 0 : 100 + (i % 7) * 10 });
      i += 1;
    }
  }
  return bars;
}

function fakeProvider(bars: readonly Candle[]): MarketDataProvider {
  return {
    name: "yahoo_finance",
    resolveProviderSymbol: () => "MES=F",
    getCandles: async (query: MarketDataQuery) => bars.filter((bar) => bar.time >= query.from.getTime() && bar.time < query.to.getTime()),
    supportsTickData: () => false,
  };
}

function loaderFor(bars: readonly Candle[], upstream?: ReturnType<typeof createRateLimiter>): CandleLoader {
  return createCandleLoader({ provider: fakeProvider(bars), now: () => NOW, upstream });
}

/** A command layer with only the two reads the endpoint makes. It cannot write: any other call throws. */
function commandsWith(accounts: readonly typeof SIM_EVAL[] = [SIM_EVAL], prefs: unknown = null): JournalCommands {
  return {
    list: async (key: string) => ({ ok: true, value: key === "accounts" ? accounts : [] }),
    readSingleton: async () => ({ ok: true, value: prefs === null ? null : { record: prefs } }),
  } as unknown as JournalCommands;
}

function mark(overrides: Partial<AgentContextInput> = {}): AgentContextInput {
  return { timeMs: Date.parse(MARK_ISO), price: MARK_PRICE, side: "long", accountId: SIM_EVAL.id, ...overrides };
}

async function build(input: AgentContextInput, options: { bars?: readonly Candle[]; commands?: JournalCommands; upstream?: ReturnType<typeof createRateLimiter> } = {}) {
  return buildAgentContext(input, {
    commands: options.commands ?? commandsWith(),
    loader: loaderFor(options.bars ?? sessionBars(), options.upstream),
    limitKey: "token-1",
    nowMs: NOW,
  });
}

function unwrap(result: Awaited<ReturnType<typeof build>>): AgentContextPayload {
  assert.ok(result.ok, result.ok ? "" : `${result.code}: ${result.message}`);
  return result.value;
}

// ---- parsing ------------------------------------------------------------------------------------------------------------

test("parse: a MES mark floors seconds to the minute and keeps side, price and account", () => {
  const parsed = parseContextBody({ symbol: "mes", time: "2026-11-25T13:12:45Z", price: MARK_PRICE, side: "long", account_id: "acc-sim" }, NOW);
  assert.deepEqual(parsed, { ok: true, value: { timeMs: Date.parse(MARK_ISO), price: MARK_PRICE, side: "long", accountId: "acc-sim" } });
  const noAccount = parseContextBody({ symbol: "MES", time: MARK_ISO, price: 5912, side: "short" }, NOW);
  assert.ok(noAccount.ok && noAccount.value.accountId === null && noAccount.value.side === "short");
});

test("parse: refuses anything that is not a valid mark (symbol, zone, future, tick, side, account)", () => {
  const good = { symbol: "MES", time: MARK_ISO, price: MARK_PRICE, side: "long" };
  const refused = (body: unknown, why: RegExp) => {
    const parsed = parseContextBody(body, NOW);
    assert.equal(parsed.ok, false, "should be refused");
    if (!parsed.ok) assert.match(parsed.message, why);
  };
  refused(null, /JSON object/);
  refused([good], /JSON object/);
  refused({ ...good, symbol: "NQ" }, /MES/);
  refused({ ...good, time: "2026-11-25T13:12:00" }, /zone/);
  refused({ ...good, time: "2026-11-25T21:00:00Z" }, /future/);
  refused({ ...good, price: 5912.3 }, /tick/);
  refused({ ...good, price: 0 }, /positive/);
  refused({ ...good, side: "buy" }, /"long" or "short"/);
  refused({ ...good, account_id: 5 }, /account_id/);
  assert.ok(parseContextBody(good, NOW).ok, "the same body without faults is accepted");
});

// ---- the card -----------------------------------------------------------------------------------------------------------

test("card: the 08:12 ET long on the decision bar, R = $300 from the account, and the sessions it read", async () => {
  const payload = unwrap(await build(mark()));
  assert.equal(payload.symbol, "MES");
  assert.equal(payload.mark.session_date, SESSION);
  assert.match(payload.card.header, /^Long · .* 08:12 ET · /);
  assert.equal(payload.card.decision_time, MARK_ISO, "the bar that closed at 08:12 ET is the decision bar");
  assert.equal(payload.card.basis, "R = $300 (SIM Eval 50K)");
  assert.deepEqual(payload.provenance.r_size, { usd: 300, source: "account", account: "SIM Eval 50K" });
  assert.equal(payload.provenance.sessions_requested, CONTEXT_SESSIONS);
  assert.equal(payload.provenance.sessions_used, CONTEXT_SESSIONS);
  assert.deepEqual(payload.provenance.excluded_dates, []);
  assert.equal(payload.provenance.notice, CONTEXT_NOTICE, "the notice tells the caller not to recompute");
  assert.ok(["ready", "partial"].includes(payload.state));
  assert.ok(payload.card.groups.length > 0, "the card has its groups");
});

test("lookahead: a bar after the mark cannot change any at-the-mark row", async () => {
  const bars = sessionBars();
  const later = Date.parse(MARK_ISO) + 7 * MIN;
  const spiked = bars.map((bar) => (bar.time === later ? { ...bar, high: 9999, close: 9999 } : bar));
  const atMark = (payload: AgentContextPayload) => JSON.stringify(
    payload.card.groups.map((group) => group.rows.filter((row) => row.when === "at-mark")),
  );
  const original = unwrap(await build(mark(), { bars }));
  const spike = unwrap(await build(mark(), { bars: spiked }));
  assert.ok(original.card.groups.some((group) => group.rows.some((row) => row.when === "at-mark")), "the comparison has at-mark rows to compare");
  assert.equal(atMark(spike), atMark(original), "at-mark values are the same with and without the later spike");
});

test("R: no account falls back to prefs ($300), and Shield hides every dollar amount in the basis", async () => {
  const noAccount = unwrap(await build(mark({ accountId: null }), { commands: commandsWith([SIM_EVAL], null) }));
  assert.equal(noAccount.card.basis, "R = $300 (default risk budget)");
  assert.equal(noAccount.provenance.r_size.source, "default");

  const shielded = unwrap(await build(mark({ accountId: null }), { commands: commandsWith([SIM_EVAL], { shield: true }) }));
  assert.equal(shielded.card.basis, "R · default risk budget");
  assert.doesNotMatch(shielded.card.basis, /\$/);
  const shieldedAccount = unwrap(await build(mark(), { commands: commandsWith([SIM_EVAL], { shield: true }) }));
  assert.equal(shieldedAccount.card.basis, "R · SIM Eval 50K");
});

test("accounts: an account_id that is not one of yours is refused as invalid", async () => {
  const result = await build(mark({ accountId: "someone-else" }));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "invalid");
    assert.match(result.message, /not one of your accounts/);
  }
});

test("upstream: a rate-limited candle window is an error, never a partial card", async () => {
  const oneSlot = createRateLimiter({ limit: 1, windowMs: MIN, now: () => NOW });
  const result = await build(mark(), { upstream: oneSlot });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "rate_limited");
    assert.equal(typeof result.retryAfterSec, "number");
  }
});

test("sessions: a session with no bars is excluded, counted and makes the card partial", async () => {
  const [oldest] = DATES;
  const bars = sessionBars(DATES.slice(1));
  const payload = unwrap(await build(mark(), { bars }));
  assert.deepEqual(payload.provenance.excluded_dates, [oldest]);
  assert.equal(payload.provenance.sessions_used, CONTEXT_SESSIONS - 1);
  assert.equal(payload.card.excluded_sessions, 1);
  assert.equal(payload.state, "partial");
});

// ---- skills -------------------------------------------------------------------------------------------------------------

test("skills: the registry's metadata has id, version and kind for every skill", () => {
  const skills = listSkills();
  assert.ok(skills.some((skill) => skill.id === "rvol"), "the registry includes rvol");
  for (const skill of skills) {
    assert.ok(skill.id && skill.version && skill.kind, `${skill.id} has id, version and kind`);
  }
});

// ---- HTTP: real auth pipeline, read and write keys, a fake owner ---------------------------------------------------------

interface Harness {
  deps: AgentServerDeps;
  audits: Record<string, unknown>[];
  bearer: string;
}

async function harness(scopes: string[]): Promise<Harness> {
  const { token } = generateAgentToken();
  const hash = await hashAgentToken(token);
  const audits: Record<string, unknown>[] = [];
  const keyRow = { id: "token-1", user_id: OWNER, scopes, revoked_at: null };
  const chain = (run: (filters: Record<string, string>) => unknown): AgentQuery => {
    const filters: Record<string, string> = {};
    const query = {
      eq(column: string, value: string) {
        filters[column] = value;
        return query;
      },
      maybeSingle: () => Promise.resolve(run(filters)),
      then: (onOk: (value: unknown) => unknown, onErr?: (error: unknown) => unknown) => Promise.resolve(run(filters)).then(onOk, onErr),
    };
    return query as unknown as AgentQuery;
  };
  const admin = {
    from(table: string) {
      if (table === "mogmine_agent_audit") {
        return {
          insert: (row: Record<string, unknown>) => {
            audits.push(row);
            return Promise.resolve({ error: null });
          },
        };
      }
      return {
        select: () => chain((filters) => ({ data: filters.token_hash === hash ? keyRow : null, error: null })),
        update: () => chain(() => ({ data: null, error: null })),
      };
    },
    auth: {
      admin: {
        getUserById: async () => ({ data: { user: { email: "owner@example.test" } }, error: null }),
        generateLink: async () => ({ data: { properties: { hashed_token: "hashed" } }, error: null }),
      },
    },
  } as unknown as AdminLike;
  const anon = {
    auth: {
      verifyOtp: async () => ({ data: { session: { access_token: "access", refresh_token: "refresh", expires_at: Math.floor(NOW / 1000) + 3600 } }, error: null }),
      refreshSession: async () => ({ data: { session: null }, error: { message: "none" } }),
    },
  } as unknown as AnonAuthLike;
  const deps: AgentServerDeps = {
    env: GOOD_ENV, admin, anon, userClient: () => ({} as unknown as UserDataClient), now: () => NOW,
  };
  return { deps, audits, bearer: `Bearer ${token}` };
}

function options(env: Harness, extra: StrategyLabRequestOptions = {}): StrategyLabRequestOptions {
  return { deps: env.deps, loader: loaderFor(sessionBars()), commands: commandsWith(), now: () => NOW, ...extra };
}

beforeEach(() => __resetAgentSessionCache());

test("HTTP skills: a read key gets the registry; a write-only key is forbidden (GET needs read)", async () => {
  const read = await harness(["read"]);
  const ok = await handleSkillsRequest(new Request("https://example.test/api/v1/strategy-lab/skills", { headers: { authorization: read.bearer } }), options(read));
  assert.equal(ok.status, 200);
  const body = await ok.json() as { ok: boolean; data: { skills: unknown[] } };
  assert.equal(body.ok, true);
  assert.equal(body.data.skills.length, listSkills().length);
  assert.equal(read.audits.at(-1)?.method, "GET");
  assert.equal(read.audits.at(-1)?.outcome, "ok");

  const write = await harness(["write"]);
  const denied = await handleSkillsRequest(new Request("https://example.test/api/v1/strategy-lab/skills", { headers: { authorization: write.bearer } }), options(write));
  assert.equal(denied.status, 403);
});

test("HTTP context: a read key gets the computed card; the POST is read scope, so a write-only key is forbidden", async () => {
  const body = JSON.stringify({ symbol: "MES", time: MARK_ISO, price: MARK_PRICE, side: "long", account_id: SIM_EVAL.id });
  const read = await harness(["read"]);
  const response = await handleContextRequest(new Request("https://example.test/api/v1/strategy-lab/context", {
    method: "POST", headers: { authorization: read.bearer, "content-type": "application/json" }, body,
  }), options(read));
  assert.equal(response.status, 200);
  const parsed = await response.json() as { ok: boolean; data: AgentContextPayload };
  assert.equal(parsed.ok, true);
  assert.equal(parsed.data.card.basis, "R = $300 (SIM Eval 50K)");
  assert.equal(parsed.data.provenance.notice, CONTEXT_NOTICE);
  assert.equal(read.audits.at(-1)?.method, "POST");
  assert.equal(read.audits.at(-1)?.outcome, "ok");

  const write = await harness(["write"]);
  const denied = await handleContextRequest(new Request("https://example.test/api/v1/strategy-lab/context", {
    method: "POST", headers: { authorization: write.bearer, "content-type": "application/json" }, body,
  }), options(write));
  assert.equal(denied.status, 403);
});

test("HTTP context: a bad mark is a 422 with nothing computed", async () => {
  const read = await harness(["read"]);
  const response = await handleContextRequest(new Request("https://example.test/api/v1/strategy-lab/context", {
    method: "POST", headers: { authorization: read.bearer, "content-type": "application/json" },
    body: JSON.stringify({ symbol: "MES", time: MARK_ISO, price: 5912.3, side: "long" }),
  }), options(read));
  assert.equal(response.status, 422);
  const parsed = await response.json() as { ok: boolean; error: { code: string } };
  assert.equal(parsed.ok, false);
  assert.equal(parsed.error.code, "invalid");
});
