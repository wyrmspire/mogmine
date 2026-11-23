// How /api/market-data answers when it has no candles, and what the trade page says then. Pure and client-safe.
// "No data for that window" is a normal answer (a future trade, a weekend, a range Yahoo no longer serves); only a
// real upstream failure is a 502 (docs/10 §2, AGENTS §3b-8: an empty answer is not missing data).

/** Why a candle request came back without candles. */
export type NoCandlesReason = "future" | "no-data" | "unavailable";

/** Whether a window is in the future: nothing can exist for it yet, so Yahoo is not asked. */
export function windowInFuture(from: number, now: number): boolean {
  return Number.isFinite(from) && from > now;
}

/** The body and status for a request that found no candles. 502 only when an attempt failed upstream. */
export function noCandlesResponse(reason: NoCandlesReason | "upstream"): { status: number; body: { candles: []; reason: NoCandlesReason; error?: string } } {
  if (reason === "future") return { status: 200, body: { candles: [], reason: "future" } };
  if (reason === "upstream" || reason === "unavailable") {
    return { status: 502, body: { candles: [], reason: "unavailable", error: "Market data request failed" } };
  }
  return { status: 404, body: { candles: [], reason: "no-data", error: "Yahoo Finance has no candles for this range" } };
}

/** Read the reason from a /api/market-data answer (its `ok` and status, and the parsed body, if any). */
export function reasonFromResponse(response: { ok: boolean; status: number }, body: unknown): NoCandlesReason | null {
  const reason = body && typeof body === "object" ? (body as { reason?: unknown }).reason : undefined;
  if (reason === "future" || reason === "no-data" || reason === "unavailable") return reason;
  if (response.ok) return null;
  return response.status === 404 ? "no-data" : "unavailable";
}

/**
 * Yahoo's "nothing for this range" answers: 404, 422 (range beyond what the interval serves), or a 400 / chart
 * error whose description says the data does not exist (a future or empty range). Anything else is a failure.
 */
export function isYahooNoData(status: number, description: string | null | undefined): boolean {
  if (status === 404 || status === 422) return true;
  const text = (description ?? "").toLowerCase();
  return (status === 400 || status === 200) && (text.includes("doesn't exist") || text.includes("does not exist") || text.includes("no data found"));
}

/** The calm line the trade page shows when it has no candles. */
export function noCandlesMessage(reason: NoCandlesReason | null | undefined, fresh: boolean): string {
  if (reason === "future") return "No candles for this time: the trade is dated in the future";
  if (fresh) return "Yahoo has not published these bars yet";
  if (reason === "no-data") return "Yahoo has no candles for this time";
  return "No candles loaded for this trade";
}
