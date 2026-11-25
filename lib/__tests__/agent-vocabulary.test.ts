// #API-2a: the vocabulary, derived values and list filters, driven through the real command layer over the local
// mock adapter (not a stand-in). Every value here is a fixture; no live API or real journal is touched.
import test from "node:test";
import assert from "node:assert/strict";
import { buildVocabulary } from "../agent/vocabulary.ts";
import { dispatchAgentRoute } from "../agent/dispatch.ts";
import type { AgentWho } from "../agent/dispatch.ts";
import { parseAgentListFilters, parseIncludeDerived, parseListQuery } from "../agent/http.ts";
import { createJournalCommands } from "../commands/journal-commands.ts";
import { createLocalAdapter, createMemoryCandleStore, createMemoryKeyValueStore } from "../persistence/local-adapter.ts";
import type { KeyValueStore } from "../persistence/local-adapter.ts";
import { accountSummary, makeAccount } from "../accounts.ts";
import { HOUSE_RULES_VERSION } from "../agent/house-rules.ts";
import { PLAYBOOK_SEEDS, SETUP_TAGS } from "../playbooks.ts";

const WHO: AgentWho = { userId: "owner", tokenId: "tok", scopes: ["read"] };
const NOW = "2026-11-25T12:00:00.000Z";

function setup(seed: Record<string, string> = {}) {
  const store: KeyValueStore = createMemoryKeyValueStore(seed);
  const adapter = createLocalAdapter({ kind: "mock", store, candles: createMemoryCandleStore() });
  return { store, commands: createJournalCommands(adapter.repositories) };
}

/** Trade A: MES long 7600 → 7723 (123 points = $615), initial stop 7582.5 (17.5 points = $87.50). */
const tradeA = (over: Record<string, unknown> = {}) => ({
  id: "trade-a", symbol: "MES", direction: "LONG", quantity: 1, status: "closed",
  entry_time: "2026-11-23T14:30:00Z", exit_time: "2026-11-23T15:10:00Z",
  entry_price: 7600, exit_price: 7723, stop_loss_price: 7582.5,
  initial_stop_price: 7582.5, initial_stop_set_at: "2026-11-23T14:29:00Z",
  account_id: "sim-acct-eval-50k", playbook_id: "orb-reclaim",
  ...over,
});

/** An open trade entered at 18:30 ET on the 23rd: it belongs to the 24th's session. */
const openTrade = (over: Record<string, unknown> = {}) => ({
  id: "trade-open", symbol: "MES", direction: "SHORT", quantity: 1, status: "open",
  entry_time: "2026-11-23T23:30:00Z", exit_time: null, exit_price: null,
  entry_price: 7650, stop_loss_price: 7660, initial_stop_price: 7660, initial_stop_set_at: "2026-11-23T23:29:00Z",
  account_id: null, playbook_id: "vwap-trend-push",
  ...over,
});

async function seedJournal(commands: ReturnType<typeof createJournalCommands>) {
  const account = makeAccount({ id: "sim-acct-eval-50k", name: "SIM Eval 50K", starting_balance_cents: 5_000_000, now: NOW, r_size_cents: 30_000 });
  assert.equal((await commands.create("accounts", account)).ok, true);
  const plain = makeAccount({ id: "acct-plain", name: "Plain", starting_balance_cents: 1_000_000, now: NOW, r_size_cents: null });
  assert.equal((await commands.create("accounts", plain)).ok, true);
  const archived = makeAccount({ id: "acct-old", name: "Old eval", starting_balance_cents: 1_000_000, now: NOW, r_size_cents: null });
  assert.equal((await commands.create("accounts", { ...archived, archived: true })).ok, true);
  assert.equal((await commands.create("trades", tradeA())).ok, true);
  assert.equal((await commands.create("trades", openTrade())).ok, true);
}

// ---- the vocabulary -------------------------------------------------------------------------------------------------

test("vocabulary with no stored playbooks falls back to the seeds, and lists tags apart from playbooks", async () => {
  const { commands } = setup();
  const vocab = await buildVocabulary(commands);
  assert.equal(vocab.ok, true);
  if (!vocab.ok) return;
  assert.equal(vocab.value.house_rules_version, HOUSE_RULES_VERSION);
  assert.deepEqual(vocab.value.playbooks.map((p) => p.id), PLAYBOOK_SEEDS.map((p) => p.id));
  assert.ok(vocab.value.setup_tags.includes("VWAP Hold"));
  assert.ok(!vocab.value.playbooks.some((p) => p.name === "VWAP Hold"), "VWAP Hold is a setup tag, never a playbook");
  assert.deepEqual(vocab.value.setup_tags, [...SETUP_TAGS]);
});

test("vocabulary: playbooks are the owner's, active first with archived flagged; accounts are active only", async () => {
  const { commands } = setup();
  await seedJournal(commands);
  assert.equal((await commands.create("playbooks", {
    id: "custom-old", name: "Old setup", default_style: "scalp", checklist_rules: [{ id: "r1", label: "Old rule" }], archived: true,
  })).ok, true);
  assert.equal((await commands.create("playbooks", {
    id: "custom-live", name: "Live setup", default_style: "scalp", checklist_rules: [{ id: "r2", label: "Live rule" }], archived: false,
  })).ok, true);
  const vocab = await buildVocabulary(commands);
  assert.equal(vocab.ok, true);
  if (!vocab.ok) return;
  const playbooks = vocab.value.playbooks;
  // The store seeds the defaults too, so the list is theirs plus the two custom ones. Active come before archived.
  const flags = playbooks.map((p) => p.archived);
  assert.deepEqual(flags, [...flags].sort((a, b) => Number(a) - Number(b)), "active first, archived last");
  assert.deepEqual(playbooks.filter((p) => p.id.startsWith("custom")).map((p) => [p.id, p.archived]), [["custom-live", false], ["custom-old", true]]);
  assert.deepEqual(playbooks.find((p) => p.id === "custom-live")?.rules, ["Live rule"]);
  assert.deepEqual(vocab.value.accounts.map((a) => a.id), ["sim-acct-eval-50k", "acct-plain"], "the archived account is absent");
});

test("vocabulary: R size is the account's when it has one, else the default from prefs (25 000 cents)", async () => {
  const { commands } = setup();
  await seedJournal(commands);
  const vocab = await buildVocabulary(commands);
  assert.equal(vocab.ok, true);
  if (!vocab.ok) return;
  const byId = Object.fromEntries(vocab.value.accounts.map((a) => [a.id, a]));
  assert.deepEqual(byId["sim-acct-eval-50k"], { id: "sim-acct-eval-50k", name: "SIM Eval 50K", r_size_cents: 30_000, r_size_source: "account" });
  assert.deepEqual(byId["acct-plain"], { id: "acct-plain", name: "Plain", r_size_cents: 25_000, r_size_source: "prefs" });
  assert.equal(vocab.value.default_r_size_cents, 25_000);
});

test("vocabulary: exit reasons, symbols, plan presets and time rules are the app's own lists", async () => {
  const { commands } = setup({ "mogmine-prefs-v1": JSON.stringify({ timeZone: "America/New_York" }) });
  const vocab = await buildVocabulary(commands);
  assert.equal(vocab.ok, true);
  if (!vocab.ok) return;
  assert.deepEqual(vocab.value.exit_reasons.map((r) => r.value), ["target", "stop", "trail", "breakeven", "manual"]);
  assert.equal(vocab.value.exit_reasons.find((r) => r.value === "trail")?.label, "Trailed");
  assert.ok(vocab.value.exit_reasons.every((r) => r.effect.length > 0));
  assert.deepEqual(vocab.value.symbols.find((s) => s.symbol === "MES"), { symbol: "MES", tick_size: 0.25, point_value_usd: 5 });
  assert.deepEqual(vocab.value.symbols.find((s) => s.symbol === "ES"), { symbol: "ES", tick_size: 0.25, point_value_usd: 50 });
  assert.deepEqual(vocab.value.plan_presets.map((p) => p.preset), ["pre_globex", "pre_market", "pre_power_hour", "pre_moc", "pre_gap_fill"]);
  assert.deepEqual(vocab.value.plan_presets.find((p) => p.preset === "pre_market"), { preset: "pre_market", name: "Pre-market (New York)", anchor_ct: "08:30" });
  assert.deepEqual(vocab.value.time, { display_zone: "America/New_York", session_zone: "America/New_York", session_rollover_et: "18:00" });
});

test("vocabulary: display zone defaults to America/Chicago when the owner has no prefs", async () => {
  const { commands } = setup();
  const vocab = await buildVocabulary(commands);
  assert.equal(vocab.ok && vocab.value.time.display_zone, "America/Chicago");
});

// ---- derived values -------------------------------------------------------------------------------------------------

test("derived on a closed trade: pnl, result R, risk in cents and R, hold and session", async () => {
  const { commands } = setup();
  await seedJournal(commands);
  const route = { kind: "read" as const, type: "trades" as const, id: "trade-a", includeDerived: true };
  const result = await dispatchAgentRoute(route, commands, WHO);
  assert.equal(result.status, 200);
  const data = (result.body as { data: { record: { id: string }; meta: object; derived: Record<string, unknown> } }).data;
  assert.equal(data.record.id, "trade-a");
  assert.ok("meta" in data, "the stored wrapper keeps its meta");
  assert.equal(data.derived.pnl_cents, 61_500);
  assert.equal(data.derived.result_r, 2.05);
  assert.equal(data.derived.risk_cents, 8_750);
  assert.ok(Math.abs((data.derived.risk_r as number) - 8_750 / 30_000) < 1e-12);
  assert.equal(data.derived.r_size_cents, 30_000);
  assert.equal(data.derived.hold_seconds, 2_400);
  assert.equal(data.derived.session_date, "2026-11-23");
  assert.equal(data.derived.stated_risk_r, null);
});

test("derived on an open trade: P&L, result R and hold are null; the session is the next day after 18:00 ET", async () => {
  const { commands } = setup();
  await seedJournal(commands);
  const result = await dispatchAgentRoute({ kind: "read", type: "trades", id: "trade-open", includeDerived: true }, commands, WHO);
  const derived = (result.body as { data: { derived: Record<string, unknown> } }).data.derived;
  assert.equal(derived.pnl_cents, null);
  assert.equal(derived.result_r, null);
  assert.equal(derived.hold_seconds, null);
  assert.equal(derived.session_date, "2026-11-24");
  assert.equal(derived.risk_cents, 5_000, "a 10-point stop on MES is $50");
  assert.equal(derived.r_size_source, "trade", "the default R size was frozen on the trade when it was saved (D-B)");
  assert.equal(derived.r_size_cents, 25_000);
});

test("without include=derived the read is the plain stored wrapper, and nothing is stored", async () => {
  const { commands } = setup();
  await seedJournal(commands);
  const result = await dispatchAgentRoute({ kind: "read", type: "trades", id: "trade-a" }, commands, WHO);
  assert.equal("derived" in (result.body as { data: object }).data, false);
  const stored = await commands.read("trades", "trade-a");
  assert.equal(stored.ok && "derived" in stored.value.record, false, "derived values are never stored");
});

test("list with include=derived adds derived to each trade and leaves the list shape otherwise", async () => {
  const { commands } = setup();
  await seedJournal(commands);
  const list = await dispatchAgentRoute({ kind: "list", type: "trades", query: parseListQuery(new URLSearchParams("include=derived")) }, commands, WHO);
  const rows = (list.body as { data: Array<{ id: string; derived: { pnl_cents: number | null } }> }).data;
  assert.deepEqual(rows.map((r) => r.id).sort(), ["trade-a", "trade-open"]);
  assert.equal(rows.find((r) => r.id === "trade-a")?.derived.pnl_cents, 61_500);
  const plain = await dispatchAgentRoute({ kind: "list", type: "trades", query: parseListQuery(new URLSearchParams()) }, commands, WHO);
  assert.equal(((plain.body as { data: object[] }).data).every((row) => !("derived" in row)), true);
});

test("account derived matches accountSummary and says it is from the journal", async () => {
  const { commands } = setup();
  await seedJournal(commands);
  const result = await dispatchAgentRoute({ kind: "read", type: "accounts", id: "sim-acct-eval-50k", includeDerived: true }, commands, WHO);
  const derived = (result.body as { data: { derived: Record<string, unknown> } }).data.derived;
  const account = makeAccount({ id: "sim-acct-eval-50k", name: "SIM Eval 50K", starting_balance_cents: 5_000_000, now: NOW, r_size_cents: 30_000 });
  const trades = await commands.list("trades", { includeSamples: false });
  const checks = await commands.list("balance_checks", { includeSamples: false });
  assert.equal(trades.ok && checks.ok, true);
  if (!trades.ok || !checks.ok) return;
  const summary = accountSummary(account, trades.value, checks.value, new Date().toISOString());
  assert.equal(derived.balance_cents, summary.balance_cents);
  assert.equal(derived.balance_cents, 5_000_000 + 61_500);
  assert.equal(derived.realized_cents, 61_500);
  assert.equal(derived.closed_trades, 1);
  assert.equal(derived.open_trades, 0);
  assert.equal(derived.from_journal_gross, true);
});

// ---- list filters ---------------------------------------------------------------------------------------------------

test("filters: session_date uses the 18:00 ET rollover, and from/to bound the entry time inclusively", async () => {
  const { commands } = setup();
  await seedJournal(commands);
  const ids = async (qs: string) => {
    const result = await dispatchAgentRoute({ kind: "list", type: "trades", query: parseListQuery(new URLSearchParams(qs)) }, commands, WHO);
    return ((result.body as { data: Array<{ id: string }> }).data).map((row) => row.id);
  };
  assert.deepEqual(await ids("session_date=2026-11-23"), ["trade-a"]);
  assert.deepEqual(await ids("session_date=2026-11-24"), ["trade-open"]);
  assert.deepEqual(await ids("from=2026-11-23T14:30:00Z&to=2026-11-23T14:30:00Z"), ["trade-a"], "bounds are inclusive");
  assert.deepEqual(await ids("from=2026-11-23T15:00:00Z"), ["trade-open"]);
  assert.deepEqual(await ids("to=2026-11-23T15:00:00Z"), ["trade-a"]);
});

test("filters: account_id and playbook_id narrow trades; the limit applies after filtering", async () => {
  const { commands } = setup();
  await seedJournal(commands);
  assert.equal((await commands.create("trades", tradeA({ id: "trade-c", entry_time: "2026-11-23T16:00:00Z", exit_time: "2026-11-23T16:05:00Z" }))).ok, true);
  const ids = async (qs: string) => {
    const result = await dispatchAgentRoute({ kind: "list", type: "trades", query: parseListQuery(new URLSearchParams(qs)) }, commands, WHO);
    return ((result.body as { data: Array<{ id: string }> }).data).map((row) => row.id);
  };
  assert.deepEqual((await ids("account_id=sim-acct-eval-50k")).sort(), ["trade-a", "trade-c"]);
  assert.deepEqual(await ids("playbook_id=vwap-trend-push"), ["trade-open"]);
  assert.deepEqual(await ids("account_id=nobody"), []);
  // Three trades exist and two match. The limit counts matching rows, so limit=1 returns one of the two matches.
  const limited = await ids("account_id=sim-acct-eval-50k&limit=1");
  assert.equal(limited.length, 1);
  assert.ok(["trade-a", "trade-c"].includes(limited[0]));
});

test("filters: a malformed date or time is refused with a plain message, and nothing is listed", () => {
  const error = (qs: string) => parseAgentListFilters(new URLSearchParams(qs)).error;
  assert.match(error("session_date=2026-02-30") ?? "", /session_date/);
  assert.match(error("session_date=11/23/2026") ?? "", /session_date/);
  assert.match(error("from=2026-11-23") ?? "", /from/, "a time without a zone is refused");
  assert.match(error("to=yesterday") ?? "", /to/);
  assert.match(error("from=2026-11-23T15:00:00Z&to=2026-11-23T14:00:00Z") ?? "", /not be after/);
  assert.equal(error("session_date=2026-11-23&from=2026-11-23T14:00:00Z"), undefined, "well-formed values pass");
  assert.equal(error("session_date="), undefined, "a blank value counts as absent");
});

test("filters: a malformed filter in the query gives 422 invalid from dispatch, with no read", async () => {
  const { commands } = setup();
  await seedJournal(commands);
  const result = await dispatchAgentRoute({ kind: "list", type: "trades", query: parseListQuery(new URLSearchParams("session_date=2026-13-01")) }, commands, WHO);
  assert.equal(result.status, 422);
  assert.equal(result.outcome, "invalid");
});

test("filters: a filter a collection does not support is refused, never silently ignored", async () => {
  const { commands } = setup();
  await seedJournal(commands);
  const result = await dispatchAgentRoute({ kind: "list", type: "accounts", query: parseListQuery(new URLSearchParams("session_date=2026-11-23")) }, commands, WHO);
  assert.equal(result.status, 422);
  assert.deepEqual(result.body, { ok: false, error: { code: "invalid", message: "session_date is not a filter on accounts." } });
});

test("include=derived is recognised among comma-separated values and ignored otherwise", () => {
  assert.equal(parseIncludeDerived(new URLSearchParams("include=derived")), true);
  assert.equal(parseIncludeDerived(new URLSearchParams("include=foo,derived")), true);
  assert.equal(parseIncludeDerived(new URLSearchParams("include=foo")), false);
  assert.equal(parseIncludeDerived(new URLSearchParams("")), false);
});
