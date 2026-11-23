// Mood records on this device (docs/18). Kept apart from the trade list, the way a separate table would be:
// the spoke registry, the append-only score records, pending suggestions and candidate spokes.
// Local-first like the journal (UX-30, UX-31). Records, candidates and the spoke registry sync to Supabase when enabled
// (#193, #194, docs/26 §8). Suggestions are session-only and never synced (derivedNeverStored).
import { useSyncExternalStore } from "react";
import { createCollectionSync } from "./persistence/store-sync.ts";
import type { CollectionSync, CollectionSyncOptions } from "./persistence/store-sync.ts";
import { createSingletonSync } from "./persistence/singleton-sync.ts";
import type { SingletonSync, SingletonSyncOptions } from "./persistence/singleton-sync.ts";
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
  suggestMoodFromText,
  userMoodRecord,
  userScoreRecord,
  userSetSpokes,
} from "./mood.ts";
import type { MoodRecord, MoodSpokeCandidate, MoodSpokeRegistry, MoodSuggestion } from "./mood.ts";
import type { TradeRecord } from "./trades.ts";
import { sanitizeCandidates } from "./mood-store-sanitize.ts";
import type { MoodBackup } from "./mood-store-sanitize.ts";
import { DEMO_TRADE_IDS } from "./fixtures.ts";
// Rows about sample trades stay on the device, like the sample trades themselves (#193 review).
const notOnSampleTrade = (record: { trade_id?: string | null }) => !record.trade_id || !DEMO_TRADE_IDS.has(record.trade_id);
export { sanitizeCandidates, sanitizeMoodBackup } from "./mood-store-sanitize.ts";
export type { MoodBackup } from "./mood-store-sanitize.ts";

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

// Remote sync (#193, #194). The device cache above is always written first; these copy records, candidates and the
// registry in the background. `apply` leaves `suggestions` as they are and writes the whole device cache.
function applyRecords(next: MoodRecord[]) {
  set({ records: sanitizeMoodRecords(next) });
  persist();
}

function applyCandidates(next: MoodSpokeCandidate[]) {
  set({ candidates: sanitizeCandidates(next) });
  persist();
}

function applyRegistry(next: MoodSpokeRegistry) {
  set({ registry: sanitizeRegistry(next) });
  persist();
}

interface MoodSyncs {
  records: CollectionSync;
  candidates: CollectionSync;
  /** The spoke registry: one document per owner (`mogmine_mood_registries`, docs/26 §3). */
  registry: SingletonSync;
}

type MoodSyncOverrides = {
  records?: Partial<CollectionSyncOptions<MoodRecord>>;
  candidates?: Partial<CollectionSyncOptions<MoodSpokeCandidate>>;
  registry?: Partial<SingletonSyncOptions<MoodSpokeRegistry>>;
};

function createMoodSyncs(overrides: MoodSyncOverrides = {}): MoodSyncs {
  return {
    records: createCollectionSync<MoodRecord>({ key: "mood_records", include: notOnSampleTrade, getLocal: () => state.records, apply: applyRecords, ...overrides.records }),
    candidates: createCollectionSync<MoodSpokeCandidate>({ key: "mood_candidates", getLocal: () => state.candidates, apply: applyCandidates, ...overrides.candidates }),
    // A fresh device holds the starting spokes; those never overwrite the server's registry (singleton `unedited` rule).
    registry: createSingletonSync<MoodSpokeRegistry>({ key: "mood_registry", getLocal: () => state.registry, apply: applyRegistry, unedited: DEFAULT_MOOD_REGISTRY, ...overrides.registry }),
  };
}

let syncs: MoodSyncs = createMoodSyncs();

/** Dispose the current syncers (timers, listeners, registry entries) and build new ones. */
function replaceSyncs(overrides?: MoodSyncOverrides): MoodSyncs {
  syncs.records.dispose();
  syncs.candidates.dispose();
  syncs.registry.dispose();
  syncs = createMoodSyncs(overrides);
  return syncs;
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
    try {
      set(fromStored(JSON.parse(event.newValue) as StoredMood));
      syncs.records.changed();
      syncs.candidates.changed();
      syncs.registry.changed();
    } catch { /* keep ours */ }
  });
  syncs.records.start();
  syncs.candidates.start();
  syncs.registry.start();
}

const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `mood-${Date.now()}-${Math.random().toString(36).slice(2)}`);

/** The trader sets one spoke by hand. `null` sets it back to unknown. Returns the previous value for Undo. */
export function setSpokeScore(tradeId: string, spoke: string, value: number | null, now = new Date().toISOString(), capturedAt?: string | null, recordedAt?: string | null) {
  const record = userScoreRecord({ id: newId(), trade_id: tradeId, now, captured_at: capturedAt, recorded_at: recordedAt }, state.registry, spoke, value);
  set({ records: [...state.records, record] });
  persist();
  syncs.records.changed();
  return record;
}

/**
 * Record user mood scores. Used for one-tap mood capture at entry or pre-exit (docs/19 §4, OD-39 c).
 * `capturedAt` stamps when the feeling was experienced (e.g. trade entry time).
 * `recordedAt` stamps the true wall-clock time the user submitted the score.
 */
export function recordUserMood(
  tradeId: string,
  scores: Record<string, number | null>,
  now = new Date().toISOString(),
  capturedAt?: string | null,
  recordedAt?: string | null,
) {
  const record = userMoodRecord({ id: newId(), trade_id: tradeId, now, captured_at: capturedAt, recorded_at: recordedAt }, state.registry, scores);
  set({ records: [...state.records, record] });
  persist();
  syncs.records.changed();
  return record;
}

/** Remove one record (Undo of a drag made a moment ago). Only the trader's own records can be undone. */
export function undoMoodRecord(id: string) {
  const target = state.records.find((record) => record.id === id);
  if (!target || target.source !== "user") return;
  set({ records: state.records.filter((record) => record.id !== id) });
  persist();
  syncs.records.changed();
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
  syncs.candidates.changed();
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
  syncs.records.changed();
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
  syncs.registry.changed();
  syncs.records.changed();
  syncs.candidates.changed();
  return rescored.length;
}

export function dismissCandidate(candidateId: string) {
  set({ candidates: state.candidates.map((item) => (item.id === candidateId ? { ...item, dismissed: true } : item)) });
  persist();
  syncs.candidates.changed();
}

export function getMoodBackup(): MoodBackup {
  return { registry: state.registry, records: state.records, candidates: state.candidates };
}

/** Replace mood data from a backup file, alongside `replaceTrades`. */
export function restoreMood(backup: MoodBackup) {
  set({ registry: backup.registry, records: backup.records, candidates: backup.candidates, suggestions: {} });
  persist();
  syncs.registry.changed();
  syncs.records.changed();
  syncs.candidates.changed();
}

/** Test hook. Disposes the syncers, so no sync timer or listener outlives the test that started it. */
export function resetMoodForTests(next: Partial<MoodState> = {}) {
  replaceSyncs();
  state = { ...empty(), hydrated: true, ...next };
}

/** Test hook: swap the record, candidate or registry syncer's adapter, storage or timers. Returns the syncers under test. */
export function configureMoodSyncForTests(overrides: MoodSyncOverrides): MoodSyncs {
  return replaceSyncs(overrides);
}

export function getMoodState() {
  return state;
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export function useMood() {
  return useSyncExternalStore(subscribe, () => state, () => serverState);
}
