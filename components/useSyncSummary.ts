"use client";
// #190: the aggregate sync status for the header. Only AppShell reads it, and only when remote sync is on.
import { useSyncExternalStore } from "react";
import { getSyncSummary, subscribeSync } from "@/lib/persistence/store-sync";
import type { SyncState } from "@/lib/persistence/store-sync";

const OFF: SyncState = { status: "off", message: null, lastSyncedAt: null };

export function useSyncSummary(): SyncState {
  return useSyncExternalStore(subscribeSync, getSyncSummary, () => OFF);
}
