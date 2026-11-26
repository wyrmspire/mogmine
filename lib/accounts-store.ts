// Accounts and balance checks on this device (docs/21). Kept apart from the trade list, like a separate table.
// Local-first like the journal (UX-30, UX-31). Moves to Supabase with the trades (R-05).
import { useSyncExternalStore } from "react";
import { makeAccount, sanitizeAccounts, sanitizeBalanceChecks } from "./accounts.ts";
import type { AccountRules, BalanceCheck, TradingAccount } from "./accounts.ts";
import { isValidRSizeCents } from "./r-size.ts";
import { createCollectionSync } from "./persistence/store-sync.ts";
import type { CollectionSync, CollectionSyncOptions } from "./persistence/store-sync.ts";

const STORAGE_KEY = "mogmine-accounts-v1";

export interface AccountsState {
  hydrated: boolean;
  accounts: TradingAccount[];
  checks: BalanceCheck[];
}

/** What a backup file carries for accounts. */
export interface AccountsBackup {
  accounts: TradingAccount[];
  checks: BalanceCheck[];
}

const empty = (): AccountsState => ({ hydrated: false, accounts: [], checks: [] });
let state: AccountsState = empty();
const serverState: AccountsState = empty();
const listeners = new Set<() => void>();

// Remote sync (#191): with NEXT_PUBLIC_PERSISTENCE_ADAPTER=supabase, accounts and balance checks are copied to
// Supabase in the background. The device copy below is always written first. Accounts are never hard-deleted in the
// UI (archive policy), so the accounts syncer only ever archives or pushes; balance checks can be removed.
interface AccountSyncs { accounts: CollectionSync; checks: CollectionSync }

function applyAccounts(next: TradingAccount[]) {
  set({ accounts: sanitizeAccounts(next) });
  persist();
}

function applyChecks(next: BalanceCheck[]) {
  set({ checks: sanitizeBalanceChecks(next) });
  persist();
}

function createAccountSyncs(overrides: { accounts?: Partial<CollectionSyncOptions<TradingAccount>>; checks?: Partial<CollectionSyncOptions<BalanceCheck>> } = {}): AccountSyncs {
  return {
    accounts: createCollectionSync<TradingAccount>({ key: "accounts", getLocal: () => state.accounts, apply: applyAccounts, ...overrides.accounts }),
    checks: createCollectionSync<BalanceCheck>({ key: "balance_checks", getLocal: () => state.checks, apply: applyChecks, ...overrides.checks }),
  };
}

let syncs: AccountSyncs = createAccountSyncs();

// Cross-tab (docs/26 §8.4 #7): another open tab writes STORAGE_KEY. Adopt its copy so this tab never overwrites it.
let storageListener: ((event: StorageEvent) => void) | null = null;

function listenForStorage() {
  if (storageListener || typeof window === "undefined") return;
  storageListener = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY || !event.newValue) return;
    try {
      set(fromStored(JSON.parse(event.newValue)));
      syncs.accounts.changed();
      syncs.checks.changed();
    } catch { /* keep ours */ }
  };
  window.addEventListener("storage", storageListener);
}

function stopListeningForStorage() {
  if (storageListener && typeof window !== "undefined") window.removeEventListener?.("storage", storageListener);
  storageListener = null;
}

function set(patch: Partial<AccountsState>) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

function persist() {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ accounts: state.accounts, checks: state.checks }));
  } catch {
    // Storage blocked: the session keeps working in memory, as the journal does.
  }
}

function fromStored(raw: unknown): Pick<AccountsState, "accounts" | "checks"> {
  const parsed = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return { accounts: sanitizeAccounts(parsed.accounts), checks: sanitizeBalanceChecks(parsed.checks) };
}

export function hydrateAccounts() {
  if (state.hydrated || typeof window === "undefined") return;
  let loaded: Partial<AccountsState> = {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) loaded = fromStored(JSON.parse(raw));
  } catch {
    // Unreadable or blocked: start empty in memory and leave the stored value untouched.
  }
  set({ ...loaded, hydrated: true });
  listenForStorage();
  syncs.accounts.start();
  syncs.checks.start();
}

const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `acct-${Date.now()}-${Math.random().toString(36).slice(2)}`);

export function addAccount(input: { name: string; starting_balance_cents: number; rules?: Partial<AccountRules>; r_size_cents?: number | null }, now = new Date().toISOString()) {
  const account = makeAccount({ ...input, id: newId(), now });
  set({ accounts: [...state.accounts, account] });
  persist();
  syncs.accounts.changed();
  return account;
}

/**
 * Rename, change the start, the R size or the rules, or archive. The running total is recomputed from the trades.
 * `r_size_cents: null` clears the account's R size, so its trades fall back to the Default R size (Q-12).
 */
export function updateAccount(id: string, patch: Partial<Pick<TradingAccount, "name" | "starting_balance_cents" | "r_size_cents" | "rules" | "archived">>) {
  const next = "r_size_cents" in patch ? { ...patch, r_size_cents: isValidRSizeCents(patch.r_size_cents) ? patch.r_size_cents : null } : patch;
  set({ accounts: state.accounts.map((account) => (account.id === id ? { ...account, ...next, rules: { ...account.rules, ...next.rules } } : account)) });
  persist();
  syncs.accounts.changed();
}

export function addBalanceCheck(input: { account_id: string; balance_cents: number; note?: string; at?: string }) {
  const check: BalanceCheck = { id: newId(), account_id: input.account_id, at: input.at ?? new Date().toISOString(), balance_cents: Math.round(input.balance_cents), note: input.note ?? "" };
  set({ checks: [...state.checks, check] });
  persist();
  syncs.checks.changed();
  return check;
}

export function removeBalanceCheck(id: string) {
  set({ checks: state.checks.filter((check) => check.id !== id) });
  persist();
  syncs.checks.changed();
}

export function getAccountsBackup(): AccountsBackup {
  return { accounts: state.accounts, checks: state.checks };
}

export function sanitizeAccountsBackup(raw: unknown): AccountsBackup | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return fromStored(raw);
}

/**
 * Replace accounts from a backup file, alongside `replaceTrades`. Accounts are archive-only (no hard delete on the
 * server), so an account the backup leaves out is kept here as archived. Dropping it would leave the server row active.
 */
export function restoreAccounts(backup: AccountsBackup) {
  const incoming = new Set(backup.accounts.map((account) => account.id));
  const omitted = state.accounts.filter((account) => !incoming.has(account.id)).map((account) => ({ ...account, archived: true }));
  set({ accounts: sanitizeAccounts([...backup.accounts, ...omitted]), checks: sanitizeBalanceChecks(backup.checks) });
  persist();
  syncs.accounts.changed();
  syncs.checks.changed();
}

/** Test hook: restore the given state and disabled-by-default syncers (the previous ones are disposed). */
export function resetAccountsForTests(next: Partial<AccountsState> = {}) {
  stopListeningForStorage();
  syncs.accounts.dispose();
  syncs.checks.dispose();
  syncs = createAccountSyncs();
  state = { ...empty(), hydrated: true, ...next };
}

/** Test hook: swap the syncers' adapter, storage or timers. Returns the two syncers under test. */
export function configureAccountsSyncForTests(overrides: { accounts?: Partial<CollectionSyncOptions<TradingAccount>>; checks?: Partial<CollectionSyncOptions<BalanceCheck>> }): AccountSyncs {
  syncs.accounts.dispose();
  syncs.checks.dispose();
  syncs = createAccountSyncs(overrides);
  return syncs;
}

export function getAccountsState() {
  return state;
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export function useAccounts() {
  return useSyncExternalStore(subscribe, () => state, () => serverState);
}
