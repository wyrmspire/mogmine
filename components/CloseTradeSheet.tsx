"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { formatPrice } from "@/lib/format";
import { updateTrade } from "@/lib/store";
import { fromZonedInput, toZonedInput, zoneLabel } from "@/lib/time";
import { showToast } from "@/lib/toast";
import { closeTradePatch, specFor, validateClose } from "@/lib/trades";
import type { TradeRecord } from "@/lib/trades";

const toNumber = (text: string) => (text.trim() === "" ? null : Number(text));

/**
 * Close an open trade (R-03b): exit time (default now) and exit price, checked by the same rules as
 * the entry form. Saving sets `status: "closed"`, and the candle signature change reloads the chart.
 * Shows no size or dollars, so Shield (#15) has nothing to hide here.
 */
export function CloseTradeSheet({ trade, zone, onClose }: { trade: TradeRecord; zone: string; onClose: () => void }) {
  const [exitTime, setExitTime] = useState(() => toZonedInput(new Date(), zone));
  const [exitPrice, setExitPrice] = useState("");
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
    if (hasErrors || price == null) return;
    updateTrade(trade.id, closeTradePatch(trade, exit.toISOString(), price));
    showToast("Trade closed");
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
          <button className="btn-primary btn-block" type="submit" style={{ marginTop: 14 }}>Save exit</button>
        </form>
      </section>
    </div>
  );
}
