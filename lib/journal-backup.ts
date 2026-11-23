// The journal backup file (`JournalBackup`, version 1): build it, read it back, and validate every record on the way in.
// Moved out of lib/store.ts (#190) to keep the store under the file-length target. The code is unchanged except:
// `buildBackup` takes its trades as an argument (the old default read the store, which would be an import cycle).
import { DEMO_TRADE_IDS } from "./fixtures.ts";
import { sanitizeAccountsBackup } from "./accounts-store.ts";
import type { AccountsBackup } from "./accounts-store.ts";
import { sanitizeChallengesBackup } from "./challenge-store.ts";
import type { ChallengeDefinition } from "./challenges.ts";
import { sanitizeMoodBackup } from "./mood-store.ts";
import type { MoodBackup } from "./mood-store.ts";
import { sanitizePlansBackup } from "./plans-store.ts";
import { sanitizeDrillsBackup } from "./drills-store.ts";
import { sanitizeCallsBackup } from "./calls-store.ts";
import type { CallsBackup } from "./calls-store.ts";
import type { DrillRecord } from "./drills.ts";
import type { PlanningSession } from "./plans.ts";
import { playbooksDifferFromSeeds, sanitizePlaybooksBackup } from "./playbooks-store.ts";
import type { Playbook } from "./playbooks.ts";
import type { Prefs } from "./prefs.ts";
import { normalizeTrade } from "./trades.ts";
import type { Candle, ChecklistItem, TradeDirection, TradeRecord } from "./trades.ts";

/** Newest entry first. Shared with the store, which keeps the journal in this order. */
export const byNewest = (a: TradeRecord, b: TradeRecord) => Date.parse(b.entry_time) - Date.parse(a.entry_time);

export type LegacyTrade = Partial<TradeRecord> & { candles?: Candle[] };

export interface JournalBackup {
  app: "mogmine";
  version: 1;
  exportedAt: string;
  /** Backups store the trade journal only. Candles sit in IndexedDB and are re-fetched from Yahoo when a chart opens (samples use offline fixture bars). */
  includesCandles: false;
  trades: TradeRecord[];
  prefs?: Partial<Prefs>;
  /** Mood Shape records, spoke registry and candidates (docs/18). Absent in older backups. */
  mood?: MoodBackup;
  /** Accounts and balance checks (docs/21). Absent in older backups. */
  accounts?: AccountsBackup;
  /** Trading challenges (docs/17). Absent in older backups. */
  challenges?: ChallengeDefinition[];
  /** The trader's playbooks, archived included (R-07a). Absent in older backups. */
  playbooks?: Playbook[];
  /** Planning sessions and revisions (PS-1, docs/24). Absent in older backups. */
  plans?: PlanningSession[];
  /** Drill answers (CD-2b). Absent in older backups. */
  drills?: DrillRecord[];
  /** Discretionary calls and prompt dismissals (DC-2). Absent in older backups. */
  calls?: CallsBackup;
}

export type ParseBackupResult =
  | { ok: true; trades: TradeRecord[]; prefs?: Partial<Prefs>; mood?: MoodBackup; accounts?: AccountsBackup; challenges?: ChallengeDefinition[]; playbooks?: Playbook[]; plans?: PlanningSession[]; drills?: DrillRecord[]; calls?: CallsBackup; realCount: number; sampleCount: number; exportedAt: string | null }
  | { ok: false; error: string };

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isValidTime(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
}

function sanitizeChecklist(value: unknown): ChecklistItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const candidate = item as Record<string, unknown>;
    if (typeof candidate.id !== "string" || typeof candidate.label !== "string") return [];
    return [{ id: candidate.id, label: candidate.label, checked: candidate.checked === true }];
  });
}

/** An open record has both exit fields null; any other record (closed or legacy, no status) needs both (R-03). */
function hasValidExit(item: LegacyTrade): boolean {
  if (item.status === "open") return item.exit_time == null && item.exit_price == null;
  if (item.status !== undefined && item.status !== "closed") return false;
  return isValidTime(item.exit_time) && isFiniteNumber(item.exit_price);
}

function parseTradeItem(raw: unknown): TradeRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as LegacyTrade;
  if (
    typeof item.id !== "string" || !item.id.trim() ||
    typeof item.symbol !== "string" || !item.symbol.trim() ||
    !isValidTime(item.entry_time) ||
    !hasValidExit(item) ||
    !isFiniteNumber(item.entry_price) ||
    (item.direction !== "LONG" && item.direction !== "SHORT")
  ) {
    return null;
  }
  const rest = { ...item };
  delete rest.candles;
  const isSample = typeof rest.is_sample === "boolean" ? rest.is_sample : DEMO_TRADE_IDS.has(item.id);
  const quickTags = Array.isArray(rest.quick_tags) ? rest.quick_tags.filter((tag): tag is string => typeof tag === "string") : [];
  const sparkline = Array.isArray(rest.sparkline) ? rest.sparkline.filter(isFiniteNumber) : [];
  const stopLoss = isFiniteNumber(rest.stop_loss_price) ? rest.stop_loss_price : null;
  const plannedTarget = isFiniteNumber(rest.planned_target_price) ? rest.planned_target_price : null;
  const keyLevel = isFiniteNumber(rest.key_level_price) ? rest.key_level_price : null;
  // A stored 0 or 1.5 is kept as it was saved. Its money reads as null rather than a rounded guess (issue #50).
  const quantity = isFiniteNumber(rest.quantity) ? rest.quantity : 1;
  return normalizeTrade({
    ...rest,
    id: item.id,
    symbol: item.symbol,
    direction: item.direction as TradeDirection,
    entry_time: item.entry_time,
    // hasValidExit: both present, or both null on an open trade.
    exit_time: item.exit_time ?? null,
    entry_price: item.entry_price,
    exit_price: item.exit_price ?? null,
    stop_loss_price: stopLoss,
    // R-10: kept only as a valid pair; anything else is unknown, never guessed.
    ...(isFiniteNumber(rest.initial_stop_price) && isValidTime(rest.initial_stop_set_at)
      ? { initial_stop_price: rest.initial_stop_price, initial_stop_set_at: rest.initial_stop_set_at }
      : { initial_stop_price: null, initial_stop_set_at: null }),
    planned_target_price: plannedTarget,
    key_level_price: keyLevel,
    quantity,
    note: typeof rest.note === "string" ? rest.note : "",
    playbook_id: typeof rest.playbook_id === "string" ? rest.playbook_id : null,
    account_id: typeof rest.account_id === "string" && rest.account_id ? rest.account_id : null,
    quick_tags: quickTags,
    checklist_state: sanitizeChecklist(rest.checklist_state),
    pre_trade_thesis: typeof rest.pre_trade_thesis === "string" ? rest.pre_trade_thesis : "",
    management_notes: typeof rest.management_notes === "string" ? rest.management_notes : "",
    post_exit_notes: typeof rest.post_exit_notes === "string" ? rest.post_exit_notes : "",
    flagged: rest.flagged === true,
    take_again: rest.take_again === "yes" || rest.take_again === "smaller" || rest.take_again === "pass" ? rest.take_again : null,
    take_again_at: typeof rest.take_again_at === "string" ? rest.take_again_at : null,
    is_sample: isSample,
    sparkline,
    candle_source: rest.candle_source === "Yahoo Finance" || rest.candle_source === "Demo fixture" ? rest.candle_source : undefined,
  });
}

/** Build a local backup payload of the trade journal and device preferences (no candles, no secrets). */
export function buildBackup(trades: TradeRecord[], prefs?: Prefs, mood?: MoodBackup, accounts?: AccountsBackup, challenges?: ChallengeDefinition[], playbooks?: Playbook[], plans?: PlanningSession[], drills?: DrillRecord[], calls?: CallsBackup): JournalBackup {
  const cleanTrades = trades.map((trade) => {
    const rest: TradeRecord & { candles?: Candle[] } = { ...trade };
    delete rest.candles;
    return normalizeTrade({ ...rest, is_sample: rest.is_sample ?? DEMO_TRADE_IDS.has(trade.id) });
  });
  return {
    app: "mogmine",
    version: 1,
    exportedAt: new Date().toISOString(),
    includesCandles: false,
    trades: cleanTrades,
    ...(prefs ? { prefs } : {}),
    ...(mood ? { mood } : {}),
    ...(accounts ? { accounts } : {}),
    ...(challenges ? { challenges } : {}),
    ...(playbooks ? { playbooks } : {}),
    ...(plans ? { plans } : {}),
    ...(drills ? { drills } : {}),
    ...(calls && (calls.calls.length || calls.dismissals.length) ? { calls } : {}),
  };
}

/** Validate and normalize a backup JSON string before touching the journal. */
export function parseBackupFile(rawText: string): ParseBackupResult {
  if (!rawText || !rawText.trim()) {
    return { ok: false, error: "This file is empty." };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return { ok: false, error: "Not a valid JSON backup file." };
  }

  let rawTrades: unknown[];
  let rawPrefs: Partial<Prefs> | undefined;
  let mood: MoodBackup | undefined;
  let accounts: AccountsBackup | undefined;
  let challenges: ChallengeDefinition[] | undefined;
  let playbooks: Playbook[] | undefined;
  let plans: PlanningSession[] | undefined;
  let drills: DrillRecord[] | undefined;
  let calls: CallsBackup | undefined;
  let exportedAt: string | null = null;

  if (Array.isArray(parsed)) {
    rawTrades = parsed;
  } else if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    if ("app" in obj && obj.app !== "mogmine") {
      return { ok: false, error: "This file is not a MogMine journal backup." };
    }
    if (!Array.isArray(obj.trades)) {
      return { ok: false, error: "Backup file is missing a trades list." };
    }
    rawTrades = obj.trades;
    if (obj.prefs && typeof obj.prefs === "object" && !Array.isArray(obj.prefs)) {
      rawPrefs = obj.prefs as Partial<Prefs>;
    }
    mood = sanitizeMoodBackup(obj.mood) ?? undefined;
    accounts = sanitizeAccountsBackup(obj.accounts) ?? undefined;
    challenges = sanitizeChallengesBackup(obj.challenges) ?? undefined;
    playbooks = sanitizePlaybooksBackup(obj.playbooks) ?? undefined;
    plans = sanitizePlansBackup(obj.plans) ?? undefined;
    drills = sanitizeDrillsBackup(obj.drills) ?? undefined;
    calls = sanitizeCallsBackup(obj.calls) ?? undefined;
    if (typeof obj.exportedAt === "string" && Number.isFinite(Date.parse(obj.exportedAt))) {
      exportedAt = obj.exportedAt;
    }
  } else {
    return { ok: false, error: "Not a recognized MogMine backup format." };
  }

  // Seeds alone are not worth restoring; a custom or edited playbook list, challenges, plans, drill answers or calls are.
  if (rawTrades.length === 0 && !challenges?.length && !plans?.length && !drills?.length && !calls && !(playbooks && playbooksDifferFromSeeds(playbooks))) {
    return { ok: false, error: "This backup file has no trades to restore." };
  }

  const trades: TradeRecord[] = [];
  const seenIds = new Set<string>();
  for (let i = 0; i < rawTrades.length; i += 1) {
    const trade = parseTradeItem(rawTrades[i]);
    if (!trade) {
      return { ok: false, error: `Trade #${i + 1} in the file is missing required fields (id, symbol, side, times or prices).` };
    }
    if (!seenIds.has(trade.id)) {
      seenIds.add(trade.id);
      trades.push(trade);
    }
  }

  trades.sort(byNewest);
  const sampleCount = trades.filter((t) => t.is_sample).length;
  const realCount = trades.length - sampleCount;

  return { ok: true, trades, prefs: rawPrefs, ...(mood ? { mood } : {}), ...(accounts ? { accounts } : {}), ...(challenges ? { challenges } : {}), ...(playbooks ? { playbooks } : {}), ...(plans ? { plans } : {}), ...(drills ? { drills } : {}), ...(calls ? { calls } : {}), realCount, sampleCount, exportedAt };
}
