// The quiet line under the prices that says what the bar finder did (docs/20 §2.2). Pure.
import type { InferResult } from "./infer-times.ts";
import { formatPrice } from "./format.ts";
import { formatListTime, zoneLabel } from "./time.ts";

const REASON: Record<InferResult["reason"], string> = {
  "only-touch": "",
  "only-consistent": " (the only one with your exit after it)",
  "nearest-hint": " (nearest your time)",
  "first-rth": " (first in regular hours)",
  "first-touch": " (the first)",
  "no-touch": "",
};

/** One or two short sentences, in the display zone. No dollars or size, so Shield needs nothing. */
export function finderMessage(result: InferResult, input: { symbol: string; entryPrice: number; exitPrice: number | null; dateLabel: string }, zone: string): string {
  const bars = `${result.timeframe} bars${result.approximate ? ", approximate" : ""}`;
  if (result.entryTime == null) {
    return `${formatPrice(input.entryPrice, input.symbol)} did not trade in any ${result.timeframe} bar on ${input.dateLabel}. Set the times yourself.`;
  }
  const at = (ms: number) => formatListTime(ms, zone);
  const zoneName = zoneLabel(result.entryTime, zone);
  const parts: string[] = [];
  if (result.confidence === "exact") {
    parts.push(result.exitTime != null
      ? `Matched ${at(result.entryTime)} entry, ${at(result.exitTime)} exit ${zoneName} from ${bars}.`
      : `Matched ${at(result.entryTime)} entry ${zoneName} from ${bars}.`);
  } else {
    parts.push(`Entry price traded ${result.entryCandidates} times. Picked ${at(result.entryTime)} ${zoneName}${REASON[result.reason]}, from ${bars}. Tap to change.`);
    if (result.exitTime != null) parts.push(`Exit ${at(result.exitTime)}.`);
  }
  if (result.exitStatus === "not-after-entry" && input.exitPrice != null) {
    parts.push(result.exitMayBeInEntryBar
      ? `${formatPrice(input.exitPrice, input.symbol)} also traded in the entry bar, so the exit may be in that bar. Set the exit time yourself.`
      : `${formatPrice(input.exitPrice, input.symbol)} did not trade after the entry that day. Set the exit time yourself.`);
  }
  if (result.hitFirst) {
    parts.push(`Your ${result.hitFirst.kind} traded at ${at(result.hitFirst.time)}, before this exit.`);
  }
  return parts.join(" ");
}
