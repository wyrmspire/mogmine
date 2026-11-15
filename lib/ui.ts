// Small bits of interface state shared across screens.
import { useSyncExternalStore } from "react";
import { sessionDate } from "./session.ts";

interface UiState { addOpen: boolean }

let state: UiState = { addOpen: false };
const closed: UiState = { addOpen: false };
const listeners = new Set<() => void>();
const set = (next: UiState) => { state = next; listeners.forEach((listener) => listener()); };

export const openAddTrade = () => set({ ...state, addOpen: true });
export const closeAddTrade = () => set({ ...state, addOpen: false });

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const useUi = () => useSyncExternalStore(subscribe, () => state, () => closed);

// The list a trade was opened from, so previous/next step through that list and not through
// every trade (UX-11). Kept per tab; a deep link or reload falls back to all trades.
const LIST_KEY = "mogmine-list-context";

export interface ListContext { ids: string[]; label: string; href: string }

export function rememberList(context: ListContext) {
  try { sessionStorage.setItem(LIST_KEY, JSON.stringify(context)); } catch { /* falls back to all trades */ }
}

let listRaw: string | null = null;
let listParsed: ListContext | null = null;

function recallList(): ListContext | null {
  try {
    const raw = sessionStorage.getItem(LIST_KEY);
    if (raw !== listRaw) {
      listRaw = raw;
      const parsed = raw ? JSON.parse(raw) as ListContext : null;
      listParsed = parsed && Array.isArray(parsed.ids) ? parsed : null;
    }
    return listParsed;
  } catch { return null; }
}

const noSubscription = () => () => {};
export const useListContext = () => useSyncExternalStore(noSubscription, recallList, () => null);

function subscribeOnline(listener: () => void) {
  window.addEventListener("online", listener);
  window.addEventListener("offline", listener);
  return () => { window.removeEventListener("online", listener); window.removeEventListener("offline", listener); };
}
export const useOnline = () => useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);

// The current trading day, and whether the calendar day is a weekend in New York. Re-checked every
// minute and whenever the app comes back to the foreground. Encoded as one string so the snapshot is stable.
const weekdayNY = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short" });
let today = "";
function readToday() {
  const now = Date.now();
  const weekend = ["Sat", "Sun"].includes(weekdayNY.format(new Date(now))) && sessionDate(now) !== sessionDate(now - 2 * 86_400_000);
  return `${sessionDate(now)}|${weekend ? "closed" : "open"}`;
}
function subscribeToday(listener: () => void) {
  const check = () => { const next = readToday(); if (next !== today) { today = next; listener(); } };
  const timer = setInterval(check, 60_000);
  document.addEventListener("visibilitychange", check);
  return () => { clearInterval(timer); document.removeEventListener("visibilitychange", check); };
}
/** `{ date, closed }`: the session an entry made now would belong to. `date` is empty before hydration. */
export function useToday() {
  const [date, state] = useSyncExternalStore(subscribeToday, () => (today ||= readToday()), () => "|open").split("|");
  return { date, closed: state === "closed" };
}

// Unsent form drafts, kept in memory while the app is open (principle 6: nothing typed is lost).
const drafts = new Map<string, unknown>();
export function keepDraft<T>(key: string, value: T): T {
  if (value == null) drafts.delete(key); else drafts.set(key, value);
  return value;
}
export const readDraft = <T,>(key: string) => drafts.get(key) as T | undefined;
