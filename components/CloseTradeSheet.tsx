"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { remainingOpenQty, scaleOutTradePatch } from "@/lib/entry-form";
import { formatPrice } from "@/lib/format";
import { usePrefs } from "@/lib/prefs";
import { updateTrade } from "@/lib/store";
import { fromZonedInput, toZonedInput, zoneLabel } from "@/lib/time";
import { showToast } from "@/lib/toast";
import { EXIT_REASONS, specFor, validateClose } from "@/lib/trades";
import type { TradeExitReason, TradeRecord } from "@/lib/trades";

const toNumber = (text: string) => (text.trim() === "" ? null : Number(text));

/**
 * Close an open trade (R-03b): exit time (default now), exit price, and optional exit reason (G1),
 * checked by the same rules as the entry form. With more than one contract still open, the trader closes some
 * of them (issue #38 scale-out): the rest stay open. Saving the last contracts sets `status: "closed"`, and the
 * candle signature change reloads the chart. Under Shield (#15) the contract count is masked on screen.
 */
export function CloseTradeSheet({ trade, zone, onClose }: { trade: TradeRecord; zone: string; onClose: () => void }) {
  const [exitTime, setExitTime] = useState(() => toZonedInput(new Date(), zone));
  const [exitPrice, setExitPrice] = useState("");
  const [exitReason, setExitReason] = useState<TradeExitReason | null>(null);
  const prefs = usePrefs();
  const remaining = remainingOpenQty(trade);
  const [closingText, setClosingText] = useState(() => String(remaining));
  const closing = remaining > 1 ? Number(closingText) : remaining;
  const closingOk = Number.isInteger(closing) && closing >= 1 && closing <= remaining;
  const [submitted, setSubmitted] = useState(false);
  const firstField = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    firstField.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { onClose(); return; }
      if (event.key !== "Tab") return;
      const dialog = firstField.current?.closest('[role="dialog"]');
      if (!dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled])"));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); previousFocus?.focus(); };
  }, [onClose]);

  const exit = fromZonedInput(exitTime, zone);
  const price = toNumber(exitPrice);
  const errors = validateClose(trade, exit, price);
  const hasErrors = Object.values(errors).some(Boolean);
  const show = (key: keyof typeof errors) => (submitted ? errors[key] : undefined);
  const zoneName = Number.isNaN(exit.getTime()) ? "" : zoneLabel(exit, zone);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (hasErrors || price == null || !closingOk) return;
    const patch = scaleOutTradePatch(trade, exit.toISOString(), price, closing, exitReason);
    if (!patch) return;
    updateTrade(trade.id, patch);
    showToast(closing < remaining ? `Partial exit saved — ${remaining - closing} remaining open` : "Trade closed");
    onClose();
  };

  return (
    <div className="sheet-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="sheet" role="dialog" aria-modal="true" aria-labelledby="close-trade-title">
        <div className="sheet-head">
          <div><span className="eyebrow">{trade.symbol} · entry {formatPrice(trade.entry_price, trade.symbol)}</span><h2 id="close-trade-title">Close trade</h2><p>Exit time and price fill in the result.</p></div>
          <button className="icon-button" onClick={onClose} aria-label="Close">×</button>
        </div>
        <form onSubmit={submit} noValidate>
          <div className="form-grid">
            <label className="field"><span>Exit time <i>{zoneName}</i></span>
              <input ref={firstField} type="datetime-local" value={exitTime} aria-invalid={!!show("exit_time")} onChange={(event) => setExitTime(event.target.value)} />
              {show("exit_time") && <span className="error">{show("exit_time")}</span>}
            </label>
            <label className="field"><span>Exit price</span>
              <input inputMode="decimal" type="number" step={specFor(trade.symbol)?.tickSize} value={exitPrice} aria-invalid={!!show("exit_price")} onChange={(event) => setExitPrice(event.target.value)} />
              {show("exit_price") && <span className="error">{show("exit_price")}</span>}
            </label>
          </div>
          {remaining > 1 && (
            <label className="field" style={{ marginTop: 12 }}><span>Contracts closing <i>of {remaining} open</i>{prefs.shield && <i className="shield-tag" style={{ opacity: 0.6, marginLeft: 4 }}>masked</i>}</span>
              <input inputMode="numeric" type={prefs.shield ? "password" : "number"} min={1} max={remaining} step={1} value={closingText} placeholder={prefs.shield ? "••" : String(remaining)} aria-label={prefs.shield ? "Contracts closing (masked under Shield)" : "Contracts closing"} aria-invalid={submitted && !closingOk} style={{ minHeight: 44 }} onChange={(event) => setClosingText(event.target.value)} />
              {submitted && !closingOk && <span className="error">Enter 1 to {remaining} contracts</span>}
            </label>
          )}
          <div className="exit-reason-section" style={{ marginTop: 12 }}>
            <div className="exit-reason-head">
              <span className="exit-reason-title">How did it end? <i>optional</i></span>
            </div>
            <div className="chip-row" role="group" aria-label="How did it end?">
              {EXIT_REASONS.map((reason) => {
                const selected = exitReason === reason.value;
                return (
                  <button
                    key={reason.value}
                    type="button"
                    className="chip"
                    aria-pressed={selected}
                    aria-label={`Exit reason: ${reason.label}`}
                    onClick={() => setExitReason(selected ? null : reason.value)}
                  >
                    {reason.label}
                  </button>
                );
              })}
            </div>
          </div>
          <button className="btn-primary btn-block" type="submit" style={{ marginTop: 14 }}>{closing < remaining ? "Save partial exit" : "Save exit"}</button>
        </form>
      </section>
    </div>
  );
}
