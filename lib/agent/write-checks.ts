// #API-2b: write-time checks for agent trade writes (docs/design-2026-11-24/07-agent-api.md §4). Pure over the vocabulary,
// accounts, optional day range and `now` the caller passes in: no command layer, no network, no candle fetch. A refusal
// is a message (the caller answers 422 invalid and writes nothing). A warning never blocks; it rides on the saved record.
import { canonicalSymbol, FUTURES_SPECS } from "../trades.ts";
import type { TradeRecord } from "../trades.ts";
import { riskCents, riskComparison } from "../r-size.ts";
import { activeExecutionTagLabels, activeSetupTagLabels } from "../tag-registry.ts";
import type { TagRegistry } from "../tag-registry.ts";

export interface AgentWriteWarning {
  code:
    | "playbook_missing"
    | "setup_tag_missing"
    | "notes_restate_fields"
    | "stop_moved_without_time"
    | "exit_reason_mismatch"
    | "stated_risk_differs"
    | "price_out_of_range"
    | "initial_stop_time_defaulted";
  message: string;
}

export type TradeWriteCheckResult = { ok: true; warnings: AgentWriteWarning[] } | { ok: false; message: string };

export interface WriteCheckContext {
  playbooks: readonly { id: string; name: string; archived: boolean }[];
  accounts: readonly { id: string; name: string; r_size_cents: number | null; archived: boolean }[];
  /** Active setup and execution labels. Used when `tagRegistry` is absent (the seeds, in older callers). */
  setupTags?: readonly string[];
  executionTags?: readonly string[];
  /** PL-3: the owner's live tag registry. When present, its active labels are the only valid `quick_tags`. */
  tagRegistry?: TagRegistry;
  defaultRSizeCents: number;
  /** Cached bars' low and high for the trade's day. Null or absent when no bars are cached: then no range check runs. */
  dayPriceRange?: { low: number; high: number } | null;
  nowMs?: number;
  isCreate: boolean;
  /** The fields this write sets (the keys of the request body). */
  writtenFields: ReadonlySet<string>;
}

/** Q-10: an entry or exit more than this far in the future is refused. */
export const FUTURE_TOLERANCE_MS = 5 * 60_000;
/** Q-11: a price more than this fraction outside the day's range is warned about. */
const RANGE_BAND = 0.01;
/** A closed stop or trail exit may sit this many ticks from the working stop, either side, before it is flagged (HR-5). */
const EXIT_TICK_TOLERANCE = 2;

const NOTE_FIELDS = ["note", "pre_trade_thesis", "management_notes", "post_exit_notes"] as const;
const PRICE_FIELDS = ["entry_price", "stop_loss_price", "initial_stop_price", "planned_target_price", "exit_price"] as const;
const R_OR_DOLLAR = [/\b\d*\.?\d+\s*R\b/i, /\$\d+(\.\d{1,2})?\b/];

/** Every number written in the text, commas stripped, so `7,137.00` and `7137` both read as 7137. */
function numbersIn(text: string): number[] {
  return (text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((token) => Number(token.replace(/,/g, "")));
}

function restatesFields(text: string, prices: number[]): boolean {
  if (R_OR_DOLLAR.some((pattern) => pattern.test(text))) return true;
  return numbersIn(text).some((value) => prices.includes(value));
}

/** Active labels the checks accept: from the live registry when the caller has one, else the lists it passed in. */
function activeTagLists(ctx: WriteCheckContext): { setup: readonly string[]; execution: readonly string[] } {
  if (ctx.tagRegistry) return { setup: activeSetupTagLabels(ctx.tagRegistry), execution: activeExecutionTagLabels(ctx.tagRegistry) };
  return { setup: ctx.setupTags ?? [], execution: ctx.executionTags ?? [] };
}

function listTags(tags: readonly string[]): string {
  return tags.map((tag) => `"${tag}"`).join(", ");
}

function listPlaybooks(playbooks: WriteCheckContext["playbooks"]): string {
  return playbooks.filter((playbook) => !playbook.archived).map((playbook) => `"${playbook.id}" ("${playbook.name}")`).join(", ");
}

function listAccounts(accounts: WriteCheckContext["accounts"]): string {
  return accounts.filter((account) => !account.archived).map((account) => `"${account.id}" ("${account.name}")`).join(", ");
}

/** The R size a trade is measured in, as the command layer resolves it: its own frozen size, then its account's, then the default. */
function rSizeCents(candidate: TradeRecord, ctx: WriteCheckContext): number {
  const own = candidate.r_size_cents;
  if (typeof own === "number" && own > 0) return own;
  const account = candidate.account_id == null ? undefined : ctx.accounts.find((item) => item.id === candidate.account_id);
  return account && account.r_size_cents != null && account.r_size_cents > 0 ? account.r_size_cents : ctx.defaultRSizeCents;
}

/** The refusals (422). The first one found is returned; they are checked in the order of docs/07 §4. */
function refusal(candidate: TradeRecord, rawInput: Record<string, unknown>, ctx: WriteCheckContext): string | null {
  const now = ctx.nowMs ?? Date.now();
  const writes = (field: string) => ctx.isCreate || ctx.writtenFields.has(field);

  if (candidate.playbook_id != null && writes("playbook_id")) {
    const playbook = ctx.playbooks.find((item) => item.id === candidate.playbook_id);
    if (!playbook || playbook.archived) {
      return `playbook_id "${candidate.playbook_id}" is not a playbook in the vocabulary. Valid playbooks: ${listPlaybooks(ctx.playbooks)}.`;
    }
  }

  if (candidate.account_id != null && writes("account_id")) {
    const account = ctx.accounts.find((item) => item.id === candidate.account_id);
    if (!account || account.archived) {
      return `account_id "${candidate.account_id}" is not an active account of this owner. Valid accounts: ${listAccounts(ctx.accounts)}.`;
    }
  }

  const tagsWritten = ctx.writtenFields.has("quick_tags") || (ctx.isCreate && candidate.quick_tags.length > 0);
  if (tagsWritten) {
    const lists = activeTagLists(ctx);
    const valid = new Set([...lists.setup, ...lists.execution]);
    const unknown = candidate.quick_tags.filter((tag) => !valid.has(tag));
    if (unknown.length > 0) {
      return `Unknown quick_tags ${listTags(unknown)}. Setup tags: ${listTags(lists.setup)}. Execution tags: ${listTags(lists.execution)}.`;
    }
  }

  const limit = now + FUTURE_TOLERANCE_MS;
  if (writes("entry_time") && Date.parse(candidate.entry_time) > limit) {
    return `entry_time ${candidate.entry_time} is more than 5 minutes in the future. Record the time the trade happened.`;
  }
  if (candidate.exit_time != null && writes("exit_time") && Date.parse(candidate.exit_time) > limit) {
    return `exit_time ${candidate.exit_time} is more than 5 minutes in the future. Record the time the trade happened.`;
  }

  if (rawInput.risk_cents !== undefined && rawInput.risk_cents !== riskCents(candidate)) {
    return "risk_cents is computed from entry, initial stop and quantity and did not match.";
  }
  return null;
}

/**
 * HR-5: a closed stop or trail exit against its working stop, by side. Adverse slippage (the fill past the stop) and an
 * untriggered exit (the price never reached the stop) are both flagged, with different advice. Within the tolerance is silent.
 */
function exitReasonWarning(candidate: TradeRecord, working: number | null | undefined, tickSize: number | undefined): AgentWriteWarning | null {
  if (candidate.status !== "closed" || (candidate.exit_reason !== "stop" && candidate.exit_reason !== "trail")) return null;
  if (!tickSize || working == null || candidate.exit_price == null) return null;
  const reason = candidate.exit_reason;
  const exit = candidate.exit_price;
  const sign = candidate.direction === "LONG" ? 1 : -1;
  // Positive when the exit sits on the favorable side of the working stop, negative when it slipped past it.
  const favorableTicks = Math.round(((exit - working) * sign) / tickSize);
  if (Math.abs(favorableTicks) <= EXIT_TICK_TOLERANCE) return null;
  if (favorableTicks > 0) {
    return {
      code: "exit_reason_mismatch",
      message: `exit_reason "${reason}" but exit_price ${exit} sits ${favorableTicks} ticks on the favorable (untriggered) side of working stop ${working}, so the stop was never reached. Use "manual" or "target" if the trade left before the stop, or record the stop_moves trail (HR-4, HR-5).`,
    };
  }
  return {
    code: "exit_reason_mismatch",
    message: `exit_reason "${reason}" but exit_price ${exit} slipped ${-favorableTicks} ticks past working stop ${working} (adverse slippage). Keep both true prices if real stop slippage occurred, or add stop_moves if the stop was widened (HR-4, HR-5).`,
  };
}

/** Warnings (201 with `warnings`). They never block a write. */
function warningsFor(candidate: TradeRecord, ctx: WriteCheckContext): AgentWriteWarning[] {
  const warnings: AgentWriteWarning[] = [];
  const setup = new Set(activeTagLists(ctx).setup);

  if (ctx.isCreate && candidate.playbook_id == null) {
    warnings.push({ code: "playbook_missing", message: "No playbook_id on this new trade. Take one from GET /api/v1/vocabulary." });
  }

  if (!candidate.quick_tags.some((tag) => setup.has(tag))) {
    warnings.push({ code: "setup_tag_missing", message: "No setup tag. Add one from the setup_tags in GET /api/v1/vocabulary." });
  }

  const prices = PRICE_FIELDS.map((field) => candidate[field]).filter((value): value is number => typeof value === "number");
  for (const field of NOTE_FIELDS) {
    if (restatesFields(candidate[field], prices)) {
      warnings.push({ code: "notes_restate_fields", message: `${field} restates a price, stop, risk or R. Those fields already hold them (HR-1).` });
    }
  }

  const moves = candidate.stop_moves ?? [];
  if (candidate.initial_stop_price != null && candidate.stop_loss_price != null
    && candidate.stop_loss_price !== candidate.initial_stop_price && moves.length === 0) {
    warnings.push({ code: "stop_moved_without_time", message: "The stop differs from the initial stop but no stop_moves are recorded. Add each move as {price, time} (HR-4)." });
  }

  const key = canonicalSymbol(candidate.symbol);
  const spec = key ? FUTURES_SPECS[key] : undefined;
  const working = moves.length > 0 ? moves[moves.length - 1].price : candidate.stop_loss_price;
  const exitWarning = exitReasonWarning(candidate, working, spec?.tickSize);
  if (exitWarning) warnings.push(exitWarning);

  if (riskComparison(candidate, rSizeCents(candidate, ctx)).differs) {
    warnings.push({ code: "stated_risk_differs", message: "stated_risk_r differs from the risk the stop implies (HR-7). Keep the trader's figure; check the stop." });
  }

  const range = ctx.dayPriceRange;
  if (range) {
    const outside = (value: number) => value < range.low * (1 - RANGE_BAND) || value > range.high * (1 + RANGE_BAND);
    const checks: Array<[string, number | null]> = [["entry_price", candidate.entry_price], ["exit_price", candidate.exit_price]];
    for (const [field, value] of checks) {
      if (value != null && outside(value)) {
        warnings.push({ code: "price_out_of_range", message: `${field} ${value} is more than 1% outside the day's traded range ${range.low}-${range.high}.` });
      }
    }
  }

  return warnings;
}

/** Runs every write-time check on the candidate trade record. `rawInput` is what the caller sent (the body or patch). */
export function checkTradeWrite(candidate: TradeRecord, rawInput: Record<string, unknown>, ctx: WriteCheckContext): TradeWriteCheckResult {
  const message = refusal(candidate, rawInput, ctx);
  if (message) return { ok: false, message };
  return { ok: true, warnings: warningsFor(candidate, ctx) };
}
