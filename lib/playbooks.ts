// Reusable setups and the tag vocabulary for the Pit Stop (docs/03 §2A).
// The four seeds below are the defaults. The trader's own list lives in `lib/playbooks-store.ts`
// (`mogmine-playbooks-v1`, R-07a), which keeps the registry here current so non-React code
// (share cards, stats labels) reads the same names the screens show.
import type { ChecklistItem, TradeStyle } from "./trades.ts";
import { DEFAULT_OWNER_USER_ID } from "./trades.ts";

export interface PlaybookRule {
  id: string;
  label: string;
}

export interface Playbook {
  id: string;
  /** Invariant 7: set now so Supabase Auth + RLS later needs no migration. */
  user_id: string;
  name: string;
  default_style: TradeStyle;
  /** Ordered. A trade copies these when its playbook is chosen and never re-reads them (UX-50). */
  checklist_rules: PlaybookRule[];
  /** No hard delete: old trades still reference the playbook (docs/16 §R-07). */
  archived: boolean;
}

/** The impulse bucket. Clean Run scores it as broken (docs/17 §4), so it keeps its id, has no rules and cannot be archived. */
export const NO_SETUP_ID = "no-setup";

export const PLAYBOOK_LIMITS = { name: 40, ruleLabel: 80, rules: 12 } as const;

const STANDARD_RULES: PlaybookRule[] = [
  { id: "htf-bias", label: "Higher-timeframe bias defined" },
  { id: "candle-close", label: "Waited for the candle close" },
  { id: "hard-stop", label: "Hard stop placed" },
  { id: "news-clear", label: "No entry within 5m of red-folder news" },
];

const seed = (id: string, name: string, default_style: TradeStyle, rules: PlaybookRule[]): Playbook => ({
  id, user_id: DEFAULT_OWNER_USER_ID, name, default_style, checklist_rules: rules.map((rule) => ({ ...rule })), archived: false,
});

/** The defaults every device starts with. Frozen so nothing edits them in place. */
export const PLAYBOOK_SEEDS: readonly Playbook[] = Object.freeze([
  seed("orb-reclaim", "ORB Reclaim", "scalp", STANDARD_RULES),
  seed("onl-sweep-smt", "ONL Sweep + SMT", "session_90m", STANDARD_RULES),
  seed("vwap-trend-push", "VWAP Trend Push", "session_90m", STANDARD_RULES),
  seed(NO_SETUP_ID, "No Setup / Impulse", "scalp", []),
]);

/** @deprecated Seeds only. Read the trader's list with `usePlaybooks()` or `currentPlaybooks()`. */
export const PLAYBOOKS = PLAYBOOK_SEEDS;

export const SETUP_TAGS = ["SMT Divergence", "Pushed w/ NQ", "Level Sweep", "VWAP Hold", "Opening Drive"];
export const EXECUTION_TAGS = ["A+ Patience", "Chased Entry", "Cut Early", "Moved Stop", "Revenge"];

let registry: readonly Playbook[] = PLAYBOOK_SEEDS;

/** Called by the playbook store before it notifies subscribers. */
export function setPlaybookRegistry(list: readonly Playbook[]) {
  registry = list;
}

/** Every playbook on this device, archived included, in the trader's order. */
export function currentPlaybooks(): readonly Playbook[] {
  return registry;
}

/** Names resolve for archived playbooks too: a past trade still shows what it was filed under. */
export function playbookName(id: string | null, list: readonly Playbook[] = registry) {
  return list.find((playbook) => playbook.id === id)?.name ?? null;
}

/** A fresh, unchecked copy of a playbook's rules, to freeze on a trade (UX-50). */
export function checklistFor(id: string | null, list: readonly Playbook[] = registry): ChecklistItem[] {
  const playbook = list.find((item) => item.id === id);
  return (playbook?.checklist_rules ?? []).map((rule) => ({ id: rule.id, label: rule.label, checked: false }));
}
