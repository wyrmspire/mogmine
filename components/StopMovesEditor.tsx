"use client";

import React, { useCallback, useId, useMemo, useState } from "react";
import { usePrefs } from "../lib/prefs.ts";
import { DEFAULT_TIME_ZONE, fromZonedInput, toZonedInput } from "../lib/time.ts";
import {
  FUTURES_SPECS,
  MOVED_STOP_TAG,
  isStopMoveLockingProfit,
  isStopMoveWidening,
  sanitizeStopMoves,
  specFor,
  tickDecimals,
  toTicks,
} from "../lib/trades.ts";
import type { StopMove, TradeDirection, TradeRecord } from "../lib/trades.ts";

/** Contract specifications alias matching Invariant 3 and spec documentation. */
export const CONTRACT_SPECS = FUTURES_SPECS;

/** Categorisation of a stop movement relative to prior stop and entry. */
export type StopMoveKind = "tightened" | "breakeven" | "widened" | "unchanged";

export interface StopMoveDelta {
  priorPrice: number;
  price: number;
  /** Raw price change: price - priorPrice */
  deltaPoints: number;
  /** Ticks moved (positive when price increased), or null if off-grid / unknown symbol. */
  deltaTicks: number | null;
  /** Signed points in direction reducing risk (+ means risk reduced, - means risk increased). */
  riskDeltaPoints: number;
  kind: StopMoveKind;
  /** True when stop is at or beyond entry price on the winning side. */
  isLockedProfit: boolean;
  /** True when stop was moved away from entry, increasing risk. */
  isWidened: boolean;
}

export interface StopMoveDeltaItem extends StopMoveDelta {
  index: number;
  time: string;
}

/**
 * Classify a stop move as tightened, breakeven, widened, or unchanged.
 * - unchanged: movePrice === priorPrice
 * - breakeven: movePrice === entryPrice
 * - widened: stop moved away from entry (increased risk)
 * - tightened: stop moved closer to / past entry (decreased risk)
 */
export function classifyStopMove(
  priorPrice: number,
  movePrice: number,
  entryPrice: number,
  direction: TradeDirection,
  symbol?: string,
): StopMoveKind {
  const spec = symbol ? specFor(symbol) : null;
  const tolerance = spec ? spec.tickSize / 2 : 1e-4;

  if (Math.abs(movePrice - priorPrice) < tolerance) {
    return "unchanged";
  }
  if (Math.abs(movePrice - entryPrice) < tolerance) {
    return "breakeven";
  }
  if (isStopMoveWidening(priorPrice, movePrice, direction, symbol)) {
    return "widened";
  }
  return "tightened";
}

/**
 * Compute delta and classification for a single stop price change.
 */
export function computeStopMoveDelta(
  priorPrice: number,
  movePrice: number,
  entryPrice: number,
  direction: TradeDirection,
  symbol?: string,
): StopMoveDelta {
  const spec = symbol ? specFor(symbol) : null;
  const sign = direction === "LONG" ? 1 : direction === "SHORT" ? -1 : 1;
  const deltaPoints = Number((movePrice - priorPrice).toFixed(4));
  const deltaTicks = spec ? Math.round((movePrice - priorPrice) / spec.tickSize) : null;
  const riskDeltaPoints = Number(((movePrice - priorPrice) * sign).toFixed(4));
  const kind = classifyStopMove(priorPrice, movePrice, entryPrice, direction, symbol);
  const isWidened = kind === "widened";
  const isLockedProfit = isStopMoveLockingProfit(entryPrice, movePrice, direction, symbol);

  return {
    priorPrice,
    price: movePrice,
    deltaPoints,
    deltaTicks,
    riskDeltaPoints,
    kind,
    isLockedProfit,
    isWidened,
  };
}

/**
 * Compute per-row deltas for all stop moves on a trade.
 * Row 0 compares against initial_stop_price (or stop_loss_price / entry_price).
 * Row i compares against Row i - 1.
 */
export function computeStopMoveDeltas(
  trade: Pick<TradeRecord, "entry_price" | "direction"> &
    Partial<Pick<TradeRecord, "symbol" | "initial_stop_price" | "stop_loss_price">>,
  moves: StopMove[],
): StopMoveDeltaItem[] {
  const deltas: StopMoveDeltaItem[] = [];
  let priorPrice = trade.initial_stop_price ?? trade.stop_loss_price ?? trade.entry_price;

  for (let i = 0; i < moves.length; i++) {
    const move = moves[i];
    const delta = computeStopMoveDelta(
      priorPrice,
      move.price,
      trade.entry_price,
      trade.direction,
      trade.symbol,
    );
    deltas.push({
      index: i,
      time: move.time,
      ...delta,
    });
    priorPrice = move.price;
  }

  return deltas;
}

/**
 * Pure selector checking if any stop move widened risk relative to its prior stop.
 */
export function detectMovesWidening(
  trade: Pick<TradeRecord, "entry_price" | "direction"> &
    Partial<Pick<TradeRecord, "symbol" | "initial_stop_price" | "stop_loss_price">>,
  moves: StopMove[],
): boolean {
  if (!moves || moves.length === 0) return false;
  let priorPrice = trade.initial_stop_price ?? trade.stop_loss_price ?? trade.entry_price;
  for (const move of moves) {
    if (isStopMoveWidening(priorPrice, move.price, trade.direction, trade.symbol)) {
      return true;
    }
    priorPrice = move.price;
  }
  return false;
}

/**
 * Returns the tick size for a futures symbol (defaults to 0.25).
 */
export function getTickSize(symbol: string): number {
  return specFor(symbol)?.tickSize ?? 0.25;
}

/**
 * Nudge a price by a given number of ticks, rounded to the tick grid.
 */
export function stepPrice(currentPrice: number, steps: number, symbol: string): number {
  const spec = specFor(symbol);
  if (!spec || !Number.isFinite(currentPrice) || !Number.isFinite(steps)) return currentPrice;
  const decimals = tickDecimals(spec.tickSize);
  const currentTicks = Math.round(currentPrice / spec.tickSize);
  const nextTicks = currentTicks + Math.trunc(steps);
  return Number((nextTicks * spec.tickSize).toFixed(decimals));
}

/**
 * Add a new stop move and return a sanitized, chronologically sorted array.
 */
export function addStopMoveItem(moves: StopMove[], newMove: StopMove): StopMove[] {
  return sanitizeStopMoves([...moves, newMove]);
}

/**
 * Remove a stop move by index and return a sanitized array.
 */
export function removeStopMoveItem(moves: StopMove[], index: number): StopMove[] {
  if (index < 0 || index >= moves.length) return [...moves];
  return sanitizeStopMoves(moves.filter((_, i) => i !== index));
}

/**
 * Update a stop move by index and return a sanitized array.
 */
export function updateStopMoveItem(
  moves: StopMove[],
  index: number,
  patch: Partial<StopMove>,
): StopMove[] {
  if (index < 0 || index >= moves.length) return [...moves];
  const updated = moves.map((m, i) => (i === index ? { ...m, ...patch } : m));
  return sanitizeStopMoves(updated);
}

export interface StopMovesEditorProps {
  trade: TradeRecord;
  onChange: (moves: StopMove[]) => void;
  onSuggestMovedStop?: () => void;
  className?: string;
}

/**
 * Interactive "I moved my stop" Editor component (issue #36, G2-UI).
 * Allows viewing, stepping (+/- 1 tick), editing timestamps, adding, and removing stop movements.
 * Highlights deltas (tightened, breakeven, widened, profit locked) and displays a non-destructive
 * "Moved Stop" suggestion banner when risk was widened (UX-33).
 */
export function StopMovesEditor({
  trade,
  onChange,
  onSuggestMovedStop,
  className = "",
}: StopMovesEditorProps) {
  const prefs = usePrefs();
  const zone = prefs?.timeZone ?? DEFAULT_TIME_ZONE;
  const tickSize = getTickSize(trade.symbol);
  const decimals = tickDecimals(tickSize);

  const moves = useMemo(() => trade.stop_moves ?? [], [trade.stop_moves]);
  const deltas = useMemo(() => computeStopMoveDeltas(trade, moves), [trade, moves]);
  const isWidened = useMemo(() => detectMovesWidening(trade, moves), [trade, moves]);
  const hasMovedStopTag = trade.quick_tags.includes(MOVED_STOP_TAG);

  // Default seed price for a new move
  const defaultNewPrice = useMemo(() => {
    if (moves.length > 0) {
      return moves[moves.length - 1].price;
    }
    return trade.stop_loss_price ?? trade.initial_stop_price ?? trade.entry_price;
  }, [moves, trade.stop_loss_price, trade.initial_stop_price, trade.entry_price]);

  // Form draft state for adding a move
  const [newPriceText, setNewPriceText] = useState<string>(() => defaultNewPrice.toFixed(decimals));
  const [newTimeZoned, setNewTimeZoned] = useState<string>(() => {
    const seedTime =
      moves.length > 0
        ? new Date(Date.parse(moves[moves.length - 1].time) + 60_000)
        : trade.exit_time
        ? new Date((Date.parse(trade.entry_time) + Date.parse(trade.exit_time)) / 2)
        : new Date();
    return toZonedInput(seedTime, zone);
  });
  const [addError, setAddError] = useState<string | null>(null);

  const priceInputId = useId();
  const timeInputId = useId();

  // Nudge price on an existing row
  const handleStepRow = useCallback(
    (index: number, steps: number) => {
      const current = moves[index];
      if (!current) return;
      const nextPrice = stepPrice(current.price, steps, trade.symbol);
      const nextMoves = updateStopMoveItem(moves, index, { price: nextPrice });
      onChange(nextMoves);
    },
    [moves, trade.symbol, onChange],
  );

  // Update timestamp on an existing row
  const handleRowTimeChange = useCallback(
    (index: number, zonedValue: string) => {
      const date = fromZonedInput(zonedValue, zone);
      if (Number.isNaN(date.getTime())) return;
      const nextMoves = updateStopMoveItem(moves, index, { time: date.toISOString() });
      onChange(nextMoves);
    },
    [moves, zone, onChange],
  );

  // Remove a row
  const handleRemoveRow = useCallback(
    (index: number) => {
      const nextMoves = removeStopMoveItem(moves, index);
      onChange(nextMoves);
    },
    [moves, onChange],
  );

  // Nudge new draft price
  const handleStepNewPrice = useCallback(
    (steps: number) => {
      const parsed = parseFloat(newPriceText);
      const base = Number.isFinite(parsed) ? parsed : defaultNewPrice;
      const next = stepPrice(base, steps, trade.symbol);
      setNewPriceText(next.toFixed(decimals));
      setAddError(null);
    },
    [newPriceText, defaultNewPrice, trade.symbol, decimals],
  );

  // Set new draft time to now
  const handleSetTimeToNow = useCallback(() => {
    setNewTimeZoned(toZonedInput(new Date(), zone));
  }, [zone]);

  // Add the draft move
  const handleAddMove = useCallback(() => {
    const priceNum = parseFloat(newPriceText);
    if (!Number.isFinite(priceNum) || priceNum <= 0) {
      setAddError("Enter a valid price");
      return;
    }
    const ticks = toTicks(priceNum, trade.symbol);
    if (ticks == null) {
      setAddError(`Price must align with ${tickSize} tick grid`);
      return;
    }
    const date = fromZonedInput(newTimeZoned, zone);
    if (Number.isNaN(date.getTime())) {
      setAddError("Select a valid date & time");
      return;
    }

    const newMove: StopMove = {
      price: priceNum,
      time: date.toISOString(),
    };

    const nextMoves = addStopMoveItem(moves, newMove);
    onChange(nextMoves);

    // Reset draft for next entry
    setAddError(null);
    setNewPriceText(priceNum.toFixed(decimals));
    setNewTimeZoned(toZonedInput(new Date(date.getTime() + 60_000), zone));
  }, [newPriceText, newTimeZoned, trade.symbol, tickSize, decimals, zone, moves, onChange]);

  return (
    <div
      className={`stop-moves-editor ${className}`}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        padding: "14px",
        background: "var(--bg-elevated, #10131b)",
        borderRadius: "14px",
        border: "1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))",
        boxShadow: "inset 0 1px 0 0 rgba(234, 179, 8, 0.2)",
        maxWidth: "100%",
        boxSizing: "border-box",
      }}
    >
      {/* Header bar */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "8px",
        }}
      >
        <div>
          <span
            style={{
              display: "block",
              fontSize: "0.6875rem",
              fontWeight: 800,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--gold-mid, #eab308)",
            }}
          >
            Stop Path · &quot;I Moved My Stop&quot;
          </span>
          <h4
            style={{
              margin: 0,
              fontSize: "0.9375rem",
              fontWeight: 700,
              color: "var(--text-primary, #f1f5f9)",
            }}
          >
            Stop Adjustments
          </h4>
        </div>

        {trade.initial_stop_price != null && (
          <span
            style={{
              fontSize: "0.75rem",
              color: "var(--text-muted, #94a3b8)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            Initial: <strong style={{ color: "var(--text-primary, #f1f5f9)" }}>{trade.initial_stop_price.toFixed(decimals)}</strong> (frozen)
          </span>
        )}
      </div>

      {/* Widened Stop Suggestion Banner (UX-33) */}
      {isWidened && (
        <div
          role="alert"
          style={{
            padding: "10px 12px",
            background: "rgba(248, 113, 113, 0.12)",
            border: "1px solid rgba(248, 113, 113, 0.35)",
            borderRadius: "10px",
            display: "flex",
            flexDirection: "column",
            gap: "8px",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
            <span
              style={{
                fontSize: "0.75rem",
                fontWeight: 800,
                color: "#f87171",
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                letterSpacing: "0.02em",
              }}
            >
              ⚠ Moved Stop (widened)
            </span>
            {hasMovedStopTag ? (
              <span
                style={{
                  fontSize: "0.6875rem",
                  padding: "2px 8px",
                  borderRadius: "6px",
                  background: "rgba(248, 113, 113, 0.2)",
                  color: "#fca5a5",
                  fontWeight: 650,
                }}
              >
                ✓ Tagged
              </span>
            ) : onSuggestMovedStop ? (
              <button
                type="button"
                onClick={onSuggestMovedStop}
                style={{
                  minHeight: "44px",
                  minWidth: "44px",
                  padding: "0 12px",
                  borderRadius: "8px",
                  border: "1px solid #f87171",
                  background: "rgba(248, 113, 113, 0.2)",
                  color: "#fecaca",
                  fontSize: "0.75rem",
                  fontWeight: 750,
                  cursor: "pointer",
                }}
                aria-label="Add Moved Stop tag suggestion"
              >
                + Moved Stop
              </button>
            ) : null}
          </div>
          <p
            style={{
              margin: 0,
              fontSize: "0.75rem",
              lineHeight: 1.35,
              color: "#fca5a5",
            }}
          >
            A stop adjustment increased risk during this trade. Tag suggestion helps track trade rule adherence without mutating historical entry data.
          </p>
        </div>
      )}

      {/* Recorded Stop Moves List */}
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {moves.length === 0 ? (
          <div
            style={{
              padding: "16px 12px",
              textAlign: "center",
              background: "var(--bg-inset, rgba(0, 0, 0, 0.2))",
              borderRadius: "10px",
              border: "1px dashed var(--border-subtle, rgba(255, 255, 255, 0.08))",
              color: "var(--text-muted, #94a3b8)",
              fontSize: "0.8125rem",
            }}
          >
            No stop movements recorded. If you adjusted your stop during the trade, record each step below.
          </div>
        ) : (
          deltas.map((item) => {
            const rowZonedTime = toZonedInput(new Date(item.time), zone);
            const isLong = trade.direction === "LONG";
            const pointsText = (item.deltaPoints > 0 ? `+${item.deltaPoints.toFixed(decimals)}` : item.deltaPoints.toFixed(decimals)) + " pts";
            const ticksText = item.deltaTicks != null ? (item.deltaTicks > 0 ? `+${item.deltaTicks}t` : `${item.deltaTicks}t`) : "";

            let kindBadgeColor = "var(--text-muted, #94a3b8)";
            let kindBadgeBg = "rgba(255, 255, 255, 0.05)";
            let kindLabel = "Unchanged";
            let kindIcon = "—";

            if (item.kind === "widened") {
              kindBadgeColor = "#f87171";
              kindBadgeBg = "rgba(248, 113, 113, 0.15)";
              kindLabel = "Widened";
              kindIcon = "⚠";
            } else if (item.kind === "breakeven") {
              kindBadgeColor = "var(--gold-mid, #eab308)";
              kindBadgeBg = "rgba(234, 179, 8, 0.15)";
              kindLabel = "Breakeven";
              kindIcon = "⇄";
            } else if (item.kind === "tightened") {
              kindBadgeColor = "#34d399";
              kindBadgeBg = "rgba(52, 211, 153, 0.15)";
              kindLabel = item.isLockedProfit ? "Profit Locked" : "Tightened";
              kindIcon = isLong ? "▲" : "▼";
            }

            return (
              <div
                key={`stop-move-${item.index}`}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "8px",
                  padding: "10px 12px",
                  background: "var(--bg-surface, rgba(255, 255, 255, 0.03))",
                  border: "1px solid var(--border-subtle, rgba(255, 255, 255, 0.06))",
                  borderRadius: "10px",
                }}
              >
                {/* Top sub-row: index, kind badge, remove button */}
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: "8px",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <span
                      style={{
                        fontSize: "0.6875rem",
                        fontWeight: 800,
                        padding: "2px 6px",
                        borderRadius: "4px",
                        background: "var(--bg-inset, rgba(0, 0, 0, 0.3))",
                        color: "var(--text-muted, #94a3b8)",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      #{item.index + 1}
                    </span>
                    <span
                      style={{
                        fontSize: "0.6875rem",
                        fontWeight: 750,
                        padding: "2px 8px",
                        borderRadius: "6px",
                        background: kindBadgeBg,
                        color: kindBadgeColor,
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "4px",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      <span>{kindIcon}</span>
                      <span>{kindLabel}</span>
                      {item.kind !== "unchanged" && <span>({pointsText} {ticksText})</span>}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleRemoveRow(item.index)}
                    aria-label={`Remove stop move ${item.index + 1}`}
                    style={{
                      minWidth: "44px",
                      minHeight: "44px",
                      background: "none",
                      border: "none",
                      color: "var(--text-faint, #64748b)",
                      fontSize: "0.75rem",
                      fontWeight: 650,
                      cursor: "pointer",
                      padding: "0 8px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    Remove
                  </button>
                </div>

                {/* Bottom sub-row: tick steppers + price display + time input */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "44px minmax(0, 1fr) 44px minmax(0, 1.25fr)",
                    gap: "6px",
                    alignItems: "center",
                  }}
                >
                  <button
                    type="button"
                    className="tick-step"
                    aria-label={`Decrease stop move ${item.index + 1} by one tick`}
                    onClick={() => handleStepRow(item.index, -1)}
                    style={{
                      minWidth: "44px",
                      minHeight: "44px",
                      cursor: "pointer",
                    }}
                  >
                    −
                  </button>

                  <div
                    style={{
                      textAlign: "center",
                      fontVariantNumeric: "tabular-nums",
                      fontSize: "1rem",
                      fontWeight: 750,
                      color: "var(--text-primary, #f1f5f9)",
                    }}
                  >
                    {item.price.toFixed(decimals)}
                  </div>

                  <button
                    type="button"
                    className="tick-step"
                    aria-label={`Increase stop move ${item.index + 1} by one tick`}
                    onClick={() => handleStepRow(item.index, 1)}
                    style={{
                      minWidth: "44px",
                      minHeight: "44px",
                      cursor: "pointer",
                    }}
                  >
                    +
                  </button>

                  <input
                    type="datetime-local"
                    value={rowZonedTime}
                    onChange={(e) => handleRowTimeChange(item.index, e.target.value)}
                    aria-label={`Time for stop move ${item.index + 1}`}
                    style={{
                      minHeight: "44px",
                      borderRadius: "8px",
                      border: "1px solid var(--border-subtle, rgba(255, 255, 255, 0.1))",
                      background: "var(--bg-inset, rgba(0, 0, 0, 0.25))",
                      color: "var(--text-primary, #f1f5f9)",
                      fontSize: "0.75rem",
                      padding: "4px 6px",
                      boxSizing: "border-box",
                      width: "100%",
                      outline: "none",
                    }}
                  />
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Add New Stop Move Section */}
      <div
        style={{
          marginTop: "4px",
          padding: "12px",
          borderRadius: "10px",
          background: "var(--bg-surface, rgba(255, 255, 255, 0.02))",
          border: "1px solid var(--border-subtle, rgba(255, 255, 255, 0.06))",
          display: "flex",
          flexDirection: "column",
          gap: "10px",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span
            style={{
              fontSize: "0.75rem",
              fontWeight: 750,
              color: "var(--text-primary, #f1f5f9)",
            }}
          >
            + Add Stop Movement
          </span>
          <button
            type="button"
            onClick={handleSetTimeToNow}
            style={{
              minHeight: "44px",
              padding: "0 10px",
              borderRadius: "6px",
              border: "1px solid var(--border-subtle, rgba(255, 255, 255, 0.1))",
              background: "var(--bg-elevated, rgba(255, 255, 255, 0.05))",
              color: "var(--gold-mid, #eab308)",
              fontSize: "0.6875rem",
              fontWeight: 700,
              cursor: "pointer",
            }}
            aria-label="Set new stop move time to now"
          >
            Now
          </button>
        </div>

        {/* Input ladder for new move: - / input / + / time */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "44px minmax(0, 1fr) 44px minmax(0, 1.25fr)",
            gap: "6px",
            alignItems: "center",
          }}
        >
          <button
            type="button"
            className="tick-step"
            onClick={() => handleStepNewPrice(-1)}
            aria-label="Step new stop price down one tick"
            style={{ minWidth: "44px", minHeight: "44px", cursor: "pointer" }}
          >
            −
          </button>

          <input
            id={priceInputId}
            type="number"
            inputMode="decimal"
            step={tickSize}
            value={newPriceText}
            onChange={(e) => {
              setNewPriceText(e.target.value);
              setAddError(null);
            }}
            aria-label="New stop loss price"
            placeholder={defaultNewPrice.toFixed(decimals)}
            style={{
              width: "100%",
              minHeight: "44px",
              borderRadius: "8px",
              border: "1px solid var(--border-subtle, rgba(255, 255, 255, 0.15))",
              background: "var(--bg-inset, rgba(0, 0, 0, 0.3))",
              color: "var(--text-primary, #f1f5f9)",
              fontSize: "0.9375rem",
              fontWeight: 700,
              textAlign: "center",
              fontVariantNumeric: "tabular-nums",
              boxSizing: "border-box",
              padding: "4px 6px",
              outline: "none",
            }}
          />

          <button
            type="button"
            className="tick-step"
            onClick={() => handleStepNewPrice(1)}
            aria-label="Step new stop price up one tick"
            style={{ minWidth: "44px", minHeight: "44px", cursor: "pointer" }}
          >
            +
          </button>

          <input
            id={timeInputId}
            type="datetime-local"
            value={newTimeZoned}
            onChange={(e) => {
              setNewTimeZoned(e.target.value);
              setAddError(null);
            }}
            aria-label="New stop move timestamp"
            style={{
              minHeight: "44px",
              borderRadius: "8px",
              border: "1px solid var(--border-subtle, rgba(255, 255, 255, 0.1))",
              background: "var(--bg-inset, rgba(0, 0, 0, 0.25))",
              color: "var(--text-primary, #f1f5f9)",
              fontSize: "0.75rem",
              padding: "4px 6px",
              boxSizing: "border-box",
              width: "100%",
              outline: "none",
            }}
          />
        </div>

        {addError && (
          <span
            style={{
              fontSize: "0.6875rem",
              color: "var(--risk-crimson, #f87171)",
              fontWeight: 650,
            }}
          >
            {addError}
          </span>
        )}

        <button
          type="button"
          onClick={handleAddMove}
          style={{
            minHeight: "44px",
            width: "100%",
            borderRadius: "10px",
            border: "1px solid var(--border-strong, rgba(234, 179, 8, 0.4))",
            background: "var(--bg-elevated, rgba(234, 179, 8, 0.12))",
            color: "var(--gold-mid, #eab308)",
            fontSize: "0.8125rem",
            fontWeight: 750,
            letterSpacing: "0.02em",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "6px",
          }}
          aria-label="Record stop movement"
        >
          <span>+ Record Stop Move</span>
        </button>
      </div>
    </div>
  );
}

export default StopMovesEditor;
