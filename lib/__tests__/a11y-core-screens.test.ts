import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

const ROOT = path.resolve(process.cwd());

function readComponent(relativePath: string): string {
  const filePath = path.join(ROOT, relativePath);
  return fs.readFileSync(filePath, "utf-8");
}

test("AppShell enforces semantic landmarks and accessible navigation (#19b)", () => {
  const src = readComponent("components/AppShell.tsx");

  // Semantic landmarks: main and nav with distinct aria-labels
  assert.ok(src.includes("<main id=\"main-content\""), "AppShell must contain main landmark with id");
  assert.ok(src.includes("role=\"main\""), "AppShell main should declare role=\"main\"");
  assert.ok(src.includes("aria-label=\"Desktop navigation\""), "AppShell topnav must have an accessible label");
  assert.ok(src.includes("aria-label=\"Bottom dock navigation\""), "AppShell dock must have an accessible label distinct from topnav");

  // Active page indicator on nav items
  assert.ok(src.includes("aria-current={isActive(item.href) ? \"page\" : undefined}"), "Active bottom-dock and topnav links must set aria-current=\"page\"");

  // Bottom dock tap targets >= 44x44px
  assert.ok(src.includes("className=\"dock-add\""), "Dock must contain dock-add button");
  assert.ok(src.includes("style={{ minHeight: 44, minWidth: 44 }}"), "Dock items must enforce >=44x44px tap target");
});

test("TuneScreen provides accessible sliders and role=\"switch\" toggles (#19b)", () => {
  const src = readComponent("components/TuneScreen.tsx");

  // Gold Intensity slider accessible attributes
  assert.ok(src.includes("aria-label=\"Gold intensity\""), "Gold intensity slider must have aria-label");
  assert.ok(src.includes("aria-valuemin={0}"), "Gold intensity slider must have aria-valuemin");
  assert.ok(src.includes("aria-valuemax={100}"), "Gold intensity slider must have aria-valuemax");
  assert.ok(src.includes("aria-valuenow="), "Gold intensity slider must have aria-valuenow");
  assert.ok(src.includes("aria-valuetext="), "Gold intensity slider must have aria-valuetext percentage");

  // Box Opacity slider accessible attributes
  assert.ok(src.includes("aria-label=\"Position Box opacity\""), "Position Box opacity slider must have aria-label");
  assert.ok(src.includes("aria-valuemin={15}"), "Position Box opacity slider must have aria-valuemin");
  assert.ok(src.includes("aria-valuemax={65}"), "Position Box opacity slider must have aria-valuemax");
  assert.ok(src.includes("aria-valuenow="), "Position Box opacity slider must have aria-valuenow");
  assert.ok(src.includes("aria-valuetext="), "Position Box opacity slider must have aria-valuetext percentage");

  // Toggles: Shield mode and Color-blind mode with role="switch" and aria-checked
  assert.ok(src.includes("role=\"switch\""), "TuneScreen must include role=\"switch\" toggles");
  assert.ok(src.includes("aria-checked={prefs.shield}"), "Shield toggle must have aria-checked binding");
  assert.ok(src.includes("aria-label=\"Shield mode"), "Shield toggle must have accessible label");

  assert.ok(src.includes("aria-checked={prefs.palette === \"blue-orange\"}"), "Color-blind mode toggle must have aria-checked binding");
  assert.ok(src.includes("aria-label=\"Color-blind mode\""), "Color-blind mode toggle must have accessible label");

  // Tap targets on buttons
  assert.ok(src.includes("style={{ minHeight: 44 }}"), "Segmented / preset buttons must ensure >=44px minimum height");
});

test("PlanSheet enforces role=\"dialog\", aria-modal=\"true\", and Escape key handling (#19b)", () => {
  const src = readComponent("components/PlanSheet.tsx");

  // Dialog semantics
  assert.ok(src.includes("role=\"dialog\""), "PlanSheet must specify role=\"dialog\"");
  assert.ok(src.includes("aria-modal=\"true\""), "PlanSheet must specify aria-modal=\"true\"");
  assert.ok(src.includes("aria-labelledby=\"plan-sheet-title\""), "PlanSheet must reference its heading via aria-labelledby");
  assert.ok(src.includes("id=\"plan-sheet-title\""), "PlanSheet heading must have id matching aria-labelledby");

  // Escape key handler
  assert.ok(src.includes("event.key === \"Escape\""), "PlanSheet must listen for Escape key to close");
  assert.ok(src.includes("onClose()"), "Escape key handler must trigger onClose");

  // Tap targets on plan buttons
  assert.ok(src.includes("aria-label=\"Close planning sheet\""), "Close button must have accessible label");
  assert.ok(src.includes("minHeight: 44"), "Plan controls must ensure >=44px minimum touch target");
  assert.ok(src.includes("minWidth: 44"), "Plan icon / step buttons must ensure >=44px minimum touch target");
});

test("SessionReview enforces role=\"dialog\", aria-modal=\"true\", and Escape key handling (#19b)", () => {
  const src = readComponent("components/SessionReview.tsx");

  // Dialog semantics
  assert.ok(src.includes("role=\"dialog\""), "SessionReview must specify role=\"dialog\"");
  assert.ok(src.includes("aria-modal=\"true\""), "SessionReview must specify aria-modal=\"true\"");
  assert.ok(src.includes("aria-labelledby=\"review-title\""), "SessionReview must reference its heading via aria-labelledby");
  assert.ok(src.includes("id=\"review-title\""), "SessionReview heading must have id matching aria-labelledby");

  // Escape key handler
  assert.ok(src.includes("event.key === \"Escape\""), "SessionReview must listen for Escape key to close");
  assert.ok(src.includes("onClose()"), "SessionReview Escape handler must call onClose");

  // Accessible close button with >= 44x44px target
  assert.ok(src.includes("aria-label=\"Close review\""), "Close button must have aria-label");
  assert.ok(src.includes("minHeight: 44, minWidth: 44"), "Close button must have minHeight and minWidth of 44px");
});

test("ReviewScreen enforces review action tap targets and blind review switch (#19b)", () => {
  const src = readComponent("components/ReviewScreen.tsx");

  // Review queue card landmark & progressbar
  assert.ok(src.includes("className=\"specular-card queue-card\" aria-label="), "Review queue card must have descriptive aria-label");
  assert.ok(src.includes("role=\"progressbar\""), "Queue progress must have role=\"progressbar\"");

  // Blind review toggle
  assert.ok(src.includes("role=\"switch\" aria-checked={prefs.blindReview} aria-label=\"Blind review\""), "Blind review must be accessible switch");

  // Primary review actions >= 44px tap targets
  assert.ok(src.includes("aria-label=\"Skip trade\""), "Skip action must have accessible label");
  assert.ok(src.includes("aria-label=\"Mark trade reviewed\""), "Reviewed action must have accessible label");
  assert.ok(src.includes("minHeight: 44, minWidth: 44"), "Review actions must enforce >=44x44px tap targets");
});

test("PlanCard enforces >= 44px tap targets on all plan buttons (#19b)", () => {
  const src = readComponent("components/PlanCard.tsx");

  // New plan button and review buttons
  assert.ok(src.includes("minHeight: 44"), "PlanCard buttons must enforce >= 44px tap targets");
  assert.ok(src.includes("aria-label={`Review ${plan.name}`}"), "Review button must have specific accessible label");
  assert.ok(src.includes("role=\"button\""), "Interactive plan rows must have role=\"button\"");
  assert.ok(src.includes("aria-label={`Open plan ${plan.name}`}"), "Interactive plan rows must have accessible label");
});

test("TodayScreen and FeedScreen enforce landmarks and filter controls (#19b)", () => {
  const todaySrc = readComponent("components/TodayScreen.tsx");
  const feedSrc = readComponent("components/FeedScreen.tsx");

  // Today landmarks & tap targets
  assert.ok(todaySrc.includes("<aside aria-label=\"Review queue\">"), "TodayScreen must label review queue aside landmark");
  assert.ok(todaySrc.includes("aria-label={`Last trading day"), "TodayScreen past section must have accessible label");

  // Feed landmarks & filter pills
  assert.ok(feedSrc.includes("role=\"group\" aria-label=\"Filters\""), "FeedScreen must group filter pills with accessible label");
  assert.ok(feedSrc.includes("className=\"day-group\" aria-label="), "FeedScreen day sections must have accessible label");
  assert.ok(feedSrc.includes("style={{ minHeight: 44, minWidth: 44 }}"), "Feed filter pills must enforce >=44x44px tap target");
});
