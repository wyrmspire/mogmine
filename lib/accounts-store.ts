// Accounts and balance checks on this device (docs/20). Kept apart from the trade list, like a separate table.
// Local-first like the journal (UX-30, UX-31). Moves to Supabase with the trades (R-05).
import { useSyncExternalStore } from "react";
import { makeAccount, sanitizeAccounts, sanitizeBalanceChecks } from "./accounts.ts";
import type { AccountRules, BalanceCheck, TradingAccount } from "./accounts.ts";

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
  window.addEventListener("storage", (event) => {
    if (event.key !== STORAGE_KEY || !event.newValue) return;
    try { set(fromStored(JSON.parse(event.newValue))); } catch { /* keep ours */ }
  });
}

const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `acct-${Date.now()}-${Math.random().toString(36).slice(2)}`);

export function addAccount(input: { name: string; starting_balance_cents: number; rules?: Partial<AccountRules> }, now = new Date().toISOString()) {
  const account = makeAccount({ ...input, id: newId(), now });
  set({ accounts: [...state.accounts, account] });
  persist();
  return account;
}

/** Rename, change the start or the rules, or archive. The running total is recomputed from the trades. */
export function updateAccount(id: string, patch: Partial<Pick<TradingAccount, "name" | "starting_balance_cents" | "rules" | "archived">>) {
  set({ accounts: state.accounts.map((account) => (account.id === id ? { ...account, ...patch, rules: { ...account.rules, ...patch.rules } } : account)) });
  persist();
}

export function addBalanceCheck(input: { account_id: string; balance_cents: number; note?: string; at?: string }) {
  const check: BalanceCheck = { id: newId(), account_id: input.account_id, at: input.at ?? new Date().toISOString(), balance_cents: Math.round(input.balance_cents), note: input.note ?? "" };
  set({ checks: [...state.checks, check] });
  persist();
  return check;
}

export function removeBalanceCheck(id: string) {
  set({ checks: state.checks.filter((check) => check.id !== id) });
  persist();
}

export function getAccountsBackup(): AccountsBackup {
  return { accounts: state.accounts, checks: state.checks };
}

export function sanitizeAccountsBackup(raw: unknown): AccountsBackup | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return fromStored(raw);
}

/** Replace accounts from a backup file, alongside `replaceTrades`. */
export function restoreAccounts(backup: AccountsBackup) {
  set({ accounts: backup.accounts, checks: backup.checks });
  persist();
}

/** Test hook. */
export function resetAccountsForTests(next: Partial<AccountsState> = {}) {
  state = { ...empty(), hydrated: true, ...next };
}

export function getAccountsState() {
  return state;
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export function useAccounts() {
  return useSyncExternalStore(subscribe, () => state, () => serverState);
}
