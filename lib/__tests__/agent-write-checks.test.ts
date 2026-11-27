// #API-2b: the write-time refusals and warnings of docs/design-2026-11-24/07-agent-api.md §4, one case per row, driven
// through dispatchAgentRoute over the local mock adapter (the real command layer). Every value is a fixture; no live
// API, no real journal, no network.
import test from "node:test";
import assert from "node:assert/strict";
import { dispatchAgentRoute } from "../agent/dispatch.ts";
import type { AgentDispatch, AgentDispatchOptions, AgentWho } from "../agent/dispatch.ts";
import { checkTradeWrite } from "../agent/write-checks.ts";
import type { WriteCheckContext } from "../agent/write-checks.ts";
import { createJournalCommands } from "../commands/journal-commands.ts";
import type { JournalCommands } from "../commands/journal-commands.ts";
import { createLocalAdapter, createMemoryCandleStore, createMemoryKeyValueStore } from "../persistence/local-adapter.ts";
import { makeAccount } from "../accounts.ts";
import { EXECUTION_TAGS, SETUP_TAGS } from "../playbooks.ts";
import { normalizeTrade } from "../trades.ts";

const WHO: AgentWho = { userId: "owner", tokenId: "tok", scopes: ["read", "write"] };
const NOW_MS = Date.parse("2026-11-25T12:00:00.000Z");
const NOW = new Date(NOW_MS).toISOString();
const MINUTE = 60_000;

async function setup() {
  const store = createMemoryKeyValueStore();
  const adapter = createLocalAdapter({ kind: "mock", store, candles: createMemoryCandleStore() });
  const commands = createJournalCommands(adapter.repositories, undefined, { now: () => NOW_MS });
  const account = makeAccount({ id: "sim-acct-eval-50k", name: "SIM Eval 50K", starting_balance_cents: 5_000_000, now: NOW, r_size_cents: 30_000 });
  assert.equal((await commands.create("accounts", account)).ok, true);
  return commands;
}

/** Trade A: MES long 7600 → 7723, initial stop 7582.5 (70 ticks = $87.50 = 8750 cents). Valid as stored. */
function tradeA(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "trade-a", symbol: "MES", direction: "LONG", quantity: 1, status: "closed",
    entry_time: "2026-11-25T11:00:00Z", exit_time: "2026-11-25T11:40:00Z",
    entry_price: 7600, exit_price: 7723, stop_loss_price: 7582.5,
    initial_stop_price: 7582.5, initial_stop_set_at: "2026-11-25T10:59:00Z",
    account_id: "sim-acct-eval-50k", playbook_id: "orb-reclaim",
    quick_tags: [SETUP_TAGS[0], EXECUTION_TAGS[0]],
    ...over,
  };
}

/** Every write in this file runs on the fixed clock NOW_MS, so "future" never depends on the machine's date. */
const clock = (options?: AgentDispatchOptions): AgentDispatchOptions => ({ nowMs: NOW_MS, ...options });

const create = (commands: JournalCommands, body: Record<string, unknown>, options?: AgentDispatchOptions) =>
  dispatchAgentRoute({ kind: "create", type: "trades", body }, commands, WHO, clock(options));

const update = (commands: JournalCommands, id: string, body: Record<string, unknown>, options?: AgentDispatchOptions) =>
  dispatchAgentRoute({ kind: "update", type: "trades", id, body }, commands, WHO, clock(options));

async function tradeCount(commands: JournalCommands): Promise<number> {
  const rows = await commands.list("trades", { includeArchived: true, includeSamples: true });
  assert.equal(rows.ok, true);
  return rows.ok ? rows.value.length : -1;
}

function codes(result: AgentDispatch): string[] {
  const data = (result.body as { warnings?: Array<{ code: string }> }).warnings ?? [];
  return data.map((warning) => warning.code);
}

function refusedMessage(result: AgentDispatch): string {
  assert.equal(result.status, 422, `expected 422, got ${result.status}: ${JSON.stringify(result.body)}`);
  return (result.body as { error: { message: string } }).error.message;
}

// ---- refusals (422, nothing written) ---------------------------------------------------------------------------------

test("row 1: an unknown playbook_id is refused with 422, listing the valid ids and names; nothing is written", async () => {
  const commands = await setup();
  const before = await tradeCount(commands);
  const result = await create(commands, tradeA({ playbook_id: "News Impulse" }));
  const message = refusedMessage(result);
  for (const id of ["orb-reclaim", "onl-sweep-smt", "vwap-trend-push", "no-setup"]) assert.match(message, new RegExp(`"${id}"`));
  assert.match(message, /"ORB Reclaim"/);
  assert.equal(result.outcome, "invalid");
  assert.equal(await tradeCount(commands), before);
});

test("row 2: an account_id that is not an owner account is refused with 422; nothing is written", async () => {
  const commands = await setup();
  const before = await tradeCount(commands);
  const result = await create(commands, tradeA({ account_id: "acct-made-up" }));
  const message = refusedMessage(result);
  assert.match(message, /"sim-acct-eval-50k" \("SIM Eval 50K"\)/);
  assert.equal(await tradeCount(commands), before);
});

test("row 3: an unknown quick_tags value is refused with 422, listing every setup and execution tag; nothing is written", async () => {
  const commands = await setup();
  const before = await tradeCount(commands);
  const result = await create(commands, tradeA({ quick_tags: ["Invented Tag"] }));
  const message = refusedMessage(result);
  for (const tag of [...SETUP_TAGS, ...EXECUTION_TAGS]) assert.ok(message.includes(`"${tag}"`), `missing ${tag}`);
  assert.equal(await tradeCount(commands), before);
});

test("row 3 (Q-9): an update that does not write quick_tags is not blocked by an old tag on the stored trade", async () => {
  const commands = await setup();
  const seeded = await commands.create("trades", tradeA({ quick_tags: ["Retired Tag"] }));
  assert.equal(seeded.ok, true, JSON.stringify(seeded));
  const result = await update(commands, "trade-a", { note: "Took the first pullback." });
  assert.equal(result.status, 200, JSON.stringify(result.body));
});

test("row 3 (Q-9): an update that writes quick_tags with an unknown tag is refused", async () => {
  const commands = await setup();
  assert.equal((await commands.create("trades", tradeA())).ok, true);
  const result = await update(commands, "trade-a", { quick_tags: ["Invented Tag"] });
  assert.match(refusedMessage(result), /Unknown quick_tags "Invented Tag"/);
});

test("row 4: an entry_time 10 minutes in the future is refused with 422 (Q-10)", async () => {
  const commands = await setup();
  const before = await tradeCount(commands);
  const entry = new Date(NOW_MS + 10 * MINUTE).toISOString();
  const exit = new Date(NOW_MS + 11 * MINUTE).toISOString();
  const result = await create(commands, tradeA({ entry_time: entry, exit_time: exit }), { nowMs: NOW_MS });
  assert.match(refusedMessage(result), /entry_time .* more than 5 minutes in the future/);
  assert.equal(await tradeCount(commands), before);
});

test("row 4 (Q-11): an entry_time 3 minutes in the future is accepted with 201", async () => {
  const commands = await setup();
  const entry = new Date(NOW_MS + 3 * MINUTE).toISOString();
  const exit = new Date(NOW_MS + 4 * MINUTE).toISOString();
  const result = await create(commands, tradeA({ entry_time: entry, exit_time: exit }), { nowMs: NOW_MS });
  assert.equal(result.status, 201, JSON.stringify(result.body));
});

test("row 5: a risk_cents that differs from the computed value is refused with 422", async () => {
  const commands = await setup();
  const before = await tradeCount(commands);
  const result = await create(commands, tradeA({ risk_cents: 9999 }));
  assert.match(refusedMessage(result), /risk_cents/);
  assert.equal(await tradeCount(commands), before);
});

test("row 5: the computed risk_cents is accepted with 201", async () => {
  const commands = await setup();
  const result = await create(commands, tradeA({ risk_cents: 8750 }));
  assert.equal(result.status, 201, JSON.stringify(result.body));
});

// ---- warnings (saved, with a warnings array) -----------------------------------------------------------------------

test("warning playbook_missing: a create with no playbook_id saves and warns", async () => {
  const commands = await setup();
  const result = await create(commands, tradeA({ playbook_id: null }));
  assert.equal(result.status, 201, JSON.stringify(result.body));
  assert.ok(codes(result).includes("playbook_missing"));
  assert.equal((result.body as { ok: boolean }).ok, true);
});

test("warning setup_tag_missing: quick_tags with no setup tag saves and warns", async () => {
  const commands = await setup();
  const result = await create(commands, tradeA({ quick_tags: [EXECUTION_TAGS[0]] }));
  assert.equal(result.status, 201, JSON.stringify(result.body));
  assert.ok(codes(result).includes("setup_tag_missing"));
});

test("warning notes_restate_fields: a note with a price, an R or a dollar figure saves and warns (HR-1)", async () => {
  const commands = await setup();
  // entry_price 7137 so the bare "7137" in a note is a restated price.
  const base = tradeA({ entry_price: 7137, stop_loss_price: 7119.5, initial_stop_price: 7119.5, exit_price: 7150, exit_reason: "target", planned_target_price: 7150 });
  for (const note of ["Entered at 7137 after the push.", "Risked 0.25R on that one.", "Lost $75 on the stop."]) {
    const result = await create(commands, { ...base, id: `trade-${note.length}`, note });
    assert.equal(result.status, 201, JSON.stringify(result.body));
    assert.ok(codes(result).includes("notes_restate_fields"), `no warning for: ${note}`);
  }
  const clean = await create(commands, { ...base, id: "trade-clean", note: "Chased the first push. Wait for the retest next time." });
  assert.equal(clean.status, 201);
  assert.equal(codes(clean).includes("notes_restate_fields"), false);
});

test("warning stop_moved_without_time: stop_loss_price moved with no stop_moves saves and warns (HR-4)", async () => {
  const commands = await setup();
  const result = await create(commands, tradeA({ stop_loss_price: 7590, initial_stop_price: 7582.5 }));
  assert.equal(result.status, 201, JSON.stringify(result.body));
  assert.ok(codes(result).includes("stop_moved_without_time"));
});

test("warning exit_reason_mismatch: exit_reason stop with the exit 5 ticks from the working stop saves and warns (HR-5)", async () => {
  const commands = await setup();
  // Working stop 7582.5 (no stop moves). An exit 5 ticks (1.25 points) above it is past the 2-tick tolerance.
  const fiveTicks = await create(commands, tradeA({ id: "trade-five", exit_reason: "stop", exit_price: 7582.5 + 5 * 0.25 }));
  assert.equal(fiveTicks.status, 201, JSON.stringify(fiveTicks.body));
  assert.ok(codes(fiveTicks).includes("exit_reason_mismatch"));
  const onStop = await create(commands, tradeA({ id: "trade-on-stop", exit_reason: "stop", exit_price: 7582.5 }));
  assert.equal(onStop.status, 201);
  assert.equal(codes(onStop).includes("exit_reason_mismatch"), false);
});

test("warning stated_risk_differs: <1 micro ceiling overshoot does not warn; under-sized or >=1 micro over warns (HR-7)", async () => {
  const commands = await setup();
  // 1 MES at $87.50 vs $75 stated (0.25R): overshoot $12.50 < $87.50 (1 micro) -> valid ceiling sizing, no warning.
  const ceiling = await create(commands, tradeA({ id: "trade-ceiling", stated_risk_r: 0.25 }));
  assert.equal(ceiling.status, 201, JSON.stringify(ceiling.body));
  assert.equal(codes(ceiling).includes("stated_risk_differs"), false);
  // 2 MES at $175 vs $75 stated (0.25R): overshoot $100 >= $87.50 (1 micro) -> warns.
  const result = await create(commands, tradeA({ id: "trade-stated", quantity: 2, stated_risk_r: 0.25 }));
  assert.equal(result.status, 201, JSON.stringify(result.body));
  assert.ok(codes(result).includes("stated_risk_differs"));
});

test("warning price_out_of_range: an entry far below the cached day range saves and warns (Q-10)", async () => {
  const commands = await setup();
  const dayPriceRange = { low: 6935, high: 7410 };
  const outside = tradeA({ id: "trade-outside", entry_price: 4866.25, stop_loss_price: 4860, initial_stop_price: 4860, exit_price: 4870 });
  const result = await create(commands, outside, { nowMs: NOW_MS, dayPriceRange: () => dayPriceRange });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  assert.ok(codes(result).includes("price_out_of_range"));
  // With no cached bars the check does not run, so nothing is fetched and no warning appears.
  const noBars = await create(commands, { ...outside, id: "trade-no-bars" }, { nowMs: NOW_MS });
  assert.equal(noBars.status, 201);
  assert.equal(codes(noBars).includes("price_out_of_range"), false);
});

test("every trade write answers with a warnings array, even when empty", async () => {
  const commands = await setup();
  const clean = tradeA({ id: "trade-clean-2", playbook_id: "orb-reclaim", stated_risk_r: null, exit_reason: "manual", exit_price: 7700 });
  const result = await create(commands, clean);
  assert.equal(result.status, 201, JSON.stringify(result.body));
  assert.ok(Array.isArray((result.body as { warnings?: unknown }).warnings));
});

// ---- the pure check, on a candidate built the way the command layer builds it ---------------------------------------

test("checkTradeWrite is pure: the same candidate and context give the same answer", () => {
  const candidate = normalizeTrade(tradeA() as Parameters<typeof normalizeTrade>[0]);
  const ctx: WriteCheckContext = {
    playbooks: [{ id: "orb-reclaim", name: "ORB Reclaim", archived: false }],
    accounts: [{ id: "sim-acct-eval-50k", name: "SIM Eval 50K", r_size_cents: 30_000, archived: false }],
    setupTags: [...SETUP_TAGS],
    executionTags: [...EXECUTION_TAGS],
    defaultRSizeCents: 10_000,
    nowMs: NOW_MS,
    isCreate: false,
    writtenFields: new Set(["note"]),
  };
  const first = checkTradeWrite(candidate, { note: "Fine." }, ctx);
  const second = checkTradeWrite(candidate, { note: "Fine." }, ctx);
  assert.deepEqual(first, second);
  assert.deepEqual(first, { ok: true, warnings: [] });
});
