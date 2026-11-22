import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function readSource(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf-8");
}

test("MM-W2-01: Modal sheets implement dialog semantics, aria-modal, and accessible close controls", () => {
  const challengeSheet = readSource("components/ChallengeSetupSheet.tsx");
  const playbookSheet = readSource("components/PlaybookCardSheet.tsx");

  // ChallengeSetupSheet
  assert.match(challengeSheet, /role="dialog"/);
  assert.match(challengeSheet, /aria-modal="true"/);
  assert.match(challengeSheet, /aria-labelledby="challenge-sheet-title"/);
  assert.match(challengeSheet, /aria-describedby="challenge-sheet-desc"/);
  assert.match(challengeSheet, /aria-label="Close challenge setup"/);
  assert.match(challengeSheet, /key === "Escape"/);

  // PlaybookCardSheet
  assert.match(playbookSheet, /role="dialog"/);
  assert.match(playbookSheet, /aria-modal="true"/);
  assert.match(playbookSheet, /aria-labelledby="playbook-card-title"/);
  assert.match(playbookSheet, /aria-describedby="playbook-card-status"/);
  assert.match(playbookSheet, /aria-label="Close playbook card export"/);
  assert.match(playbookSheet, /key === "Escape"/);
});

test("MM-W2-01: Radiogroups, radios, and switches use correct ARIA roles and state attributes", () => {
  const challengeSheet = readSource("components/ChallengeSetupSheet.tsx");
  const playbookSheet = readSource("components/PlaybookCardSheet.tsx");
  const playbookEditor = readSource("components/PlaybookEditor.tsx");

  // Challenge kind selection in setup sheet
  assert.match(challengeSheet, /role="radiogroup"/);
  assert.match(challengeSheet, /role="radio"/);
  assert.match(challengeSheet, /aria-checked=\{kind === "drawdown"\}/);
  assert.match(challengeSheet, /aria-checked=\{kind === "clean_run"\}/);

  // Card format and face radiogroups in export sheet
  assert.match(playbookSheet, /role="radiogroup" aria-label="Card format"/);
  assert.match(playbookSheet, /role="radiogroup" aria-label="Card face"/);
  assert.match(playbookSheet, /role="radio"/);
  assert.match(playbookSheet, /aria-checked=\{size === value\}/);
  assert.match(playbookSheet, /aria-checked=\{side === value\}/);

  // Shield switch in export sheet
  assert.match(playbookSheet, /role="switch"/);
  assert.match(playbookSheet, /aria-checked=\{shield\}/);

  // Style selector in playbook editor
  assert.match(playbookEditor, /role="radiogroup"/);
  assert.match(playbookEditor, /role="radio"/);
  assert.match(playbookEditor, /aria-checked=\{draft\.default_style === style\}/);
});

test("MM-W2-01: Primary and thumb-zone controls enforce minimum 44px tap targets", () => {
  const challengeSheet = readSource("components/ChallengeSetupSheet.tsx");
  const challengeCard = readSource("components/ChallengeCard.tsx");
  const challengeDetail = readSource("components/ChallengeDetail.tsx");
  const playbookCard = readSource("components/PlaybookCard.tsx");
  const playbookEditor = readSource("components/PlaybookEditor.tsx");
  const drillScreen = readSource("components/DrillScreen.tsx");

  // ChallengeSetupSheet toggle and buttons
  assert.match(challengeSheet, /minHeight:\s*(44|46|52)/);

  // ChallengeCard links and buttons
  assert.match(challengeCard, /minHeight:\s*44/);

  // ChallengeDetail back link, action buttons, issue links
  assert.match(challengeDetail, /minHeight:\s*44/);

  // PlaybookCard flip, share buttons
  assert.match(playbookCard, /minHeight:\s*44/);

  // PlaybookEditor new, edit, restore, add buttons
  assert.match(playbookEditor, /minHeight:\s*44/);

  // DrillScreen answer buttons
  assert.match(drillScreen, /minHeight:\s*46/);
});

test("MM-W2-01: No red/green-only status conveyance (symbols and explicit text paired)", () => {
  const challengeCard = readSource("components/ChallengeCard.tsx");
  const challengeDetail = readSource("components/ChallengeDetail.tsx");
  const drillScreen = readSource("components/DrillScreen.tsx");

  // ChallengeCard checkmarks and crosses
  assert.match(challengeCard, /✓/);
  assert.match(challengeCard, /✕/);

  // ChallengeDetail shapes for process adherence: ● Clean, ▲ Broken, ■ Off-Plan, ○ Pending
  assert.match(challengeDetail, /●/);
  assert.match(challengeDetail, /▲/);
  assert.match(challengeDetail, /■/);
  assert.match(challengeDetail, /● Clean/);
  assert.match(challengeDetail, /▲ Broken Rule/);
  assert.match(challengeDetail, /■ Off-Plan/);
  assert.match(challengeDetail, /▲ LONG/);
  assert.match(challengeDetail, /▼ SHORT/);

  // DrillScreen miss warning icon and rules followed/broken text
  assert.match(drillScreen, /rules \{process === "clean" \? "followed \(clean\)" : "broken"\}/);
  assert.match(drillScreen, /⚠️/);
});

test("MM-W2-01: Progress meters and dots implement progressbar or img accessibility", () => {
  const challengeCard = readSource("components/ChallengeCard.tsx");
  const challengeDetail = readSource("components/ChallengeDetail.tsx");

  // DrawdownBar progressbar
  assert.match(challengeCard, /role="progressbar"/);
  assert.match(challengeCard, /aria-valuenow=\{pct\}/);
  assert.match(challengeCard, /aria-valuemax=\{100\}/);

  // CleanRunDots progressbar
  assert.match(challengeCard, /role="progressbar"/);
  assert.match(challengeCard, /aria-valuenow=\{run\}/);
  assert.match(challengeCard, /aria-valuemax=\{target\}/);

  // CleanRunDotsDetail trade cells have listitem role and informative labels
  assert.match(challengeDetail, /role="listitem"/);
  assert.match(challengeDetail, /aria-label=\{`Trade #\$\{idx \+ 1\}: \$\{statusText\}`\}/);

  // DrawdownPathChart has title and desc
  assert.match(challengeDetail, /<title>Drawdown path chart<\/title>/);
  assert.match(challengeDetail, /<desc>/);
});

test("MM-W2-01: All icon buttons and interactive controls have explicit accessible names", () => {
  const challengeSheet = readSource("components/ChallengeSetupSheet.tsx");
  const playbookSheet = readSource("components/PlaybookCardSheet.tsx");
  const playbookEditor = readSource("components/PlaybookEditor.tsx");
  const drillScreen = readSource("components/DrillScreen.tsx");

  // Close buttons
  assert.match(challengeSheet, /aria-label="Close challenge setup"/);
  assert.match(playbookSheet, /aria-label="Close playbook card export"/);

  // PlaybookEditor rule list buttons
  assert.match(playbookEditor, /aria-label=\{`Move rule \$\{index \+ 1\} up`\}/);
  assert.match(playbookEditor, /aria-label=\{`Move rule \$\{index \+ 1\} down`\}/);
  assert.match(playbookEditor, /aria-label=\{`Remove rule \$\{index \+ 1\}: \$\{rule\.label\}`\}/);

  // DrillScreen answer buttons
  assert.match(drillScreen, /aria-label=\{`Answer: \$\{label\}`\}/);
});

test("MM-W2-01: prefers-reduced-motion is respected in CSS and components", () => {
  const globals = readSource("app/globals.css");
  assert.match(globals, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.match(globals, /animation:\s*none\s*!important/);
  assert.match(globals, /transition:\s*none\s*!important/);
});
