// Save and sync wording, shared by the header and the inline "saved" notes (#190, #194). Pure, no I/O.
// Inline wording follows docs/11 §1 ("Saved on this device", "Syncing", "Saved to your account") and docs/08 UX-30s.
// Device-only mode (no remote sync) keeps the original device copy. With sync on, the text follows the
// aggregate sync status; a blocked device store always wins, because then nothing was kept at all.
import type { SyncState } from "./persistence/sync-status.ts";

export type LocalSave = "idle" | "saving" | "saved" | "error";

export interface SaveLabel {
  state: LocalSave;
  text: string;
}

const DEVICE_HEADER: Record<LocalSave, string> = {
  idle: "On this device", saving: "Saving…", saved: "Saved on this device", error: "Not saved — storage is blocked",
};
const SYNC_HEADER: Record<Exclude<SyncState["status"], "off">, SaveLabel> = {
  syncing: { state: "saving", text: "Syncing…" },
  synced: { state: "saved", text: "Synced" },
  pending: { state: "idle", text: "Offline — will sync" },
  "signed-out": { state: "idle", text: "Not signed in — saved on this device" },
  error: { state: "error", text: "Sync problem — saved on this device" },
};

/** Header save text. With remote sync on, the sync status shows; a device-cache failure always wins. */
export function headerSaveLabel(local: LocalSave, remoteSync: boolean, sync: SyncState): SaveLabel {
  if (!remoteSync || local === "error" || sync.status === "off") return { state: local, text: DEVICE_HEADER[local] };
  return SYNC_HEADER[sync.status];
}

/** A sync error says what failed in the header's tooltip (e.g. "2 records couldn't sync"). Nothing else. */
export function headerSaveTitle(local: LocalSave, remoteSync: boolean, sync: SyncState): string | undefined {
  if (!remoteSync || local === "error" || sync.status !== "error") return undefined;
  return sync.message ?? undefined;
}

export const BLOCKED_TEXT = "Not saved — storage is blocked on this device";

const SYNC_INLINE: Record<Exclude<SyncState["status"], "off">, string> = {
  syncing: "Syncing…",
  synced: "✓ Saved to your account",
  pending: "Saved on this device — will sync",
  "signed-out": "Saved on this device — sign in to sync",
  error: "Saved on this device — couldn't sync",
};

/**
 * The quiet note under a form (Pit Stop, plan sheet, session lesson). `remoteSync` is false for records that never
 * leave the device (sample trades), so they keep the device copy even when sync is on.
 */
export function inlineSaveText(
  local: LocalSave, remoteSync: boolean, sync: SyncState, options: InlineOptions = {},
): string {
  const { blocked = BLOCKED_TEXT, check = true } = options;
  if (local === "error") return blocked;
  if (local === "saving") return "Saving…";
  const text = !remoteSync || sync.status === "off" ? "✓ Saved on this device" : SYNC_INLINE[sync.status];
  return check ? text : text.replace(/^✓ /, "");
}

/** `blocked`: the screen's own wording for a blocked store. `check: false` drops the leading ✓. */
export interface InlineOptions {
  blocked?: string;
  check?: boolean;
}
