// HR-5 (stop trigger vs slipped fill), HR-10 (?include=derived) and the day price range in POST /api/v1/checks/trade.
// Pure over fixtures: no network (the provider is a double), no journal, no live API. Market prices are MES-scale fixtures.
import test from "node:test";
import assert from "node:assert/strict";
import { HOUSE_RULES, AGENT_WORKFLOWS } from "../agent/house-rules.ts";
import { checkTradeWrite } from "../agent/write-checks.ts";
import type { AgentWriteWarning, WriteCheckContext } from "../agent/write-checks.ts";
import { createCandleLoader } from "../agent/candles.ts";
import { draftRecord, runTradeCheck } from "../agent/trade-check.ts";
import type { JournalCommands } from "../commands/journal-commands.ts";
import type { Candle } from "../trades.ts";
import type { MarketDataProvider, MarketDataQuery } from "../market-data/types.ts";
import { YahooFinanceProvider } from "../market-data/yahoo.ts";
import { EXECUTION_TAGS, SETUP_TAGS } from "../playbooks.ts";

const NOW = Date.parse("2026-11-25T12:00:00.000Z");
const MINUTE = 60_000;

// ---- HR-5 and HR-10 text --------------------------------------------------------------------------------------------

function rule(id: string) {
  const found = HOUSE_RULES.find((item) => item.id === id);
  assert.ok(found, `${id} exists`);
  return found;
}

test("HR-5 separates the stop trigger from the slipped fill and keeps the true stop", () => {
  const hr5 = rule("HR-5");
  assert.match(hr5.title, /trigger|slip/i);
  assert.match(hr5.rule, /triggered/);
  assert.match(hr5.rule, /slippage/);
  assert.match(hr5.rule, /never move `stop_loss_price`/);
  assert.match(hr5.rule, /`manual` \(or `target`\), not `stop`/);
});

test("HR-10 points to ?include=derived and drops the stale 'until then' phrase", () => {
  const hr10 = rule("HR-10");
  assert.match(hr10.rule, /\?include=derived/);
  assert.match(hr10.rule, /pnl_cents/);
  assert.match(hr10.rule, /result_r/);
  assert.match(hr10.rule, /session_date/);
  const text = JSON.stringify(HOUSE_RULES) + JSON.stringify(AGENT_WORKFLOWS);
  assert.equal(text.includes("until then, do not expect"), false);
  assert.equal(/until then, do not expect/.test(text), false);
});

test("house-rules guard: no journal, owner or service text in the rules", () => {
  const text = JSON.stringify(HOUSE_RULES) + JSON.stringify(AGENT_WORKFLOWS);
  assert.doesNotMatch(text, /trade-2026/);
  assert.doesNotMatch(text, /\bshowmob\b/i);
  assert.doesNotMatch(text, /mmk_/);
  assert.doesNotMatch(text, /service/i);
});

// ---- exit_reason_mismatch: side-aware, through checkTradeWrite --------------------------------------------------------

const CTX: WriteCheckContext = {
  playbooks: [],
  accounts: [],
  setupTags: [...SETUP_TAGS],
  executionTags: [...EXECUTION_TAGS],
  defaultRSizeCents: 30_000,
  isCreate: true,
  writtenFields: new Set(),
  nowMs: NOW,
};

/** A closed MES trade whose working stop is `stop` and whose exit is `exit`, built through the draft normaliser. */
function exitCheck(direction: "LONG" | "SHORT", stop: number, exit: number, reason: "stop" | "trail" | "manual" = "stop"): AgentWriteWarning[] {
  const built = draftRecord({
    symbol: "MES", direction, quantity: 1,
    entry_time: "2026-11-25T11:00:00Z", entry_price: 5010,
    exit_time: "2026-11-25T11:20:00Z", exit_price: exit,
    stop_loss_price: stop, initial_stop_price: stop, exit_reason: reason,
    quick_tags: [SETUP_TAGS[0]],
  });
  assert.equal(built.ok, true, built.ok ? "" : built.message);
  if (!built.ok) return [];
  const checked = checkTradeWrite(built.record, {}, CTX);
  assert.equal(checked.ok, true, checked.ok ? "" : checked.message);
  return checked.ok ? checked.warnings.filter((warning) => warning.code === "exit_reason_mismatch") : [];
}

test("LONG stop 5000.00: 2 ticks adverse (4999.50) is within tolerance and silent", () => {
  assert.deepEqual(exitCheck("LONG", 5000, 4999.5), []);
});

test("LONG stop 5000.00: 6 ticks adverse (4998.50) warns about slippage and keeps the true prices", () => {
  const warnings = exitCheck("LONG", 5000, 4998.5);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0].message, /slipped 6 ticks past working stop 5000/);
  assert.match(warnings[0].message, /Keep both true prices/);
  assert.match(warnings[0].message, /HR-5/);
});

test("LONG stop 5000.00: 5 ticks favorable (5001.25) warns that the stop was never reached", () => {
  const warnings = exitCheck("LONG", 5000, 5001.25);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0].message, /5 ticks on the favorable \(untriggered\) side/);
  assert.match(warnings[0].message, /"manual" or "target"/);
});

test("SHORT stop 5000.00: 2 ticks adverse (5000.50) is silent; 6 ticks adverse (5001.50) warns about slippage", () => {
  assert.deepEqual(exitCheck("SHORT", 5000, 5000.5), []);
  const adverse = exitCheck("SHORT", 5000, 5001.5);
  assert.equal(adverse.length, 1);
  assert.match(adverse[0].message, /slipped 6 ticks past working stop 5000/);
});

test("SHORT stop 5000.00: 6 ticks favorable (4998.50) warns about the untriggered side", () => {
  const warnings = exitCheck("SHORT", 5000, 4998.5);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0].message, /6 ticks on the favorable \(untriggered\) side/);
});

test("a manual exit away from the stop never raises exit_reason_mismatch", () => {
  assert.deepEqual(exitCheck("LONG", 5000, 5001.25, "manual"), []);
});

// ---- price_out_of_range from the bars the check loads --------------------------------------------------------------

/** Minute bars from 13:45Z for `count` minutes, every bar inside `low`-`high`. */
function barsBetween(low: number, high: number, count: number): Candle[] {
  const start = Date.parse("2026-11-23T13:45:00Z");
  return Array.from({ length: count }, (_, index) => ({
    time: start + index * MINUTE,
    open: (low + high) / 2, high, low, close: (low + high) / 2, volume: 100,
  }));
}

/** A provider double returning fixed bars. The symbol mapping is the real Yahoo one; no network is used. */
function fixedProvider(bars: Candle[]): MarketDataProvider {
  const real = new YahooFinanceProvider();
  return {
    name: "yahoo_finance",
    resolveProviderSymbol: (symbol: string) => real.resolveProviderSymbol(symbol),
    supportsTickData: () => false,
    async getCandles(_query: MarketDataQuery) {
      return bars.map((bar) => ({ ...bar }));
    },
  };
}

/** Read-only command double with an empty vocabulary: the seeds stand in for playbooks. */
const EMPTY_COMMANDS = {
  list: async () => ({ ok: true as const, value: [] }),
  readSingleton: async () => ({ ok: true as const, value: null }),
  read: async () => ({ ok: false as const, error: { code: "not_found", message: "none" } }),
} as unknown as JournalCommands;

function draftBody(entry: number, entryIso: string): Record<string, unknown> {
  return { symbol: "MES", direction: "LONG", entry_time: entryIso, entry_price: entry, quantity: 1 };
}

test("checks: an entry of 4866.25 against bars that trade 7110-7145 warns price_out_of_range", async () => {
  const bars = barsBetween(7110, 7145, 46);
  const result = await runTradeCheck(
    { kind: "draft", body: draftBody(4866.25, "2026-11-23T13:55:00Z") },
    { commands: EMPTY_COMMANDS, loader: createCandleLoader({ provider: fixedProvider(bars), now: () => NOW }), limitKey: "tok", now: NOW },
  );
  assert.equal(result.ok, true, result.ok ? "" : result.message);
  if (!result.ok) return;
  const out = result.data.warnings.filter((warning) => warning.code === "price_out_of_range");
  assert.equal(out.length, 1);
  assert.match(out[0].message, /entry_price 4866\.25 .* 7110-7145/);
});

test("checks: an entry inside the loaded range raises no price_out_of_range", async () => {
  const bars = barsBetween(7110, 7145, 46);
  const result = await runTradeCheck(
    { kind: "draft", body: draftBody(7120, "2026-11-23T13:55:00Z") },
    { commands: EMPTY_COMMANDS, loader: createCandleLoader({ provider: fixedProvider(bars), now: () => NOW }), limitKey: "tok", now: NOW },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.warnings.some((warning) => warning.code === "price_out_of_range"), false);
});

// ---- regression: the day range is the whole session day, not the +-10-minute fill window (live check, 2026-11-27) ----

/** A provider double that answers each query with the master bars inside the queried window, like a real provider. */
function windowProvider(all: Candle[]): MarketDataProvider {
  const real = new YahooFinanceProvider();
  return {
    name: "yahoo_finance",
    resolveProviderSymbol: (symbol: string) => real.resolveProviderSymbol(symbol),
    supportsTickData: () => false,
    async getCandles(query: MarketDataQuery) {
      const from = +query.from;
      const to = +query.to;
      return all.filter((bar) => bar.time >= from && bar.time < to).map((bar) => ({ ...bar }));
    },
  };
}

test("checks: an entry priced at the morning's levels does not warn when checked against the afternoon's window", async () => {
  // Mirrors the live 2026-11-23 check that misfired: the session traded at 7137 in the morning (07:55 CT) and at
  // 7232.25-7278.25 around 09:10 CT. Ranging only the fill window warned that 7140 was outside the "day".
  const morning: Candle = { time: Date.parse("2026-11-23T13:55:00Z"), open: 7140, high: 7145, low: 7130, close: 7142, volume: 100 };
  const afternoon = Array.from({ length: 21 }, (_, index) => ({
    time: Date.parse("2026-11-23T15:00:00Z") + index * MINUTE,
    open: 7250, high: 7278.25, low: 7232.25, close: 7250, volume: 100,
  }));
  const loader = createCandleLoader({ provider: windowProvider([morning, ...afternoon]), now: () => NOW });
  const run = { commands: EMPTY_COMMANDS, loader, limitKey: "tok", now: NOW };

  const inside = await runTradeCheck({ kind: "draft", body: draftBody(7140, "2026-11-23T15:10:00Z") }, run);
  assert.equal(inside.ok, true, inside.ok ? "" : inside.message);
  if (!inside.ok) return;
  assert.equal(inside.data.warnings.some((warning) => warning.code === "price_out_of_range"), false);

  // A price outside even the whole session still warns, and the message cites the session range, not the window's.
  const outside = await runTradeCheck({ kind: "draft", body: draftBody(6000, "2026-11-23T15:10:00Z") }, run);
  assert.equal(outside.ok, true);
  if (!outside.ok) return;
  const out = outside.data.warnings.filter((warning) => warning.code === "price_out_of_range");
  assert.equal(out.length, 1);
  assert.match(out[0].message, /entry_price 6000 .* 7130-7278\.25/);
});
