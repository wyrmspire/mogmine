import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// SL-13 entry links (docs/design-2026-11-24/09 §6.2). The screens are client components (.tsx), which
// node --test cannot import, so the link wiring is checked against source, the way a11y-routes.test.ts does.

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

test("TuneScreen links to /strategy-lab next to the Playbooks & Lab link", () => {
  const src = read("components/TuneScreen.tsx");
  assert.match(src, /<Link href="\/strategy-lab">Strategy Lab<\/Link>/);
  const lab = src.indexOf('<Link href="/playbooks/lab">Playbooks &amp; Lab</Link>');
  const strategy = src.indexOf('<Link href="/strategy-lab">Strategy Lab</Link>');
  assert.ok(lab > 0 && strategy > lab, "Strategy Lab link sits in the Playbooks section header");
});

test("PlaybookLab playbook view has one Recipes row linking to /strategy-lab?playbook=<id>", () => {
  const src = read("components/PlaybookLab.tsx");
  const rows = src.match(/Recipes · Open in Strategy Lab →/g) ?? [];
  assert.equal(rows.length, 1, "exactly one Recipes row");
  assert.match(
    src,
    /href=\{`\/strategy-lab\?playbook=\$\{encodeURIComponent\(facet\.playbookId\)\}`\}[^>]*>Recipes · Open in Strategy Lab →<\/Link>/,
  );
});

test("the /strategy-lab target resolves to a route page", () => {
  assert.ok(fs.existsSync(path.join(ROOT, "app/strategy-lab/page.tsx")), "app/strategy-lab/page.tsx exists");
});
