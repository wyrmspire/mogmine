// One toast at a time, with an optional action. Undo beats confirm (UX-34).
import { useSyncExternalStore } from "react";

export interface Toast {
  id: number;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

let current: Toast | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let counter = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

export function showToast(message: string, action?: { label: string; run: () => void }) {
  counter += 1;
  current = { id: counter, message, actionLabel: action?.label, onAction: action?.run };
  clearTimeout(timer);
  timer = setTimeout(dismissToast, action ? 5000 : 2200);
  emit();
}

export function dismissToast() {
  clearTimeout(timer);
  current = null;
  emit();
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export function useToast() {
  return useSyncExternalStore(subscribe, () => current, () => null);
}
