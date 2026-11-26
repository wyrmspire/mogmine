"use client";

import { useState } from "react";
import type { CSSProperties } from "react";
import { stepPriceText, zonedParts } from "@/lib/entry-form";
import type { DraftStopMove } from "@/lib/entry-form";
import { EXIT_REASONS, MOVED_STOP_TAG, specFor } from "@/lib/trades";
import type { TradeExitReason } from "@/lib/trades";

interface EntryStopMovesProps {
  symbol: string;
  /** The initial stop text, the stop the trade starts at. */
  stopPrice: string;
  entryPrice: string;
  /** The exit clock, or null for a trade still open (the new row then defaults to now). */
  exitClock: string | null;
  zone: string;
  rows: DraftStopMove[];
  /** The first row problem, shown inline. */
  error: string | null;
  widened: boolean;
  quickTags: string[];
  onRows: (rows: DraftStopMove[]) => void;
  onAcceptTag: () => void;
}

/** Shared by the "How did it end?" chips and any other exit-reason picker (issue #36 G1). */
export function EntryExitReasonRow({ value, onChange }: { value: TradeExitReason | null | undefined; onChange: (reason: TradeExitReason | null) => void }) {
  return (
    <div className="exit-reason-section">
      <div className="exit-reason-head">
        <span className="exit-reason-title">How did it end? <i>optional</i></span>
      </div>
      <div className="chip-row" role="group" aria-label="How did it end?">
        {EXIT_REASONS.map((reason) => {
          const selected = value === reason.value;
          return (
            <button
              key={reason.value}
              type="button"
              className="chip"
              aria-pressed={selected}
              aria-label={`Exit reason: ${reason.label}`}
              onClick={() => onChange(selected ? null : reason.value)}
            >
              {reason.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const TAP: CSSProperties = { minWidth: 44, minHeight: 44 };

/**
 * "I moved my stop" (optional, issue #36 G2). Collapsed when there are no rows so fast entry stays
 * uncluttered. A widened stop offers the "Moved Stop" tag as a suggestion the trader accepts by tapping
 * (UX-33): nothing is applied on its own.
 */
export function EntryStopMoves({ symbol, stopPrice, entryPrice, exitClock, zone, rows, error, widened, quickTags, onRows, onAcceptTag }: EntryStopMovesProps) {
  const [expanded, setExpanded] = useState(() => rows.length > 0);
  const step = specFor(symbol)?.tickSize;
  const tagged = quickTags.includes(MOVED_STOP_TAG);
  const setRow = (index: number, patch: Partial<DraftStopMove>) => onRows(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  const addRow = () => {
    // Pre-filled: the clock from the exit (or now for an open trade), the price from the last stop or breakeven.
    const clock = exitClock ?? zonedParts(new Date(), zone).clock;
    const previous = rows.length > 0 ? rows[rows.length - 1].price : "";
    const price = previous.trim() !== "" ? previous : entryPrice;
    setExpanded(true);
    onRows([...rows, { price, clock }]);
  };

  return (
    <div className="stop-moves-section">
      <button type="button" className="chip" aria-expanded={expanded} onClick={() => setExpanded(!expanded)} style={{ minHeight: 44 }}>
        I moved my stop (optional){rows.length > 0 && <span className="stop-moves-count" style={{ fontVariantNumeric: "tabular-nums", marginLeft: 6 }}>{rows.length}</span>}
      </button>
      {!expanded && error && <span className="error" role="alert">{error}</span>}
      {expanded && (
        <div className="stop-moves-body" style={{ display: "grid", gap: 8, paddingTop: 8 }}>
          {rows.map((row, index) => {
            const n = index + 1;
            return (
              <div key={index} className="stop-move-row" style={{ display: "grid", gridTemplateColumns: "44px minmax(0, 1fr) 44px", gap: 6, alignItems: "center" }}>
                <button type="button" className="tick-step" style={TAP} aria-label={`Stop move ${n} down one tick`} onClick={() => setRow(index, { price: stepPriceText(row.price, -1, symbol, entryPrice) })}>−</button>
                <input inputMode="decimal" type="number" step={step} aria-label={`Stop move ${n} price`} placeholder="new stop" value={row.price} style={{ minHeight: 44, fontVariantNumeric: "tabular-nums" }} onChange={(event) => setRow(index, { price: event.target.value })} />
                <button type="button" className="tick-step" style={TAP} aria-label={`Stop move ${n} up one tick`} onClick={() => setRow(index, { price: stepPriceText(row.price, 1, symbol, entryPrice) })}>+</button>
                <input type="time" step={60} aria-label={`Stop move ${n} time`} value={row.clock} style={{ minHeight: 44, fontVariantNumeric: "tabular-nums", gridColumn: "2 / 3" }} onChange={(event) => setRow(index, { clock: event.target.value })} />
                <button type="button" className="now-button" style={{ ...TAP, gridColumn: "3 / 4" }} aria-label={`Remove stop move ${n}`} onClick={() => onRows(rows.filter((_, i) => i !== index))}>Remove</button>
              </div>
            );
          })}
          <button type="button" className="now-button" style={{ ...TAP, justifySelf: "start" }} onClick={addRow}>+ Add stop move</button>
          {stopPrice.trim() === "" && rows.length > 0 && <span className="hint">Enter the initial stop above first.</span>}
          {error && <span className="error" role="alert">{error}</span>}
          {widened && !tagged && (
            <button type="button" className="chip" aria-pressed={false} onClick={onAcceptTag} style={{ minHeight: 44, justifySelf: "start" }}>Stop widened — tag &apos;Moved Stop&apos;?</button>
          )}
        </div>
      )}
    </div>
  );
}
