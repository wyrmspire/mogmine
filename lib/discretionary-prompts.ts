// Discretionary review prompts engine (DP-1, docs/playbook-design/04).
// Pure: no storage, no React. Evaluates trade execution facts to detect plan departures
// and determines pending review asks. All deviations and grades are derived and never stored.

import {
  CALL_KINDS,
  seedReasonId,
  sharedReasonChips,
} from "./calls.ts";
import type {
  CallKind,
  DeviationKind,
  DiscretionCall,
  PromptDismissal,
  ReasonChip,
  ReasonFamily,
} from "./calls.ts";
import { hasWidenedStop, specFor } from "./trades.ts";
import type { TradeRecord } from "./trades.ts";

export type { ReasonChip, ReasonFamily, DeviationKind };

export type PromptTrigger =
  /** Asked on every eligible trade, optionally only when a fact is present ("has a stop"). */
  | { on: "always"; when?: DeviationKind }
  /** Asked only when the detector finds one of these departures. */
  | { on: "deviation"; deviations: DeviationKind[] }
  /** Never asked automatically; offered in the call sheet and on Trade Detail. */
  | { on: "manual" };

export interface ReviewPrompt {
  id: string; // seeds: "seed:cut"; owner prompts: generated, never changes
  user_id: string;
  /** Seed lineage, so "Reset to default" and seed upgrades work without overwriting edits. */
  seed_id: string | null;
  seed_version: number | null;
  answer_shape: "call" | "reflection";
  /** Required when answer_shape is "call". Immutable after the first answer (OD-DP-12). */
  kind: CallKind | null;
  /** The kind's prompt in the manual call sheet. Exactly one active primary per kind. */
  primary: boolean;
  question: string; // <= 120 chars
  reasons: ReasonChip[]; // <= 12, the owner's order is the picker order
  include_shared_reasons: boolean;
  ask_conviction: boolean;
  trigger: PromptTrigger;
  /** "global": asked on every playbook unless the playbook turns it off. "playbook": only where a playbook turns it on. */
  scope: "global" | "playbook";
  retired: boolean;
}

export const PROMPT_LIBRARY_SCHEMA = "mogmine.prompt_library.v1" as const;
export const SEED_PROMPTS_VERSION = 1;

/** The whole library: one document, seeded from code constants and edited by the owner. */
export interface PromptLibraryV1 {
  schema: "mogmine.prompt_library.v1";
  user_id: string;
  /** Highest seed set merged so far. */
  seeds_version: number;
  shared_reasons: ReasonChip[]; // docs/25: Gut, News soon, Tired / tilted, Daily limit close
  /** Ordered: library order is ask order when several prompts fire on one trade. */
  prompts: ReviewPrompt[];
}

export interface PendingAsk {
  prompt: ReviewPrompt;
  /** The specific deviation that triggered this ask (null for unconditioned "always" prompts). */
  deviation: DeviationKind | null;
  trade_id?: string;
}

/**
 * Default trigger specification for each CallKind in the seed prompt library (docs/04 §2.5).
 */
export function defaultTriggerForKind(kind: CallKind): PromptTrigger {
  switch (kind) {
    case "cut":
      return { on: "deviation", deviations: ["exit_before_target_loss"] };
    case "early_take":
      return { on: "deviation", deviations: ["exit_before_target_profit"] };
    case "stop_here":
      return { on: "always", when: "stop_set" };
    case "hold":
      return { on: "deviation", deviations: ["exit_beyond_target"] };
    case "size":
      return { on: "deviation", deviations: ["size_off_normal"] };
    case "flip":
      return { on: "deviation", deviations: ["against_signal"] };
    case "skip":
      return { on: "deviation", deviations: ["setup_not_taken"] };
  }
}

/**
 * Seed default review prompt library for a user (Invariant 7: ALWAYS sets user_id).
 * Populates stable `seed:*` IDs for all 7 CallKinds and shared reasons.
 */
export function seedPromptLibrary(userId: string): PromptLibraryV1 {
  const prompts: ReviewPrompt[] = CALL_KINDS.map((spec) => {
    const kind = spec.kind;
    const reasons: ReasonChip[] = spec.reasons.map(([key, label, family]) => ({
      id: seedReasonId(kind, key),
      label,
      family,
      retired: false,
    }));

    return {
      id: `seed:${kind}`,
      user_id: userId,
      seed_id: `seed:${kind}`,
      seed_version: SEED_PROMPTS_VERSION,
      answer_shape: "call",
      kind,
      primary: true,
      question: spec.prompt,
      reasons,
      include_shared_reasons: true,
      ask_conviction: true,
      trigger: defaultTriggerForKind(kind),
      scope: "global",
      retired: false,
    };
  });

  return {
    schema: PROMPT_LIBRARY_SCHEMA,
    user_id: userId,
    seeds_version: SEED_PROMPTS_VERSION,
    shared_reasons: sharedReasonChips(),
    prompts,
  };
}

/**
 * Check whether any stop movement in the trade tightened risk.
 * Examines stated stop moves if present; otherwise inspects initial-to-current stop difference.
 * Invariant: returns false if initial_stop_price is null (pre-R-10 records).
 */
export function isStopTightened(
  trade: Pick<TradeRecord, "direction" | "entry_price"> &
    Partial<Pick<TradeRecord, "symbol" | "initial_stop_price" | "stop_loss_price" | "stop_moves">>,
): boolean {
  if (trade.initial_stop_price == null) return false;
  const sign = (trade.direction as string).toUpperCase() === "SHORT" ? -1 : 1;
  const spec = trade.symbol ? specFor(trade.symbol) : null;
  const tickSize = spec?.tickSize ?? 0.25;

  const moves = trade.stop_moves;
  if (moves && moves.length > 0) {
    let current = trade.initial_stop_price;
    for (const move of moves) {
      const diffTicks = Math.round((move.price - current) / tickSize);
      if (diffTicks * sign >= 1) {
        return true;
      }
      current = move.price;
    }
    return false;
  }

  if (trade.stop_loss_price != null && trade.stop_loss_price !== trade.initial_stop_price) {
    const diffTicks = Math.round((trade.stop_loss_price - trade.initial_stop_price) / tickSize);
    return diffTicks * sign >= 1;
  }

  return false;
}

export interface DeviationOptions {
  /** Slippage tolerance in ticks for considering an exit "at the plan" (OD-DP-07). Default 1. */
  at_plan_tolerance_ticks?: number;
}

/**
 * Pure deviation detector (docs/playbook-design/04 §2.1).
 * Inspects execution facts in integer ticks (guardrail 4) and returns all detected plan departures.
 * Reads exit_price, planned_target_price, initial_stop_price, stop_loss_price, stop_moves, and hasWidenedStop.
 */
export function detectDeviations(
  trade: TradeRecord,
  options?: DeviationOptions,
): DeviationKind[] {
  const deviations: DeviationKind[] = [];
  const tolerance = options?.at_plan_tolerance_ticks ?? 1;

  // 1. Stop presence and movements
  const hasInitialStop = trade.initial_stop_price != null;
  const hasWorkingStop = trade.stop_loss_price != null;
  const hasAnyStop = hasInitialStop || hasWorkingStop;

  if (hasAnyStop) {
    deviations.push("stop_set");
  } else {
    deviations.push("no_stop");
  }

  if (hasInitialStop) {
    const normalizedTrade = {
      ...trade,
      direction: (trade.direction as string).toUpperCase() as "LONG" | "SHORT",
    };
    if (hasWidenedStop(normalizedTrade)) {
      deviations.push("stop_widened");
    }
    if (isStopTightened(normalizedTrade)) {
      deviations.push("stop_tightened");
    }
  }

  // 2. Position size departure (if baseline recorded)
  const tradeWithAdditions = trade as unknown as {
    normal_quantity_at_selection?: number | null;
    signal_direction?: string | null;
  };

  if (
    tradeWithAdditions.normal_quantity_at_selection != null &&
    trade.quantity !== tradeWithAdditions.normal_quantity_at_selection
  ) {
    deviations.push("size_off_normal");
  }

  // 3. Direction against recorded signal
  if (
    tradeWithAdditions.signal_direction != null &&
    tradeWithAdditions.signal_direction.toUpperCase() !== (trade.direction as string).toUpperCase()
  ) {
    deviations.push("against_signal");
  }

  // 4. Exit departures (only for closed trades)
  if (trade.exit_price != null) {
    const spec = specFor(trade.symbol);
    const tickSize = spec?.tickSize ?? 0.25;
    const sign = (trade.direction as string).toUpperCase() === "SHORT" ? -1 : 1;

    const entryTicks = Math.round(trade.entry_price / tickSize);
    const exitTicks = Math.round(trade.exit_price / tickSize);
    const pnlTicks = (exitTicks - entryTicks) * sign;

    const targetTicks =
      trade.planned_target_price != null
        ? Math.round(trade.planned_target_price / tickSize)
        : null;

    const workingStopPrice = trade.stop_loss_price ?? trade.initial_stop_price;
    const stopTicks =
      workingStopPrice != null ? Math.round(workingStopPrice / tickSize) : null;

    // Check exit beyond target (hold)
    if (targetTicks != null) {
      const distBeyondTarget = (exitTicks - targetTicks) * sign;
      if (distBeyondTarget > tolerance) {
        deviations.push("exit_beyond_target");
      }
    }

    // Check early exit (cut or early take)
    // Stated exit reasons "target", "stop", or "trail" suppress early exit detection
    const isSuppressedByExitReason =
      trade.exit_reason === "target" ||
      trade.exit_reason === "stop" ||
      trade.exit_reason === "trail";

    if (!isSuppressedByExitReason) {
      const hasPlan = targetTicks != null || stopTicks != null;

      if (hasPlan) {
        const isAtTarget =
          targetTicks != null && Math.abs(exitTicks - targetTicks) <= tolerance;
        const isAtStop =
          stopTicks != null && Math.abs(exitTicks - stopTicks) <= tolerance;

        // Stopped out or past stop on loss side
        const isPastStop =
          stopTicks != null && (exitTicks - stopTicks) * sign < -tolerance;

        if (!isAtTarget && !isAtStop && !isPastStop) {
          // If only a stop is known and the trade is in profit, "early" has no meaning
          const onlyStopInProfit = targetTicks == null && stopTicks != null && pnlTicks > 0;

          if (!onlyStopInProfit) {
            const isInsideTarget =
              targetTicks == null || (targetTicks - exitTicks) * sign > tolerance;
            const isInsideStop =
              stopTicks == null || (exitTicks - stopTicks) * sign > tolerance;

            if (isInsideTarget && isInsideStop) {
              if (pnlTicks > 0) {
                deviations.push("exit_before_target_profit");
              } else {
                // Scratch (0 ticks) counts as loss (cut) per OD-DP-07
                deviations.push("exit_before_target_loss");
              }
            }
          }
        }
      }
    }
  }

  // Deduplicate while preserving insertion order
  return Array.from(new Set(deviations));
}

export interface PendingAsksOptions {
  /** Explicit deviations if already computed; otherwise runs detectDeviations(trade). */
  deviations?: DeviationKind[];
  /** Maximum number of asks to return (budget). */
  maxAsks?: number;
}

/**
 * Determine pending review asks for a trade (docs/playbook-design/04 §2.2).
 * Returns ordered, unanswered prompts whose trigger matches detected deviations or `always`,
 * excluding retired prompts and already-answered kinds.
 */
export function pendingAsks(
  trade: TradeRecord,
  library: PromptLibraryV1,
  existingCalls?:
    | DiscretionCall[]
    | { calls?: DiscretionCall[]; dismissals?: PromptDismissal[] },
  options?: PendingAsksOptions,
): PendingAsk[] {
  const deviations = options?.deviations ?? detectDeviations(trade);

  const calls: DiscretionCall[] = Array.isArray(existingCalls)
    ? existingCalls
    : (existingCalls?.calls ?? []);
  const dismissals: PromptDismissal[] = Array.isArray(existingCalls)
    ? []
    : (existingCalls?.dismissals ?? []);

  // Collect answered kinds and prompt IDs on this trade
  const answeredKinds = new Set<CallKind>();
  const answeredPromptIds = new Set<string>();

  for (const call of calls) {
    if (!call.trade_id || call.trade_id === trade.id) {
      if (call.kind) answeredKinds.add(call.kind);
      if (call.prompt_id) answeredPromptIds.add(call.prompt_id);
    }
  }

  // Collect permanently dismissed prompt IDs ("not_a_call")
  const dismissedPromptIds = new Set<string>();
  for (const dismissal of dismissals) {
    if (dismissal.trade_id === trade.id && dismissal.reason === "not_a_call") {
      dismissedPromptIds.add(dismissal.prompt_id);
    }
  }

  const deviationAsks: PendingAsk[] = [];
  const alwaysAsks: PendingAsk[] = [];
  const seenKinds = new Set<CallKind>();

  for (const prompt of library.prompts) {
    if (prompt.retired) continue;
    if (prompt.answer_shape !== "call") continue;
    if (prompt.kind && answeredKinds.has(prompt.kind)) continue;
    if (answeredPromptIds.has(prompt.id)) continue;
    if (dismissedPromptIds.has(prompt.id)) continue;
    if (prompt.kind && seenKinds.has(prompt.kind)) continue;

    if (prompt.trigger.on === "deviation") {
      const matchedDev = prompt.trigger.deviations.find((d) => deviations.includes(d));
      if (matchedDev) {
        if (prompt.kind) seenKinds.add(prompt.kind);
        deviationAsks.push({
          prompt,
          deviation: matchedDev,
          trade_id: trade.id,
        });
      }
    } else if (prompt.trigger.on === "always") {
      if (prompt.trigger.when) {
        if (deviations.includes(prompt.trigger.when)) {
          if (prompt.kind) seenKinds.add(prompt.kind);
          alwaysAsks.push({
            prompt,
            deviation: prompt.trigger.when,
            trade_id: trade.id,
          });
        }
      } else {
        if (prompt.kind) seenKinds.add(prompt.kind);
        alwaysAsks.push({
          prompt,
          deviation: null,
          trade_id: trade.id,
        });
      }
    }
    // "manual" triggers are never returned as pending asks
  }

  // Deviation asks precede always asks; preserve library order within groups
  const combined = [...deviationAsks, ...alwaysAsks];

  if (options?.maxAsks != null && options.maxAsks > 0) {
    return combined.slice(0, options.maxAsks);
  }

  return combined;
}
