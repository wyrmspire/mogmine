import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";
import { labView } from "../playbook-lab.ts";
import type { LabView } from "../playbook-lab.ts";
import { EXECUTION_TAGS, NO_SETUP_ID, SETUP_TAGS } from "../playbooks.ts";
import type { Playbook } from "../playbooks.ts";
import { applyFilters, parseFilters } from "../selectors.ts";
import type { TradeRecord } from "../trades.ts";
import type { LabMapLayout } from "../../components/PlaybookLabMap.tsx";

// The Map and Gaps are client components (.tsx), which node --test cannot import. The Map's layout helper is
// loaded by transpiling the real source with `typescript` and running it with stubbed imports (react/jsx-runtime
// is real, next/link is a stub). The Feed round-trip uses the real parseFilters + applyFilters.

const NOW = Date.parse("2026-11-24T18:00:00Z");
const EXTRA_SETUP = ["Extra A", "Extra B", "Extra C", "Extra D"];
const SETUP_8 = [...SETUP_TAGS, ...EXTRA_SETUP.slice(0, 3)];
const SETUP_9 = [...SETUP_TAGS, ...EXTRA_SETUP];
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
    id: `m${seq}`, user_id: "demo-owner", account_id: null, symbol: "MES", yahoo_ticker: "MES=F",
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

// A mixed fixture: every gap kind, an archived playbook with trades, an impulse trade, and a sample.
const FIXTURE: TradeRecord[] = [
  trade({ playbook_id: "orb", quick_tags: ["Level Sweep"] }),
  trade({ playbook_id: "orb", quick_tags: ["Level Sweep", "VWAP Hold"] }),
  trade({ playbook_id: "orb", quick_tags: ["Level Sweep", "Extra A"] }),
  trade({ playbook_id: "orb", quick_tags: [] }),
  trade({ playbook_id: "vwap", quick_tags: ["VWAP Hold"] }),
  trade({ playbook_id: "vwap", quick_tags: ["VWAP Hold", "Pushed w/ NQ"] }),
  trade({ playbook_id: "old", quick_tags: ["Opening Drive"] }),
  trade({ playbook_id: null, quick_tags: ["Level Sweep"] }),
  trade({ playbook_id: null, quick_tags: [] }),
  trade({ playbook_id: NO_SETUP_ID, quick_tags: [] }),
  trade({ playbook_id: NO_SETUP_ID, quick_tags: ["Revenge"] }),
  trade({ playbook_id: "orb", quick_tags: ["Level Sweep"], is_sample: true }),
];
const ELIGIBLE = FIXTURE.filter((trade) => !trade.is_sample);

const view = (setup: readonly string[], trades: TradeRecord[] = FIXTURE): LabView =>
  labView(BOOKS, { setup, execution: EXECUTION_TAGS }, trades, { includeSamples: false, now: NOW });

function readSource(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf-8");
}

// Transpile a .tsx component and evaluate it with stubbed imports. Only the pure helpers are called.
const requireFromRoot = createRequire(path.join(process.cwd(), "package.json"));
function loadComponent(relPath: string): Record<string, unknown> {
  const { outputText } = ts.transpileModule(readSource(relPath), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  });
  const mod = { exports: {} as Record<string, unknown> };
  const stubRequire = (id: string) => (id === "react/jsx-runtime" ? requireFromRoot("react/jsx-runtime") : {});
  new Function("require", "module", "exports", outputText)(stubRequire, mod, mod.exports);
  return mod.exports;
}

type MapModule = {
  buildLabMapLayout: (view: LabView) => LabMapLayout;
  cellShade: (n: number, maxCount: number) => string;
};
const map = loadComponent("components/PlaybookLabMap.tsx") as unknown as MapModule;

/** Feed count for a link, through the same parse and apply the Feed page uses. */
function feedCount(href: string, trades: TradeRecord[] = ELIGIBLE): number {
  const query = new URLSearchParams(href.includes("?") ? href.slice(href.indexOf("?") + 1) : "");
  return applyFilters(trades, parseFilters(query)).length;
}

test("PL-2b: Map uses grid mode for up to 8 setup tags and switches to sorted pairs at 9", () => {
  const eight = map.buildLabMapLayout(view(SETUP_8));
  assert.equal(eight.mode, "grid");
  assert.deepEqual(eight.columns, SETUP_8);
  assert.ok(eight.rows.every((row) => row.cells.length === SETUP_8.length));

  const nine = map.buildLabMapLayout(view(SETUP_9));
  assert.equal(nine.mode, "pairs");
  assert.equal(nine.pairs.length, view(SETUP_9).matrix.length);
  assert.ok(nine.pairs.every((pair) => pair.n > 0 && pair.feedHref.startsWith("/feed?")));
  for (let i = 1; i < nine.pairs.length; i += 1) {
    assert.ok(nine.pairs[i - 1].n >= nine.pairs[i].n, "pairs are sorted most used first");
  }
  assert.equal(nine.pairs[0].n, nine.maxCount);
});

test("PL-2b: Map rows are active playbooks plus archived playbooks with trades", () => {
  const layout = map.buildLabMapLayout(view(SETUP_8));
  const ids = layout.rows.map((row) => row.playbookId);
  assert.deepEqual(ids, ["orb", "vwap", "old"]);
  assert.equal(layout.rows.find((row) => row.playbookId === "old")?.archived, true);
  // An archived playbook with no trades is left out of the grid.
  const noOld = map.buildLabMapLayout(view(SETUP_8, FIXTURE.filter((t) => t.playbook_id !== "old")));
  assert.ok(!noOld.rows.some((row) => row.playbookId === "old"));
});

test("PL-2b: Map cell shade is a count-only gold token mix, never a hardcoded colour", () => {
  const top = map.cellShade(5, 5);
  assert.match(top, /var\(--gold-mid\)/);
  assert.match(top, /var\(--gold-intensity\)/);
  assert.match(top, /var\(--bg-elevated\)/);
  assert.doesNotMatch(top, /#[0-9a-fA-F]{3,8}\b/);

  // Strictly by count: higher counts get a larger percentage, zero gets 0%, a non-zero cell is never blank.
  const pct = (n: number) => Number(/calc\((\d+)%/.exec(map.cellShade(n, 10))?.[1]);
  assert.equal(pct(0), 0);
  assert.ok(pct(1) >= 1);
  for (let n = 1; n < 10; n += 1) assert.ok(pct(n) <= pct(n + 1), `shade is monotonic at ${n}`);
  assert.equal(pct(10), 32);

  // Map source: no hex gold, no profit or loss colour, no P&L helpers.
  const src = readSource("components/PlaybookLabMap.tsx");
  assert.doesNotMatch(src, /#d4af37/i);
  assert.doesNotMatch(src, /#[0-9a-fA-F]{6}\b/);
  assert.doesNotMatch(src, /tradePnl|resultR|--(?:green|red|profit|loss)/);
  // The grid scrolls inside its own box and pins the first column.
  const css = readSource("app/lab.css");
  assert.match(css, /\.lab-map-scroll \{[^}]*overflow-x: auto;[^}]*overscroll-behavior-x: contain;/);
  const pinned = /\.lab-map-first \{([^}]*)\}/.exec(css)?.[1] ?? "";
  for (const decl of ["position: sticky", "left: 0", "background: var(--bg-surface)", "z-index: 1"]) assert.ok(pinned.includes(decl), `pinned column has ${decl}`);
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/);
});

test("PL-2b: every non-zero Map cell links to a Feed that shows exactly that many trades", () => {
  for (const setup of [SETUP_8, SETUP_9]) {
    const layout = map.buildLabMapLayout(view(setup));
    const cells = layout.mode === "grid"
      ? layout.rows.flatMap((row) => row.cells).filter((cell) => cell.n > 0)
      : layout.pairs;
    assert.ok(cells.length > 0);
    for (const cell of cells) {
      assert.ok(cell.feedHref, `cell ${cell.playbookId} × ${cell.tag} has a link`);
      assert.equal(feedCount(cell.feedHref!), cell.n, `${cell.playbookId} × ${cell.tag}`);
    }
  }
});

test("PL-2b: Gaps count links return exactly the displayed count (no playbook, impulse)", () => {
  const v = view(SETUP_8);
  assert.equal(feedCount(v.gaps.noPlaybookHref), v.gaps.noPlaybook.length);
  assert.equal(feedCount(v.gaps.impulseHref), v.gaps.impulseCount);
  assert.ok(v.gaps.noPlaybook.length > 0 && v.gaps.impulseCount > 0, "fixture has both kinds");
});

test("PL-2b: Gaps no-setup-tag link returns exactly the displayed count", () => {
  const v = view(SETUP_8);
  assert.equal(feedCount(v.gaps.noSetupTagHref), v.gaps.noSetupTag.length);
});

test("PL-2b: Gaps shows the clean state when every trade has a playbook and setup tag", () => {
  const clean = [trade({ playbook_id: "orb", quick_tags: ["Level Sweep"] }), trade({ playbook_id: "vwap", quick_tags: ["VWAP Hold"] })];
  const cleanView = view(SETUP_TAGS, clean);
  assert.equal(cleanView.gaps.noPlaybook.length, 0);
  assert.equal(cleanView.gaps.noSetupTag.length, 0);
  const src = readSource("components/PlaybookLabGaps.tsx");
  assert.match(src, /Every trade has a playbook and setup tag\./);
  assert.match(src, /clean = view\.counts\.trades > 0/);
});

test("PL-2b: Gaps lists unused playbooks to Tune and shows the impulse share as a percentage link", () => {
  const src = readSource("components/PlaybookLabGaps.tsx");
  assert.match(src, /href="\/tune#playbooks"/);
  assert.match(src, /g\.impulseShare == null \? "—" : fmtPct\(g\.impulseShare\)/);
  assert.match(src, /href=\{g\.impulseHref\}/);
  assert.match(src, /href=\{g\.noPlaybookHref\}/);
  assert.match(src, /href=\{g\.noSetupTagHref\}/);
  assert.match(src, /className="num"/);
});

test("PL-2b: PlaybookLab mounts Map and Gaps in their tabs and keeps the placeholders out", () => {
  const src = readSource("components/PlaybookLab.tsx");
  assert.match(src, /\{tab === "map" && <PlaybookLabMap view=\{view\} \/>\}/);
  assert.match(src, /\{tab === "gaps" && <PlaybookLabGaps view=\{view\} \/>\}/);
  assert.doesNotMatch(src, /function (MapPanel|GapsPanel)/);
  assert.match(readSource("components/PlaybookLabMap.tsx"), /tabIndex=\{0\}/);
});
