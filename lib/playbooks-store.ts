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
import type { Playbook, PlaybookRule, PlaybookVersion } from "./playbooks.ts";
import { DEFAULT_OWNER_USER_ID } from "./trades.ts";
import type { TradeStyle } from "./trades.ts";
import { STYLES, clonePlaybook, pinnedExampleId, trimText, sanitizePlaybooks, withPinnedExample } from "./playbooks-sanitize.ts";
import { createCollectionSync, fingerprint } from "./persistence/store-sync.ts";
import type { CollectionSync, CollectionSyncOptions } from "./persistence/store-sync.ts";
export { sanitizePlaybook, sanitizePlaybooks, sanitizePlaybooksBackup } from "./playbooks-sanitize.ts";

export const PLAYBOOKS_STORAGE_KEY = "mogmine-playbooks-v1";
export const PLAYBOOK_VERSIONS_STORAGE_KEY = "mogmine-playbook-versions-v1";

export interface PlaybooksState {
  hydrated: boolean;
  /** False when the last write to device storage failed. The session still works. */
  saved: boolean;
  playbooks: readonly Playbook[];
}

const seeds = (): Playbook[] => PLAYBOOK_SEEDS.map(clonePlaybook);
const empty = (): PlaybooksState => ({ hydrated: false, saved: true, playbooks: seeds() });
let state: PlaybooksState = empty();
let versions: PlaybookVersion[] = [];
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
    localStorage.setItem(PLAYBOOKS_STORAGE_KEY, JSON.stringify(state.playbooks.map(withVersionHistory)));
    localStorage.setItem(PLAYBOOK_VERSIONS_STORAGE_KEY, JSON.stringify(versions));
    if (!state.saved) set({ saved: true });
  } catch {
    if (state.saved) set({ saved: false });
  }
}

// Remote sync (#190 pattern). With NEXT_PUBLIC_PERSISTENCE_ADAPTER=supabase the list is copied to Supabase in the
// background; the device cache above is always written first. Playbooks are archived, never deleted (deletePolicy).
function applyRemote(next: Playbook[]) {
  versions = mergeVersions(versions, next.flatMap((playbook) => playbook.version_history ?? []));
  const playbooks = sanitizePlaybooks(next);
  ensureBaselineVersions(playbooks);
  set({ playbooks });
  persist();
}

// A seed nobody edited: a fresh device must not push it over the server's (possibly renamed) copy (#192 review).
const seedFingerprints = new Map(PLAYBOOK_SEEDS.map((seed) => [seed.id, fingerprint("playbooks", clonePlaybook(seed))]));
const isUntouchedSeed = (playbook: Playbook) => {
  const clean = clonePlaybook(playbook);
  delete clean.version_history;
  return seedFingerprints.get(playbook.id) === fingerprint("playbooks", clean);
};

function createPlaybooksSync(overrides: Partial<CollectionSyncOptions<Playbook>> = {}): CollectionSync {
  return createCollectionSync<Playbook>({
    key: "playbooks",
    pristine: isUntouchedSeed,
    getLocal: () => state.playbooks.map(withVersionHistory),
    apply: applyRemote,
    ...overrides,
  });
}

let playbooksSync: CollectionSync = createPlaybooksSync();

// Cross-tab (docs/26 §8.4 #7): another open tab writes PLAYBOOKS_STORAGE_KEY. Adopt its copy so this tab never overwrites it.
let storageListener: ((event: StorageEvent) => void) | null = null;

function listenForStorage() {
  if (storageListener || typeof window === "undefined") return;
  storageListener = (event: StorageEvent) => {
    if (event.storageArea !== localStorage || (event.key !== PLAYBOOKS_STORAGE_KEY && event.key !== PLAYBOOK_VERSIONS_STORAGE_KEY && event.key !== null)) return;
    try {
      if (event.key === PLAYBOOK_VERSIONS_STORAGE_KEY) {
        versions = event.newValue ? sanitizeVersions(JSON.parse(event.newValue)) : [];
        ensureBaselineVersions(state.playbooks);
        set({ saved: true });
        return;
      }
      const storedVersions = localStorage.getItem(PLAYBOOK_VERSIONS_STORAGE_KEY);
      const nextPlaybooks = event.newValue ? sanitizePlaybooks(JSON.parse(event.newValue)) : seeds();
      versions = mergeVersions(
        nextPlaybooks.flatMap((playbook) => playbook.version_history ?? []),
        storedVersions ? sanitizeVersions(JSON.parse(storedVersions)) : [],
      );
      ensureBaselineVersions(nextPlaybooks);
      set({ playbooks: nextPlaybooks, saved: true });
      playbooksSync.changed();
    } catch {
      /* keep ours */
    }
  };
  window.addEventListener("storage", storageListener);
}

function stopListeningForStorage() {
  if (storageListener && typeof window !== "undefined") window.removeEventListener?.("storage", storageListener);
  storageListener = null;
}

export function hydratePlaybooks() {
  if (state.hydrated || typeof window === "undefined") return;
  let playbooks: Playbook[] = seeds();
  let saved = true;
  try {
    const raw = localStorage.getItem(PLAYBOOKS_STORAGE_KEY);
    if (raw) playbooks = sanitizePlaybooks(JSON.parse(raw));
    versions = mergeVersions(versions, playbooks.flatMap((playbook) => playbook.version_history ?? []));
    const history = localStorage.getItem(PLAYBOOK_VERSIONS_STORAGE_KEY);
    if (history) versions = mergeVersions(versions, sanitizeVersions(JSON.parse(history)));
    ensureBaselineVersions(playbooks);
  } catch {
    saved = false;
  }
  set({ playbooks, hydrated: true, saved });
  listenForStorage();
  playbooksSync.start();
}

function sanitizeVersions(raw: unknown): PlaybookVersion[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const value = item as Record<string, unknown>;
    const rules = Array.isArray(value.checklist_rules)
      ? value.checklist_rules.flatMap((rule) => {
        if (!rule || typeof rule !== "object") return [];
        const r = rule as Record<string, unknown>;
        return typeof r.id === "string" && typeof r.label === "string" ? [{ id: r.id, label: r.label }] : [];
      })
      : [];
    const version = value.version;
    if (typeof value.playbook_id !== "string" || typeof version !== "number" || !Number.isInteger(version) || version < 1 ||
      typeof value.created_at !== "string" || typeof value.name !== "string" || !STYLES.includes(value.default_style as TradeStyle)) return [];
    return [{ playbook_id: value.playbook_id, version, created_at: value.created_at, name: value.name,
      default_style: value.default_style as TradeStyle, checklist_rules: rules }];
  });
}

function mergeVersions(...groups: readonly PlaybookVersion[][]): PlaybookVersion[] {
  const byKey = new Map<string, PlaybookVersion>();
  for (const version of groups.flat()) byKey.set(`${version.playbook_id}|${version.version}`, version);
  return [...byKey.values()].sort((a, b) => a.playbook_id.localeCompare(b.playbook_id) || a.version - b.version);
}

function withVersionHistory(playbook: Playbook): Playbook {
  const history = versions.filter((version) => version.playbook_id === playbook.id);
  return history.length ? { ...playbook, version_history: history.map((version) => ({ ...version, checklist_rules: version.checklist_rules.map((rule) => ({ ...rule })) })) } : playbook;
}

const snapshot = (playbook: Playbook, version: number): PlaybookVersion => ({
  playbook_id: playbook.id, version, created_at: new Date().toISOString(), name: playbook.name,
  default_style: playbook.default_style, checklist_rules: playbook.checklist_rules.map((rule) => ({ ...rule })),
});

function ensureBaselineVersions(playbooks: readonly Playbook[]): void {
  const known = new Set(versions.map((version) => version.playbook_id));
  const missing = playbooks.filter((playbook) => !known.has(playbook.id)).map((playbook) => snapshot(playbook, 1));
  if (missing.length) versions = mergeVersions(versions, missing);
}

/** Exact rules/name snapshot. Missing versions return null rather than silently using current rules. */
export function playbookVersion(id: string, version: number): PlaybookVersion | null {
  hydratePlaybooks();
  return versions.find((item) => item.playbook_id === id && item.version === version) ?? null;
}

export function playbookVersions(id: string): readonly PlaybookVersion[] {
  hydratePlaybooks();
  return versions.filter((item) => item.playbook_id === id).sort((a, b) => a.version - b.version);
}

export function currentPlaybookVersion(id: string): number | null {
  const history = playbookVersions(id);
  return history.length ? history[history.length - 1].version : null;
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
  versions = [...versions, snapshot(playbook, 1)];
  persist();
  playbooksSync.changed();
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
  const history = versions.filter((item) => item.playbook_id === id);
  const nextVersion = (history.at(-1)?.version ?? 0) + 1;
  // The first edit establishes v1 from the old live record, then records the edited v2.
  const baseline = history.length ? [] : [snapshot(current, 1)];
  versions = [...versions, ...baseline, snapshot(playbook, nextVersion === 1 ? 2 : nextVersion)];
  persist();
  playbooksSync.changed();
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
  playbooksSync.changed();
  return { ok: true, playbook };
}

/**
 * docs/23 §9: pin a closed trade as the playbook's teaching example, or clear the pin with `null`. The card checks
 * the trade on read, so a pin to a deleted, reassigned or open trade falls back to the automatic example.
 */
export function setPlaybookPinnedExample(playbookId: string, tradeId: string | null): PlaybookResult {
  hydratePlaybooks();
  const current = state.playbooks.find((item) => item.id === playbookId);
  if (!current) return { ok: false, error: "That playbook no longer exists on this device." };
  const next = pinnedExampleId(tradeId);
  if (tradeId != null && !next) return { ok: false, error: "Pick a saved trade to pin." };
  const playbook = withPinnedExample(current, next);
  set({ playbooks: state.playbooks.map((item) => (item.id === playbookId ? playbook : item)) });
  persist();
  playbooksSync.changed();
  return { ok: true, playbook };
}

/** Playbooks a trader can pick for a trade now. `keepId` keeps a trade's current, archived choice visible. */
export function activePlaybooks(list: readonly Playbook[], keepId: string | null = null) {
  return list.filter((item) => !item.archived || item.id === keepId);
}

export function getPlaybooksBackup(): Playbook[] {
  hydratePlaybooks();
  return state.playbooks.map((playbook) => clonePlaybook(withVersionHistory(playbook)));
}

/** True when a list holds anything beyond the untouched seeds. */
export function playbooksDifferFromSeeds(list: readonly Playbook[]) {
  return JSON.stringify(sanitizePlaybooks(list)) !== JSON.stringify(seeds());
}

/**
 * Backup restore. Playbooks are archive-only on the server, so a playbook the backup leaves out (a custom one or a
 * seed) is kept here as archived and pushed that way. Dropping it would leave the server row active. No Setup stays.
 */
export function restorePlaybooks(playbooks: readonly Playbook[]) {
  hydratePlaybooks();
  versions = mergeVersions(versions, playbooks.flatMap((playbook) => playbook.version_history ?? []));
  ensureBaselineVersions(playbooks);
  const incoming = new Set(playbooks.map((item) => item.id));
  const omitted = state.playbooks.filter((item) => item.id !== NO_SETUP_ID && !incoming.has(item.id)).map((item) => ({ ...item, archived: true }));
  set({ playbooks: sanitizePlaybooks([...playbooks, ...omitted]) });
  persist();
  playbooksSync.changed();
}

/** Test hook: back to unhydrated seeds and the default (disabled) syncer. */
export function resetPlaybooksForTests() {
  stopListeningForStorage();
  state = empty();
  versions = [];
  setPlaybookRegistry(state.playbooks);
  playbooksSync.dispose();
  playbooksSync = createPlaybooksSync();
}

/** Test hook: swap the playbook syncer's adapter, storage or timers. Returns the syncer under test. */
export function configurePlaybooksSyncForTests(overrides: Partial<CollectionSyncOptions<Playbook>>): CollectionSync {
  playbooksSync.dispose();
  playbooksSync = createPlaybooksSync(overrides);
  return playbooksSync;
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
