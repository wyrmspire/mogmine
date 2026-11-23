// The trader's playbooks on this device (R-07a, docs/16 §R-07). Local-first per docs/22:
// localStorage key `mogmine-playbooks-v1`, in-memory cache, React useSyncExternalStore hook,
// sanitization, and backup export/restore. Synced to a `playbooks` table later in R-05.
//
// Rules this store keeps:
// - The four seeds always exist. A list saved by an older build gains any seed it lacks.
// - No hard delete. Archive hides a playbook from pickers; old trades still show its name.
// - Editing a playbook never touches a saved trade: trades hold a frozen checklist copy (UX-50).
// - Invariant 7: every playbook carries `user_id`.
import { useSyncExternalStore } from "react";
import { NO_SETUP_ID, PLAYBOOK_LIMITS, PLAYBOOK_SEEDS, setPlaybookRegistry } from "./playbooks.ts";
import type { Playbook, PlaybookRule } from "./playbooks.ts";
import { DEFAULT_OWNER_USER_ID } from "./trades.ts";
import type { TradeStyle } from "./trades.ts";
import { STYLES, clonePlaybook, trimText, sanitizePlaybooks } from "./playbooks-sanitize.ts";
export { sanitizePlaybook, sanitizePlaybooks, sanitizePlaybooksBackup } from "./playbooks-sanitize.ts";

export const PLAYBOOKS_STORAGE_KEY = "mogmine-playbooks-v1";

export interface PlaybooksState {
  hydrated: boolean;
  /** False when the last write to device storage failed. The session still works. */
  saved: boolean;
  playbooks: readonly Playbook[];
}

const seeds = (): Playbook[] => PLAYBOOK_SEEDS.map(clonePlaybook);
const empty = (): PlaybooksState => ({ hydrated: false, saved: true, playbooks: seeds() });
let state: PlaybooksState = empty();
const serverState: PlaybooksState = empty();
const listeners = new Set<() => void>();

function set(patch: Partial<PlaybooksState>) {
  state = { ...state, ...patch };
  setPlaybookRegistry(state.playbooks);
  listeners.forEach((listener) => listener());
}

function persist() {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(PLAYBOOKS_STORAGE_KEY, JSON.stringify(state.playbooks));
    if (!state.saved) set({ saved: true });
  } catch {
    if (state.saved) set({ saved: false });
  }
}

export function hydratePlaybooks() {
  if (state.hydrated || typeof window === "undefined") return;
  let playbooks: Playbook[] = seeds();
  let saved = true;
  try {
    const raw = localStorage.getItem(PLAYBOOKS_STORAGE_KEY);
    if (raw) playbooks = sanitizePlaybooks(JSON.parse(raw));
  } catch {
    saved = false;
  }
  set({ playbooks, hydrated: true, saved });
  window.addEventListener("storage", (event) => {
    if (event.storageArea !== localStorage || (event.key !== PLAYBOOKS_STORAGE_KEY && event.key !== null)) return;
    try {
      set({ playbooks: event.newValue ? sanitizePlaybooks(JSON.parse(event.newValue)) : seeds(), saved: true });
    } catch {
      /* keep ours */
    }
  });
}

const randomPart = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);

const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "item";

/** A stable id for a new rule or playbook. Ids never change after creation, so renames keep history joined. */
export function newPlaybookItemId(label: string, taken: Iterable<string>) {
  const used = new Set(taken);
  let id = `${slug(label)}-${randomPart()}`;
  while (used.has(id)) id = `${slug(label)}-${randomPart()}`;
  return id;
}

export interface PlaybookDraft {
  name: string;
  default_style: TradeStyle;
  checklist_rules: PlaybookRule[];
}

export type PlaybookResult = { ok: true; playbook: Playbook } | { ok: false; error: string };

/** Check a draft before it is saved. `selfId` is the playbook being edited, if any. */
export function validatePlaybookDraft(draft: PlaybookDraft, list: readonly Playbook[], selfId: string | null = null): string | null {
  const name = trimText(draft.name, Number.MAX_SAFE_INTEGER);
  if (!name) return "Give the playbook a name.";
  if (name.length > PLAYBOOK_LIMITS.name) return `Keep the name to ${PLAYBOOK_LIMITS.name} characters.`;
  const clash = list.find((item) => item.id !== selfId && item.name.toLowerCase() === name.toLowerCase());
  if (clash) return clash.archived ? `An archived playbook is already called “${clash.name}”. Restore it or pick another name.` : `A playbook called “${clash.name}” already exists.`;
  if (!STYLES.includes(draft.default_style)) return "Pick a default style.";
  if (draft.checklist_rules.length > PLAYBOOK_LIMITS.rules) return `Keep it to ${PLAYBOOK_LIMITS.rules} rules.`;
  for (const [index, rule] of draft.checklist_rules.entries()) {
    const label = trimText(rule.label, Number.MAX_SAFE_INTEGER);
    if (!label) return `Rule ${index + 1} is empty. Write it or remove it.`;
    if (label.length > PLAYBOOK_LIMITS.ruleLabel) return `Keep rule ${index + 1} to ${PLAYBOOK_LIMITS.ruleLabel} characters.`;
  }
  if (new Set(draft.checklist_rules.map((rule) => rule.id)).size !== draft.checklist_rules.length) return "Two rules share an id. Remove one and add it again.";
  if (selfId === NO_SETUP_ID && draft.checklist_rules.length > 0) return "No Setup / Impulse has no rules. Make a new playbook for a setup with rules.";
  return null;
}

function cleanDraft(draft: PlaybookDraft): PlaybookDraft {
  return {
    name: trimText(draft.name, PLAYBOOK_LIMITS.name),
    default_style: draft.default_style,
    checklist_rules: draft.checklist_rules.map((rule) => ({ id: rule.id, label: trimText(rule.label, PLAYBOOK_LIMITS.ruleLabel) })),
  };
}

export function createPlaybook(draft: PlaybookDraft): PlaybookResult {
  hydratePlaybooks();
  const error = validatePlaybookDraft(draft, state.playbooks);
  if (error) return { ok: false, error };
  const clean = cleanDraft(draft);
  const playbook: Playbook = {
    id: newPlaybookItemId(clean.name, state.playbooks.map((item) => item.id)),
    user_id: DEFAULT_OWNER_USER_ID,
    ...clean,
    archived: false,
  };
  set({ playbooks: [...state.playbooks, playbook] });
  persist();
  return { ok: true, playbook };
}

/** Rename, restyle, or replace the ordered rule list. Saved trades keep the rules they were saved with. */
export function updatePlaybook(id: string, draft: PlaybookDraft): PlaybookResult {
  hydratePlaybooks();
  const current = state.playbooks.find((item) => item.id === id);
  if (!current) return { ok: false, error: "That playbook no longer exists on this device." };
  const error = validatePlaybookDraft(draft, state.playbooks, id);
  if (error) return { ok: false, error };
  const playbook: Playbook = { ...current, ...cleanDraft(draft) };
  set({ playbooks: state.playbooks.map((item) => (item.id === id ? playbook : item)) });
  persist();
  return { ok: true, playbook };
}

/** Archive hides a playbook from pickers. It is never deleted, because past trades point at it. */
export function setPlaybookArchived(id: string, archived: boolean): PlaybookResult {
  hydratePlaybooks();
  const current = state.playbooks.find((item) => item.id === id);
  if (!current) return { ok: false, error: "That playbook no longer exists on this device." };
  if (id === NO_SETUP_ID && archived) return { ok: false, error: "No Setup / Impulse stays available so impulse trades can be filed honestly." };
  if (!archived) {
    const clash = state.playbooks.find((item) => item.id !== id && !item.archived && item.name.toLowerCase() === current.name.toLowerCase());
    if (clash) return { ok: false, error: `Rename “${clash.name}” first: two active playbooks cannot share a name.` };
  }
  const playbook = { ...current, archived };
  set({ playbooks: state.playbooks.map((item) => (item.id === id ? playbook : item)) });
  persist();
  return { ok: true, playbook };
}

/** Playbooks a trader can pick for a trade now. `keepId` keeps a trade's current, archived choice visible. */
export function activePlaybooks(list: readonly Playbook[], keepId: string | null = null) {
  return list.filter((item) => !item.archived || item.id === keepId);
}

export function getPlaybooksBackup(): Playbook[] {
  hydratePlaybooks();
  return state.playbooks.map(clonePlaybook);
}

/** True when a list holds anything beyond the untouched seeds. */
export function playbooksDifferFromSeeds(list: readonly Playbook[]) {
  return JSON.stringify(sanitizePlaybooks(list)) !== JSON.stringify(seeds());
}

export function restorePlaybooks(playbooks: readonly Playbook[]) {
  hydratePlaybooks();
  set({ playbooks: sanitizePlaybooks(playbooks) });
  persist();
}

/** Test hook: back to unhydrated seeds. */
export function resetPlaybooksForTests() {
  state = empty();
  setPlaybookRegistry(state.playbooks);
}

export function getPlaybooksState(): PlaybooksState {
  return state;
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export function usePlaybooks() {
  return useSyncExternalStore(subscribe, () => state, () => serverState);
}
