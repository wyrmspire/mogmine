"use client";

import { stepPriceText, zonedParts } from "@/lib/entry-form";
import type { DraftPartialExit, DraftPartialTarget, EntryDraft } from "@/lib/entry-form";
import { usePrefs } from "@/lib/prefs";
import { EXIT_REASONS, specFor } from "@/lib/trades";

interface EntryPartialsSectionProps {
  draft: EntryDraft;
  /** First problem with the partial rows (issue #38), shown under the section. */
  error: string | null;
  onChange: (patch: Partial<EntryDraft>) => void;
}

const patchAt = <T,>(rows: T[], index: number, patch: Partial<T>): T[] => rows.map((row, i) => (i === index ? { ...row, ...patch } : row));
const dropAt = <T,>(rows: T[], index: number): T[] => rows.filter((_, i) => i !== index);
/** Every touch target is at least 44px (issue #38). */
const TAP = { minHeight: 44, minWidth: 44 } as const;
const NUMBERS = { fontVariantNumeric: "tabular-nums" } as const;

/**
 * Optional split targets and partial exits (issue #38, docs/15 §2.3–2.4). Typing stays the fast path; the tick
 * steppers nudge a price. Under Shield the contract counts are masked on screen but stay editable (#15).
 */
export function EntryPartialsSection({ draft, error, onChange }: EntryPartialsSectionProps) {
  const prefs = usePrefs();
  const targets = draft.partialTargets ?? [];
  const exits = draft.partialExits ?? [];
  const step = specFor(draft.symbol)?.tickSize;
  const qtyType = prefs.shield ? "password" : "number";
  const setTargets = (rows: DraftPartialTarget[]) => onChange({ partialTargets: rows });
  const setExits = (rows: DraftPartialExit[]) => onChange({ partialExits: rows });

  return (
    <details className="partials-section" open={targets.length + exits.length > 0 || undefined} style={{ marginTop: 12 }}>
      <summary style={{ minHeight: 44, display: "flex", alignItems: "center" }}>Split targets / partial exits <i>optional</i></summary>

      <div className="partial-group" role="group" aria-label="Split targets">
        {targets.map((row, index) => (
          <div className="price-row" key={`target-${index}`}>
            <span>T{index + 1}</span>
            <button type="button" className="tick-step" style={TAP} aria-label={`Target T${index + 1} down one tick`} onClick={() => setTargets(patchAt(targets, index, { price: stepPriceText(row.price, -1, draft.symbol, draft.entryPrice) }))}>−</button>
            <input inputMode="decimal" type="number" step={step} placeholder="target price" aria-label={`Target T${index + 1} price`} style={{ ...TAP, ...NUMBERS }} value={row.price} onChange={(event) => setTargets(patchAt(targets, index, { price: event.target.value }))} />
            <button type="button" className="tick-step" style={TAP} aria-label={`Target T${index + 1} up one tick`} onClick={() => setTargets(patchAt(targets, index, { price: stepPriceText(row.price, 1, draft.symbol, draft.entryPrice) }))}>+</button>
            <input inputMode="numeric" type={qtyType} min={1} step={1} placeholder="qty" aria-label={`Target T${index + 1} contracts`} style={{ ...TAP, ...NUMBERS }} value={row.qty} onChange={(event) => setTargets(patchAt(targets, index, { qty: event.target.value }))} />
            <button type="button" className="tick-step" style={TAP} aria-label={`Remove target T${index + 1}`} onClick={() => setTargets(dropAt(targets, index))}>×</button>
          </div>
        ))}
        <button type="button" className="now-button" style={TAP} onClick={() => setTargets([...targets, { price: "", qty: "1" }])}>+ Add target (T{targets.length + 1})</button>
      </div>

      <div className="partial-group" role="group" aria-label="Partial exits" style={{ marginTop: 8 }}>
        {exits.map((row, index) => (
          <div className="price-row" key={`exit-${index}`}>
            <span>Exit {index + 1}</span>
            <input type="time" step={60} aria-label={`Partial exit ${index + 1} time`} style={{ ...TAP, ...NUMBERS }} value={row.clock} onChange={(event) => setExits(patchAt(exits, index, { clock: event.target.value }))} />
            <button type="button" className="tick-step" style={TAP} aria-label={`Partial exit ${index + 1} down one tick`} onClick={() => setExits(patchAt(exits, index, { price: stepPriceText(row.price, -1, draft.symbol, draft.entryPrice) }))}>−</button>
            <input inputMode="decimal" type="number" step={step} placeholder="exit price" aria-label={`Partial exit ${index + 1} price`} style={{ ...TAP, ...NUMBERS }} value={row.price} onChange={(event) => setExits(patchAt(exits, index, { price: event.target.value }))} />
            <button type="button" className="tick-step" style={TAP} aria-label={`Partial exit ${index + 1} up one tick`} onClick={() => setExits(patchAt(exits, index, { price: stepPriceText(row.price, 1, draft.symbol, draft.entryPrice) }))}>+</button>
            <input inputMode="numeric" type={qtyType} min={1} step={1} placeholder="qty" aria-label={`Partial exit ${index + 1} contracts`} style={{ ...TAP, ...NUMBERS }} value={row.qty} onChange={(event) => setExits(patchAt(exits, index, { qty: event.target.value }))} />
            <select aria-label={`Partial exit ${index + 1} reason`} style={TAP} value={row.reason ?? ""} onChange={(event) => setExits(patchAt(exits, index, { reason: (event.target.value || null) as DraftPartialExit["reason"] }))}>
              <option value="">Reason</option>
              {EXIT_REASONS.map((reason) => <option key={reason.value} value={reason.value}>{reason.label}</option>)}
            </select>
            <button type="button" className="tick-step" style={TAP} aria-label={`Remove partial exit ${index + 1}`} onClick={() => setExits(dropAt(exits, index))}>×</button>
          </div>
        ))}
        <button type="button" className="now-button" style={TAP} onClick={() => setExits([...exits, { price: "", clock: zonedParts(new Date(), prefs.timeZone).clock, qty: "1", reason: null }])}>+ Add partial exit</button>
      </div>

      {error && <p className="error" role="status">{error}</p>}
    </details>
  );
}
