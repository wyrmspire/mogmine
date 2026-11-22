import test from "node:test";
import assert from "node:assert/strict";
import {
  activePlaybooks,
  createPlaybook,
  getPlaybooksBackup,
  getPlaybooksState,
  newPlaybookItemId,
  playbooksDifferFromSeeds,
  resetPlaybooksForTests,
  restorePlaybooks,
  sanitizePlaybooks,
  setPlaybookArchived,
  updatePlaybook,
  validatePlaybookDraft,
} from "../playbooks-store.ts";
import { NO_SETUP_ID, PLAYBOOK_LIMITS, PLAYBOOK_SEEDS, checklistFor, currentPlaybooks, playbookName } from "../playbooks.ts";
import { demoTrades } from "../fixtures.ts";
import { buildBackup, parseBackupFile } from "../store.ts";
import { DEFAULT_OWNER_USER_ID } from "../trades.ts";

const draft = (name: string, labels: string[] = ["Wait for reclaim"]) => ({
  name,
  default_style: "scalp" as const,
  checklist_rules: labels.map((label, index) => ({ id: `r${index}`, label })),
});

test("R-07a: an empty device starts with the four seeds, user_id set, none archived", () => {
  resetPlaybooksForTests();
  const list = getPlaybooksState().playbooks;
  assert.deepEqual(list.map((item) => item.id), ["orb-reclaim", "onl-sweep-smt", "vwap-trend-push", NO_SETUP_ID]);
  assert.ok(list.every((item) => item.user_id === DEFAULT_OWNER_USER_ID && item.archived === false));
  assert.equal(playbooksDifferFromSeeds(list), false);
});

test("R-07a: sanitize drops bad entries and duplicates, keeps order, appends missing seeds", () => {
  const list = sanitizePlaybooks([
    { id: "mine", name: "  Gap   Fill ", default_style: "session_90m", checklist_rules: [{ id: "a", label: "One" }, { id: "a", label: "Dup" }, { id: "b", label: "  " }], archived: false },
    { id: "orb-reclaim", name: "ORB v2", default_style: "nope", checklist_rules: [] },
    { id: "mine", name: "Duplicate id", checklist_rules: [] },
    { id: "", name: "No id", checklist_rules: [] },
    { id: "x", name: "", checklist_rules: [] },
    { id: "y", name: "No rules array" },
    "junk",
  ]);
  assert.deepEqual(list.map((item) => item.id), ["mine", "orb-reclaim", "onl-sweep-smt", "vwap-trend-push", NO_SETUP_ID]);
  assert.equal(list[0].name, "Gap Fill");
  assert.deepEqual(list[0].checklist_rules, [{ id: "a", label: "One" }]);
  assert.equal(list[1].name, "ORB v2");
  assert.equal(list[1].default_style, "scalp", "an unknown style falls back to scalp");
  assert.equal(list[0].user_id, DEFAULT_OWNER_USER_ID);
});

test("R-07a: the impulse bucket never gains rules and is never archived, even from a hand-edited file", () => {
  const [noSetup] = sanitizePlaybooks([{ id: NO_SETUP_ID, name: "Impulse", checklist_rules: [{ id: "a", label: "A" }], archived: true }]);
  assert.deepEqual(noSetup.checklist_rules, []);
  assert.equal(noSetup.archived, false);
  resetPlaybooksForTests();
  const result = setPlaybookArchived(NO_SETUP_ID, true);
  assert.equal(result.ok, false);
  assert.equal(validatePlaybookDraft(draft("Impulse"), getPlaybooksState().playbooks, NO_SETUP_ID) !== null, true);
});

test("R-07a: create validates name, clash and rule limits, then appends with a fresh id", () => {
  resetPlaybooksForTests();
  assert.equal(createPlaybook(draft("   ")).ok, false);
  assert.equal(createPlaybook(draft("orb reclaim")).ok, false, "names clash case-insensitively");
  assert.equal(createPlaybook(draft("Gap Fill", ["ok", " "])).ok, false, "an empty rule is refused, not silently dropped");
  assert.equal(createPlaybook(draft("Gap Fill", Array.from({ length: PLAYBOOK_LIMITS.rules + 1 }, (_, i) => `Rule ${i}`))).ok, false);
  const created = createPlaybook(draft("  Gap   Fill  ", ["Opening gap > 5 pts", "First 5m candle holds"]));
  assert.ok(created.ok);
  assert.equal(created.playbook.name, "Gap Fill");
  assert.match(created.playbook.id, /^gap-fill-/);
  assert.equal(created.playbook.user_id, DEFAULT_OWNER_USER_ID);
  assert.equal(getPlaybooksState().playbooks.at(-1)?.id, created.playbook.id);
  assert.equal(currentPlaybooks().at(-1)?.id, created.playbook.id, "the registry follows the store");
});

test("R-07a / UX-50: editing a playbook changes new checklists only; a saved trade keeps its frozen copy", () => {
  resetPlaybooksForTests();
  const sample = demoTrades.find((trade) => trade.playbook_id === "orb-reclaim");
  assert.ok(sample);
  const frozenBefore = structuredClone(sample.checklist_state);
  const result = updatePlaybook("orb-reclaim", {
    name: "ORB Reclaim (A+)",
    default_style: "scalp",
    checklist_rules: [{ id: "hard-stop", label: "Stop in before entry" }, { id: "htf-bias", label: "Higher-timeframe bias defined" }, { id: "new-rule", label: "Volume above 20-bar mean" }],
  });
  assert.ok(result.ok);
  assert.equal(playbookName("orb-reclaim"), "ORB Reclaim (A+)");
  assert.deepEqual(checklistFor("orb-reclaim").map((rule) => rule.id), ["hard-stop", "htf-bias", "new-rule"], "reorder kept");
  assert.ok(checklistFor("orb-reclaim").every((rule) => rule.checked === false));
  assert.deepEqual(sample.checklist_state, frozenBefore, "trade checklist untouched");
  assert.deepEqual(checklistFor("orb-reclaim", PLAYBOOK_SEEDS).map((rule) => rule.label), frozenBefore.map((rule) => rule.label), "seeds untouched");
});

test("R-07a: archive hides from pickers, the name still resolves, and unarchiving refuses a name clash", () => {
  resetPlaybooksForTests();
  assert.ok(setPlaybookArchived("vwap-trend-push", true).ok);
  const list = getPlaybooksState().playbooks;
  assert.equal(activePlaybooks(list).some((item) => item.id === "vwap-trend-push"), false);
  assert.equal(activePlaybooks(list, "vwap-trend-push").some((item) => item.id === "vwap-trend-push"), true, "a trade filed under it still sees it");
  assert.equal(playbookName("vwap-trend-push"), "VWAP Trend Push");
  assert.equal(createPlaybook(draft("VWAP Trend Push")).ok, false, "an archived name still clashes");
  assert.ok(setPlaybookArchived("vwap-trend-push", false).ok);
  // Two active playbooks sharing a name can only come from a hand-edited file; unarchiving then refuses.
  restorePlaybooks([{ ...PLAYBOOK_SEEDS[2], id: "copy", archived: false }, { ...PLAYBOOK_SEEDS[2], archived: true }]);
  assert.equal(setPlaybookArchived("vwap-trend-push", false).ok, false);
});

test("R-07a: backup round-trips custom and archived playbooks; older backups leave the device list alone", () => {
  resetPlaybooksForTests();
  const created = createPlaybook(draft("Gap Fill"));
  assert.ok(created.ok);
  setPlaybookArchived("onl-sweep-smt", true);
  const backup = buildBackup(demoTrades, undefined, undefined, undefined, undefined, getPlaybooksBackup());
  const parsed = parseBackupFile(JSON.stringify(backup));
  assert.ok(parsed.ok);
  assert.ok(parsed.playbooks);
  assert.equal(parsed.playbooks.find((item) => item.id === created.playbook.id)?.name, "Gap Fill");
  assert.equal(parsed.playbooks.find((item) => item.id === "onl-sweep-smt")?.archived, true);

  resetPlaybooksForTests();
  restorePlaybooks(parsed.playbooks);
  assert.equal(playbookName(created.playbook.id), "Gap Fill");

  const legacy = parseBackupFile(JSON.stringify({ app: "mogmine", version: 1, exportedAt: "2026-11-20T00:00:00Z", trades: demoTrades }));
  assert.ok(legacy.ok);
  assert.equal(legacy.playbooks, undefined);
});

test("R-07a: a playbook-only backup restores; a seeds-only, trade-less backup is still refused", () => {
  resetPlaybooksForTests();
  createPlaybook(draft("Gap Fill"));
  const onlyPlaybooks = parseBackupFile(JSON.stringify({ app: "mogmine", trades: [], playbooks: getPlaybooksBackup() }));
  assert.equal(onlyPlaybooks.ok, true);
  const seedsOnly = parseBackupFile(JSON.stringify({ app: "mogmine", trades: [], playbooks: PLAYBOOK_SEEDS }));
  assert.equal(seedsOnly.ok, false);
});

test("R-07a: new ids avoid ones already taken", () => {
  const taken = new Set<string>();
  for (let i = 0; i < 50; i += 1) {
    const id = newPlaybookItemId("Hard stop placed!", taken);
    assert.match(id, /^hard-stop-placed-[a-z0-9-]+$/);
    assert.equal(taken.has(id), false);
    taken.add(id);
  }
  assert.match(newPlaybookItemId("!!!", []), /^item-/);
});
