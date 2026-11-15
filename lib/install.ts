import { useSyncExternalStore } from "react";

export const HOME_SCREEN_HINT_KEY = "mogmine-home-screen-hint-v1";

interface HomeScreenEnvironment {
  userAgent: string;
  maxTouchPoints: number;
  navigatorStandalone: boolean;
  displayModeStandalone: boolean;
  seen: boolean;
}

/** Includes iPadOS devices that identify themselves as desktop Macs. */
export function isIosDevice(userAgent: string, maxTouchPoints: number) {
  return /iPad|iPhone|iPod/i.test(userAgent)
    || (/Macintosh/i.test(userAgent) && maxTouchPoints > 1);
}

export function shouldShowHomeScreenHint(environment: HomeScreenEnvironment) {
  return isIosDevice(environment.userAgent, environment.maxTouchPoints)
    && !environment.navigatorStandalone
    && !environment.displayModeStandalone
    && !environment.seen;
}

let initialized = false;
let visible = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

export function initializeHomeScreenHint() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;

  let seen = false;
  try { seen = localStorage.getItem(HOME_SCREEN_HINT_KEY) === "seen"; } catch { /* storage can be blocked */ }

  const nav = navigator as Navigator & { standalone?: boolean };
  visible = shouldShowHomeScreenHint({
    userAgent: nav.userAgent,
    maxTouchPoints: nav.maxTouchPoints,
    navigatorStandalone: nav.standalone === true,
    displayModeStandalone: window.matchMedia("(display-mode: standalone)").matches,
    seen,
  });

  // The doc calls for a one-time hint, not a banner that returns until clicked.
  if (visible) {
    try { localStorage.setItem(HOME_SCREEN_HINT_KEY, "seen"); } catch { /* one time for this page when storage is blocked */ }
    emit();
  }
}

export function dismissHomeScreenHint() {
  if (!visible) return;
  visible = false;
  emit();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

export function useHomeScreenHint() {
  return useSyncExternalStore(subscribe, () => visible, () => false);
}
