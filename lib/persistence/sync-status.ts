// #190/#191: the aggregate sync status for the header. Every syncer (collection or singleton) registers here; the worst
// status wins. Split out of store-sync.ts to keep files under the line target (#192 review).
export type SyncStatus = "off" | "signed-out" | "syncing" | "synced" | "pending" | "error";
export interface SyncState {
  status: SyncStatus;
  message: string | null;
  lastSyncedAt: string | null;
}

// ---- Aggregate status for the header. Worst status wins. -----------------------------------------------------------

const RANK: Record<SyncStatus, number> = { off: 0, synced: 1, "signed-out": 2, syncing: 3, pending: 4, error: 5 };
const OFF: SyncState = { status: "off", message: null, lastSyncedAt: null };
const registry = new Set<{ getState(): SyncState }>();
const listeners = new Set<() => void>();
let summary: SyncState | null = null;

function computeSummary(): SyncState {
  let worst = OFF;
  let lastSyncedAt: string | null = null;
  for (const entry of registry) {
    const state = entry.getState();
    if (state.lastSyncedAt && (!lastSyncedAt || state.lastSyncedAt > lastSyncedAt)) lastSyncedAt = state.lastSyncedAt;
    if (RANK[state.status] > RANK[worst.status]) worst = state;
  }
  return { status: worst.status, message: worst.message, lastSyncedAt };
}

/** Cached so `useSyncExternalStore` sees a stable value until something changes. */
function refresh() {
  summary = computeSummary();
  listeners.forEach((listener) => listener());
}

export function getSyncSummary(): SyncState {
  if (!summary) summary = computeSummary();
  return summary;
}

export function subscribeSync(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Lets another syncer kind (singleton-sync) join the header summary. Returns the unregister function. */
export function registerSyncEntry(entry: { getState(): SyncState }): () => void {
  registry.add(entry);
  refresh();
  return () => { registry.delete(entry); refresh(); };
}

/** Tell the summary that a registered entry changed its state. */
export const notifySyncChanged = (): void => refresh();

export function resetSyncRegistryForTests(): void {
  registry.clear();
  refresh();
}

