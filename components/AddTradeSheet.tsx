"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";
import { dayWindow, entryLevelFields, entryTimes, priceOrNull, stepPriceText, suggestionPatch, upgradeDraft, zonedParts } from "@/lib/entry-form";
import { loadDayCandles } from "@/lib/candles";
import { inferTradeTimes } from "@/lib/infer-times";
import type { InferResult } from "@/lib/infer-times";
import { finderMessage } from "@/lib/infer-message";
import type { EntryDraft } from "@/lib/entry-form";
import { formatMoney, formatPointDistance, formatPoints, formatR, formatUsdAmount } from "@/lib/format";
import { usePrefs } from "@/lib/prefs";
import { addTrade } from "@/lib/store";
import { zoneLabel } from "@/lib/time";
import { showToast } from "@/lib/toast";
import { FUTURES_SPECS, initialRiskUsd, isWholeQuantity, normalizeTrade, plannedR, rMultiple, specFor, tradePnl, tradePoints, validateTradeInput } from "@/lib/trades";
import type { TradeStatus } from "@/lib/trades";
import { closeAddTrade, keepDraft, readDraft, useOnline } from "@/lib/ui";

/** Wait this long after the last price keystroke before searching the bars. */
const FINDER_DEBOUNCE_MS = 600;

type Finder =
  | { state: "idle" }
  | { state: "loading"; key: string }
  | { state: "done"; key: string; result: InferResult; message: string }
  | { state: "error"; key: string; message: string };

// Kept while the app is open, so closing the sheet by accident never loses what was typed.
const DRAFT_KEY = "add-trade";

type PriceKey = "entryPrice" | "exitPrice" | "stopPrice" | "targetPrice";
type ErrorKey = PriceKey | "symbol" | "quantity" | "date" | "entryClock" | "exitClock";

interface PriceRowProps {
  id: string;
  label: string;
  optional?: boolean;
  value: string;
  placeholder: string;
  step: number | undefined;
  error: string | undefined;
  onChange: (value: string) => void;
  onStep: (ticks: number) => void;
}

/** One price: label, − tick, the typed price, + tick. Typing stays the fast path; the steppers nudge (docs/20 §2). */
function PriceRow({ id, label, optional, value, placeholder, step, error, onChange, onStep }: PriceRowProps) {
  return (
    <div className="price-row">
      <label htmlFor={id}>{label}{optional && <i>optional</i>}</label>
      <button type="button" className="tick-step" aria-label={`${label} down one tick`} onClick={() => onStep(-1)}>−</button>
      <input id={id} inputMode="decimal" type="number" step={step} placeholder={placeholder} value={value} aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined} onChange={(event) => onChange(event.target.value)} />
      <button type="button" className="tick-step" aria-label={`${label} up one tick`} onClick={() => onStep(1)}>+</button>
      {error && <span className="error" id={`${id}-error`}>{error}</span>}
    </div>
  );
}

export function AddTradeSheet() {
  const router = useRouter();
  const prefs = usePrefs();
  const zone = prefs.timeZone;
  const [draft, setDraft] = useState<EntryDraft>(() => upgradeDraft(readDraft<unknown>(DRAFT_KEY), new Date(), zone));
  const [submitted, setSubmitted] = useState(false);
  const [finder, setFinder] = useState<Finder>({ state: "idle" });
  const [finderNonce, setFinderNonce] = useState(0);
  const online = useOnline();
  // A date that starts after the sheet opened has no bars yet.
  const [openedAt] = useState(() => Date.now());
  const dialogRef = useRef<HTMLElement>(null);
  const firstField = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Focus the side, not a price: no keyboard pops up over the sheet before the trader looks at it.
    firstField.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { closeAddTrade(); return; }
      if (event.key !== "Tab") return;
      const dialog = dialogRef.current;
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

  const change = (patch: Partial<EntryDraft>) => setDraft((current) => keepDraft(DRAFT_KEY, { ...current, ...patch }));
  const isOpenDraft = draft.status === "open";
  // Still open: the entry defaults to now unless the trader already set a time (R-03b).
  const setStatus = (status: TradeStatus) => {
    if (status === "open" && !draft.entryEdited && !draft.dateEdited && finder.state !== "done") {
      const now = zonedParts(new Date(), zone);
      change({ status, date: now.date, entryClock: now.clock });
    } else change({ status });
  };
  const setNow = (which: "entry" | "exit") => {
    const now = zonedParts(new Date(), zone);
    change(which === "entry" ? { date: now.date, entryClock: now.clock, entryEdited: true, dateEdited: true } : { exitClock: now.clock, exitEdited: true });
  };
  // A stepper on an empty stop, target or exit starts from the entry price.
  const stepPrice = (key: PriceKey, ticks: number) => change({ [key]: stepPriceText(draft[key], ticks, draft.symbol, key === "entryPrice" ? "" : draft.entryPrice) });

  const spec = specFor(draft.symbol);
  const entryPrice = priceOrNull(draft.entryPrice);
  const exitPrice = isOpenDraft ? null : priceOrNull(draft.exitPrice);
  const stopPrice = priceOrNull(draft.stopPrice);
  const targetPrice = priceOrNull(draft.targetPrice);
  // Not clamped or rounded: "0", "1.5" and "" are errors the trader sees (issue #50).
  // Under Shield the Contracts input is hidden, so an invalid draft quantity cannot be seen or
  // fixed; fall back to 1 there and keep the typed draft untouched for when Shield turns off.
  const typedQuantity = Number(draft.quantity);
  const quantity = prefs.shield ? (isWholeQuantity(typedQuantity) ? typedQuantity : 1) : typedQuantity;
  const times = entryTimes(draft, zone);
  const { entry, exit } = times;

  // Price, side, size and tick rules live in the lib, including the stop-side and target-side rules.
  // An off-tick price is rejected, never snapped.
  const executionErrors = validateTradeInput({
    symbol: draft.symbol, direction: draft.direction, quantity,
    entry_price: entryPrice ?? Number.NaN, exit_price: isOpenDraft ? null : exitPrice ?? Number.NaN,
    stop_loss_price: stopPrice, planned_target_price: targetPrice, key_level_price: null,
  });
  const errors: Partial<Record<ErrorKey, string>> = {
    symbol: executionErrors.symbol,
    quantity: prefs.shield ? undefined : executionErrors.quantity,
    entryPrice: executionErrors.entry_price,
    exitPrice: executionErrors.exit_price,
    stopPrice: executionErrors.stop_loss_price,
    targetPrice: executionErrors.planned_target_price,
  };
  if (entryPrice != null && !(entryPrice > 0)) errors.entryPrice = "Enter the entry price";
  if (!isOpenDraft && exitPrice != null && !(exitPrice > 0)) errors.exitPrice = "Enter the exit price";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date)) errors.date = "Pick the date";
  else if (Number.isNaN(entry.getTime())) errors.entryClock = "Pick the entry time";
  // An open trade has no exit to check (R-03b).
  if (!isOpenDraft && exit) {
    if (Number.isNaN(exit.getTime())) errors.exitClock = "Pick the exit time";
    else if (!errors.entryClock && !errors.date && exit <= entry) errors.exitClock = "The exit must be after the entry";
  }
  const hasErrors = Object.values(errors).some(Boolean);
  const show = (key: ErrorKey) => (submitted ? errors[key] : undefined);
  // A price error shows as soon as the price is typed (wrong-side stop, off-tick), not only on save.
  const showPrice = (key: PriceKey) => (submitted || draft[key].trim() !== "" ? errors[key] : undefined);

  const priced = entryPrice != null && entryPrice > 0 && !errors.entryPrice
    ? { symbol: draft.symbol, direction: draft.direction, quantity, entry_price: entryPrice, exit_price: !isOpenDraft && exitPrice != null && exitPrice > 0 && !errors.exitPrice ? exitPrice : null, stop_loss_price: errors.stopPrice ? null : stopPrice, planned_target_price: errors.targetPrice ? null : targetPrice }
    : null;
  const riskUsd = priced ? initialRiskUsd(priced) : null;
  const riskPoints = priced && priced.stop_loss_price != null ? formatPointDistance(priced.entry_price - priced.stop_loss_price, draft.symbol) : null;
  const plan = priced ? plannedR(priced) : null;
  const pnl = priced ? tradePnl(priced) : null;
  const r = priced ? rMultiple(priced) : null;

  // Find the times from the prices (OD-41 (5), docs/20 §2.2). Runs a moment after the prices settle,
  // or on "Find times". A hand-set time is a hint and is never overwritten.
  const dayRange = dayWindow(draft.date, zone);
  const entryReady = entryPrice != null && entryPrice > 0 && !errors.entryPrice;
  const hint = draft.entryEdited && !Number.isNaN(entry.getTime()) ? entry.getTime() : null;
  const finderInput = entryPrice != null && entryReady && dayRange && dayRange.from < openedAt
    ? {
      symbol: draft.symbol, direction: draft.direction, entryPrice,
      exitPrice: !isOpenDraft && exitPrice != null && exitPrice > 0 && !errors.exitPrice ? exitPrice : null,
      stopPrice: !errors.stopPrice ? stopPrice : null, targetPrice: !errors.targetPrice ? targetPrice : null,
      hint, window: dayRange,
    }
    : null;
  const finderKey = finderInput ? JSON.stringify({ ...finderInput, nonce: finderNonce }) : "";
  const dateLabel = dayRange ? new Intl.DateTimeFormat("en-US", { timeZone: zone, month: "short", day: "numeric" }).format(new Date(dayRange.from + 12 * 3_600_000)) : "";
  const finderRun = useRef(0);
  useEffect(() => {
    const run = ++finderRun.current;
    if (!finderInput) return;
    const timer = setTimeout(() => {
      loadDayCandles(finderInput.symbol, finderInput.window.from, finderInput.window.to)
        .then((day) => {
          if (run !== finderRun.current) return;
          const result = inferTradeTimes({ ...finderInput, candles: day.candles, timeframe: day.baseTimeframe });
          setFinder({ state: "done", key: finderKey, result, message: finderMessage(result, { symbol: finderInput.symbol, entryPrice: finderInput.entryPrice, exitPrice: finderInput.exitPrice, dateLabel }, zone) });
          setDraft((current) => keepDraft(DRAFT_KEY, { ...current, ...suggestionPatch(current, result, zone) }));
        })
        .catch(() => {
          if (run !== finderRun.current) return;
          setFinder({ state: "error", key: finderKey, message: navigator.onLine
            ? `No bars for ${dateLabel} yet. Yahoo may not have published them. Set the times yourself.`
            : "Offline, so the bars cannot be searched. Set the times yourself." });
        });
    }, FINDER_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // finderKey carries every input; the object itself is rebuilt each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finderKey]);
  // A result for older inputs is stale: while the new search waits or runs, show the loading line.
  const shown: Finder = !finderKey ? { state: "idle" } : finder.state !== "idle" && finder.key === finderKey ? finder : { state: "loading", key: finderKey };
  const suggestion = shown.state === "done" ? shown.result : null;
  const suggestedEntry = suggestion?.entryTime != null ? zonedParts(new Date(suggestion.entryTime), zone).clock : null;
  const suggestedExit = !isOpenDraft && suggestion?.exitTime != null ? zonedParts(new Date(suggestion.exitTime), zone).clock : null;
  // The trader set a time by hand that differs from the bars: offer the bars' times, never force them.
  const canUseSuggestion = suggestion != null
    && ((draft.entryEdited && suggestedEntry != null && suggestedEntry !== draft.entryClock) || (draft.exitEdited && suggestedExit != null && suggestedExit !== draft.exitClock));
  const focusEntryTime = () => {
    const input = document.getElementById("entry-clock") as (HTMLInputElement & { showPicker?: () => void }) | null;
    input?.focus();
    try { input?.showPicker?.(); } catch { /* focus is enough */ }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (hasErrors || entryPrice == null) return;
    // Missing is null, never 0 or the entry price (R-03).
    const exitFields = isOpenDraft
      ? { status: "open" as const, exit_time: null, exit_price: null }
      : exitPrice == null || !exit ? null : { status: "closed" as const, exit_time: exit.toISOString(), exit_price: exitPrice };
    if (!exitFields) return;
    const trade = normalizeTrade({
      id: crypto.randomUUID(), symbol: draft.symbol, direction: draft.direction, quantity,
      entry_time: entry.toISOString(), ...exitFields,
      entry_price: entryPrice,
      // R-10: a stop typed here is the stop and the frozen initial stop.
      ...entryLevelFields(stopPrice, targetPrice, new Date().toISOString()),
      key_level_price: null,
      note: "",
    });
    addTrade(trade);
    keepDraft(DRAFT_KEY, null);
    closeAddTrade();
    showToast(isOpenDraft ? "Open trade saved on this device" : "Trade saved on this device");
    router.push(`/trades/${trade.id}`);
  };

  const zoneName = Number.isNaN(entry.getTime()) ? "" : zoneLabel(entry, zone);
  const step = spec?.tickSize;
  const nextDayLabel = times.exitNextDay && exit && !Number.isNaN(exit.getTime())
    ? new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "short", month: "short", day: "numeric" }).format(exit)
    : null;

  return (
    <div className="sheet-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && closeAddTrade()}>
      <section className="sheet" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="add-trade-title">
        <div className="sheet-head">
          <div><span className="eyebrow">Manual entry</span><h2 id="add-trade-title">Log the trade</h2><p>Side and prices first. The times are filled in; change them if they are off.</p></div>
          <button className="icon-button" onClick={closeAddTrade} aria-label="Close">×</button>
        </div>
        <form onSubmit={submit} noValidate>
          <div className="form-grid">
            <div className="field wide"><span>Side</span>
              <div className="segmented" role="group" aria-label="Side">
                <button ref={firstField} type="button" aria-pressed={draft.direction === "LONG"} onClick={() => change({ direction: "LONG" })}>▲ Long</button>
                <button type="button" aria-pressed={draft.direction === "SHORT"} onClick={() => change({ direction: "SHORT" })}>▼ Short</button>
              </div>
            </div>
            <div className="field wide"><span>Status</span>
              <div className="segmented" role="group" aria-label="Trade status">
                <button type="button" aria-pressed={!isOpenDraft} onClick={() => setStatus("closed")}>Closed</button>
                <button type="button" aria-pressed={isOpenDraft} onClick={() => setStatus("open")}>Still open</button>
              </div>
            </div>
          </div>

          <fieldset className="price-ladder" aria-label="Prices">
            <PriceRow id="entry-price" label="Entry" value={draft.entryPrice} placeholder="6844.25" step={step} error={showPrice("entryPrice")} onChange={(value) => change({ entryPrice: value })} onStep={(ticks) => stepPrice("entryPrice", ticks)} />
            {!isOpenDraft && <PriceRow id="exit-price" label="Exit" value={draft.exitPrice} placeholder="6849.00" step={step} error={showPrice("exitPrice")} onChange={(value) => change({ exitPrice: value })} onStep={(ticks) => stepPrice("exitPrice", ticks)} />}
            <PriceRow id="stop-price" label="Stop" optional value={draft.stopPrice} placeholder={draft.direction === "LONG" ? "below entry" : "above entry"} step={step} error={showPrice("stopPrice")} onChange={(value) => change({ stopPrice: value })} onStep={(ticks) => stepPrice("stopPrice", ticks)} />
            <PriceRow id="target-price" label="Target" optional value={draft.targetPrice} placeholder={draft.direction === "LONG" ? "above entry" : "below entry"} step={step} error={showPrice("targetPrice")} onChange={(value) => change({ targetPrice: value })} onStep={(ticks) => stepPrice("targetPrice", ticks)} />
          </fieldset>

          <div className="form-preview" aria-live="polite">
            <span>{riskUsd != null || riskPoints != null
              ? <>Risk {prefs.shield ? riskPoints : `${formatUsdAmount(riskUsd)} · ${riskPoints}`}{plan != null && <> · Plan {formatR(plan)}</>}</>
              : "Add a stop to see the risk"}</span>
            <span>{isOpenDraft
              ? "Open. The result appears when you close it."
              : priced && priced.exit_price != null
                ? <><b className={pnl == null ? "" : pnl >= 0 ? "positive" : "negative"}>{prefs.shield ? (r != null ? formatR(r) : formatPoints(tradePoints(priced), draft.symbol)) : formatMoney(pnl)}</b>{!prefs.shield && <> · {formatR(r)}</>}</>
                : "Result appears with the exit"}</span>
          </div>

          {shown.state !== "idle" && (
            <div className={`finder finder-${shown.state}`} role="status" aria-live="polite">
              {shown.state === "loading" && <><span className="finder-spinner" aria-hidden="true" /><span>Finding your fill in the bars…</span></>}
              {shown.state === "done" && <button type="button" className="finder-line" onClick={focusEntryTime}>{shown.message}</button>}
              {shown.state === "error" && <span className="finder-line">{online ? shown.message : "Offline, so the bars cannot be searched. Set the times yourself."}</span>}
              {shown.state === "done" && canUseSuggestion && (
                <button type="button" className="now-button" onClick={() => change(suggestionPatch(draft, shown.result, zone, true))}>Use {suggestedEntry}{suggestedExit ? `–${suggestedExit}` : ""}</button>
              )}
              {shown.state === "error" && <button type="button" className="now-button" onClick={() => setFinderNonce((n) => n + 1)}>Retry</button>}
            </div>
          )}
          {shown.state === "idle" && finderInput == null && entryReady && <p className="finder-hint">Pick a date that has bars to find the times.</p>}

          <div className="form-grid when-grid">
            <label className="field"><span>Symbol</span>
              <select value={draft.symbol} onChange={(event) => change({ symbol: event.target.value })}>
                {Object.keys(FUTURES_SPECS).map((symbol) => <option key={symbol}>{symbol}</option>)}
              </select>
              {show("symbol") && <span className="error">{show("symbol")}</span>}
            </label>
            {/* Shield hides position size (#15): the input is masked, the draft keeps the
                quantity and the saved execution preserves it. The preview never shows it. */}
            {!prefs.shield && (
              <label className="field"><span>Contracts</span>
                <input inputMode="numeric" type="number" min={1} step={1} value={draft.quantity} aria-invalid={!!show("quantity")} onChange={(event) => change({ quantity: event.target.value })} />
                {show("quantity") && <span className="error">{show("quantity")}</span>}
              </label>
            )}
            <label className="field wide"><span>Date <i>{zoneName}</i></span>
              <input type="date" value={draft.date} aria-invalid={!!show("date")} onChange={(event) => change({ date: event.target.value, dateEdited: true })} />
              {show("date") && <span className="error">{show("date")}</span>}
            </label>
            <div className="field wide"><label htmlFor="entry-clock"><span>Entry time</span></label>
              <div className="clock-row">
                <input id="entry-clock" type="time" step={60} value={draft.entryClock} aria-invalid={!!show("entryClock")} onChange={(event) => change({ entryClock: event.target.value, entryEdited: true })} />
                <button type="button" className="now-button" onClick={() => setNow("entry")} aria-label="Entry time now">Now</button>
              </div>
              {show("entryClock") && <span className="error">{show("entryClock")}</span>}
            </div>
            {!isOpenDraft && (
              <div className="field wide"><label htmlFor="exit-clock"><span>Exit time</span></label>
                <div className="clock-row">
                  <input id="exit-clock" type="time" step={60} value={draft.exitClock} aria-invalid={!!show("exitClock")} onChange={(event) => change({ exitClock: event.target.value, exitEdited: true })} />
                  <button type="button" className="now-button" onClick={() => setNow("exit")} aria-label="Exit time now">Now</button>
                </div>
                {nextDayLabel && !show("exitClock") && <span className="hint">Next day, {nextDayLabel}</span>}
                {show("exitClock") && <span className="error">{show("exitClock")}</span>}
              </div>
            )}
          </div>
          <button className="btn-primary btn-block" type="submit" style={{ marginTop: 14 }}>{isOpenDraft ? "Save open trade and open chart" : "Save trade and open chart"}</button>
        </form>
      </section>
    </div>
  );
}
