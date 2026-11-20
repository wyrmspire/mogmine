// Trading accounts and their running totals, built from the journal. Pure: no I/O, no DOM, `now` is a parameter.
//
// The total is "from your journal": the starting balance plus the gross P&L of every closed trade logged to
// the account, plus the trader's own balance checks. It is not the broker's balance and never claims to be.
//
// Rules shared with docs/17 §2 (one engine for the account card and for Drawdown Defender):
// - Real, closed trades only. Samples never count; open trades have no result yet (OD-38).
// - Order by exit time, then id. A trade lands on the session it closed in (`sessionDate(exit_time)`).
// - Money is integer cents. Compare unrounded; round only to display.
// - Missing is not zero: a trade with no computable P&L is listed as an issue, never counted as $0.
// - The starting balance counts as the first peak. Touching the loss limit counts as a breach.
// See docs/20.

import { sessionCloseUtc, sessionDate } from "./session.ts";
import { DEFAULT_OWNER_USER_ID, tradePnl } from "./trades.ts";
import type { TradeRecord } from "./trades.ts";

/**
 * How the loss limit moves.
 * - `static`: a fixed floor at starting balance − max loss.
 * - `trailing`: the floor follows the highest balance after any closed trade.
 * - `trailing_eod`: the floor follows the highest balance at the end of a session (many prop firms).
 */
export type DrawdownMode = "static" | "trailing" | "trailing_eod";

export interface AccountRules {
  /** Largest drop allowed below the start (static) or the high point (trailing). Null: no limit. */
  max_loss_cents: number | null;
  drawdown: DrawdownMode;
  /** Largest loss allowed in one session, from closed trades. Null: no limit. */
  daily_loss_cents: number | null;
  /** Profit over the starting balance to aim for. Null: no target. */
  profit_target_cents: number | null;
}

export interface TradingAccount {
  id: string;
  /** Invariant 7. */
  user_id: string;
  name: string;
  starting_balance_cents: number;
  rules: AccountRules;
  created_at: string;
  /** Hidden from pickers; its trades and history stay. */
  archived: boolean;
}

/**
 * The trader typed the real balance shown by the broker at a moment. The difference from the journal's
 * total becomes an adjustment (fees, a trade not logged), so old trades never have to be edited.
 */
export interface BalanceCheck {
  id: string;
  account_id: string;
  at: string;
  balance_cents: number;
  note: string;
}

export const NO_RULES: AccountRules = { max_loss_cents: null, drawdown: "trailing", daily_loss_cents: null, profit_target_cents: null };

export function makeAccount(input: { id: string; name: string; starting_balance_cents: number; now: string; rules?: Partial<AccountRules> }): TradingAccount {
  return {
    id: input.id,
    user_id: DEFAULT_OWNER_USER_ID,
    name: input.name.trim() || "Account",
    starting_balance_cents: Math.round(input.starting_balance_cents),
    rules: { ...NO_RULES, ...input.rules },
    created_at: input.now,
    archived: false,
  };
}

/** Dollars typed by the trader → integer cents, or null when it is not a finite amount. */
export function dollarsToCents(text: string): number | null {
  const cleaned = text.replace(/[$,\s]/g, "");
  if (!cleaned || !/^-?\d*(\.\d{0,2})?$/.test(cleaned) || cleaned === "-" || cleaned === ".") return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? Math.round(value * 100) : null;
}

/** Gross P&L of a closed trade in integer cents, or null when it cannot be priced. */
export function pnlCents(trade: TradeRecord): number | null {
  if (trade.exit_time == null) return null;
  const pnl = tradePnl(trade);
  return pnl == null ? null : Math.round(pnl * 100);
}

export type LedgerRow =
  | { kind: "trade"; trade_id: string; at: string; session: string; delta_cents: number; balance_cents: number; floor_cents: number | null }
  | { kind: "check"; check_id: string; at: string; session: string; delta_cents: number; balance_cents: number; floor_cents: number | null };

export type AccountIssue = { trade_id: string; reason: "unpriceable" };

export interface AccountSummary {
  account_id: string;
  starting_cents: number;
  balance_cents: number;
  /** Sum of closed trades only. */
  realized_cents: number;
  /** Sum of balance-check differences (fees, unlogged trades). */
  adjustments_cents: number;
  /** Highest balance reached, the start included. For `trailing_eod`, end-of-session balances only. */
  peak_cents: number;
  /** Peak − balance now. */
  drawdown_cents: number;
  /** Largest peak-to-balance drop seen. */
  max_drawdown_cents: number;
  closedTrades: number;
  openTrades: number;
  sessions: number;
  /** Today's session: realized from closed trades, and the number of trades. */
  today: { session: string; realized_cents: number; trades: number };
  /** Null when the account has no loss limit. */
  limit: {
    floor_cents: number;
    /** Balance − floor. 0 or below means the limit has been reached. */
    room_cents: number;
    /** First row where the balance touched or went under the floor, or null. */
    breached_at: { kind: "trade" | "check"; id: string; at: string } | null;
  } | null;
  /** Null when the account has no daily loss limit. */
  daily: { limit_cents: number; today_room_cents: number; breached_sessions: string[] } | null;
  /** Null when the account has no profit target. */
  target: { target_balance_cents: number; remaining_cents: number; reached_at: string | null } | null;
  /** Balance after each row, starting balance first, for a small line chart. */
  curve: number[];
  rows: LedgerRow[];
  issues: AccountIssue[];
}

type Item =
  | { kind: "trade"; at: string; ms: number; id: string; cents: number }
  | { kind: "check"; at: string; ms: number; id: string; balance: number };

/**
 * The running total of one account. Trades and balance checks are applied in time order; at the same
 * instant a trade comes first, so a check reflects every trade closed up to that moment.
 */
export function accountSummary(account: TradingAccount, trades: TradeRecord[], checks: BalanceCheck[], now: string): AccountSummary {
  const nowMs = Date.parse(now);
  const own = trades.filter((trade) => trade.account_id === account.id && !trade.is_sample);
  const issues: AccountIssue[] = [];
  const items: Item[] = [];
  let openTrades = 0;
  for (const trade of own) {
    if (trade.exit_time == null) { openTrades += 1; continue; }
    const cents = pnlCents(trade);
    if (cents == null) { issues.push({ trade_id: trade.id, reason: "unpriceable" }); continue; }
    items.push({ kind: "trade", at: trade.exit_time, ms: Date.parse(trade.exit_time), id: trade.id, cents });
  }
  for (const check of checks) {
    if (check.account_id !== account.id || !Number.isFinite(check.balance_cents)) continue;
    items.push({ kind: "check", at: check.at, ms: Date.parse(check.at), id: check.id, balance: Math.round(check.balance_cents) });
  }
  items.sort((a, b) => a.ms - b.ms || (a.kind === b.kind ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.kind === "trade" ? -1 : 1));

  const { rules } = account;
  const start = account.starting_balance_cents;
  let balance = start;
  let realized = 0;
  let adjustments = 0;
  let peak = start;
  let maxDrawdown = 0;
  const floorFor = (high: number) => (rules.max_loss_cents == null ? null : (rules.drawdown === "static" ? start : high) - rules.max_loss_cents);
  let breached: NonNullable<AccountSummary["limit"]>["breached_at"] = null;
  let reachedAt: string | null = null;
  const targetBalance = rules.profit_target_cents == null ? null : start + rules.profit_target_cents;
  const sessionRealized = new Map<string, number>();
  const sessionTrades = new Map<string, number>();
  const rows: LedgerRow[] = [];
  const curve = [start];
  let previousSession: string | null = null;

  for (const item of items) {
    const session = sessionDate(item.ms);
    // End-of-session trailing: the session that just ended sets the new high point.
    if (rules.drawdown === "trailing_eod" && previousSession !== null && session !== previousSession) peak = Math.max(peak, balance);
    previousSession = session;
    const delta = item.kind === "trade" ? item.cents : item.balance - balance;
    balance += delta;
    if (item.kind === "trade") {
      realized += delta;
      sessionRealized.set(session, (sessionRealized.get(session) ?? 0) + delta);
      sessionTrades.set(session, (sessionTrades.get(session) ?? 0) + 1);
    } else adjustments += delta;
    if (rules.drawdown !== "trailing_eod") peak = Math.max(peak, balance);
    maxDrawdown = Math.max(maxDrawdown, peak - balance);
    const floor = floorFor(peak);
    if (floor != null && breached == null && balance <= floor) breached = { kind: item.kind, id: item.id, at: item.at };
    if (targetBalance != null && reachedAt == null && balance >= targetBalance) reachedAt = item.at;
    rows.push(item.kind === "trade"
      ? { kind: "trade", trade_id: item.id, at: item.at, session, delta_cents: delta, balance_cents: balance, floor_cents: floor }
      : { kind: "check", check_id: item.id, at: item.at, session, delta_cents: delta, balance_cents: balance, floor_cents: floor });
    curve.push(balance);
  }
  // The last session counts toward an end-of-session high only once it is over.
  if (rules.drawdown === "trailing_eod" && previousSession !== null && rows.length && nowMs > sessionCloseUtc(rows[rows.length - 1].at)) peak = Math.max(peak, balance);

  const today = sessionDate(nowMs);
  const floor = floorFor(peak);
  const breachedSessions = rules.daily_loss_cents == null ? [] : [...sessionRealized].filter(([, value]) => value <= -(rules.daily_loss_cents as number)).map(([key]) => key).sort();
  return {
    account_id: account.id,
    starting_cents: start,
    balance_cents: balance,
    realized_cents: realized,
    adjustments_cents: adjustments,
    peak_cents: peak,
    drawdown_cents: peak - balance,
    max_drawdown_cents: maxDrawdown,
    closedTrades: items.filter((item) => item.kind === "trade").length,
    openTrades,
    sessions: sessionRealized.size,
    today: { session: today, realized_cents: sessionRealized.get(today) ?? 0, trades: sessionTrades.get(today) ?? 0 },
    limit: floor == null ? null : { floor_cents: floor, room_cents: balance - floor, breached_at: breached },
    daily: rules.daily_loss_cents == null ? null : { limit_cents: rules.daily_loss_cents, today_room_cents: rules.daily_loss_cents + (sessionRealized.get(today) ?? 0), breached_sessions: breachedSessions },
    target: targetBalance == null ? null : { target_balance_cents: targetBalance, remaining_cents: Math.max(0, targetBalance - balance), reached_at: reachedAt },
    curve,
    rows,
    issues,
  };
}

/** The account a new trade defaults to: the one used last, if it still exists and is not archived. */
export function defaultAccountId(accounts: TradingAccount[], trades: TradeRecord[]): string | null {
  const live = new Set(accounts.filter((account) => !account.archived).map((account) => account.id));
  const latest = trades
    .filter((trade) => !trade.is_sample && trade.account_id && live.has(trade.account_id))
    .sort((a, b) => Date.parse(b.entry_time) - Date.parse(a.entry_time))[0];
  if (latest?.account_id) return latest.account_id;
  const first = accounts.find((account) => !account.archived);
  return first ? first.id : null;
}

const isCents = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const centsOrNull = (value: unknown) => (isCents(value) && value > 0 ? Math.round(value) : null);

/** Validate stored accounts. Bad rows are dropped, never repaired by guessing. */
export function sanitizeAccounts(raw: unknown): TradingAccount[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item): TradingAccount[] => {
    if (!item || typeof item !== "object") return [];
    const account = item as Partial<TradingAccount>;
    if (typeof account.id !== "string" || typeof account.name !== "string" || !isCents(account.starting_balance_cents)) return [];
    const rules = (account.rules && typeof account.rules === "object" ? account.rules : {}) as Partial<AccountRules>;
    const drawdown: DrawdownMode = rules.drawdown === "static" || rules.drawdown === "trailing_eod" ? rules.drawdown : "trailing";
    return [{
      id: account.id,
      user_id: typeof account.user_id === "string" ? account.user_id : DEFAULT_OWNER_USER_ID,
      name: account.name,
      starting_balance_cents: Math.round(account.starting_balance_cents),
      rules: { max_loss_cents: centsOrNull(rules.max_loss_cents), drawdown, daily_loss_cents: centsOrNull(rules.daily_loss_cents), profit_target_cents: centsOrNull(rules.profit_target_cents) },
      created_at: typeof account.created_at === "string" ? account.created_at : "",
      archived: account.archived === true,
    }];
  });
}

export function sanitizeBalanceChecks(raw: unknown): BalanceCheck[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item): BalanceCheck[] => {
    if (!item || typeof item !== "object") return [];
    const check = item as Partial<BalanceCheck>;
    if (typeof check.id !== "string" || typeof check.account_id !== "string" || typeof check.at !== "string" || !Number.isFinite(Date.parse(check.at)) || !isCents(check.balance_cents)) return [];
    return [{ id: check.id, account_id: check.account_id, at: check.at, balance_cents: Math.round(check.balance_cents), note: typeof check.note === "string" ? check.note : "" }];
  });
}
