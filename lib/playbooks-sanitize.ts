// Pure playbook sanitizers (no React, no window). Split out of lib/playbooks-store.ts so server routes can import the command layer (#185a).
import { NO_SETUP_ID, PLAYBOOK_LIMITS, PLAYBOOK_SEEDS } from "./playbooks.ts";
import type { Playbook, PlaybookRule, PlaybookVersion } from "./playbooks.ts";
import { DEFAULT_OWNER_USER_ID } from "./trades.ts";
import type { TradeStyle } from "./trades.ts";

export const STYLES: readonly TradeStyle[] = ["scalp", "session_90m", "investment"];

/** A usable pinned trade id, or null. Empty, blank and non-string values count as unset. */
export function pinnedExampleId(raw: unknown): string | null {
  return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : null;
}

/** Copy of a playbook with its pinned example set, or removed. The key is omitted when unset (docs/23 §9). */
export function withPinnedExample(playbook: Playbook, tradeId: string | null): Playbook {
  const { pinned_example_trade_id: _previous, ...rest } = playbook;
  const pinned = pinnedExampleId(tradeId);
  return pinned ? { ...rest, pinned_example_trade_id: pinned } : rest;
}

export function clonePlaybook(playbook: Playbook): Playbook {
  const copy: Playbook = {
    ...playbook,
    checklist_rules: playbook.checklist_rules.map((rule) => ({ ...rule })),
    version_history: playbook.version_history?.map((version) => ({ ...version, checklist_rules: version.checklist_rules.map((rule) => ({ ...rule })) })),
  };
  if (!pinnedExampleId(playbook.pinned_example_trade_id)) delete copy.pinned_example_trade_id;
  if (!copy.version_history?.length) delete copy.version_history;
  return copy;
}

export const trimText = (value: unknown, max: number) =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";

function sanitizeRules(raw: unknown): PlaybookRule[] | null {
  if (!Array.isArray(raw)) return null;
  const seen = new Set<string>();
  const rules: PlaybookRule[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const candidate = item as Record<string, unknown>;
    const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
    const label = trimText(candidate.label, PLAYBOOK_LIMITS.ruleLabel);
    if (!id || !label || seen.has(id)) continue;
    seen.add(id);
    rules.push({ id, label });
    if (rules.length === PLAYBOOK_LIMITS.rules) break;
  }
  return rules;
}

export function sanitizePlaybookVersions(raw: unknown, playbookId: string): PlaybookVersion[] {
  if (!Array.isArray(raw)) return [];
  const byVersion = new Map<number, PlaybookVersion>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const value = item as Record<string, unknown>;
    const version = typeof value.version === "number" && Number.isInteger(value.version) && value.version >= 1 ? value.version : null;
    const rules = sanitizeRules(value.checklist_rules);
    const name = trimText(value.name, PLAYBOOK_LIMITS.name);
    if (version == null || !rules || !name || typeof value.created_at !== "string" || !Number.isFinite(Date.parse(value.created_at))) continue;
    byVersion.set(version, {
      playbook_id: playbookId,
      version,
      created_at: new Date(Date.parse(value.created_at)).toISOString(),
      name,
      default_style: STYLES.includes(value.default_style as TradeStyle) ? value.default_style as TradeStyle : "scalp",
      checklist_rules: rules,
    });
  }
  return [...byVersion.values()].sort((a, b) => a.version - b.version);
}

export function sanitizePlaybook(raw: unknown): Playbook | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const id = typeof obj.id === "string" ? obj.id.trim() : "";
  const name = trimText(obj.name, PLAYBOOK_LIMITS.name);
  const rules = sanitizeRules(obj.checklist_rules);
  if (!id || !name || !rules) return null;
  const noSetup = id === NO_SETUP_ID;
  const playbook: Playbook = {
    id,
    user_id: typeof obj.user_id === "string" && obj.user_id.trim() ? obj.user_id : DEFAULT_OWNER_USER_ID,
    name,
    default_style: STYLES.includes(obj.default_style as TradeStyle) ? obj.default_style as TradeStyle : "scalp",
    // The impulse bucket has no rules and stays pickable (docs/17 §4).
    checklist_rules: noSetup ? [] : rules,
    archived: noSetup ? false : obj.archived === true,
  };
  const history = sanitizePlaybookVersions(obj.version_history, id);
  if (history.length) playbook.version_history = history;
  return withPinnedExample(playbook, pinnedExampleId(obj.pinned_example_trade_id));
}

/** Clean a stored or restored list: drop bad and duplicate entries, keep order, and add any missing seed at the end. */
export function sanitizePlaybooks(raw: unknown): Playbook[] {
  const list: Playbook[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(raw) ? raw : []) {
    const playbook = sanitizePlaybook(item);
    if (!playbook || seen.has(playbook.id)) continue;
    seen.add(playbook.id);
    list.push(playbook);
  }
  for (const seedPlaybook of PLAYBOOK_SEEDS) {
    if (!seen.has(seedPlaybook.id)) list.push(clonePlaybook(seedPlaybook));
  }
  return list;
}

/** `null` when a backup has no playbook list (older backups): the device keeps its own. */
export function sanitizePlaybooksBackup(raw: unknown): Playbook[] | null {
  if (!Array.isArray(raw)) return null;
  return sanitizePlaybooks(raw);
}
