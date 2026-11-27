import test from "node:test";
import assert from "node:assert/strict";
import { binderView, playbookDrillLine, playbookExampleCaption, playbookSampleLine, playbookStatCells, playbookTileStats } from "../playbook-binder.ts";
import { playbookCardData } from "../playbook-card.ts";
import type { Playbook } from "../playbooks.ts";
import type { TradeRecord } from "../trades.ts";

const now = Date.parse("2026-11-22T18:00:00Z");
const book = (id: string, archived = false): Playbook => ({
  id, user_id: "owner", name: id.toUpperCase(), default_style: "scalp", archived,
  checklist_rules: [{ id: "a", label: "Bias set" }, { id: "b", label: "Stop placed" }],
});
let n = 0;
/** Long MES, 1 contract, 4-point stop; `points` is exit minus entry. */
const trade = (over: Partial<TradeRecord> & { points?: number } = {}): TradeRecord => {
  const { points = 4, ...rest } = over;
  n += 1;
  const entry = Date.parse("2026-11-10T15:00:00Z") + n * 600_000;
  return {
    id: `t${n}`, symbol: "MES", direction: "LONG", quantity: 1, status: "closed", is_sample: false, playbook_id: "orb",
    entry_time: new Date(entry).toISOString(), exit_time: new Date(entry + 300_000).toISOString(),
    entry_price: 7600, exit_price: 7600 + points, stop_loss_price: 7596, quick_tags: [], take_again: null,
    checklist_state: [{ id: "a", label: "Bias set", checked: true }, { id: "b", label: "Stop placed", checked: true }],
    ...rest,
  } as TradeRecord;
};
const NO_DOLLARS = /\$|contract|account|balance/i;

test("CD-3b: the binder keeps store order, leaves archived playbooks out and counts them", () => {
  const view = binderView([book("orb"), book("old", true), book("fade")], [], [], now);
  assert.deepEqual(view.cards.map((card) => card.playbook_id), ["orb", "fade"]);
  assert.equal(view.archived, 1);
});

test("CD-3b: below 10 trades the rates say so; the count and R skips always print", () => {
  const data = playbookCardData(book("orb"), [trade({ points: 8 }), trade({ stop_loss_price: null })], [], now);
  assert.deepEqual(playbookStatCells(data, false), [
    { label: "Trades", value: "2" },
    { label: "Win rate", value: "Not enough trades yet" },
    { label: "Avg R", value: "Not enough trades yet" },
  ]);
  // D-A: closed trades without a stop still have account R; only unpriceable trades are skipped.
  assert.equal(playbookSampleLine(data), "n = 2 · rates from 10");
  const unpriceable = playbookCardData(book("orb"), [trade({ points: 8 }), trade({ exit_price: 7600.1 })], [], now);
  assert.equal(playbookSampleLine(unpriceable), "n = 2 · rates from 10 · 1 unpriceable, left out of R");
});

test("CD-3b: at 10 trades the rates print, formatted by lib/format", () => {
  const trades = Array.from({ length: 10 }, (_, i) => trade({ points: i < 6 ? 8 : -4 }));
  const cells = playbookStatCells(playbookCardData(book("orb"), trades, [], now), false);
  assert.equal(cells[1].value, "60%");
  // 6 × +0.16R and 4 × −0.08R over 10 trades = +0.064R avg → +0.1R.
  assert.equal(cells[2].value, "+0.1R");
  assert.equal(playbookSampleLine(playbookCardData(book("orb"), trades, [], now)), "n = 10");
});

test("CD-3b: Shield hides results entirely and the visible copy carries no dollars, size or account", () => {
  const trades = Array.from({ length: 12 }, () => trade({ points: 8 }));
  const data = playbookCardData(book("orb"), trades, [], now);
  assert.deepEqual(playbookStatCells(data, true), []);
  assert.equal(playbookDrillLine(data, true), "Hidden by Shield");
  for (const text of [playbookExampleCaption(data), playbookDrillLine(data, true), ...data.rules]) assert.doesNotMatch(text, NO_DOLLARS);
});

test("CD-3b: a binder tile says 'not enough' once, prints rates at 10, and hides them under Shield", () => {
  const few = playbookCardData(book("orb"), [trade()], [], now);
  assert.equal(playbookTileStats(few, false), "1 trade · not enough for rates yet");
  const ten = playbookCardData(book("orb"), Array.from({ length: 10 }, () => trade({ points: 8 })), [], now);
  assert.equal(playbookTileStats(ten, false), "Trades 10 · Win rate 100% · Avg R +0.1R");
  assert.equal(playbookTileStats(ten, true), "Results hidden by Shield");
});

test("CD-3b: the example caption explains the pick or says there is none", () => {
  const empty = playbookCardData(book("orb"), [], [], now);
  assert.equal(playbookExampleCaption(empty), "No example yet");
  const clean = playbookCardData(book("orb"), [trade()], [], now);
  assert.equal(playbookExampleCaption(clean), "Latest trade with every rule followed");
  const take = playbookCardData(book("orb"), [trade({ take_again: "yes" })], [], now);
  assert.equal(playbookExampleCaption(take), "Latest trade with every rule followed and a blind Take it");
});

test("CD-3b: the drill line counts answers until the comparison is ready", () => {
  const t = trade();
  const records = [{ id: "d1", user_id: "owner", trade_id: t.id, kind: "take_it" as const, answer: "take" as const, answered_at: "2026-11-21T12:00:00Z", hidden: [] }];
  const data = playbookCardData(book("orb"), [t], records, now);
  assert.match(playbookDrillLine(data, false), /^1\/30 trades drilled\./);
});
