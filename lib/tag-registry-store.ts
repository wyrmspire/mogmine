// PL-3: the tag registry on this device (docs/design-2026-11-24/01-playbook-lab.md §5). Local-first like prefs: the
// localStorage key `mogmine-tags-v1` is always written first; with NEXT_PUBLIC_PERSISTENCE_ADAPTER=supabase the one
// document is also copied to `mogmine_tag_registries` in the background (singleton sync). Every change is pushed to
// the live tag lists in lib/playbooks.ts, so the Lab, the Pit Stop and the share text read the same names.
import { useSyncExternalStore } from "react";
import {
  DEFAULT_TAG_REGISTRY,
  addTag as addTagToModel,
  renameTag as renameTagInModel,
  restoreTag as restoreTagInModel,
  retireTag as retireTagInModel,
  sanitizeTagRegistry,
  setTagPlaybooks as setTagPlaybooksInModel,
  updateTagDescription as updateTagDescriptionInModel,
} from "./tag-registry.ts";
import type { TagDraft, TagKind, TagRegistry, TagResult } from "./tag-registry.ts";
import { setTagRegistry } from "./playbooks.ts";
import { createSingletonSync } from "./persistence/singleton-sync.ts";
import type { SingletonSync, SingletonSyncOptions } from "./persistence/singleton-sync.ts";

export const TAGS_STORAGE_KEY = "mogmine-tags-v1";

export interface TagRegistryState {
  hydrated: boolean;
  registry: TagRegistry;
}

const freshRegistry = (): TagRegistry => sanitizeTagRegistry(DEFAULT_TAG_REGISTRY);
const empty = (): TagRegistryState => ({ hydrated: false, registry: freshRegistry() });
let state: TagRegistryState = empty();
const listeners = new Set<() => void>();

function set(patch: Partial<TagRegistryState>) {
  state = { ...state, ...patch };
  if (patch.registry) setTagRegistry(state.registry);
  listeners.forEach((listener) => listener());
}

function persist() {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(TAGS_STORAGE_KEY, JSON.stringify(state.registry));
  } catch {
    // Storage blocked: the session keeps working in memory, as the other stores do.
  }
}

// Remote sync. The device cache is written first; `apply` replaces the whole registry from the server copy.
function applyRemote(next: TagRegistry) {
  set({ registry: sanitizeTagRegistry(next) });
  persist();
}

function createTagSync(overrides: Partial<SingletonSyncOptions<TagRegistry>> = {}): SingletonSync {
  // A device that never edited its tags holds the seeds; those must not overwrite the server's copy (singleton `unedited` rule).
  return createSingletonSync<TagRegistry>({ key: "tag_registry", getLocal: () => state.registry, apply: applyRemote, unedited: DEFAULT_TAG_REGISTRY, ...overrides });
}

let tagSync: SingletonSync = createTagSync();

// Cross-tab (docs/26 §8.4 #7): another open tab writes TAGS_STORAGE_KEY. Adopt its copy so this tab never overwrites it.
let storageListener: ((event: StorageEvent) => void) | null = null;

function listenForStorage() {
  if (storageListener || typeof window === "undefined") return;
  storageListener = (event: StorageEvent) => {
    if (event.key !== TAGS_STORAGE_KEY) return;
    try {
      set({ registry: event.newValue ? sanitizeTagRegistry(JSON.parse(event.newValue)) : freshRegistry() });
      tagSync.changed();
    } catch { /* malformed: keep this tab's copy */ }
  };
  window.addEventListener("storage", storageListener);
}

function stopListeningForStorage() {
  if (storageListener && typeof window !== "undefined") window.removeEventListener?.("storage", storageListener);
  storageListener = null;
}

/** Reads the device copy once per page load and starts the background sync. Safe to call again. */
export function hydrateTagRegistry() {
  if (state.hydrated || typeof window === "undefined") return;
  let registry = freshRegistry();
  try {
    const raw = localStorage.getItem(TAGS_STORAGE_KEY);
    if (raw) registry = sanitizeTagRegistry(JSON.parse(raw));
  } catch {
    // Unreadable copy: keep the seeds. The next change rewrites it.
  }
  set({ registry, hydrated: true });
  listenForStorage();
  tagSync.start();
}

/** Commits a model result. A refusal changes nothing and comes back to the caller as its message. */
function commit(result: TagResult): TagResult {
  hydrateTagRegistry();
  if (!result.ok) return result;
  set({ registry: result.registry });
  persist();
  tagSync.changed();
  return result;
}

export function addTag(kind: TagKind, draft: TagDraft): TagResult {
  hydrateTagRegistry();
  return commit(addTagToModel(state.registry, kind, draft));
}

/** Renames a tag. The old label stays in its aliases, so saved trades still show the tag. */
export function renameTag(id: string, label: string): TagResult {
  hydrateTagRegistry();
  return commit(renameTagInModel(state.registry, id, label));
}

export function updateTagDescription(id: string, description: string): TagResult {
  hydrateTagRegistry();
  return commit(updateTagDescriptionInModel(state.registry, id, description));
}

export function setTagPlaybooks(id: string, playbookIds: string[]): TagResult {
  hydrateTagRegistry();
  return commit(setTagPlaybooksInModel(state.registry, id, playbookIds));
}

export function retireTag(id: string): TagResult {
  hydrateTagRegistry();
  return commit(retireTagInModel(state.registry, id));
}

export function restoreTag(id: string): TagResult {
  hydrateTagRegistry();
  return commit(restoreTagInModel(state.registry, id));
}

/** The whole registry as a backup carries it. Hydrates first, so an un-hydrated device still exports its tags. */
export function getTagRegistryBackup(): TagRegistry {
  hydrateTagRegistry();
  return sanitizeTagRegistry(state.registry);
}

/** Backup restore: replaces the device's tags with the file's, then pushes them to the server. */
export function restoreTagRegistry(registry: TagRegistry) {
  hydrateTagRegistry();
  set({ registry: sanitizeTagRegistry(registry) });
  persist();
  tagSync.changed();
}

/** Test hook: back to unhydrated seeds and the default (disabled) syncer. */
export function resetTagRegistryForTests() {
  stopListeningForStorage();
  state = empty();
  setTagRegistry(null);
  tagSync.dispose();
  tagSync = createTagSync();
}

/** Test hook: swap the syncer's adapter, storage or timers. Returns the syncer under test. */
export function configureTagRegistrySyncForTests(overrides: Partial<SingletonSyncOptions<TagRegistry>>): SingletonSync {
  tagSync.dispose();
  tagSync = createTagSync(overrides);
  return tagSync;
}

export function getTagRegistryState(): TagRegistryState {
  return state;
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export function useTagRegistry(): TagRegistry {
  return useSyncExternalStore(subscribe, () => state.registry, () => DEFAULT_TAG_REGISTRY);
}
