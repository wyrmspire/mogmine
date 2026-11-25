import test from "node:test";
import assert from "node:assert/strict";
import { labView } from "../playbook-lab.ts";
import type { LabView } from "../playbook-lab.ts";
import { PLAYBOOK_CARD_MIN_TRADES } from "../playbook-card.ts";
import { EXECUTION_TAGS, NO_SETUP_ID, SETUP_TAGS } from "../playbooks.ts";
import type { Playbook } from "../playbooks.ts";
import { applyFilters, parseFilters } from "../selectors.ts";
import type { TradeRecord } from "../trades.ts";

const NOW = Date.parse("2026-11-24T18:00:00Z");
const TAGS = { setup: SETUP_TAGS, execution: EXECUTION_TAGS };
const rule = (id: string) => ({ id, label: `Rule ${id}` });
const book = (id: string, archived = false): Playbook => ({
  id, user_id: "demo-owner", name: id.toUpperCase(), default_style: "scalp",
  checklist_rules: [rule("a"), rule("b")], archived,
});
const BOOKS = [book("orb"), book("vwap"), book("old", true)];

let seq = 0;
/** Closed long MES trade by default: `points` is exit minus entry, 10-minute hold, all rules followed. */
function trade(over: Partial<TradeRecord> & { points?: number } = {}): TradeRecord {
  const { points = 4, ...rest } = over;
  seq += 1;
  const entry = Date.parse("2026-11-23T15:00:00Z") + seq * 60_000;
  const base: TradeRecord = {
    id: `t${seq}`, user_id: "demo-owner", account_id: null, symbol: "MES", yahoo_ticker: "MES=F",
    direction: "LONG", trade_style: "scalp", status: "closed",
    entry_time: new Date(entry).toISOString(), exit_time: new Date(entry + 600_000).toISOString(),
    entry_price: 7600, exit_price: 7600 + points, exit_reason: "target",
    stop_loss_price: 7596, initial_stop_price: 7596, initial_stop_set_at: null, planned_target_price: null,
    key_level_price: null, quantity: 1, note: "", review_status: "tagged", playbook_id: "orb", quick_tags: [],
    checklist_state: [{ id: "a", label: "Rule a", checked: true }, { id: "b", label: "Rule b", checked: true }],
    pre_trade_thesis: "", management_notes: "", post_exit_notes: "", flagged: false, take_again: null,
    take_again_at: null, is_sample: false, sparkline: [],
  };
  return { ...base, ...rest };
}
const openTrade = (over: Partial<TradeRecord> = {}) =>
  trade({ status: "open", exit_time: null, exit_price: null, exit_reason: null, ...over });

const lab = (trades: TradeRecord[], includeSamples = true, rOf?: (t: TradeRecord) => number | null): LabView =>
  labView(BOOKS, TAGS, trades, { includeSamples, now: NOW, rOf });

/** Every Feed link must return exactly the count the Lab printed beside it (01 §9). */
function assertFeedParity(view: LabView, trades: TradeRecord[], includeSamples: boolean) {
  const eligible = includeSamples ? trades : trades.filter((item) => !item.is_sample);
  const count = (href: string) => applyFilters(eligible, parseFilters(new URL(href, "http://lab.test").searchParams)).length;
  for (const facet of view.playbooks) {
    assert.equal(count(facet.feedHref), facet.n, `playbook ${facet.playbookId}`);
    for (const row of [...facet.setupTags, ...facet.executionTags]) assert.equal(count(row.feedHref), row.n, `${facet.playbookId} × ${row.tag}`);
  }
  for (const facet of view.tags) {
    assert.equal(count(facet.feedHref), facet.n, `tag ${facet.tag}`);
    for (const row of facet.playbooks) assert.equal(count(row.feedHref), row.n, `${facet.tag} × ${row.name}`);
  }
  for (const unknown of view.unknownTags) assert.equal(count(unknown.feedHref), unknown.n, `unknown ${unknown.label}`);
  for (const cell of view.matrix) assert.equal(count(cell.feedHref), cell.n, `matrix ${cell.playbookId} × ${cell.tag}`);
  assert.equal(count(view.gaps.noPlaybookHref), view.gaps.noPlaybook.length, "no playbook gap");
  assert.equal(count(view.gaps.impulseHref), view.gaps.impulseCount, "impulse gap");
}

test("samples are excluded by default and included when the toggle is on", () => {
  const trades = [trade({ quick_tags: ["Level Sweep"] }), trade({ is_sample: true, quick_tags: ["Level Sweep"] })];
  const off = lab(trades, false);
  assert.equal(off.counts.trades, 1);
  assert.equal(off.playbooks[0].n, 1);
  assert.equal(off.tags.find((facet) => facet.tag === "Level Sweep")?.n, 1);
  const on = lab(trades, true);
  assert.equal(on.counts.trades, 2);
  assert.equal(on.playbooks[0].n, 2);
  assert.equal(on.tags.find((facet) => facet.tag === "Level Sweep")?.n, 2);
});

test("open trades count in n and openCount only, never in results, wins or hold bands (OD-38)", () => {
  const seen: string[] = [];
  const rOf = (item: TradeRecord) => {
    seen.push(item.id);
    return 3;
  };
  const open = openTrade({ quick_tags: ["Level Sweep"] });
  const closed = trade({ quick_tags: ["Level Sweep"], points: 4 });
  const view = lab([open, closed], true, rOf);
  const orb = view.playbooks.find((facet) => facet.playbookId === "orb");
  assert.ok(orb);
  assert.equal(orb.n, 2);
  assert.equal(orb.openCount, 1);
  assert.equal(orb.closedCount, 1);
  assert.equal(orb.shape.wins, 1);
  assert.equal(orb.shape.losses, 0);
  assert.equal(orb.shape.scratches, 0);
  assert.equal(Object.values(orb.shape.holdBands).reduce((sum, value) => sum + value, 0), 1);
  assert.deepEqual([...new Set(seen)], [closed.id], "rOf is only asked about closed trades");
  const tag = view.tags.find((facet) => facet.tag === "Level Sweep");
  assert.equal(tag?.n, 2);
  assert.equal(tag?.closedCount, 1);
  assert.equal(view.gaps.noPlaybook.length, 0);
});

test("avgResultR and rulesFollowedRatio stay null at 9 trades and are exact at 10", () => {
  const batch = (size: number) => Array.from({ length: size }, (_, index) =>
    trade({ points: 4, checklist_state: [{ id: "a", label: "Rule a", checked: true }, { id: "b", label: "Rule b", checked: index >= 4 }] }));
  const nine = batch(PLAYBOOK_CARD_MIN_TRADES - 1);
  const nineView = lab(nine, true, () => 2);
  const nineOrb = nineView.playbooks.find((facet) => facet.playbookId === "orb");
  assert.equal(nineOrb?.avgResultR, null);
  assert.equal(nineOrb?.rulesFollowedRatio, null);
  assert.equal(nineOrb?.gradedCount, 9);

  const ten = batch(PLAYBOOK_CARD_MIN_TRADES);
  const rById = new Map(ten.map((item, index) => [item.id, index + 1]));
  const tenView = lab(ten, true, (item) => rById.get(item.id) ?? null);
  const tenOrb = tenView.playbooks.find((facet) => facet.playbookId === "orb");
  assert.ok(tenOrb);
  assert.ok(Math.abs((tenOrb.avgResultR ?? NaN) - 5.5) < 1e-9, "mean of 1..10");
  assert.equal(tenOrb.gradedCount, 10);
  assert.equal(tenOrb.rulesFollowedRatio, 0.6, "6 of 10 followed every rule");
});

test("unknown tags appear with their count and disappear once the trade is fixed", () => {
  const typo = trade({ quick_tags: ["VWAP HoldPlaybookTypo"] });
  const withTypo = lab([typo]);
  assert.deepEqual(withTypo.unknownTags.map(({ label, n }) => ({ label, n })), [{ label: "VWAP HoldPlaybookTypo", n: 1 }]);
  const fixed = lab([{ ...typo, quick_tags: ["VWAP Hold"] }]);
  assert.deepEqual(fixed.unknownTags, []);
});

test("every Feed link returns exactly the count the Lab prints, with and without samples", () => {
  const trades = [
    trade({ quick_tags: ["Level Sweep", "Chased Entry"], points: -4, direction: "SHORT", exit_reason: "stop", stop_moves: [{ price: 7600, time: "2026-11-23T15:05:00Z" }] }),
    trade({ quick_tags: ["Level Sweep"], points: 4 }),
    openTrade({ quick_tags: ["Level Sweep"] }),
    trade({ playbook_id: "vwap", quick_tags: ["VWAP Hold", "A+ Patience"], points: 0, exit_reason: "manual" }),
    trade({ playbook_id: "vwap", quick_tags: ["VWAP HoldPlaybookTypo"], points: 8 }),
    trade({ playbook_id: null, quick_tags: ["Opening Drive"], points: 2 }),
    trade({ playbook_id: NO_SETUP_ID, quick_tags: [], points: -2 }),
    trade({ playbook_id: "old", quick_tags: ["Level Sweep"], points: 4 }),
    trade({ quick_tags: ["Cut Early"], points: 4 }),
    trade({ is_sample: true, quick_tags: ["Level Sweep"] }),
    trade({ playbook_id: "vwap", is_sample: true, quick_tags: ["Mystery Tag"] }),
  ];
  for (const includeSamples of [false, true]) {
    assertFeedParity(lab(trades, includeSamples), trades, includeSamples);
  }
  const view = lab(trades, true);
  assert.equal(view.gaps.impulseCount, 1);
  assert.equal(view.gaps.impulseShare, 1 / 11);
  assert.deepEqual(view.gaps.unusedPlaybooks, []);
  assert.ok(view.gaps.unusedTags.includes("Moved Stop"), "Moved Stop is in the vocabulary and no trade carries it");
});

test("playbooks sort active before archived, and tags group setup before execution", () => {
  const view = labView([book("old", true), book("orb"), book("vwap")], TAGS, [trade()], { includeSamples: true, now: NOW });
  assert.deepEqual(view.playbooks.map((facet) => [facet.playbookId, facet.archived]), [["orb", false], ["vwap", false], ["old", true]]);
  assert.deepEqual(
    view.tags.map((facet) => facet.kind),
    [...SETUP_TAGS.map(() => "setup"), ...EXECUTION_TAGS.map(() => "execution")],
  );
});

test("examples are at most three distinct trade ids: latest, best_rules, latest_loss", () => {
  const best = trade({ points: 4 });
  const loss = trade({ points: -4, checklist_state: [{ id: "a", label: "Rule a", checked: false }, { id: "b", label: "Rule b", checked: true }] });
  const middle = trade({ points: 4, checklist_state: [{ id: "a", label: "Rule a", checked: true }, { id: "b", label: "Rule b", checked: false }] });
  const latest = openTrade();
  const examples = lab([best, loss, middle, latest]).playbooks.find((facet) => facet.playbookId === "orb")?.examples;
  assert.deepEqual(examples, [
    { tradeId: latest.id, reason: "latest" },
    { tradeId: best.id, reason: "best_rules" },
    { tradeId: loss.id, reason: "latest_loss" },
  ]);
  assert.ok((examples ?? []).length <= 3);

  const only = trade({ points: -4, checklist_state: [{ id: "a", label: "Rule a", checked: true }, { id: "b", label: "Rule b", checked: true }] });
  const single = lab([only]).playbooks.find((facet) => facet.playbookId === "orb")?.examples;
  assert.deepEqual(single, [{ tradeId: only.id, reason: "latest" }], "one trade fills every role but is listed once");
});

test("shape facts split direction, exit reasons, hold bands, stop moves and results", () => {
  const trades = [
    trade({ exit_reason: "stop", direction: "SHORT", points: 4, stop_moves: [{ price: 7600, time: "2026-11-23T15:05:00Z" }] }),
    trade({ exit_reason: null, exit_time: new Date(Date.parse("2026-11-23T20:00:00Z")).toISOString(), points: 0 }),
    trade({ exit_reason: "trail", points: 4 }),
  ];
  const shape = lab(trades).playbooks.find((facet) => facet.playbookId === "orb")?.shape;
  assert.ok(shape);
  assert.equal(shape.longCount, 2);
  assert.equal(shape.shortCount, 1);
  assert.equal(shape.exitReasons.stop, 1);
  assert.equal(shape.exitReasons.trail, 1);
  assert.equal(shape.exitReasons.unknown, 1);
  assert.equal(shape.holdBands["5m_to_30m"], 2);
  assert.equal(shape.holdBands.over_2h, 1);
  assert.equal(shape.stopMovedCount, 1);
  assert.equal(shape.stopMovedShare, 1 / 3);
  assert.equal(shape.scratches, 1);
  assert.equal(shape.wins, 1);
  assert.equal(shape.losses, 1);
});

test("gaps list playbook-less and setup-less trades, unused vocabulary and impulse share", () => {
  const trades = [
    trade({ playbook_id: null, quick_tags: [] }),
    trade({ playbook_id: "orb", quick_tags: ["Cut Early"] }),
    trade({ playbook_id: NO_SETUP_ID, quick_tags: [] }),
  ];
  const view = lab(trades);
  assert.equal(view.gaps.noPlaybookHref, "/feed?playbook=none");
  assert.equal(view.gaps.noPlaybook.length, 1);
  assert.deepEqual(view.gaps.noSetupTag, [trades[1].id, trades[2].id]);
  assert.deepEqual(view.gaps.unusedPlaybooks, ["vwap"]);
  assert.ok(view.gaps.unusedTags.includes("Level Sweep"));
  assert.equal(view.gaps.impulseShare, 1 / 3);
  assert.equal(view.gaps.impulseHref, "/feed?playbook=no-setup");
  assert.equal(lab([]).gaps.impulseShare, null);
});
