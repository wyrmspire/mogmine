// Reusable setups and the tag vocabulary for the Pit Stop (docs/03 §2A).
// Fixed defaults for now: there is no playbook editor or `playbooks` table yet.
import type { ChecklistItem, TradeStyle } from "./trades.ts";

export interface Playbook {
  id: string;
  name: string;
  default_style: TradeStyle;
  checklist_rules: Array<{ id: string; label: string }>;
}

const STANDARD_RULES = [
  { id: "htf-bias", label: "Higher-timeframe bias defined" },
  { id: "candle-close", label: "Waited for the candle close" },
  { id: "hard-stop", label: "Hard stop placed" },
  { id: "news-clear", label: "No entry within 5m of red-folder news" },
];

export const PLAYBOOKS: Playbook[] = [
  { id: "orb-reclaim", name: "ORB Reclaim", default_style: "scalp", checklist_rules: STANDARD_RULES },
  { id: "onl-sweep-smt", name: "ONL Sweep + SMT", default_style: "session_90m", checklist_rules: STANDARD_RULES },
  { id: "vwap-trend-push", name: "VWAP Trend Push", default_style: "session_90m", checklist_rules: STANDARD_RULES },
  { id: "no-setup", name: "No Setup / Impulse", default_style: "scalp", checklist_rules: [] },
];

export const SETUP_TAGS = ["SMT Divergence", "Pushed w/ NQ", "Level Sweep", "VWAP Hold", "Opening Drive"];
export const EXECUTION_TAGS = ["A+ Patience", "Chased Entry", "Cut Early", "Moved Stop", "Revenge"];

export function playbookName(id: string | null) {
  return PLAYBOOKS.find((playbook) => playbook.id === id)?.name ?? null;
}

/** A fresh, unchecked copy of a playbook's rules, to freeze on a trade (UX-50). */
export function checklistFor(id: string | null): ChecklistItem[] {
  const playbook = PLAYBOOKS.find((item) => item.id === id);
  return (playbook?.checklist_rules ?? []).map((rule) => ({ ...rule, checked: false }));
}
