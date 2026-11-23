// Pure mood sanitizers (no React, no window). Split out of lib/mood-store.ts so server routes can import the command layer (#185a).
import { sanitizeMoodRecords, sanitizeRegistry, spokeIdFor } from "./mood.ts";
import type { MoodRecord, MoodSpokeCandidate, MoodSpokeRegistry } from "./mood.ts";

/** What a backup file carries for mood. Suggestions are not kept: they can be made again from the notes. */
export interface MoodBackup {
  registry: MoodSpokeRegistry;
  records: MoodRecord[];
  candidates: MoodSpokeCandidate[];
}

export function sanitizeCandidates(raw: unknown): MoodSpokeCandidate[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const candidate = item as Partial<MoodSpokeCandidate>;
    if (typeof candidate.label !== "string" || !Array.isArray(candidate.trade_ids)) return [];
    const tradeIds = candidate.trade_ids.filter((id): id is string => typeof id === "string");
    const id = spokeIdFor(candidate.label);
    if (!id) return [];
    return [{
      id,
      label: candidate.label,
      count: tradeIds.length,
      trade_ids: tradeIds,
      first_seen: typeof candidate.first_seen === "string" ? candidate.first_seen : "",
      last_seen: typeof candidate.last_seen === "string" ? candidate.last_seen : "",
      dismissed: candidate.dismissed === true,
    }];
  });
}

export function sanitizeMoodBackup(raw: unknown): MoodBackup | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const input = raw as Partial<Record<keyof MoodBackup, unknown>>;
  return { registry: sanitizeRegistry(input.registry), records: sanitizeMoodRecords(input.records), candidates: sanitizeCandidates(input.candidates) };
}
