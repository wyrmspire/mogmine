"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";
import { formatMoney, formatPoints, formatPrice, formatR } from "@/lib/format";
import { usePrefs } from "@/lib/prefs";
import { addTrade } from "@/lib/store";
import { fromZonedInput, toZonedInput, zoneLabel } from "@/lib/time";
import { showToast } from "@/lib/toast";
import { FUTURES_SPECS, isWholeQuantity, normalizeTrade, rMultiple, snapToTick, specFor, tradePnl, tradePoints, validateTradeInput } from "@/lib/trades";
import type { TradeDirection } from "@/lib/trades";
import { closeAddTrade, keepDraft, readDraft } from "@/lib/ui";

interface Draft {
  symbol: string;
  direction: TradeDirection;
  quantity: string;
  entryTime: string;
  exitTime: string;
  entryPrice: string;
  exitPrice: string;
  stop: string;
  target: string;
  keyLevel: string;
  note: string;
}

// Kept while the app is open, so closing the sheet by accident never loses what was typed.
const DRAFT_KEY = "add-trade";

function freshDraft(zone: string): Draft {
  const exit = new Date();
  const entry = new Date(exit.getTime() - 30 * 60_000);
  return { symbol: "MES", direction: "LONG", quantity: "1", entryTime: toZonedInput(entry, zone), exitTime: toZonedInput(exit, zone), entryPrice: "", exitPrice: "", stop: "", target: "", keyLevel: "", note: "" };
}

const toNumber = (text: string) => (text.trim() === "" ? null : Number(text));

export function AddTradeSheet() {
  const router = useRouter();
  const prefs = usePrefs();
  const zone = prefs.timeZone;
  const [draft, setDraft] = useState<Draft>(() => readDraft<Draft>(DRAFT_KEY) ?? freshDraft(zone));
  const [submitted, setSubmitted] = useState(false);
  const firstField = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    firstField.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { closeAddTrade(); return; }
      if (event.key !== "Tab") return;
      const dialog = firstField.current?.closest('[role="dialog"]');
      if (!dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); previousFocus?.focus(); };
  }, []);

  const change = (patch: Partial<Draft>) => setDraft((current) => keepDraft(DRAFT_KEY, { ...current, ...patch }));

  const spec = specFor(draft.symbol);
  const sign = draft.direction === "LONG" ? 1 : -1;
  const entryPrice = toNumber(draft.entryPrice);
  const exitPrice = toNumber(draft.exitPrice);
  const stop = toNumber(draft.stop);
  const target = toNumber(draft.target);
  const keyLevel = toNumber(draft.keyLevel);
  // Not clamped or rounded: "0", "1.5" and "" are errors the trader sees (issue #50).
  const quantity = Number(draft.quantity);
  const entry = fromZonedInput(draft.entryTime, zone);
  const exit = fromZonedInput(draft.exitTime, zone);

  // Price, side, size and tick rules live in the lib. An off-tick price is rejected, never snapped.
  const executionErrors = validateTradeInput({
    symbol: draft.symbol, direction: draft.direction, quantity,
    entry_price: entryPrice ?? Number.NaN, exit_price: exitPrice ?? Number.NaN,
    stop_loss_price: stop, planned_target_price: target, key_level_price: keyLevel,
  });
  const errors: Partial<Record<keyof Draft, string>> = {
    symbol: executionErrors.symbol,
    quantity: executionErrors.quantity,
    entryPrice: executionErrors.entry_price,
    exitPrice: executionErrors.exit_price,
    stop: executionErrors.stop_loss_price,
    target: executionErrors.planned_target_price,
    keyLevel: executionErrors.key_level_price,
  };
  if (entryPrice != null && !(entryPrice > 0)) errors.entryPrice = "Enter the entry price";
  if (exitPrice != null && !(exitPrice > 0)) errors.exitPrice = "Enter the exit price";
  if (Number.isNaN(entry.getTime())) errors.entryTime = "Enter the entry time";
  if (Number.isNaN(exit.getTime())) errors.exitTime = "Enter the exit time";
  else if (!errors.entryTime && exit <= entry) errors.exitTime = "The exit must be after the entry";
  const hasErrors = Object.values(errors).some(Boolean);
  const show = (key: keyof Draft) => (submitted ? errors[key] : undefined);

  const preview = entryPrice != null && exitPrice != null && entryPrice > 0 && exitPrice > 0
    ? { symbol: draft.symbol, direction: draft.direction, quantity, entry_price: entryPrice, exit_price: exitPrice, stop_loss_price: stop != null && !errors.stop ? stop : null }
    : null;
  const previewPnl = preview ? tradePnl(preview) : null;

  // Sizing defaults (docs/12 LV-17): stop distance from the risk budget, target at 1.5R.
  const sized = !!spec && isWholeQuantity(quantity);
  const budgetPoints = sized && spec ? prefs.riskBudgetUsd / (quantity * spec.pointValueUsd) : 0;
  const suggestedStop = sized && entryPrice != null && entryPrice > 0 ? snapToTick(entryPrice - sign * budgetPoints, draft.symbol) : null;
  const suggestedTarget = entryPrice != null && stop != null && !errors.stop ? snapToTick(entryPrice + sign * Math.abs(entryPrice - stop) * 1.5, draft.symbol) : null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (hasErrors || entryPrice == null || exitPrice == null) return;
    const trade = normalizeTrade({
      id: crypto.randomUUID(), symbol: draft.symbol, direction: draft.direction, quantity,
      entry_time: entry.toISOString(), exit_time: exit.toISOString(),
      entry_price: entryPrice, exit_price: exitPrice,
      stop_loss_price: stop, planned_target_price: target, key_level_price: keyLevel,
      note: draft.note.trim(),
    });
    addTrade(trade);
    keepDraft(DRAFT_KEY, null);
    closeAddTrade();
    showToast("Trade saved on this device");
    router.push(`/trades/${trade.id}`);
  };

  const zoneName = Number.isNaN(entry.getTime()) ? "" : zoneLabel(entry, zone);
  const step = spec?.tickSize;

  return (
    <div className="sheet-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && closeAddTrade()}>
      <section className="sheet" role="dialog" aria-modal="true" aria-labelledby="add-trade-title">
        <div className="sheet-head">
          <div><span className="eyebrow">Manual entry</span><h2 id="add-trade-title">Log the execution</h2><p>{prefs.shield ? "Side, prices and times make the chart. The rest can wait." : "Side, size, prices and times make the chart. The rest can wait."}</p></div>
          <button className="icon-button" onClick={closeAddTrade} aria-label="Close">×</button>
        </div>
        <form onSubmit={submit} noValidate>
          <div className="form-grid">
            <label className={`field${prefs.shield ? " wide" : ""}`}><span>Symbol</span>
              <select ref={firstField} value={draft.symbol} onChange={(event) => change({ symbol: event.target.value })}>
                {Object.keys(FUTURES_SPECS).map((symbol) => <option key={symbol}>{symbol}</option>)}
              </select>
              {show("symbol") && <span className="error">{show("symbol")}</span>}
            </label>
            {!prefs.shield && (
              <label className="field"><span>Contracts</span>
                <input inputMode="numeric" type="number" min={1} step={1} value={draft.quantity} aria-invalid={!!show("quantity")} onChange={(event) => change({ quantity: event.target.value })} />
                {show("quantity") && <span className="error">{show("quantity")}</span>}
              </label>
            )}
            <div className="field wide"><span>Side</span>
              <div className="segmented" role="group" aria-label="Side">
                <button type="button" aria-pressed={draft.direction === "LONG"} onClick={() => change({ direction: "LONG" })}>▲ Long</button>
                <button type="button" aria-pressed={draft.direction === "SHORT"} onClick={() => change({ direction: "SHORT" })}>▼ Short</button>
              </div>
            </div>
            <label className="field"><span>Entry time <i>{zoneName}</i></span>
              <input type="datetime-local" value={draft.entryTime} aria-invalid={!!show("entryTime")} onChange={(event) => change({ entryTime: event.target.value })} />
              {show("entryTime") && <span className="error">{show("entryTime")}</span>}
            </label>
            <label className="field"><span>Entry price</span>
              <input inputMode="decimal" type="number" step={step} placeholder="6844.25" value={draft.entryPrice} aria-invalid={!!show("entryPrice")} onChange={(event) => change({ entryPrice: event.target.value })} />
              {show("entryPrice") && <span className="error">{show("entryPrice")}</span>}
            </label>
            <label className="field"><span>Exit time <i>{zoneName}</i></span>
              <input type="datetime-local" value={draft.exitTime} aria-invalid={!!show("exitTime")} onChange={(event) => change({ exitTime: event.target.value })} />
              {show("exitTime") && <span className="error">{show("exitTime")}</span>}
            </label>
            <label className="field"><span>Exit price</span>
              <input inputMode="decimal" type="number" step={step} placeholder="6849.00" value={draft.exitPrice} aria-invalid={!!show("exitPrice")} onChange={(event) => change({ exitPrice: event.target.value })} />
              {show("exitPrice") && <span className="error">{show("exitPrice")}</span>}
            </label>
            <label className="field"><span>Stop <i>unlocks R</i></span>
              <input inputMode="decimal" type="number" step={step} value={draft.stop} aria-invalid={!!errors.stop} onChange={(event) => change({ stop: event.target.value })} />
              {errors.stop && <span className="error">{errors.stop}</span>}
            </label>
            <label className="field"><span>Target <i>optional</i></span>
              <input inputMode="decimal" type="number" step={step} value={draft.target} aria-invalid={!!errors.target} onChange={(event) => change({ target: event.target.value })} />
              {errors.target && <span className="error">{errors.target}</span>}
            </label>
            {(suggestedStop != null && draft.stop === "") || (suggestedTarget != null && draft.target === "") ? (
              <div className="field wide"><span>{prefs.shield ? "Suggested from your risk budget" : `Suggested from your $${prefs.riskBudgetUsd} risk budget`}</span>
                <div className="suggest">
                  {suggestedStop != null && draft.stop === "" && <button type="button" onClick={() => change({ stop: String(suggestedStop) })}>Stop {formatPrice(suggestedStop, draft.symbol)} · {budgetPoints.toFixed(2)} pts</button>}
                  {suggestedTarget != null && draft.target === "" && <button type="button" onClick={() => change({ target: String(suggestedTarget) })}>Target {formatPrice(suggestedTarget, draft.symbol)} · exactly 1.5R</button>}
                </div>
              </div>
            ) : null}
            <label className="field wide"><span>Key level <i>optional</i></span>
              <input inputMode="decimal" type="number" step={step} value={draft.keyLevel} aria-invalid={!!errors.keyLevel} onChange={(event) => change({ keyLevel: event.target.value })} />
              {errors.keyLevel && <span className="error">{errors.keyLevel}</span>}
            </label>
            <label className="field wide"><span>Private note <i>optional</i></span>
              <textarea value={draft.note} onChange={(event) => change({ note: event.target.value })} placeholder="Why I took it / what I would change" />
            </label>
          </div>
          <div className="form-preview" aria-live="polite">
            {preview
              ? <><span>{prefs.shield ? draft.symbol : `${draft.quantity} × ${draft.symbol}`} · {formatPoints(tradePoints(preview), draft.symbol)}</span><span><b className={previewPnl == null ? "" : previewPnl >= 0 ? "positive" : "negative"}>{prefs.shield ? formatR(rMultiple(preview)) : formatMoney(previewPnl)}</b>{!prefs.shield && <> · {formatR(rMultiple(preview))}</>}</span></>
              : <span>Result appears here as you type the prices.</span>}
          </div>
          <button className="btn-primary btn-block" type="submit" style={{ marginTop: 14 }}>Save trade and open chart</button>
        </form>
      </section>
    </div>
  );
}
