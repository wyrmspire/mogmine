// Freshness determination for candle series and market data (UI-1, OD-40).
// Honest indicator of candle delay, device caching, and network status.
// Never display "Market Live" on delayed Yahoo data (OD-40, issue #80, guardrail B-01).

import type { Candle } from "./trades.ts";

export type FreshnessStatus = "delayed" | "cached" | "offline" | "loading" | "unavailable";

export interface FreshnessState {
  status: FreshnessStatus;
  label: string;
  delayMinutes?: number;
}

export interface FreshnessInput {
  candles?: readonly Candle[];
  lastAttemptAt?: number;
  source?: string | null;
  fetching?: boolean;
  online: boolean;
  now?: number;
}

const MINUTE_MS = 60_000;

/**
 * Computes honest freshness state for chart header / HUD.
 * Rules (UI-1, OD-40):
 * - If navigator is offline (!online): "Offline"
 * - If demo fixture or sample trade: "Cached"
 * - If real candles from Yahoo:
 *     - If online and fetching/ready: calculate delay from newest bar's timestamp.
 *     - Delay in minutes: Math.max(1, Math.round((now - newestBarTime) / MINUTE_MS)).
 *     - Label: "Delayed · {delayMinutes}m".
 *     - If last attempt was not recent (> 15 minutes old and not fetching) or stored: "Cached" if stale.
 *     - When online with fresh Yahoo data: "Delayed · {delayMinutes}m".
 */
export function getCandleFreshness(input: FreshnessInput): FreshnessState {
  const { candles, source, online, fetching } = input;
  const now = input.now ?? Date.now();

  if (!online) {
    return { status: "offline", label: "Offline" };
  }

  if (fetching && (!candles || candles.length === 0)) {
    return { status: "loading", label: "Loading…" };
  }

  if (!candles || candles.length === 0) {
    return { status: "unavailable", label: "No data" };
  }

  if (source === "Demo fixture" || source === "demo") {
    return { status: "cached", label: "Cached" };
  }

  // Find the newest bar timestamp
  const newestBar = candles[candles.length - 1];
  const newestTime = newestBar?.time;

  if (typeof newestTime === "number" && Number.isFinite(newestTime)) {
    const ageMs = Math.max(0, now - newestTime);
    const delayMinutes = Math.max(1, Math.round(ageMs / MINUTE_MS));

    // If data is very old (e.g. historical trade from hours or days ago), it is cached historical data.
    // However, if it's within regular delayed market window (< 60 minutes), report the delay.
    if (delayMinutes <= 60) {
      return {
        status: "delayed",
        label: `Delayed · ${delayMinutes}m`,
        delayMinutes,
      };
    } else {
      return {
        status: "cached",
        label: "Cached",
        delayMinutes,
      };
    }
  }

  return { status: "cached", label: "Cached" };
}
