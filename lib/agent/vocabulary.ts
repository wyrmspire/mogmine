// #API-2a: GET /api/v1/vocabulary. The names an agent may use, read from the owner's live data (docs/07 §3.1).
// Pure over the command layer: no route, no SDK. Agents must take playbooks, tags and accounts from here (HR-3).
import type { PersistResult } from "../persistence/contract.ts";
import type { JournalCommands } from "../commands/journal-commands.ts";
import { HOUSE_RULES_VERSION } from "./house-rules.ts";
import { EXIT_REASONS, FUTURES_SPECS } from "../trades.ts";
import type { TradeExitReason } from "../trades.ts";
import { PLAN_PRESETS } from "../plans.ts";
import type { PlanPreset } from "../plans.ts";
import { PLAYBOOK_SEEDS, EXECUTION_TAGS, SETUP_TAGS } from "../playbooks.ts";
import { isValidRSizeCents, resolveRSize } from "../r-size.ts";

/** The display zone used when the owner has not chosen one (prefs `timeZone`). */
const DEFAULT_DISPLAY_ZONE = "America/Chicago";

/** What each exit reason does to the chart and the P&L (HR-5). The labels are the app's own. */
const EXIT_EFFECTS: Record<TradeExitReason, string> = {
  target: "Exit filled at the planned target.",
  stop: "Exit filled at the working stop.",
  trail: "Exit filled at the working (moved) stop.",
  breakeven: "Exit filled at the entry price.",
  manual: "Exit filled at market, chosen by hand.",
};

export interface VocabularyPlaybook {
  id: string;
  name: string;
  rules: string[];
  archived: boolean;
}

export interface VocabularyAccount {
  id: string;
  name: string;
  r_size_cents: number;
  r_size_source: "account" | "prefs";
}

export interface VocabularyPayload {
  house_rules_version: string;
  playbooks: VocabularyPlaybook[];
  setup_tags: string[];
  execution_tags: string[];
  accounts: VocabularyAccount[];
  default_r_size_cents: number;
  exit_reasons: Array<{ value: TradeExitReason; label: string; effect: string }>;
  symbols: Array<{ symbol: string; tick_size: number; point_value_usd: number }>;
  plan_presets: Array<{ preset: PlanPreset; name: string; anchor_ct: string | null }>;
  time: { display_zone: string; session_zone: string; session_rollover_et: string };
}

/**
 * Builds the vocabulary for the owner behind `commands`. Playbooks include archived ones (flagged, so old trades still
 * resolve), active first. Accounts are active only. Any read failure fails the whole answer.
 */
export async function buildVocabulary(commands: JournalCommands): Promise<PersistResult<VocabularyPayload>> {
  const playbooks = await commands.list("playbooks", { includeArchived: true, includeSamples: false });
  if (!playbooks.ok) return playbooks;
  const accounts = await commands.list("accounts", { includeArchived: false, includeSamples: false });
  if (!accounts.ok) return accounts;
  const stored = await commands.readSingleton("prefs");
  if (!stored.ok) return stored;
  const prefs = stored.value?.record ?? null;

  const defaultRSizeCents = resolveRSize({ account_id: null }, [], prefs).cents;
  const ordered = playbooks.value.length > 0 ? playbooks.value : PLAYBOOK_SEEDS;
  const playbookRows = [...ordered]
    .sort((a, b) => Number(a.archived === true) - Number(b.archived === true))
    .map((playbook) => ({
      id: playbook.id,
      name: playbook.name,
      rules: playbook.checklist_rules.map((rule) => rule.label),
      archived: playbook.archived === true,
    }));

  return {
    ok: true,
    value: {
      house_rules_version: HOUSE_RULES_VERSION,
      playbooks: playbookRows,
      setup_tags: [...SETUP_TAGS],
      execution_tags: [...EXECUTION_TAGS],
      accounts: accounts.value.map((account) => {
        const own = isValidRSizeCents(account.r_size_cents);
        return {
          id: account.id,
          name: account.name,
          r_size_cents: own ? account.r_size_cents as number : defaultRSizeCents,
          r_size_source: own ? "account" : "prefs",
        };
      }),
      default_r_size_cents: defaultRSizeCents,
      exit_reasons: EXIT_REASONS.map((reason) => ({ value: reason.value, label: reason.label, effect: EXIT_EFFECTS[reason.value] })),
      symbols: Object.entries(FUTURES_SPECS).map(([symbol, spec]) => ({
        symbol,
        tick_size: spec.tickSize,
        point_value_usd: spec.pointValueUsd,
      })),
      plan_presets: PLAN_PRESETS.map((preset) => ({ preset: preset.preset, name: preset.name, anchor_ct: preset.beforeCt })),
      time: {
        display_zone: prefs?.timeZone ?? DEFAULT_DISPLAY_ZONE,
        session_zone: "America/New_York",
        session_rollover_et: "18:00",
      },
    },
  };
}
