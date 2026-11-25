import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { labView } from "../playbook-lab.ts";
import type { LabView } from "../playbook-lab.ts";
import { PLAYBOOK_CARD_MIN_TRADES } from "../playbook-card.ts";
import { EXECUTION_TAGS, SETUP_TAGS } from "../playbooks.ts";
import type { Playbook } from "../playbooks.ts";
import type { TradeRecord } from "../trades.ts";

// The Lab is a client component (.tsx), which node --test cannot import. Logic is covered through the
// pure labView model; presentation rules (gating copy, Shield, ARIA, 390×844 CSS) are read from source,
// the same way lib/__tests__/a11y-routes.test.ts does it.

const NOW = Date.parse("2026-11-24T18:00:00Z");
const TAGS = { setup: SETUP_TAGS, execution: EXECUTION_TAGS };
const rule = (id: string) => ({ id, label: `Rule ${id}` });
const book = (id: string, archived = false): Playbook => ({
  id, user_id: "demo-owner", name: id.toUpperCase(), default_style: "scalp",
  checklist_rules: [rule("a"), rule("b")], archived,
});
const BOOKS = [book("orb"), book("vwap"), book("old", true)];

let seq = 0;
function trade(over: Partial<TradeRecord> = {}): TradeRecord {
  seq += 1;
  const entry = Date.parse("2026-11-23T15:00:00Z") + seq * 60_000;
  const base: TradeRecord = {
    id: `u${seq}`, user_id: "demo-owner", account_id: null, symbol: "MES", yahoo_ticker: "MES=F",
    direction: "LONG", trade_style: "scalp", status: "closed",
    entry_time: new Date(entry).toISOString(), exit_time: new Date(entry + 600_000).toISOString(),
    entry_price: 7600, exit_price: 7604, exit_reason: "target",
    stop_loss_price: 7596, initial_stop_price: 7596, initial_stop_set_at: null, planned_target_price: null,
    key_level_price: null, quantity: 1, note: "", review_status: "tagged", playbook_id: "orb", quick_tags: [],
    checklist_state: [{ id: "a", label: "Rule a", checked: true }, { id: "b", label: "Rule b", checked: true }],
    pre_trade_thesis: "", management_notes: "", post_exit_notes: "", flagged: false, take_again: null,
    take_again_at: null, is_sample: false, sparkline: [],
  };
  return { ...base, ...over };
}

const lab = (trades: TradeRecord[], includeSamples: boolean, rOf?: (t: TradeRecord) => number | null): LabView =>
  labView(BOOKS, TAGS, trades, { includeSamples, now: NOW, rOf });

function readSource(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf-8");
}

test("PL-2a: samples are excluded by default on the Lab and included only when the switch is on", () => {
  const src = readSource("components/PlaybookLab.tsx");
  // Default state of the switch is off (01 §9).
  assert.match(src, /const \[includeSamples, setIncludeSamples\] = useState\(false\);/);
  // The switch labels inclusion in the UI.
  assert.match(src, /samples included/);
  assert.match(src, /Samples are excluded by default/);

  const trades = [trade({ quick_tags: ["Level Sweep"] }), trade({ is_sample: true, quick_tags: ["Level Sweep"] })];
  assert.equal(lab(trades, false).counts.trades, 1);
  assert.equal(lab(trades, true).counts.trades, 2);
  assert.equal(lab(trades, false).tags.find((tag) => tag.tag === "Level Sweep")?.n, 1);
});

test("PL-2a: rates are gated below PLAYBOOK_CARD_MIN_TRADES and shown with tabular numbers at or above it", () => {
  const under = Array.from({ length: PLAYBOOK_CARD_MIN_TRADES - 1 }, () => trade({ quick_tags: ["Level Sweep"] }));
  const underView = lab(under, false, () => 0.5);
  assert.equal(underView.playbooks[0].avgResultR, null);
  assert.equal(underView.playbooks[0].rulesFollowedRatio, null);
  assert.equal(underView.tags.find((tag) => tag.tag === "Level Sweep")?.avgResultR, null);

  const at = Array.from({ length: PLAYBOOK_CARD_MIN_TRADES }, () => trade({ quick_tags: ["Level Sweep"] }));
  const atView = lab(at, false, () => 0.5);
  assert.equal(atView.playbooks[0].avgResultR, 0.5);
  assert.equal(atView.playbooks[0].rulesFollowedRatio, 1);

  // The copy shown for each state is in the component, and numbers use tabular figures.
  const src = readSource("components/PlaybookLab.tsx");
  assert.match(src, /need \$\{PLAYBOOK_CARD_MIN_TRADES\} closed for rates/);
  assert.match(src, /not enough for rates yet/);
  assert.match(src, /toFixed\(2\)\}R/);
  assert.match(readSource("app/lab.css"), /font-variant-numeric: tabular-nums/);
});

test("PL-2a: Shield-safe presentation shows counts and R and never a dollar amount", () => {
  const src = readSource("components/PlaybookLab.tsx");
  // No currency formatting and no dollar literals in the Lab's output.
  assert.doesNotMatch(src, /style:\s*"currency"/);
  assert.doesNotMatch(src, /["'`]\$(?!\{)/);
  assert.doesNotMatch(src, /tradePnl|riskBudgetUsd/);
});

test("PL-2a: unknown tags are listed when a trade carries them and archived playbooks fold under the active list", () => {
  const trades = [trade({ quick_tags: ["Mystery Tag"] }), trade({ quick_tags: ["Mystery Tag"] }), trade({ playbook_id: "vwap" })];
  const view = lab(trades, false);
  assert.deepEqual(view.unknownTags.map((row) => [row.label, row.n]), [["Mystery Tag", 2]]);
  assert.match(view.unknownTags[0].feedHref, /tag=Mystery/);
  assert.equal(lab(trades.map((t) => ({ ...t, quick_tags: [] })), false).unknownTags.length, 0);

  // Archived fold: counts.archived is the number printed on the fold summary; active come first.
  assert.equal(view.counts.archived, 1);
  assert.deepEqual(view.playbooks.map((facet) => [facet.playbookId, facet.archived]), [["orb", false], ["vwap", false], ["old", true]]);

  const src = readSource("components/PlaybookLab.tsx");
  assert.match(src, /<details className="lab-archived">/);
  assert.match(src, /Not in your vocabulary/);
  assert.match(src, /Log a trade and tag it to see your map/);
});

test("PL-2a: Lab Home, Playbooks, and Tags render all empty and loaded states", () => {
  const src = readSource("components/PlaybookLab.tsx");
  assert.match(src, /role="status" aria-label="Loading playbook lab"/);
  assert.match(src, /No tags used yet/);
  assert.match(src, /No playbooks yet/);
  assert.match(src, /Not used yet\./);
  assert.match(src, /samples included/);
  assert.match(src, /\{tab === "map" && <PlaybookLabMap view=\{view\} \/>\}/);
  assert.match(src, /\{tab === "gaps" && <PlaybookLabGaps view=\{view\} \/>\}/);

  // Zero-trade state with an empty model is still a valid view.
  const empty = lab([], false);
  assert.equal(empty.counts.trades, 0);
  assert.equal(empty.unknownTags.length, 0);
  assert.equal(empty.tags.every((tag) => tag.n === 0), true);
});

test("PL-2a: switch, segmented tabs, and Binder | Lab links expose accessible names and state", () => {
  const src = readSource("components/PlaybookLab.tsx");
  assert.match(src, /role="switch"/);
  assert.match(src, /aria-checked=\{includeSamples\}/);
  assert.match(src, /aria-label="Include samples"/);
  assert.match(src, /aria-label="Lab sections"/);
  assert.match(src, /aria-current=\{tab === id \? "page" : undefined\}/);
  assert.match(src, /aria-labelledby="lab-playbooks-title"/);

  const binder = readSource("components/PlaybookBinder.tsx");
  assert.match(binder, /aria-label="Playbook views"/);
  assert.match(binder, /aria-current=\{active === "binder" \? "page" : undefined\}/);
  assert.match(binder, /aria-current=\{active === "lab" \? "page" : undefined\}/);

  // Tap targets are at least 44px tall.
  const css = readSource("app/lab.css");
  assert.match(css, /\.lab-switch \{[^}]*min-height: 44px/);
  assert.match(css, /\.lab-tabs a \{[^}]*min-height: 44px/);
  assert.match(css, /\.lab-mode a \{[^}]*min-height: 44px/);
});

test("PL-2a: 390×844 layout clips horizontal overflow and uses only theme tokens for bars", () => {
  const css = readSource("app/lab.css");
  assert.match(css, /\.lab-page \{ overflow-x: clip; \}/);
  assert.match(css, /--gold-mid/);
  assert.match(css, /--border-strong/);
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/);
  assert.match(css, /grid-template-columns: repeat\(4, 1fr\)/);
});

test("PL-2a: Map and Gaps mount their dedicated components without TradeChart", () => {
  const src = readSource("components/PlaybookLab.tsx");
  assert.match(src, /<PlaybookLabMap view=\{view\} \/>/);
  assert.match(src, /<PlaybookLabGaps view=\{view\} \/>/);
  assert.doesNotMatch(src, /TradeChart/);
});

test("PL-2a: wiring from Binder, Tune, layout, and the route", () => {
  assert.match(readSource("components/TuneScreen.tsx"), /<Link href="\/playbooks\/lab">Playbooks &amp; Lab<\/Link>/);
  assert.match(readSource("app/layout.tsx"), /import "\.\/lab\.css";/);
  assert.match(readSource("app/playbooks/lab/page.tsx"), /<PlaybookLab \/>/);
  // Q-1: no fifth dock item.
  assert.doesNotMatch(readSource("components/AppShell.tsx"), /playbooks\/lab/);
});
