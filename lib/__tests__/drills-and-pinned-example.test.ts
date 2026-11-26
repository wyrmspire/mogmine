import test from "node:test";
import assert from "node:assert/strict";
import { drillRevealRuleNote, isPreOpenWarmupWindow } from "../drills.ts";
import { playbookCardData, playbookExample } from "../playbook-card.ts";
import {
  getPlaybooksBackup,
  getPlaybooksState,
  resetPlaybooksForTests,
  restorePlaybooks,
  setPlaybookPinnedExample,
} from "../playbooks-store.ts";
import { sanitizePlaybook } from "../playbooks-sanitize.ts";
import { PLAYBOOK_SEEDS } from "../playbooks.ts";
import type { TradeRecord } from "../trades.ts";

const DAY = 86_400_000;
const now = Date.parse("2026-11-26T18:00:00Z");

const trade = (id: string, over: Partial<TradeRecord> & { days?: number } = {}): TradeRecord => {
  const { days = 10, ...rest } = over;
  const entry = now - days * DAY;
  return {
    id, symbol: "MES", direction: "LONG", quantity: 1, status: "closed", is_sample: false, playbook_id: "orb-reclaim",
    entry_time: new Date(entry).toISOString(), exit_time: new Date(entry + 600_000).toISOString(),
    entry_price: 7600, exit_price: 7604, stop_loss_price: 7596,
    checklist_state: [{ id: "a", label: "Stop", checked: true }], quick_tags: [], take_again: null,
    ...rest,
  } as TradeRecord;
};

// ET wall clock → UTC instant. Winter (EST, UTC-5) and summer (EDT, UTC-4) dates.
const ET_EST = (hhmm: string, day = "2026-01-14") => Date.parse(`${day}T${hhmm}:00-05:00`);
const ET_EDT = (hhmm: string, day = "2026-07-15") => Date.parse(`${day}T${hhmm}:00-04:00`);
/** A closed real trade `days` before `at`, so the warm-up check reads the same clock as the trade. */
const agedTrade = (at: number, days: number, over: Partial<TradeRecord> = {}) => trade("aged", { ...over, entry_time: new Date(at - days * DAY).toISOString(), exit_time: new Date(at - days * DAY + 600_000).toISOString() });
const oldTradeAt = (at: number) => [agedTrade(at, 10)];

test("docs/23 §9: the reveal names the first unchecked frozen rule on a broken trade", () => {
  const broken = trade("b", {
    checklist_state: [
      { id: "htf", label: "Higher-timeframe bias defined", checked: true },
      { id: "close", label: "Waited for the candle close", checked: false },
      { id: "stop", label: "Hard stop placed", checked: true },
      { id: "news", label: "No entry within 5m of red-folder news", checked: false },
    ],
  });
  assert.deepEqual(drillRevealRuleNote(broken), { kind: "broken", ruleLabel: "Waited for the candle close", followed: 2, total: 4 });
});

test("docs/23 §9: the reveal reports a clean trade when every frozen rule was checked", () => {
  const clean = trade("c", {
    checklist_state: [
      { id: "htf", label: "Higher-timeframe bias defined", checked: true },
      { id: "close", label: "Waited for the candle close", checked: true },
    ],
  });
  assert.deepEqual(drillRevealRuleNote(clean), { kind: "clean", ruleLabel: "Higher-timeframe bias defined", followed: 2, total: 2 });
});

test("docs/23 §9: no frozen checklist means no rule note", () => {
  assert.deepEqual(drillRevealRuleNote(trade("n", { checklist_state: [] })), { kind: "none", ruleLabel: null, followed: 0, total: 0 });
});

test("docs/23 §7: the pre-open warm-up shows at 08:45 ET on a weekday, in EST and in EDT", () => {
  assert.deepEqual(isPreOpenWarmupWindow(oldTradeAt(ET_EST("08:45")), ET_EST("08:45")), { show: true, eligibleCount: 1 });
  assert.deepEqual(isPreOpenWarmupWindow(oldTradeAt(ET_EDT("08:45")), ET_EDT("08:45")), { show: true, eligibleCount: 1 });
});

test("docs/23 §7: the pre-open warm-up stops at 09:30 ET and does not start before 06:00 ET", () => {
  assert.equal(isPreOpenWarmupWindow(oldTradeAt(ET_EST("09:30")), ET_EST("09:30")).show, false);
  assert.equal(isPreOpenWarmupWindow(oldTradeAt(ET_EDT("10:15")), ET_EDT("10:15")).show, false);
  assert.equal(isPreOpenWarmupWindow(oldTradeAt(ET_EST("06:00")), ET_EST("06:00")).show, true);
  assert.equal(isPreOpenWarmupWindow(oldTradeAt(ET_EST("05:59")), ET_EST("05:59")).show, false);
});

test("docs/23 §7: the pre-open warm-up stays off on weekends", () => {
  const sat = ET_EST("08:45", "2026-01-17");
  const sun = ET_EST("08:45", "2026-01-18");
  assert.equal(isPreOpenWarmupWindow(oldTradeAt(sat), sat).show, false); // Saturday
  assert.equal(isPreOpenWarmupWindow(oldTradeAt(sun), sun).show, false); // Sunday
});

test("docs/23 §7: the pre-open warm-up needs at least one eligible trade, not samples or recent ones", () => {
  assert.deepEqual(isPreOpenWarmupWindow([trade("s", { is_sample: true })], ET_EST("08:45")), { show: false, eligibleCount: 0 });
  assert.deepEqual(isPreOpenWarmupWindow([agedTrade(ET_EST("08:45"), 3)], ET_EST("08:45")), { show: false, eligibleCount: 0 });
  assert.deepEqual(isPreOpenWarmupWindow([], ET_EST("08:45")), { show: false, eligibleCount: 0 });
});

test("docs/23 §9: a pinned example is chosen first; a missing or open pin falls back automatically", () => {
  resetPlaybooksForTests();
  const pinnedTrade = trade("pinned", { days: 30, take_again: "pass" });
  const clean = trade("clean-take", { days: 5, take_again: "yes" });
  const trades = [clean, pinnedTrade, trade("open", { days: 2, exit_time: null, exit_price: null, status: "open" })];

  assert.deepEqual(playbookExample("orb-reclaim", trades, "pinned"), { trade_id: "pinned", basis: "pinned" });
  assert.deepEqual(playbookExample("orb-reclaim", trades), { trade_id: "clean-take", basis: "clean_take" });
  assert.deepEqual(playbookExample("orb-reclaim", trades, "missing"), { trade_id: "clean-take", basis: "clean_take" });
  assert.deepEqual(playbookExample("orb-reclaim", trades, "open"), { trade_id: "clean-take", basis: "clean_take" });
  assert.deepEqual(playbookExample("orb-reclaim", trades, "clean-take"), { trade_id: "clean-take", basis: "pinned" });

  const data = playbookCardData({ id: "orb-reclaim", name: "ORB Reclaim", checklist_rules: [], pinned_example_trade_id: "pinned" }, trades, [], now);
  assert.equal(data.example?.trade_id, "pinned");
  assert.equal(data.example?.basis, "pinned");
});

test("docs/23 §9: pinning round-trips through backup and restore, and unpinning leaves the seeds untouched", () => {
  resetPlaybooksForTests();
  const seedsBefore = JSON.stringify(PLAYBOOK_SEEDS);

  const pinned = setPlaybookPinnedExample("orb-reclaim", "trade-42");
  assert.equal(pinned.ok, true);
  assert.equal(getPlaybooksState().playbooks.find((item) => item.id === "orb-reclaim")?.pinned_example_trade_id, "trade-42");
  assert.equal(sanitizePlaybook(getPlaybooksState().playbooks.find((item) => item.id === "orb-reclaim"))?.pinned_example_trade_id, "trade-42");

  const backup = getPlaybooksBackup();
  assert.equal(backup.find((item) => item.id === "orb-reclaim")?.pinned_example_trade_id, "trade-42");

  restorePlaybooks([]);
  restorePlaybooks(backup);
  assert.equal(getPlaybooksState().playbooks.find((item) => item.id === "orb-reclaim")?.pinned_example_trade_id, "trade-42");

  const cleared = setPlaybookPinnedExample("orb-reclaim", null);
  assert.equal(cleared.ok, true);
  const orb = getPlaybooksState().playbooks.find((item) => item.id === "orb-reclaim");
  assert.equal(orb && "pinned_example_trade_id" in orb, false);
  assert.equal(JSON.stringify(PLAYBOOK_SEEDS), seedsBefore);
  assert.equal(JSON.stringify(PLAYBOOK_SEEDS.find((item) => item.id === "orb-reclaim")) === JSON.stringify(orb), true);
});

test("docs/23 §9: a blank or null pinned id is treated as unset and never written to a playbook", () => {
  resetPlaybooksForTests();
  const blank = sanitizePlaybook({ ...PLAYBOOK_SEEDS[0], pinned_example_trade_id: "   " });
  const nulled = sanitizePlaybook({ ...PLAYBOOK_SEEDS[0], pinned_example_trade_id: null });
  assert.equal(blank && "pinned_example_trade_id" in blank, false);
  assert.equal(nulled && "pinned_example_trade_id" in nulled, false);
  assert.equal(setPlaybookPinnedExample("no-such-playbook", "trade-1").ok, false);
  assert.equal(setPlaybookPinnedExample("orb-reclaim", "  ").ok, false);
});
