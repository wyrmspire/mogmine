// Spec write-back guard (issue #21, package R3-16). Pure node:fs: no app code, no network.
// Keeps the numbered docs from drifting back to the stale wording that the shipped code replaced.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

const DOCS = [
  "03-trade-cards-and-note-taking.md",
  "07-agent-guardrails-and-smart-notes.md",
  "08-ux-notes-viewing-and-journaling.md",
  "09-backend-risk-register.md",
  "12-levels-zones-and-daily-markup.md",
  "14-ui-phased-plan.md",
  "15-trade-document-and-render-grammar.md",
  "16-floor-roadmap.md",
  "21-accounts-and-running-totals.md",
  "23-card-system.md",
  "24-planning-sessions-and-after-session-review.md",
];

const read = (name: string) => fs.readFileSync(path.join(process.cwd(), "docs", name), "utf-8");

test("no updated doc still says the playbook filter is unbuilt", () => {
  for (const name of DOCS) assert.doesNotMatch(read(name), /\?playbook= filter is not built/, name);
});

test("no updated doc uses rMultiple === null as the live running-stats rule", () => {
  for (const name of DOCS) assert.doesNotMatch(read(name), /rMultiple === null/, name);
});

test("docs/03 no longer shows the emerald/gold profit box", () => {
  assert.doesNotMatch(read("03-trade-cards-and-note-taking.md"), /Translucent Emerald\/Gold Profit Box/);
});

test("docs/21 documents the fixed per-account r_size_cents", () => {
  const doc = read("21-accounts-and-running-totals.md");
  assert.match(doc, /r_size_cents/);
  assert.match(doc, /\$300/);
  assert.match(doc, /\$250/);
});

test("docs/15 documents the untimed stop-move basis and partial_exits mapping", () => {
  const doc = read("15-trade-document-and-render-grammar.md");
  assert.match(doc, /"untimed"/);
  assert.match(doc, /partial_exits/);
  assert.match(doc, /partial_targets/);
});

test("docs/07 and docs/09 use account R, not the old points ratio", () => {
  assert.doesNotMatch(read("07-agent-guardrails-and-smart-notes.md"), /rMultiple = riskPoints/);
  assert.match(read("09-backend-risk-register.md"), /r_size_cents/);
});
