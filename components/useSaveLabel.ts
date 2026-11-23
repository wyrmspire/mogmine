"use client";
// The save/sync wording for a screen (lib/save-label.ts), with the live sync summary (#190).
import { headerSaveLabel, headerSaveTitle, inlineSaveText } from "@/lib/save-label";
import type { InlineOptions, LocalSave } from "@/lib/save-label";
import { remoteSyncEnabled } from "@/lib/persistence/store-sync";
import { useSyncSummary } from "./useSyncSummary";

// NEXT_PUBLIC_* values are inlined at build time, so this is a constant in the browser bundle (#190).
const REMOTE_SYNC = remoteSyncEnabled();

export function useHeaderSaveLabel(local: LocalSave) {
  const sync = useSyncSummary();
  return { ...headerSaveLabel(local, REMOTE_SYNC, sync), title: headerSaveTitle(local, REMOTE_SYNC, sync) };
}

/** `deviceOnly`: the record never syncs (a sample trade), so it keeps the device copy. */
export function useInlineSaveText(local: LocalSave, options: InlineOptions & { deviceOnly?: boolean } = {}) {
  const sync = useSyncSummary();
  return inlineSaveText(local, REMOTE_SYNC && !options.deviceOnly, sync, options);
}
