// Server only. Daily `MES=F` 1m archive top-up (ROADMAP RM-A2). A TypeScript port of
// `scripts/databento/forward_fill_yahoo.py`. It writes completed CME sessions only, never touches a session that
// Databento covers, never deletes, and stops rather than guess when Yahoo's continuous series switches contract.
import { fromZonedInput, toZonedInput } from "../time.ts";
import type { Candle } from "../trades.ts";

export const TOP_UP_SYMBOL = "MES=F";
const CHICAGO = "America/Chicago";
const DAY_MS = 86_400_000;
const TICK = 0.25;
const QUARTERS = "HMUZ";
/** Yahoo serves `1m` for 30 days; stay inside it. */
const LOOKBACK_DAYS = 29;
/** Recent sessions are re-read on every run, so one that was skipped or short gets another chance. */
const REFRESH_DAYS = 5;
const CHUNK_DAYS = 7;
/** Yahoo futures data lags by about ten minutes. */
const SETTLE_MS = 15 * 60_000;
/** Fewer shared bars than this cannot identify the contract. */
const MIN_COMMON_BARS = 30;

export interface ArchiveRow {
  symbol: string; timeframe: "1m"; ts: string;
  open: number; high: number; low: number; close: number; volume: number;
  source: "yahoo_finance";
}
export interface RollRow {
  symbol: string; session_date: string; from_contract: string; to_contract: string;
  spread: number; source: "yahoo_finance"; evidence: Record<string, unknown>;
}
export interface JobResult {
  status: "success" | "partial" | "failed"; bars: number; result: Record<string, unknown>; error?: string;
}
export interface TopUpStore {
  lastCandleTs(): Promise<string | null>;
  /** The contract in force on a session: the newest roll at or before it. */
  contractAsOf(sessionDate: string): Promise<string | null>;
  databentoSessions(fromSession: string): Promise<Set<string>>;
  databentoCloses(fromIso: string): Promise<Array<{ ts: string; close: number }>>;
  upsertCandles(rows: ArchiveRow[]): Promise<void>;
  upsertCoverage(sessionDate: string, receivedBars: number): Promise<void>;
  upsertRoll(row: RollRow): Promise<void>;
  startJob(rangeFrom: string, rangeTo: string): Promise<string>;
  finishJob(id: string, result: JobResult): Promise<void>;
}
export type FetchBars = (ticker: string, from: Date, to: Date) => Promise<Candle[]>;

export interface TopUpSummary {
  status: "success" | "partial"; bars: number;
  sessions: Array<{ session_date: string; bars: number; contract: string }>;
  skipped: Array<{ session_date: string; reason: string }>;
  /** Set when the archive is older than Yahoo's lookback, so some sessions can no longer be fetched. */
  gap?: { last_archived: string; resumed_from_session: string };
}

/** CME trade date: from 17:00 Chicago a timestamp belongs to the next day's session. */
export function sessionDateOf(ms: number): string {
  const wall = toZonedInput(new Date(ms), CHICAGO);
  const date = wall.slice(0, 10);
  return Number(wall.slice(11, 13)) >= 17 ? addDays(date, 1) : date;
}

/** 17:00 Chicago the day before, up to (not including) 16:00 Chicago on the session date. */
export function sessionWindow(sessionDate: string): { start: number; end: number } {
  return {
    start: fromZonedInput(`${addDays(sessionDate, -1)}T17:00`, CHICAGO).getTime(),
    end: fromZonedInput(`${sessionDate}T16:00`, CHICAGO).getTime(),
  };
}

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

export function nextContract(contract: string): string {
  const prefix = contract.slice(0, -2);
  const index = QUARTERS.indexOf(contract.slice(-2, -1));
  if (index < 0) throw new Error(`Unrecognised contract ${contract}`);
  const year = (Number(contract.slice(-1)) + (index === 3 ? 1 : 0)) % 10;
  return `${prefix}${QUARTERS[(index + 1) % 4]}${year}`;
}

/** `MESZ6` → `MESZ26.CME`, picking the decade nearest the reference year. */
export function yahooContractTicker(contract: string, referenceYear: number): string {
  let year = referenceYear - (referenceYear % 10) + Number(contract.slice(-1));
  if (year < referenceYear - 2) year += 10;
  if (year > referenceYear + 7) year -= 10;
  return `${contract.slice(0, -1)}${String(year % 100).padStart(2, "0")}.CME`;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export interface ContractMatch {
  selected: "current" | "following"; common_bars: number; median_abs_error: number; spread: number | null;
}

/**
 * Which contract the continuous series printed in one session. `null` means too few shared bars to tell.
 * Throws when the series switches contract inside the session or matches neither contract.
 */
export function matchContract(continuous: Candle[], current: Candle[], following: Candle[]): ContractMatch | null {
  const now = new Map(current.map((bar) => [bar.time, bar.close]));
  const next = new Map(following.map((bar) => [bar.time, bar.close]));
  const all = continuous.flatMap((bar) => {
    const a = now.get(bar.time);
    const b = next.get(bar.time);
    return a == null || b == null ? [] : [{ close: bar.close, a, b }];
  });
  if (all.length < MIN_COMMON_BARS) {
    // The next contract trades thinly far from a roll. Accept the current one if it alone matches.
    const errors = continuous.flatMap((bar) => {
      const a = now.get(bar.time);
      return a == null ? [] : [Math.abs(bar.close - a)];
    });
    if (errors.length < MIN_COMMON_BARS || median(errors) > TICK) return null;
    return { selected: "current", common_bars: errors.length, median_abs_error: median(errors), spread: null };
  }
  const votes = all.filter((row) => Math.abs(row.close - row.b) < Math.abs(row.close - row.a)).length;
  const selected = votes / all.length > 0.5 ? "following" : "current";
  const minority = Math.min(votes, all.length - votes);
  if (minority > Math.max(5, Math.floor(all.length / 50))) {
    throw new Error(`Yahoo continuous series appears to switch contract inside one session (${minority} minority bars)`);
  }
  const error = median(all.map((row) => Math.abs(row.close - (selected === "following" ? row.b : row.a))));
  if (error > TICK) throw new Error("Yahoo continuous series is more than one tick from both candidate contracts");
  return {
    selected, common_bars: all.length, median_abs_error: error,
    spread: median(all.slice(0, 60).map((row) => row.b - row.a)),
  };
}

async function fetchChunked(fetchBars: FetchBars, ticker: string, from: number, to: number): Promise<Candle[]> {
  const byTime = new Map<number, Candle>();
  for (let cursor = from; cursor < to; cursor += CHUNK_DAYS * DAY_MS) {
    const end = Math.min(cursor + CHUNK_DAYS * DAY_MS, to);
    for (const bar of await fetchBars(ticker, new Date(cursor), new Date(end - 1))) {
      if (bar.time % 60_000 === 0 && bar.time >= cursor && bar.time < end) byTime.set(bar.time, bar);
    }
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

function bySession(bars: Candle[]): Map<string, Candle[]> {
  const sessions = new Map<string, Candle[]>();
  for (const bar of bars) {
    const date = sessionDateOf(bar.time);
    const window = sessionWindow(date);
    if (bar.time < window.start || bar.time >= window.end) continue; // the 16:00–17:00 break
    const list = sessions.get(date);
    if (list) list.push(bar); else sessions.set(date, [bar]);
  }
  return sessions;
}

export async function runArchiveTopUp(store: TopUpStore, fetchBars: FetchBars, now = new Date()): Promise<TopUpSummary> {
  const nowMs = Math.floor(now.getTime() / 60_000) * 60_000;
  const lastTs = await store.lastCandleTs();
  if (!lastTs) throw new Error("The archive is empty. Load it before topping it up.");
  const lastSession = sessionDateOf(Date.parse(lastTs));
  const refreshFrom = sessionDateOf(nowMs - REFRESH_DAYS * DAY_MS);
  // The first session that opens entirely inside Yahoo's lookback.
  const earliest = addDays(sessionDateOf(nowMs - LOOKBACK_DAYS * DAY_MS), 1);
  const wanted = lastSession < refreshFrom ? lastSession : refreshFrom;
  const startSession = wanted < earliest ? earliest : wanted;
  const fetchStart = sessionWindow(startSession).start;

  const jobId = await store.startJob(new Date(fetchStart).toISOString(), new Date(nowMs).toISOString());
  const summary: TopUpSummary = { status: "success", bars: 0, sessions: [], skipped: [] };
  if (lastSession < earliest) summary.gap = { last_archived: lastTs, resumed_from_session: startSession };
  try {
    const current = await store.contractAsOf(startSession);
    if (!current) throw new Error(`No roll on record at or before ${startSession}`);
    const following = nextContract(current);
    const year = Number(startSession.slice(0, 4));
    const [continuous, currentBars, followingBars] = await Promise.all(
      [TOP_UP_SYMBOL, yahooContractTicker(current, year), yahooContractTicker(following, year)]
        .map((ticker) => fetchChunked(fetchBars, ticker, fetchStart, nowMs)),
    );

    // Same contract check against the authoritative bars, where they overlap.
    const closes = new Map(continuous.map((bar) => [bar.time, bar.close]));
    const seam = (await store.databentoCloses(new Date(fetchStart).toISOString())).flatMap((row) => {
      const yahoo = closes.get(Date.parse(row.ts));
      return yahoo == null ? [] : [row.close - yahoo];
    });
    if (seam.length >= MIN_COMMON_BARS && Math.abs(median(seam)) > TICK) {
      throw new Error(`Databento/Yahoo seam offset ${median(seam)} looks like a contract mismatch`);
    }

    const covered = await store.databentoSessions(startSession);
    const currentBySession = bySession(currentBars);
    const followingBySession = bySession(followingBars);
    let active = current;
    for (const [date, bars] of [...bySession(continuous)].sort(([a], [b]) => a.localeCompare(b))) {
      if (date < startSession || covered.has(date)) continue;
      if (sessionWindow(date).end + SETTLE_MS > nowMs) continue; // still trading, or not settled
      const match = matchContract(bars, currentBySession.get(date) ?? [], followingBySession.get(date) ?? []);
      if (!match) {
        summary.skipped.push({ session_date: date, reason: `too few bars to identify the contract (${bars.length})` });
        continue;
      }
      const contract: string = match.selected === "following" ? following : current;
      if (contract !== active) {
        if (active !== current || contract !== following || match.spread == null) {
          throw new Error(`Yahoo contract moved backward or more than one quarter: ${active} to ${contract}`);
        }
        await store.upsertRoll({
          symbol: TOP_UP_SYMBOL, session_date: date, from_contract: active, to_contract: contract,
          spread: match.spread, source: "yahoo_finance", evidence: { ...match },
        });
        active = contract;
      }
      await store.upsertCandles(bars.map((bar) => ({
        symbol: TOP_UP_SYMBOL, timeframe: "1m", ts: new Date(bar.time).toISOString(),
        open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: Math.trunc(bar.volume ?? 0),
        source: "yahoo_finance",
      })));
      await store.upsertCoverage(date, bars.length);
      summary.bars += bars.length;
      summary.sessions.push({ session_date: date, bars: bars.length, contract });
    }
    if (summary.skipped.length || summary.gap) summary.status = "partial";
    await store.finishJob(jobId, { status: summary.status, bars: summary.bars, result: { ...summary } });
    return summary;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await store.finishJob(jobId, { status: "failed", bars: summary.bars, result: { ...summary }, error: message.slice(0, 2000) });
    throw error;
  }
}
