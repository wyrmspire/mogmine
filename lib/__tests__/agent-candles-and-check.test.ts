// #API-3: GET /api/v1/candles and POST /api/v1/checks/trade (docs/design-2026-11-24/07-agent-api.md §3.2, §3.3, §6).
// Every market-data call goes through a mocked MarketDataProvider: zero live Yahoo HTTP. The HTTP tests run the real auth
// pipeline with a read-only key against a fake per-owner database, and they prove nothing is written.
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { __resetAgentSessionCache } from "../agent/server-auth.ts";
import type { AdminLike, AgentQuery, AgentServerDeps, AnonAuthLike, AgentEnv } from "../agent/server-auth.ts";
import { createRateLimiter } from "../agent/http.ts";
import { generateAgentToken, hashAgentToken } from "../agent/tokens.ts";
import {
  cleanBars, createCandleCache, createCandleLoader, formatCt, handleCandlesRequest, loadAgentCandles, parseCandleQuery,
} from "../agent/candles.ts";
import type { CandleQuery } from "../agent/candles.ts";
import { draftRecord, handleTradeCheckRequest, parseCheckInput, runTradeCheck } from "../agent/trade-check.ts";
import type { JournalCommands } from "../commands/journal-commands.ts";
import type { TradingAccount } from "../accounts.ts";
import type { Candle, TradeRecord } from "../trades.ts";
import type { MarketDataProvider, MarketDataQuery } from "../market-data/types.ts";
import { YahooFinanceProvider } from "../market-data/yahoo.ts";
import { createFakeSupabase } from "./fake-supabase.ts";
import type { FakeSupabase } from "./fake-supabase.ts";

const OWNER = "00000000-0000-4000-8000-00000000000a";
const NOW = Date.parse("2026-11-25T12:00:00.000Z");
const GOOD_ENV: AgentEnv = { url: "https://example.supabase.test", anonKey: "anon-test", serviceKey: "service-test", adapter: "supabase" };
const MIN = 60_000;

// ---- fixtures -----------------------------------------------------------------------------------------------------------

/** One minute bar per minute from `startIso`, flat at `price` (high and low a quarter point either side). */
function flatBars(startIso: string, count: number, price: number): Candle[] {
  const start = Date.parse(startIso);
  return Array.from({ length: count }, (_, index) => ({
    time: start + index * MIN, open: price, high: price + 0.25, low: price - 0.25, close: price, volume: 100,
  }));
}

/** Replaces the bars at the given open times (ISO), keeping the rest. */
function withBars(base: Candle[], overrides: Record<string, Omit<Candle, "time" | "volume">>): Candle[] {
  return base.map((bar) => {
    const override = overrides[new Date(bar.time).toISOString()];
    return override ? { ...bar, ...override } : bar;
  });
}

/** Trade C (§5 golden case): 7263 logged at 14:14 CT, printed at 14:13 CT. 20:13Z is 14:13 CT (CST). */
const TRADE_C_BARS = withBars(flatBars("2026-11-23T20:00:00Z", 31, 7266), {
  "2026-11-23T20:13:00.000Z": { open: 7262, high: 7266, low: 7258, close: 7265 },
  "2026-11-23T20:14:00.000Z": { open: 7270, high: 7272, low: 7268, close: 7269 },
});

/** Trade A (§5 golden case): long 7137 at 07:55 CT (13:55Z), stop 7119.50, entry bar low 7083.75, exit 08:30 CT at 7150. */
const TRADE_A_BARS = withBars(flatBars("2026-11-23T13:45:00Z", 56, 7135), {
  "2026-11-23T13:55:00.000Z": { open: 7120, high: 7140, low: 7083.75, close: 7137 },
  "2026-11-23T14:30:00.000Z": { open: 7148, high: 7152, low: 7146, close: 7150 },
});

const TRADE_C_DRAFT = {
  symbol: "MES", direction: "LONG", entry_time: "2026-11-23T20:14:00Z", entry_price: 7263, quantity: 1,
};

const TRADE_A_DRAFT = {
  symbol: "MES", direction: "LONG", entry_time: "2026-11-23T13:55:00Z", entry_price: 7137, quantity: 1,
  exit_time: "2026-11-23T14:30:00Z", exit_price: 7150, stop_loss_price: 7119.5, initial_stop_price: 7119.5,
  account_id: "acc-300", stated_risk_r: 0.25,
};

/** A provider double: fixed bars, counts calls, records each query. The mapping is the real Yahoo one (no network). */
function fakeProvider(bars: Candle[], calls: { count: number; queries: MarketDataQuery[] } = { count: 0, queries: [] }): MarketDataProvider & { calls: typeof calls } {
  const real = new YahooFinanceProvider();
  return {
    name: "yahoo_finance",
    calls,
    resolveProviderSymbol: (symbol: string) => real.resolveProviderSymbol(symbol),
    supportsTickData: () => false,
    async getCandles(query: MarketDataQuery) {
      calls.count += 1;
      calls.queries.push(query);
      return bars.map((bar) => ({ ...bar }));
    },
  };
}

function query(overrides: Partial<CandleQuery> = {}): CandleQuery {
  return { symbol: "MES", timeframe: "1m", from: Date.parse("2026-11-23T20:00:00Z"), to: Date.parse("2026-11-23T20:10:00Z"), ...overrides };
}

// ---- GET /api/v1/candles: query, cleaning, labels --------------------------------------------------------------------

test("candles: MES maps to MES=F through the provider, never ES=F", () => {
  const params = new URLSearchParams({ symbol: "MES", from: "2026-11-23T20:00:00Z", to: "2026-11-23T20:10:00Z" });
  const parsed = parseCandleQuery(params);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.query.symbol, "MES");
  assert.equal(fakeProvider([]).resolveProviderSymbol("MES"), "MES=F");
  assert.notEqual(fakeProvider([]).resolveProviderSymbol("MES"), "ES=F");
});

test("candles: a 27-hour window is refused on 1m (422) and allowed on 5m", () => {
  const from = "2026-11-23T00:00:00Z";
  const to = "2026-11-24T03:00:00Z";
  const oneMinute = parseCandleQuery(new URLSearchParams({ symbol: "MES", timeframe: "1m", from, to }));
  assert.equal(oneMinute.ok, false);
  const fiveMinute = parseCandleQuery(new URLSearchParams({ symbol: "MES", timeframe: "5m", from, to }));
  assert.equal(fiveMinute.ok, true);
});

test("candles: bad symbol, timeframe, times and order are refused", () => {
  const good = { from: "2026-11-23T20:00:00Z", to: "2026-11-23T20:10:00Z" };
  assert.equal(parseCandleQuery(new URLSearchParams({ symbol: "ES=F", ...good })).ok, false);
  assert.equal(parseCandleQuery(new URLSearchParams({ symbol: "MES", timeframe: "1h", ...good })).ok, false);
  assert.equal(parseCandleQuery(new URLSearchParams({ symbol: "MES", from: "2026-11-23 20:00", to: good.to })).ok, false);
  assert.equal(parseCandleQuery(new URLSearchParams({ symbol: "MES", from: good.to, to: good.from })).ok, false);
});

test("candles: cleaning drops NaN, null, inverted-range and out-of-window bars", () => {
  const from = Date.parse("2026-11-23T20:00:00Z");
  const to = Date.parse("2026-11-23T20:10:00Z");
  const valid: Candle = { time: from, open: 7266, high: 7267, low: 7265, close: 7266, volume: 5 };
  const bars: Candle[] = [
    valid,
    { ...valid, time: from + MIN, open: Number.NaN },
    { ...valid, time: from + 2 * MIN, close: null as unknown as number },
    { ...valid, time: from + 3 * MIN, open: 7265, close: 7268, low: 7270 },       // low above min(open, close)
    { ...valid, time: from + 4 * MIN, open: 7266, close: 7266, high: 7265 },      // high below max(open, close)
    { ...valid, time: from - MIN },                                              // before the window
    { ...valid, time: to },                                                      // at the exclusive end
    { ...valid, time: from + 5 * MIN, volume: Number.NaN },                      // kept; volume becomes 0
  ];
  const cleaned = cleanBars(bars, from, to);
  assert.deepEqual(cleaned.map((bar) => bar.time), [from, from + 5 * MIN]);
  assert.equal(cleaned[1].volume, 0);
});

test("candles: CT label for 2026-11-23T20:13Z is 14:13", () => {
  assert.equal(formatCt(Date.parse("2026-11-23T20:13:00Z")), "14:13");
});

test("candles: a missing run of expected bars is one gap with its count", async () => {
  const start = Date.parse("2026-11-23T20:00:00Z");
  const present = flatBars("2026-11-23T20:00:00Z", 10, 7266).filter((bar) => bar.time !== start + 3 * MIN && bar.time !== start + 4 * MIN);
  const loader = createCandleLoader({ provider: fakeProvider(present), now: () => NOW });
  const loaded = await loadAgentCandles(loader, query(), "tok");
  assert.equal(loaded.ok, true);
  if (!loaded.ok) return;
  assert.equal(loaded.value.coverage.expected, 10);
  assert.equal(loaded.value.coverage.present, 8);
  assert.deepEqual(loaded.value.coverage.gaps, [
    { from: "2026-11-23T20:03:00.000Z", to: "2026-11-23T20:04:00.000Z", bars: 2 },
  ]);
});

test("candles: a weekend window answers closed with no bars", async () => {
  const loader = createCandleLoader({ provider: fakeProvider([]), now: () => NOW });
  const loaded = await loadAgentCandles(loader, query({ from: Date.parse("2026-11-21T15:00:00Z"), to: Date.parse("2026-11-21T16:00:00Z") }), "tok");
  assert.equal(loaded.ok, true);
  if (!loaded.ok) return;
  assert.equal(loaded.value.reason, "closed");
  assert.deepEqual(loaded.value.bars, []);
});

test("candles: a future window answers future and does not ask the provider", async () => {
  const provider = fakeProvider(TRADE_C_BARS);
  const loader = createCandleLoader({ provider, now: () => NOW });
  const loaded = await loadAgentCandles(loader, query({ from: NOW + 3_600_000, to: NOW + 7_200_000 }), "tok");
  assert.equal(loaded.ok, true);
  if (!loaded.ok) return;
  assert.equal(loaded.value.reason, "future");
  assert.equal(provider.calls.count, 0);
});

test("candles: a cache hit avoids a second provider call, and an expired entry is fetched again", async () => {
  let clock = NOW;
  const provider = fakeProvider(TRADE_C_BARS);
  const loader = createCandleLoader({ provider, cache: createCandleCache({ maxEntries: 64, now: () => clock }), now: () => clock });
  const window = query();
  await loadAgentCandles(loader, window, "tok");
  await loadAgentCandles(loader, window, "tok");
  assert.equal(provider.calls.count, 1);
  clock += 11 * MIN;
  await loadAgentCandles(loader, window, "tok");
  assert.equal(provider.calls.count, 2);
});

test("candles: the cache is bounded (least recently used goes first)", () => {
  const cache = createCandleCache({ maxEntries: 2 });
  cache.set("a", [], 60_000);
  cache.set("b", [], 60_000);
  cache.get("a");
  cache.set("c", [], 60_000);
  assert.equal(cache.size(), 2);
  assert.equal(cache.get("b"), undefined);
  assert.notEqual(cache.get("a"), undefined);
});

test("candles: cache misses over 15 a minute for one key are 429; hits are not counted", async () => {
  const clock = NOW;
  const provider = fakeProvider(TRADE_C_BARS);
  const loader = createCandleLoader({
    provider,
    upstream: createRateLimiter({ limit: 15, windowMs: 60_000, now: () => clock }),
    now: () => clock,
  });
  const start = Date.parse("2026-11-23T20:00:00Z");
  const results: string[] = [];
  for (let index = 0; index < 16; index += 1) {
    const loaded = await loadAgentCandles(loader, query({ from: start + index * MIN, to: start + (index + 5) * MIN }), "tok");
    results.push(loaded.ok ? "ok" : loaded.code);
  }
  assert.equal(results.filter((result) => result === "ok").length, 15);
  assert.equal(results[15], "rate_limited");
  assert.equal(provider.calls.count, 15);
  // A repeat of an earlier window is a cache hit and does not take a slot.
  const repeat = await loadAgentCandles(loader, query({ from: start, to: start + 5 * MIN }), "tok");
  assert.equal(repeat.ok, true);
});

// ---- POST /api/v1/checks/trade: pure checks (fake commands, fixture bars) --------------------------------------------

/** Read-only command double: it answers reads from fixtures and records every write it is asked for. */
function fakeCommands(options: { accounts?: TradingAccount[]; stored?: TradeRecord } = {}) {
  const writes: string[] = [];
  const reads = {
    list: async (type: string) => ({ ok: true as const, value: type === "accounts" ? options.accounts ?? [] : [] }),
    readSingleton: async () => ({ ok: true as const, value: null }),
    read: async (type: string, id: string) => (options.stored && type === "trades" && id === options.stored.id
      ? { ok: true as const, value: { record: options.stored } }
      : { ok: false as const, error: { code: "not_found", message: `No ${type} ${id}.` } }),
  };
  const refuse = (name: string) => async () => {
    writes.push(name);
    return { ok: false as const, error: { code: "unavailable", message: "read-only check" } };
  };
  const commands = {
    ...reads,
    create: refuse("create"), update: refuse("update"), remove: refuse("remove"), archive: refuse("archive"), writeSingleton: refuse("writeSingleton"),
  };
  return { commands: commands as unknown as JournalCommands, writes };
}

const ACCOUNT_300 = { id: "acc-300", name: "SIM Eval 50K", r_size_cents: 30000, archived: false } as unknown as TradingAccount;

function checkRun(provider: MarketDataProvider, commands: JournalCommands) {
  return { commands, loader: createCandleLoader({ provider, now: () => NOW }), limitKey: "tok", now: NOW };
}

test("checks: Trade C draft is shifted -1 to the 14:13 CT bar, with the matched ISO time", async () => {
  const { commands, writes } = fakeCommands();
  const result = await runTradeCheck({ kind: "draft", body: TRADE_C_DRAFT }, checkRun(fakeProvider(TRADE_C_BARS), commands));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const [entry] = result.data.fills;
  assert.equal(entry.role, "entry");
  assert.equal(entry.match, "shifted");
  assert.equal(entry.match === "shifted" ? entry.offset_min : null, -1);
  assert.equal(entry.match === "shifted" ? entry.matched : null, "2026-11-23T20:13:00.000Z");
  assert.equal(entry.match === "shifted" ? entry.message : null, "7263.00 did not trade in the 14:14 CT bar. It traded at 14:13 CT. Ask the trader.");
  assert.deepEqual(writes, []);
});

test("checks: Trade A draft has no stop touch from the entry bar, and the derived R values", async () => {
  const { commands, writes } = fakeCommands({ accounts: [ACCOUNT_300] });
  const result = await runTradeCheck({ kind: "draft", body: TRADE_A_DRAFT }, checkRun(fakeProvider(TRADE_A_BARS), commands));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.findings.filter((finding) => finding.code === "stop_traded_through").length, 0);
  assert.equal(result.data.derived.risk_cents, 8750);
  assert.equal(result.data.derived.r_size_cents, 30000);
  assert.equal(result.data.derived.r_size_source, "account");
  assert.equal(result.data.derived.stated_risk_r, 0.25);
  // Unrounded, as /records?include=derived returns it (8750 / 30000); docs/07 §3.3 shows it rounded for display.
  assert.ok(result.data.derived.risk_r !== null && Math.abs(result.data.derived.risk_r - 0.29) < 0.005);
  assert.deepEqual(writes, []);
});

test("checks: a stop move before the entry is ok:false, and a missing playbook is a warning", async () => {
  const { commands } = fakeCommands({ accounts: [ACCOUNT_300] });
  const body = { ...TRADE_A_DRAFT, stop_moves: [{ price: 7125, time: "2026-11-23T13:40:00Z" }] };
  const result = await runTradeCheck({ kind: "draft", body }, checkRun(fakeProvider(TRADE_A_BARS), commands));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.stop_moves[0].ok, false);
  assert.match(result.data.stop_moves[0].message ?? "", /between entry \(07:55 CT\) and exit \(08:30 CT\)/);
  assert.ok(result.data.warnings.some((warning) => warning.code === "playbook_missing"));
});

test("checks: a stop move inside the hold on the tick grid is ok", async () => {
  const { commands } = fakeCommands({ accounts: [ACCOUNT_300] });
  const body = { ...TRADE_A_DRAFT, stop_loss_price: 7125, stop_moves: [{ price: 7125, time: "2026-11-23T14:10:00Z" }] };
  const result = await runTradeCheck({ kind: "draft", body }, checkRun(fakeProvider(TRADE_A_BARS), commands));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.data.stop_moves, [{ time: "2026-11-23T14:10:00.000Z", price: 7125, ok: true }]);
});

test("checks: a stored trade is read by id; an unknown id is not_found", async () => {
  const stored = draftRecordFor({ ...TRADE_C_DRAFT, id: "trade-c" }) as TradeRecord;
  const { commands } = fakeCommands({ stored });
  const found = await runTradeCheck({ kind: "stored", id: "trade-c" }, checkRun(fakeProvider(TRADE_C_BARS), commands));
  assert.equal(found.ok, true);
  const missing = await runTradeCheck({ kind: "stored", id: "nope" }, checkRun(fakeProvider(TRADE_C_BARS), commands));
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.status, 404);
});

test("checks: a malformed draft is 422 and a body that is not an object is refused", () => {
  assert.equal(draftRecord({ ...TRADE_C_DRAFT, direction: "SIDEWAYS" }).ok, false);
  assert.equal(draftRecord({ ...TRADE_C_DRAFT, exit_time: "2026-11-23T20:10:00Z" }).ok, false);
  assert.equal(parseCheckInput(["not", "an", "object"]).kind, "invalid");
  assert.deepEqual(parseCheckInput({ id: "trade-c" }), { kind: "stored", id: "trade-c" });
  assert.equal(parseCheckInput(TRADE_C_DRAFT).kind, "draft");
});

/** The normalized record a draft becomes, used as the stored trade in the stored-path test. */
function draftRecordFor(body: Record<string, unknown>): Partial<TradeRecord> {
  const built = draftRecord(body);
  if (!built.ok) throw new Error(built.message);
  return built.record;
}

// ---- HTTP: read key, real auth pipeline, fake owner database -----------------------------------------------------------

interface Harness {
  deps: AgentServerDeps;
  owner: FakeSupabase;
  audits: Record<string, unknown>[];
  bearer: string;
}

async function harness(scopes: string[] = ["read"]): Promise<Harness> {
  const { token } = generateAgentToken();
  const hash = await hashAgentToken(token);
  const audits: Record<string, unknown>[] = [];
  const owner = createFakeSupabase(OWNER);
  const rows = { id: "token-1", user_id: OWNER, scopes, revoked_at: null };
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
          select: () => chain(() => ({ data: null, error: null })),
          update: () => chain(() => ({ data: null, error: null })),
          insert: (row: Record<string, unknown>) => {
            audits.push(row);
            return Promise.resolve({ error: null });
          },
        };
      }
      return {
        select: () => chain((filters) => ({ data: filters.token_hash === hash ? rows : null, error: null })),
        update: () => chain(() => ({ data: null, error: null })),
        insert: () => Promise.resolve({ error: null }),
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
  const deps: AgentServerDeps = { env: GOOD_ENV, admin, anon, userClient: () => owner, now: () => NOW };
  return { deps, owner, audits, bearer: `Bearer ${token}` };
}

beforeEach(() => __resetAgentSessionCache());

test("http: GET /candles with a read key returns ct-labelled bars and coverage", async () => {
  const env = await harness();
  const url = "https://mogmine.test/api/v1/candles?symbol=MES&timeframe=1m&from=2026-11-23T20:00:00Z&to=2026-11-23T20:30:00Z";
  const response = await handleCandlesRequest(new Request(url, { headers: { authorization: env.bearer } }), {
    deps: env.deps,
    loader: createCandleLoader({ provider: fakeProvider(TRADE_C_BARS), now: () => NOW }),
  });
  assert.equal(response.status, 200);
  const body = await response.json() as { ok: boolean; data: { ticker: string; bars: Array<{ ct: string; iso: string }>; coverage: { expected: number } } };
  assert.equal(body.ok, true);
  assert.equal(body.data.ticker, "MES=F");
  assert.equal(body.data.bars.find((bar) => bar.iso === "2026-11-23T20:13:00.000Z")?.ct, "14:13");
  assert.equal(body.data.coverage.expected, 30);
  assert.equal(env.audits.at(-1)?.method, "GET");
});

test("http: POST /checks/trade with a READ-ONLY key is allowed, shifts Trade C, and writes nothing", async () => {
  const env = await harness(["read"]);
  const response = await handleTradeCheckRequest(new Request("https://mogmine.test/api/v1/checks/trade", {
    method: "POST",
    headers: { authorization: env.bearer, "content-type": "application/json" },
    body: JSON.stringify(TRADE_C_DRAFT),
  }), { deps: env.deps, loader: createCandleLoader({ provider: fakeProvider(TRADE_C_BARS), now: () => NOW }), now: NOW });
  assert.equal(response.status, 200);
  const body = await response.json() as { ok: boolean; data: { fills: Array<{ match: string }> } };
  assert.equal(body.ok, true);
  assert.equal(body.data.fills[0].match, "shifted");
  const rows = [...env.owner.tables.values()].reduce((total, table) => total + table.length, 0);
  assert.equal(rows, 0, "nothing is written to the owner's repository");
  assert.equal(env.audits.at(-1)?.method, "POST");
});

test("http: no bearer key is 401", async () => {
  const env = await harness(["read"]);
  const unauthenticated = await handleTradeCheckRequest(new Request("https://mogmine.test/api/v1/checks/trade", {
    method: "POST", body: JSON.stringify(TRADE_C_DRAFT),
  }), { deps: env.deps, now: NOW });
  assert.equal(unauthenticated.status, 401);
});

test("http: a malformed JSON body is 422", async () => {
  const env = await harness();
  const response = await handleTradeCheckRequest(new Request("https://mogmine.test/api/v1/checks/trade", {
    method: "POST", headers: { authorization: env.bearer }, body: "{not json",
  }), { deps: env.deps, now: NOW });
  assert.equal(response.status, 422);
});
