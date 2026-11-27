// Canonical, pure review-queue selection. UI and read-model callers should use
// this module so sample and replay isolation cannot drift between surfaces.
import { isReplayTrade } from "./selectors.ts";
import type { TradingAccount } from "./accounts.ts";
import type { TradeRecord } from "./trades.ts";

export interface ReviewQueueOptions {
  /** Account metadata is required to identify trades belonging to replay accounts. */
  accounts?: readonly Pick<TradingAccount, "id" | "mode">[];
  /** Samples are excluded by default and included only when explicitly requested. */
  includeSamples?: boolean;
  /** Replay trades are isolated from the real queue unless explicitly requested. */
  includeReplay?: boolean;
}

/** The stable ordering used by every review queue consumer. */
function compareReviewTrades(a: TradeRecord, b: TradeRecord): number {
  const statusOrder = (trade: TradeRecord) => trade.review_status === "new" ? 0 : 1;
  const statusDifference = statusOrder(a) - statusOrder(b);
  if (statusDifference !== 0) return statusDifference;

  const aTime = Date.parse(a.entry_time);
  const bTime = Date.parse(b.entry_time);
  const aValid = Number.isFinite(aTime);
  const bValid = Number.isFinite(bTime);
  if (aValid && bValid && aTime !== bTime) return bTime - aTime;
  if (aValid !== bValid) return aValid ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Return pending trades in canonical order.
 *
 * Samples never enter the queue by default. Replay trades are also excluded
 * when account metadata identifies them; pass `includeReplay: true` to request
 * them explicitly. Without account metadata, no trade is guessed to be replay.
 */
export function selectReviewQueue(
  trades: readonly TradeRecord[],
  options: ReviewQueueOptions = {},
): TradeRecord[] {
  const accounts = options.accounts ?? [];
  return trades
    .filter((trade) => trade.review_status !== "reviewed")
    .filter((trade) => options.includeSamples === true || !trade.is_sample)
    .filter((trade) => options.includeReplay === true || !isReplayTrade(trade, accounts))
    .slice()
    .sort(compareReviewTrades);
}

/** IDs in the same deterministic order as `selectReviewQueue`. */
export function selectReviewQueueIds(
  trades: readonly TradeRecord[],
  options?: ReviewQueueOptions,
): string[] {
  return selectReviewQueue(trades, options).map((trade) => trade.id);
}

