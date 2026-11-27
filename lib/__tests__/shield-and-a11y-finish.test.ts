// R3-15: finishes #19 (accessibility pass) and locks #15 (Shield hides dollars and contract counts) on post-MM-W2
// screens. Source-contract tests in the style of a11y-core-screens.test.ts: they read the component files, so no DOM.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

function readSource(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf-8");
}

// A colour declared with a hardcoded hex (gold or danger) instead of a theme token.
const HARDCODED_COLOUR = /(?:color|background|borderColor)\s*:\s*"[^"]*#[0-9a-fA-F]{3,8}\b/;

test("R3-15 Shield: PartialsCard (R3-12) and EntryPartialsSection (R3-13) mask quantities and dollars", () => {
  const partials = readSource("components/PartialsCard.tsx");
  assert.match(partials, /const qty = \(count: number\) => \(shield \? null : `\$\{count\}×`\);/);
  assert.match(partials, /\{!shield && <th style=\{HEAD_STYLE\}>Qty<\/th>\}/);
  assert.match(partials, /\{!shield && <td style=\{CELL_STYLE\}>\{target\.qty\}<\/td>\}/);
  assert.match(partials, /\{!shield && <td style=\{CELL_STYLE\}>\{exit\.qty\}<\/td>\}/);
  assert.match(partials, /no contract quantity and no dollar figure is returned/);

  const entry = readSource("components/EntryPartialsSection.tsx");
  assert.match(entry, /const qtyType = prefs\.shield \? "password" : "number";/);
  assert.match(entry, /Under Shield the contract counts are masked on screen/);
});

test("R3-15 Shield: DayReviewScreen hides dollar P&L and contract counts whenever Shield is on", () => {
  const src = readSource("components/DayReviewScreen.tsx");
  // Summary line: money only when Shield is off.
  assert.match(src, /\{!prefs\.shield && totals\.formattedNetMoney \? ` · \$\{totals\.formattedNetMoney\}` : ""\}/);
  // Totals are Shield-aware.
  assert.match(src, /prefs\.shield,\n\s*\{ accounts: accounts\.accounts, prefs \}/);
  // The app Shield wins over the export toggle, so the share sheet cannot show dollars with Shield on.
  assert.match(src, /const exportShield = prefs\.shield \|\| exportShieldPick;/);
  assert.match(src, /const cardShield = shareOpen \? exportShield : prefs\.shield;/);
  assert.match(src, /checked=\{exportShield\} disabled=\{prefs\.shield\}/);
  // The screen never prints a quantity or a formatted money value directly.
  assert.doesNotMatch(src, /trade\.quantity/);
  assert.doesNotMatch(src, /formatMoney\(/);
});

test("R3-15 #19: DayReviewScreen Share day dialog has role, aria-modal and Escape handling", () => {
  const src = readSource("components/DayReviewScreen.tsx");
  assert.match(src, /<section ref=\{shareDialogRef\} tabIndex=\{-1\} className="day-share-sheet" role="dialog" aria-modal="true" aria-labelledby="day-share-title"/);
  assert.match(src, /<strong id="day-share-title">Share day<\/strong>/);
  assert.match(src, /if \(event\.key === "Escape"\) setShareOpen\(false\);/);
  assert.match(src, /window\.addEventListener\("keydown", onKey\);/);
  assert.match(src, /window\.removeEventListener\("keydown", onKey\);/);
  assert.match(src, /\}, \[shareOpen\]\);/);
});

test("R3-15 #19: DayReviewScreen tap targets and labels meet 44px and name each control", () => {
  const src = readSource("components/DayReviewScreen.tsx");
  // Unlinked trade row checkbox label is a 44x44 target.
  assert.match(src, /<label className="day-review-check" style=\{\{ minHeight: 44, minWidth: 44, display: "inline-flex", alignItems: "center" \}\}>/);
  // PointGroup remove, cancel and save buttons.
  assert.match(src, /aria-label=\{`Delete \$\{props\.title\} point`\}/);
  assert.match(src, /aria-label=\{`Cancel \$\{props\.title\} point`\}/);
  assert.match(src, /aria-label=\{`Save \$\{props\.title\} point`\}/);
  assert.match(src, /aria-label="Close share day"/);
  // Stays under the 448-line ceiling set for this file.
  assert.ok(src.split("\n").length <= 448, `DayReviewScreen.tsx must stay <= 448 lines (has ${src.split("\n").length})`);
});

test("R3-15 #19: AgentKeysScreen revoke buttons name the key and timestamps use tabular numerals", () => {
  const src = readSource("components/AgentKeysScreen.tsx");
  assert.match(src, /aria-label=\{`\$\{armed === row\.id \? "Confirm revoke" : "Revoke"\} \$\{row\.label\}`\}/);
  assert.match(src, /const TOUCH: CSSProperties = \{ minHeight: 44, minWidth: 44 \};/);
  assert.match(src, /fontVariantNumeric: "tabular-nums"/);
  assert.match(src, /aria-label=\{`Copy \$\{label\}`\}/);
  assert.match(src, /<section className="card card-pad" style=\{SECTION\} aria-labelledby="agent-keys">/);
  assert.doesNotMatch(src, HARDCODED_COLOUR);
});

test("R3-15 #19: LoginScreen is a labelled main landmark with 44px controls and no hardcoded colour", () => {
  const src = readSource("components/LoginScreen.tsx");
  assert.match(src, /return auth \? <main style=\{PAGE\}>\{content\}<\/main> : <div style=\{PAGE\}>\{content\}<\/div>;/);
  assert.match(src, /const TOUCH: CSSProperties = \{ minHeight: 44 \};/);
  assert.match(src, /aria-labelledby="login-title"/);
  assert.match(src, /<button type="submit" className="btn-primary btn-block" style=\{TOUCH\}/);
  assert.doesNotMatch(src, HARDCODED_COLOUR);
});

test("R3-15 #19: TagRegistryEditor retired disclosure is a 44px summary and danger uses the theme token", () => {
  const src = readSource("components/TagRegistryEditor.tsx");
  assert.match(src, /<summary style=\{\{ minHeight: 44, display: "flex", alignItems: "center", gap: 6 \}\}>Retired/);
  assert.match(src, /aria-label=\{`Restore tag \$\{def\.label\}`\}/);
  assert.match(src, /aria-label=\{`Edit tag \$\{def\.label\}`\}/);
  assert.match(src, /style=\{\{ color: "var\(--loss-text\)", margin: 0, fontSize: 13 \}\}/);
  assert.doesNotMatch(src, /#f87171/);
  assert.doesNotMatch(src, HARDCODED_COLOUR);
});

test("R3-15 #19: PlaybookLab tabs, rows, examples and switch enforce 44px and labelled landmarks", () => {
  const src = readSource("components/PlaybookLab.tsx");
  assert.match(src, /<nav className="lab-tabs" aria-label="Lab sections">/);
  assert.match(src, /aria-current=\{tab === id \? "page" : undefined\} style=\{\{ minHeight: 44, display: "inline-flex", alignItems: "center" \}\}/);
  assert.match(src, /className="lab-switch"\n\s*style=\{\{ minHeight: 44 \}\}/);
  assert.match(src, /<Link className="lab-row" style=\{\{ minHeight: 44 \}\}/);
  assert.match(src, /<Link className="lab-example" style=\{\{ minHeight: 44 \}\}/);
  assert.match(src, /<summary style=\{\{ minHeight: 44, display: "flex", alignItems: "center" \}\}>/);
  assert.match(src, /<div className="lab-counts" style=\{\{ fontVariantNumeric: "tabular-nums" \}\}>/);
  assert.match(src, /<section className="lab-panel" aria-labelledby="lab-playbooks-title">/);
  assert.match(src, /aria-label=\{`\$\{title\} tags`\}/);
  // Lab shows R, counts and percentages only: no dollar or quantity output.
  assert.doesNotMatch(src, /formatMoney|formatUsd|\.quantity|currency/);
  assert.doesNotMatch(src, HARDCODED_COLOUR);
});

test("R3-15 #19: PlaybookLabMap grid cells and pair rows enforce 44px and labelled regions", () => {
  const src = readSource("components/PlaybookLabMap.tsx");
  assert.match(src, /role="region" aria-label="Playbook by setup tag counts" tabIndex=\{0\}/);
  assert.match(src, /className="lab-map-link"\n\s*style=\{\{ minHeight: 44, minWidth: 44/);
  assert.match(src, /<Link className="lab-bar" style=\{\{ minHeight: 44 \}\} href=\{pair\.feedHref\}>/);
  assert.match(src, /aria-label=\{`\$\{cell\.playbookName\} with \$\{cell\.tag\}: \$\{cell\.n\}/);
  assert.match(src, /aria-label="Playbook and setup tag pairs, most used first"/);
  assert.doesNotMatch(src, /formatMoney|formatUsd|\.quantity|currency/);
  assert.doesNotMatch(src, HARDCODED_COLOUR);
});

test("R3-15 #19: PlaybookLabGaps gap links enforce 44px and the section is labelled", () => {
  const src = readSource("components/PlaybookLabGaps.tsx");
  assert.match(src, /<section className="lab-panel" aria-labelledby="lab-gaps-title">/);
  assert.match(src, /<ul className="lab-grid lab-list" aria-label="Gap counts">/);
  assert.equal((src.match(/<Link className="lab-row" style=\{\{ minHeight: 44 \}\}/g) ?? []).length, 3);
  assert.match(src, /<Link href="\/tune#playbooks" style=\{\{ minHeight: 44, display: "inline-flex", alignItems: "center" \}\}>/);
  assert.doesNotMatch(src, /formatMoney|formatUsd|\.quantity|currency/);
  assert.doesNotMatch(src, HARDCODED_COLOUR);
});
