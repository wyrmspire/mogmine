// Mood records on this device (docs/18). Kept apart from the trade list, the way a separate table would be:
// the spoke registry, the append-only score records, pending suggestions and candidate spokes.
// Local-first like the journal (UX-30, UX-31). No Supabase table until OD-30 is settled.
import { useSyncExternalStore } from "react";
import {
  DEFAULT_CANDIDATE_THRESHOLD,
  DEFAULT_MOOD_REGISTRY,
  acceptSuggestion,
  addSpoke,
  moodSourceText,
  recordCandidates,
  rescoreForNewSpoke,
  sanitizeMoodRecords,
  sanitizeRegistry,
  spokeIdFor,
  suggestMoodFromText,
  userScoreRecord,
  userSetSpokes,
} from "./mood.ts";
import type { MoodRecord, MoodSpokeCandidate, MoodSpokeRegistry, MoodSuggestion } from "./mood.ts";
import type { TradeRecord } from "./trades.ts";

const STORAGE_KEY = "mogmine-mood-v1";

export interface MoodState {
  hydrated: boolean;
  registry: MoodSpokeRegistry;
  records: MoodRecord[];
  /** Pending suggestions by trade. Shown for Accept / Adjust; never scores until accepted (UX-33). */
  suggestions: Record<string, MoodSuggestion>;
  candidates: MoodSpokeCandidate[];
  /** Trades that must name a new emotion before "Add spoke?" is offered (OD-39). */
  threshold: number;
}

/** What a backup file carries for mood. Suggestions are not kept: they can be made again from the notes. */
export interface MoodBackup {
  registry: MoodSpokeRegistry;
  records: MoodRecord[];
  candidates: MoodSpokeCandidate[];
}

const empty = (): MoodState => ({ hydrated: false, registry: DEFAULT_MOOD_REGISTRY, records: [], suggestions: {}, candidates: [], threshold: DEFAULT_CANDIDATE_THRESHOLD });
let state: MoodState = empty();
const serverState: MoodState = empty();
const listeners = new Set<() => void>();

function set(patch: Partial<MoodState>) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

function persist() {
  if (typeof window === "undefined") return;
  try {
    const { registry, records, suggestions, candidates } = state;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ registry, records, suggestions, candidates }));
  } catch {
    // Storage blocked: the session keeps working in memory, as the journal does.
  }
}

function sanitizeCandidates(raw: unknown): MoodSpokeCandidate[] {
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

function sanitizeSuggestions(raw: unknown): Record<string, MoodSuggestion> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, MoodSuggestion> = {};
  for (const [tradeId, value] of Object.entries(raw as Record<string, unknown>)) {
    const item = value as Partial<MoodSuggestion> | null;
    if (!item || item.trade_id !== tradeId || !item.scores || typeof item.scores !== "object") continue;
    out[tradeId] = { trade_id: tradeId, spoke_set_version: Number(item.spoke_set_version) || 1, scores: item.scores, evidence: item.evidence ?? {}, candidates: Array.isArray(item.candidates) ? item.candidates : [], model: String(item.model ?? ""), captured_at: item.captured_at ?? null, created_at: String(item.created_at ?? "") };
  }
  return out;
}

type StoredMood = Partial<Record<keyof MoodBackup | "suggestions", unknown>>;

function fromStored(parsed: StoredMood): Partial<MoodState> {
  return {
    registry: sanitizeRegistry(parsed.registry),
    records: sanitizeMoodRecords(parsed.records),
    suggestions: sanitizeSuggestions(parsed.suggestions),
    candidates: sanitizeCandidates(parsed.candidates),
  };
}

export function hydrateMood() {
  if (state.hydrated || typeof window === "undefined") return;
  let loaded: Partial<MoodState> = {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) loaded = fromStored(JSON.parse(raw) as StoredMood);
  } catch {
    // Unreadable or blocked: start empty in memory and leave the stored value untouched.
  }
  set({ ...loaded, hydrated: true });
  window.addEventListener("storage", (event) => {
    // Another tab changed mood data: take its copy rather than overwrite it later.
    if (event.key !== STORAGE_KEY || !event.newValue) return;
    try { set(fromStored(JSON.parse(event.newValue) as StoredMood)); } catch { /* keep ours */ }
  });
}

const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `mood-${Date.now()}-${Math.random().toString(36).slice(2)}`);

/** The trader sets one spoke by hand. `null` sets it back to unknown. Returns the previous value for Undo. */
export function setSpokeScore(tradeId: string, spoke: string, value: number | null, now = new Date().toISOString()) {
  const record = userScoreRecord({ id: newId(), trade_id: tradeId, now }, state.registry, spoke, value);
  set({ records: [...state.records, record] });
  persist();
  return record;
}

/** Remove one record (Undo of a drag made a moment ago). Only the trader's own records can be undone. */
export function undoMoodRecord(id: string) {
  const target = state.records.find((record) => record.id === id);
  if (!target || target.source !== "user") return;
  set({ records: state.records.filter((record) => record.id !== id) });
  persist();
}

/**
 * Read the trade's notes with the on-device phrase matcher and keep the result as a pending suggestion.
 * Spokes the trader already set are not offered. New emotions are counted toward "Add spoke?".
 */
export function suggestFromNotes(trade: TradeRecord, now = new Date().toISOString()) {
  const text = moodSourceText(trade);
  const suggestion = suggestMoodFromText(text, state.registry, { trade_id: trade.id, now, captured_at: now });
  const mine = userSetSpokes(trade.id, state.records);
  const kept: string[] = [];
  for (const spoke of mine) {
    if (spoke in suggestion.scores) kept.push(spoke);
    delete suggestion.scores[spoke];
    delete suggestion.evidence[spoke];
  }
  const suggestions = { ...state.suggestions };
  if (Object.keys(suggestion.scores).length) suggestions[trade.id] = suggestion;
  else delete suggestions[trade.id];
  // Samples never shape the trader's spoke list.
  const candidates = trade.is_sample ? state.candidates : recordCandidates(state.candidates, suggestion.candidates.map((item) => item.label), trade.id, now);
  set({ suggestions, candidates });
  persist();
  /** `keptYours`: spokes the notes spoke to that the trader had already set, so nothing was offered. */
  return { suggestion, keptYours: kept };
}

/** Accept some or all suggested spokes. Never writes over a spoke the trader set (UX-33). */
export function acceptMoodSuggestion(tradeId: string, spokes?: string[], now = new Date().toISOString()) {
  const suggestion = state.suggestions[tradeId];
  if (!suggestion) return null;
  const record = acceptSuggestion(suggestion, state.records, { id: newId(), now, spokes });
  const remaining = { ...suggestion, scores: { ...suggestion.scores }, evidence: { ...suggestion.evidence } };
  for (const spoke of spokes ?? Object.keys(suggestion.scores)) { delete remaining.scores[spoke]; delete remaining.evidence[spoke]; }
  const suggestions = { ...state.suggestions };
  if (Object.keys(remaining.scores).length) suggestions[tradeId] = remaining;
  else delete suggestions[tradeId];
  set({ records: record ? [...state.records, record] : state.records, suggestions });
  persist();
  return record;
}

export function dismissMoodSuggestion(tradeId: string, spoke?: string) {
  const suggestion = state.suggestions[tradeId];
  if (!suggestion) return;
  const suggestions = { ...state.suggestions };
  if (spoke) {
    const scores = { ...suggestion.scores };
    delete scores[spoke];
    if (Object.keys(scores).length) suggestions[tradeId] = { ...suggestion, scores };
    else delete suggestions[tradeId];
  } else delete suggestions[tradeId];
  set({ suggestions });
  persist();
}

/**
 * The trader said yes to "Add spoke?": a new registry version, then past trades are scored for the
 * new spoke from their own notes. Returns how many trades got a score.
 */
export function addSpokeFromCandidate(candidateId: string, trades: TradeRecord[], now = new Date().toISOString()) {
  const candidate = state.candidates.find((item) => item.id === candidateId);
  if (!candidate) return 0;
  const registry = addSpoke(state.registry, candidate.label);
  const rescored = rescoreForNewSpoke(trades.filter((trade) => !trade.is_sample), state.records, registry, candidate.id, { now, makeId: () => newId() });
  set({ registry, records: [...state.records, ...rescored], candidates: state.candidates.filter((item) => item.id !== candidateId) });
  persist();
  return rescored.length;
}

export function dismissCandidate(candidateId: string) {
  set({ candidates: state.candidates.map((item) => (item.id === candidateId ? { ...item, dismissed: true } : item)) });
  persist();
}

export function getMoodBackup(): MoodBackup {
  return { registry: state.registry, records: state.records, candidates: state.candidates };
}

export function sanitizeMoodBackup(raw: unknown): MoodBackup | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const input = raw as Partial<Record<keyof MoodBackup, unknown>>;
  return { registry: sanitizeRegistry(input.registry), records: sanitizeMoodRecords(input.records), candidates: sanitizeCandidates(input.candidates) };
}

/** Replace mood data from a backup file, alongside `replaceTrades`. */
export function restoreMood(backup: MoodBackup) {
  set({ registry: backup.registry, records: backup.records, candidates: backup.candidates, suggestions: {} });
  persist();
}

/** Test hook. */
export function resetMoodForTests(next: Partial<MoodState> = {}) {
  state = { ...empty(), hydrated: true, ...next };
}

export function getMoodState() {
  return state;
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export function useMood() {
  return useSyncExternalStore(subscribe, () => state, () => serverState);
}
