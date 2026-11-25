// PL-3: the tag registry model, its store and backup, and the Agent API vocabulary and write checks that read it.
// Fixtures only: no live API, no real journal, no network. Storage is the local mock adapter.
import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_TAG_REGISTRY,
  activeExecutionTagLabels,
  activeSetupTagLabels,
  addTag,
  renameTag,
  resolveTagLabel,
  restoreTag,
  retireTag,
  sanitizeTagRegistry,
  setTagPlaybooks,
  updateTagDescription,
  tagRegistryDiffersFromSeeds,
} from "../tag-registry.ts";
import type { TagRegistry, TagResult } from "../tag-registry.ts";
import {
  configureTagRegistrySyncForTests,
  getTagRegistryBackup,
  getTagRegistryState,
  restoreTagRegistry,
  resetTagRegistryForTests,
  addTag as addTagToStore,
  renameTag as renameTagInStore,
  retireTag as retireTagInStore,
} from "../tag-registry-store.ts";
import { buildBackup, parseBackupFile } from "../journal-backup.ts";
import { EXECUTION_TAGS, SETUP_TAGS, currentExecutionTags, currentSetupTags, currentTagRegistry } from "../playbooks.ts";
import { MOVED_STOP_TAG } from "../trades.ts";
import { normalizeTrade } from "../trades.ts";
import { createJournalCommands } from "../commands/journal-commands.ts";
import { createLocalAdapter, createMemoryCandleStore, createMemoryKeyValueStore } from "../persistence/local-adapter.ts";
import { dispatchAgentRoute } from "../agent/dispatch.ts";
import type { AgentWho } from "../agent/dispatch.ts";
import { buildVocabulary } from "../agent/vocabulary.ts";
import { checkTradeWrite } from "../agent/write-checks.ts";
import type { WriteCheckContext } from "../agent/write-checks.ts";

const WHO: AgentWho = { userId: "owner", tokenId: "tok", scopes: ["read", "write"] };
const NOW_MS = Date.parse("2026-11-25T12:00:00.000Z");

const ok = (result: TagResult): TagRegistry => {
  assert.equal(result.ok, true, result.ok ? "" : result.error);
  return (result as Extract<TagResult, { ok: true }>).registry;
};
const fail = (result: TagResult): string => {
  assert.equal(result.ok, false, "expected a refusal");
  return (result as Extract<TagResult, { ok: false }>).error;
};
const idOf = (reg: TagRegistry, label: string) => {
  const hit = resolveTagLabel(reg, label);
  assert.ok(hit, `no tag ${label}`);
  return hit.def.id;
};

// --- Model ---------------------------------------------------------------------------------------------------------

test("seed parity: the default registry is exactly today's setup and execution constants", () => {
  assert.deepEqual(activeSetupTagLabels(DEFAULT_TAG_REGISTRY), [...SETUP_TAGS]);
  assert.deepEqual(activeExecutionTagLabels(DEFAULT_TAG_REGISTRY), [...EXECUTION_TAGS]);
  assert.equal(tagRegistryDiffersFromSeeds(DEFAULT_TAG_REGISTRY), false);
});

test("sanitize: junk input falls back to the seeds, and a junk item is dropped", () => {
  assert.deepEqual(sanitizeTagRegistry(null), sanitizeTagRegistry(DEFAULT_TAG_REGISTRY));
  assert.deepEqual(sanitizeTagRegistry("nope"), sanitizeTagRegistry(DEFAULT_TAG_REGISTRY));
  const reg = sanitizeTagRegistry({ setup: [null, 7, { label: "   " }, { label: "Pullback" }], execution: "x" });
  assert.deepEqual(activeSetupTagLabels(reg), ["Pullback"]);
  assert.deepEqual(activeExecutionTagLabels(reg), [...EXECUTION_TAGS], "a junk execution group falls back to the seeds");
});

test("sanitize: Moved Stop is always present and active, even when stored retired or missing", () => {
  const retired = sanitizeTagRegistry({ setup: [], execution: [{ id: "x", label: "moved stop", retired: true }] });
  assert.deepEqual(activeExecutionTagLabels(retired), ["moved stop"]);
  assert.equal(resolveTagLabel(retired, MOVED_STOP_TAG)?.def.retired, false);
  const missing = sanitizeTagRegistry({ setup: [], execution: [] });
  assert.deepEqual(activeExecutionTagLabels(missing), [MOVED_STOP_TAG]);
});

test("sanitize: labels are unique across kinds and aliases never shadow a label", () => {
  const reg = sanitizeTagRegistry({
    setup: [{ id: "a", label: "Level Sweep", aliases: ["Cut Early"] }, { id: "b", label: "level sweep" }],
    execution: [{ id: "c", label: "Cut Early" }],
  });
  assert.deepEqual(reg.setup.map((def) => def.label), ["Level Sweep"]);
  assert.deepEqual(reg.execution.map((def) => def.label), ["Cut Early", MOVED_STOP_TAG]);
  assert.deepEqual(reg.setup[0].aliases, [], "an alias that names another tag's label is dropped");
});

test("add: a new active tag appears in its kind; duplicates (case-insensitive) and empty names are refused", () => {
  const reg = ok(addTag(DEFAULT_TAG_REGISTRY, "setup", { label: "  200 EMA   Pullback  ", description: "Pullback to the 200 EMA" }));
  assert.ok(activeSetupTagLabels(reg).includes("200 EMA Pullback"));
  assert.equal(resolveTagLabel(reg, "200 ema pullback")?.kind, "setup");
  assert.match(fail(addTag(reg, "execution", { label: "200 ema pullback" })), /already exists/);
  assert.match(fail(addTag(reg, "setup", { label: "   " })), /name/);
  assert.match(fail(addTag(reg, "setup", { label: "x".repeat(41) })), /40 characters/);
});

test("rename: the old label is kept as an alias, so saved trades still resolve; a clash is refused", () => {
  const before = DEFAULT_TAG_REGISTRY;
  const id = idOf(before, "Level Sweep");
  const reg = ok(renameTag(before, id, "Liquidity Sweep"));
  assert.deepEqual(activeSetupTagLabels(reg).includes("Level Sweep"), false);
  const hit = resolveTagLabel(reg, "Level Sweep");
  assert.equal(hit?.def.label, "Liquidity Sweep");
  assert.equal(hit?.def.id, id);
  assert.match(fail(renameTag(reg, id, "vwap hold")), /already exists/);
  assert.match(fail(renameTag(reg, id, "Cut Early")), /already exists/);
  assert.match(fail(renameTag(reg, "missing-id", "Anything")), /no longer exists/);
});

test("rename back to an old alias does not keep the same label twice", () => {
  const reg = ok(renameTag(ok(renameTag(DEFAULT_TAG_REGISTRY, idOf(DEFAULT_TAG_REGISTRY, "Level Sweep"), "Liquidity Sweep")), idOf(DEFAULT_TAG_REGISTRY, "Level Sweep"), "Level Sweep"));
  const def = reg.setup.find((item) => item.label === "Level Sweep");
  assert.ok(def);
  assert.deepEqual(def.aliases, ["Liquidity Sweep"]);
});

test("description and playbook links are edited without touching the label", () => {
  const id = idOf(DEFAULT_TAG_REGISTRY, "SMT Divergence");
  const reg = ok(setTagPlaybooks(ok(updateTagDescription(DEFAULT_TAG_REGISTRY, id, "  Divergence   between  NQ and ES ")), id, ["orb-reclaim", "orb-reclaim", "onl-sweep-smt"]));
  const def = resolveTagLabel(reg, "SMT Divergence")?.def;
  assert.equal(def?.description, "Divergence between NQ and ES");
  assert.deepEqual(def?.playbook_ids, ["orb-reclaim", "onl-sweep-smt"]);
  assert.equal(def?.label, "SMT Divergence");
});

test("retire hides a tag from active lists but it still resolves; restore brings it back", () => {
  const id = idOf(DEFAULT_TAG_REGISTRY, "Revenge");
  const retired = ok(retireTag(DEFAULT_TAG_REGISTRY, id));
  assert.equal(activeExecutionTagLabels(retired).includes("Revenge"), false);
  assert.equal(resolveTagLabel(retired, "Revenge")?.def.retired, true);
  const back = ok(restoreTag(retired, id));
  assert.equal(activeExecutionTagLabels(back).includes("Revenge"), true);
});

test("Moved Stop cannot be retired: stop-move warnings depend on it", () => {
  assert.match(fail(retireTag(DEFAULT_TAG_REGISTRY, idOf(DEFAULT_TAG_REGISTRY, MOVED_STOP_TAG))), /stays active/);
});

/** `buildBackup` with only the trades and the tag registry set; every other section stays absent, as in an older build. */
const backupWith = (trades: ReturnType<typeof normalizeTrade>[], tags?: TagRegistry) =>
  buildBackup(trades, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, tags);

test("sanitize keeps labels intact up to 40 characters and never cuts a typed name silently", () => {
  const long = "x".repeat(41);
  assert.match(fail(addTag(DEFAULT_TAG_REGISTRY, "setup", { label: long })), /40 characters/);
  const stored = sanitizeTagRegistry({ setup: [{ id: "s", label: long }] });
  assert.equal(stored.setup[0].label.length, 40);
});

// --- Store, live lists and backup -----------------------------------------------------------------------------------

test("store: edits update the live tag lists the playbooks module reads, and reset restores the seeds", async () => {
  resetTagRegistryForTests();
  configureTagRegistrySyncForTests({ enabled: false });
  assert.equal(addTagToStore("setup", { label: "200 EMA Pullback" }).ok, true);
  assert.ok(currentSetupTags().includes("200 EMA Pullback"));
  assert.ok(currentTagRegistry()?.setup.some((def) => def.label === "200 EMA Pullback"));
  const id = currentTagRegistry()!.setup.find((def) => def.label === "200 EMA Pullback")!.id;
  assert.equal(retireTagInStore(id).ok, true);
  assert.equal(currentSetupTags().includes("200 EMA Pullback"), false);
  assert.equal(renameTagInStore(idOf(getTagRegistryBackup(), "Pushed w/ NQ"), "Pushed with NQ").ok, true);
  assert.ok(currentSetupTags().includes("Pushed with NQ"));
  resetTagRegistryForTests();
  assert.deepEqual(currentSetupTags(), [...SETUP_TAGS]);
  assert.deepEqual(currentExecutionTags(), [...EXECUTION_TAGS]);
  assert.equal(getTagRegistryState().hydrated, false, "no window in node: the device copy is never read");
});

test("backup round-trip: buildBackup → parseBackupFile → restoreTagRegistry keeps custom tags", () => {
  resetTagRegistryForTests();
  assert.equal(addTagToStore("execution", { label: "Walked Away" }).ok, true);
  const trade = normalizeTrade({
    id: "trade-fixture-1", symbol: "MES", direction: "LONG", quantity: 1, status: "closed",
    entry_time: "2026-11-23T14:30:00Z", exit_time: "2026-11-23T15:10:00Z",
    entry_price: 7600, exit_price: 7723, stop_loss_price: 7582.5,
  } as Parameters<typeof normalizeTrade>[0]);
  const text = JSON.stringify(backupWith([trade], getTagRegistryBackup()));
  const parsed = parseBackupFile(text);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.ok(parsed.tag_registry);

  resetTagRegistryForTests();
  assert.equal(currentExecutionTags().includes("Walked Away"), false);
  restoreTagRegistry(parsed.tag_registry);
  assert.ok(currentExecutionTags().includes("Walked Away"));
  resetTagRegistryForTests();
});

test("backup: a tag-only backup with no trades still restores; a legacy backup has no tag_registry", () => {
  const custom = ok(addTag(DEFAULT_TAG_REGISTRY, "setup", { label: "Opening Range Retest" }));
  const tagOnly = parseBackupFile(JSON.stringify(backupWith([], custom)));
  assert.equal(tagOnly.ok, true);
  assert.ok(tagOnly.ok && tagOnly.tag_registry);

  const legacyTrade = { id: "legacy-1", symbol: "MES", direction: "LONG", entry_time: "2026-11-23T14:30:00Z", exit_time: "2026-11-23T15:10:00Z", entry_price: 7600, exit_price: 7723, status: "closed" };
  const legacy = parseBackupFile(JSON.stringify({ app: "mogmine", version: 1, trades: [legacyTrade] }));
  assert.equal(legacy.ok, true);
  assert.equal(legacy.ok && "tag_registry" in legacy, false, "no tag_registry: the device's tags are left alone");
});

// --- Local adapter, Agent API vocabulary and write checks -----------------------------------------------------------

function agentCommands() {
  const adapter = createLocalAdapter({ kind: "mock", store: createMemoryKeyValueStore(), candles: createMemoryCandleStore() });
  return createJournalCommands(adapter.repositories, undefined, { now: () => NOW_MS });
}

test("local adapter: tag_registry is a singleton that round-trips and sanitizes on read", async () => {
  const commands = agentCommands();
  const first = await commands.readSingleton("tag_registry");
  assert.deepEqual(first, { ok: true, value: null });
  const written = await commands.writeSingleton("tag_registry", ok(addTag(DEFAULT_TAG_REGISTRY, "setup", { label: "200 EMA Pullback" })));
  assert.equal(written.ok, true);
  const read = await commands.readSingleton("tag_registry");
  assert.equal(read.ok && read.value?.record.setup.some((def) => def.label === "200 EMA Pullback"), true);
});

test("agent API: PUT the registry, then GET vocabulary lists the new tag with its description", async () => {
  const commands = agentCommands();
  const reg = ok(addTag(DEFAULT_TAG_REGISTRY, "setup", { label: "200 EMA Pullback", description: "Pullback to the 200 EMA" }));
  const put = await dispatchAgentRoute({ kind: "writeSingleton", key: "tag_registry", body: reg }, commands, { ...WHO, scopes: ["read", "write"] }, { nowMs: NOW_MS });
  assert.equal(put.outcome, "ok");

  const vocabulary = await buildVocabulary(commands);
  assert.equal(vocabulary.ok, true);
  if (!vocabulary.ok) return;
  assert.ok(vocabulary.value.setup_tags.includes("200 EMA Pullback"));
  assert.deepEqual(vocabulary.value.setup_tag_details.find((tag) => tag.label === "200 EMA Pullback")?.description, "Pullback to the 200 EMA");
});

test("vocabulary: with no registry saved, the seeds are listed", async () => {
  const vocabulary = await buildVocabulary(agentCommands());
  assert.equal(vocabulary.ok, true);
  if (!vocabulary.ok) return;
  assert.deepEqual(vocabulary.value.setup_tags, [...SETUP_TAGS]);
  assert.deepEqual(vocabulary.value.execution_tags, [...EXECUTION_TAGS]);
});

function checkContext(tagRegistry: TagRegistry): WriteCheckContext {
  return {
    playbooks: [{ id: "orb-reclaim", name: "ORB Reclaim", archived: false }],
    accounts: [],
    setupTags: [],
    executionTags: [],
    tagRegistry,
    defaultRSizeCents: 25_000,
    nowMs: NOW_MS,
    isCreate: true,
    writtenFields: new Set(["quick_tags"]),
  };
}

const writeBody = (quick_tags: string[]) => ({
  symbol: "MES", direction: "LONG", quantity: 1, status: "closed",
  entry_time: "2026-11-23T14:30:00Z", exit_time: "2026-11-23T15:10:00Z",
  entry_price: 7600, exit_price: 7723, stop_loss_price: 7582.5, initial_stop_price: 7582.5,
  initial_stop_set_at: "2026-11-23T14:29:00Z", playbook_id: "orb-reclaim", quick_tags,
});

function checkTags(reg: TagRegistry, quick_tags: string[]) {
  const body = writeBody(quick_tags);
  const candidate = normalizeTrade({ id: "fixture-write", ...body } as Parameters<typeof normalizeTrade>[0]);
  return checkTradeWrite(candidate, body, checkContext(reg));
}

test("write checks: an active registry tag is accepted; a retired or unknown one is refused with 422's message", () => {
  const added = ok(addTag(DEFAULT_TAG_REGISTRY, "setup", { label: "200 EMA Pullback" }));
  const accepted = checkTags(added, ["200 EMA Pullback", "Cut Early"]);
  assert.equal(accepted.ok, true);

  const retired = ok(retireTag(added, idOf(added, "Level Sweep")));
  const retiredRefusal = checkTags(retired, ["Level Sweep"]);
  assert.equal(retiredRefusal.ok, false);
  assert.match(retiredRefusal.ok ? "" : retiredRefusal.message, /Unknown quick_tags "Level Sweep"/);

  const unknownRefusal = checkTags(added, ["Made Up Tag"]);
  assert.equal(unknownRefusal.ok, false);
  assert.match(unknownRefusal.ok ? "" : unknownRefusal.message, /Setup tags: .*"200 EMA Pullback"/);
});

test("write checks: a renamed tag's old label is refused (alias is for reading old trades, not writing new ones)", () => {
  const renamed = ok(renameTag(DEFAULT_TAG_REGISTRY, idOf(DEFAULT_TAG_REGISTRY, "Level Sweep"), "Liquidity Sweep"));
  assert.equal(checkTags(renamed, ["Liquidity Sweep"]).ok, true);
  assert.equal(checkTags(renamed, ["Level Sweep"]).ok, false);
});

test("write checks: Moved Stop stays accepted after a registry edit", () => {
  const reg = ok(addTag(DEFAULT_TAG_REGISTRY, "setup", { label: "Gap Fill" }));
  assert.equal(checkTags(reg, [MOVED_STOP_TAG]).ok, true);
});

test("agent API: POST /records/trades accepts a registry tag and refuses retired or unknown ones (dispatch.ts wiring)", async () => {
  const commands = agentCommands();
  const added = ok(addTag(DEFAULT_TAG_REGISTRY, "setup", { label: "200 EMA Pullback" }));
  const reg = ok(retireTag(added, idOf(added, "Level Sweep")));
  await dispatchAgentRoute({ kind: "writeSingleton", key: "tag_registry", body: reg }, commands, WHO, { nowMs: NOW_MS });
  const posted = await dispatchAgentRoute({ kind: "create", type: "trades", body: { id: "accepted-1", ...writeBody(["200 EMA Pullback"]) } }, commands, WHO, { nowMs: NOW_MS });
  assert.equal(posted.status, 201);
  const retiredPost = await dispatchAgentRoute({ kind: "create", type: "trades", body: { ...writeBody(["Level Sweep"]), id: "retired-1" } }, commands, WHO, { nowMs: NOW_MS });
  assert.equal(retiredPost.status, 422);
  const unknownPost = await dispatchAgentRoute({ kind: "create", type: "trades", body: { ...writeBody(["Unknown Tag"]), id: "unknown-1" } }, commands, WHO, { nowMs: NOW_MS });
  assert.equal(unknownPost.status, 422);
});
