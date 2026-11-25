import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

// PitStop.tsx and ReviewScreen.tsx are .tsx, which node --test cannot import here. The exported
// constants and predicate are therefore read from the source and evaluated, so the tests check the
// real shipped values rather than a copy.

const ROOT = path.resolve(process.cwd());
const read = (relativePath: string) => fs.readFileSync(path.join(ROOT, relativePath), "utf-8");
const pitStop = read("components/PitStop.tsx");
const reviewScreen = read("components/ReviewScreen.tsx");

function exportedValue(src: string, name: string): unknown {
  const match = src.match(new RegExp(`export const ${name} = ([\\s\\S]*?);\\n`));
  assert.ok(match, `${name} must be exported from PitStop.tsx`);
  return new Function(`return (${match[1].replace(/\s+as const$/, "")});`)();
}

test("NOTE_PLACEHOLDERS matches the four 02-ux §2.5 placeholders exactly", () => {
  assert.deepEqual(exportedValue(pitStop, "NOTE_PLACEHOLDERS"), {
    pre_trade_thesis: "Why this trade? What did you see?",
    management_notes: "What did you decide during the trade, and why?",
    post_exit_notes: "What would you do differently?",
    note: "Anything else worth remembering",
  });
});

test("NOTES_COMMENTARY_HINT and NO_SETUP_PICKED_LABEL match 02-ux §2.4-2.5", () => {
  assert.equal(exportedValue(pitStop, "NOTES_COMMENTARY_HINT"), "Prices, stop, risk and R are saved above. Notes are for your thinking.");
  assert.equal(exportedValue(pitStop, "NO_SETUP_PICKED_LABEL"), "No setup picked");
});

test("PitStop wires each notes textarea to its placeholder and renders the muted hint", () => {
  assert.ok(pitStop.includes("placeholder={NOTE_PLACEHOLDERS.note}"));
  assert.ok(pitStop.includes("placeholder={NOTE_PLACEHOLDERS.pre_trade_thesis}"));
  assert.ok(pitStop.includes("placeholder={NOTE_PLACEHOLDERS.management_notes}"));
  assert.ok(pitStop.includes("placeholder={NOTE_PLACEHOLDERS.post_exit_notes}"));
  assert.ok(pitStop.includes('<p className="muted"') && pitStop.includes("{NOTES_COMMENTARY_HINT}</p>"));
});

test("showsNoSetupPicked is true only for playbook_id null", () => {
  const body = pitStop.match(/export function showsNoSetupPicked\(trade: [^)]*\): boolean \{\n  return ([^;]+);\n\}/);
  assert.ok(body, "showsNoSetupPicked must be exported from PitStop.tsx");
  const predicate = new Function("trade", `return ${body[1]};`) as (trade: { playbook_id: string | null }) => boolean;
  assert.equal(predicate({ playbook_id: null }), true, "null means no setup was picked");
  assert.equal(predicate({ playbook_id: "no-setup" }), false, "No Setup / Impulse is a chosen playbook");
  assert.equal(predicate({ playbook_id: "orb-reclaim" }), false);
});

test("PitStop shows the No setup picked label at the start of the playbook row, gated on the predicate", () => {
  const row = pitStop.indexOf('aria-label="Playbook"');
  const label = pitStop.indexOf("{NO_SETUP_PICKED_LABEL}");
  assert.ok(row > 0 && label > row, "label must sit inside the Playbook chip group");
  assert.ok(pitStop.includes("{showsNoSetupPicked(trade) && <span"));
});

test("ReviewScreen shows a muted No setup chip in the queue card title only when unsealed and unfiled", () => {
  assert.ok(reviewScreen.includes('<span className="tag-chip muted">No setup</span>'));
  const line = reviewScreen.split("\n").find((item) => item.includes('"tag-chip muted">No setup'));
  assert.ok(line?.includes("!sealed && showsNoSetupPicked(trade)"), "chip must be gated on !sealed and the predicate");
  const title = reviewScreen.indexOf('className="row-title"');
  assert.ok(title > 0 && reviewScreen.indexOf("No setup</span>") > title, "chip must be inside .row-title");
});

test("Playbook chips are accessible buttons with a 44px tap target", () => {
  assert.ok(pitStop.includes('className="chip" aria-pressed={trade.playbook_id === playbook.id}'), "playbook chips must expose aria-pressed");
  assert.ok(pitStop.includes('role="group" aria-label="Playbook"'), "playbook chips must sit in a labelled group");
  const chipRule = read("app/globals.css").match(/\n\.chip \{\n\s+min-height: 44px;/);
  assert.ok(chipRule, ".chip must keep min-height: 44px");
  assert.ok(pitStop.includes('<span className="chip outlined" style={{ minHeight: 44 }}>'), "No setup label must meet the 44px target too");
});

test("every notes textarea has an accessible label", () => {
  for (const label of ['aria-label="Review note"', 'aria-label="Thesis and invalidation"', 'aria-label="Management"', 'aria-label="After the exit"']) {
    assert.ok(pitStop.includes(label), `missing ${label}`);
  }
});
