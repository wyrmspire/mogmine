"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";
import { checkPriceAgainstDayRange, dayWindow, entryDraftAfterSave, entryStopFields, entryTimes, priceOrNull, resolveDraftPartials, resolveDraftStopMoves, statedRiskError, statedRiskRFrom, stepPriceText, suggestionPatch, upgradeDraft, validateFutureTimes, zonedParts } from "@/lib/entry-form";
import { RiskRow } from "./RiskRow";
import { EntryExitReasonRow, EntryStopMoves } from "./EntryStopMoves";
import { EntryPartialsSection } from "./EntryPartialsSection";
import { loadDayCandles } from "@/lib/candles";
import { inferTradeTimes } from "@/lib/infer-times";
import type { InferResult } from "@/lib/infer-times";
import { finderMessage } from "@/lib/infer-message";
import type { EntryDraft } from "@/lib/entry-form";
import { formatMoney, formatPointDistance, formatPoints, formatR, formatUsdAmount } from "@/lib/format";
import { usePrefs } from "@/lib/prefs";
import { AccountSelect } from "./AccountSelect";
import { defaultAccountId, isReplayAccount } from "@/lib/accounts";
import { resolveRSize } from "@/lib/r-size";
import { useAccounts } from "@/lib/accounts-store";
import { ONE_TAP_MOOD_SCORE, spokeChipLabel } from "@/lib/mood";
import { recordUserMood, useMood } from "@/lib/mood-store";
import { addTradeAndFlush, useJournal } from "@/lib/store";
import { zoneLabel } from "@/lib/time";
import { showToast } from "@/lib/toast";
import { FUTURES_SPECS, MOVED_STOP_TAG, initialRiskUsd, normalizeTrade, plannedRewardRisk, specFor, tickDecimals, tradePnl, tradePoints, validateTradeInput } from "@/lib/trades";
import type { Candle, TradeStatus } from "@/lib/trades";
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
const NOTES_DRAFT_KEY = "add-trade-notes";

interface NotesDraft {
  note: string;
  preTradeThesis: string;
}

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
  const [notesDraft, setNotesDraft] = useState<NotesDraft>(() => readDraft<NotesDraft>(NOTES_DRAFT_KEY) ?? { note: "", preTradeThesis: "" });
  const [submitted, setSubmitted] = useState(false);
  const [finder, setFinder] = useState<Finder>({ state: "idle" });
  /** The day bars the finder loaded, keyed by the day window they cover (UX-09 price-range warning). */
  const [dayBars, setDayBars] = useState<{ from: number; candles: Candle[] } | null>(null);
  const [finderNonce, setFinderNonce] = useState(0);
  const online = useOnline();
  // Captured at mount and refreshed in event handlers so render stays pure (`react-hooks/purity`).
  const [nowMs, setNowMs] = useState(() => Date.now());
  const dialogRef = useRef<HTMLElement>(null);
  const firstField = useRef<HTMLButtonElement>(null);
  const accounts = useAccounts();
  const journal = useJournal();
  const moodState = useMood();
  // Undefined until the trader picks: the account used last (docs/21).
  const accountId = draft.accountId !== undefined ? draft.accountId : defaultAccountId(accounts.accounts, journal.trades);
  const selectedAccount = accounts.accounts.find((account) => account.id === accountId) ?? null;
  const replaySession = isReplayAccount(selectedAccount);

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

  const change = (patch: Partial<EntryDraft>) => { setNowMs(new Date().getTime()); setDraft((current) => keepDraft(DRAFT_KEY, { ...current, ...patch })); };
  const changeNotes = (patch: Partial<NotesDraft>) => setNotesDraft((current) => keepDraft(NOTES_DRAFT_KEY, { ...current, ...patch }));
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
  const stopPrice = priceOrNull(draft.stopPrice);
  const targetPrice = priceOrNull(draft.targetPrice);
  // Not clamped or rounded: "0", "1.5" and "" are errors the trader sees (issue #50). Under Shield, Contracts stays editable & masked (UX-e, #15).
  const quantity = Number(draft.quantity);
  const times = entryTimes(draft, zone);
  const { entry, exit: draftExit } = times;
  // Split targets and partial exits (issue #38). Filled exit legs replace the single Exit price and time.
  const partials = resolveDraftPartials({ draft, entryPrice, quantity, isOpenDraft, entryMs: entry.getTime(), zone });
  const exitPrice = isOpenDraft ? null : partials.legged ? partials.exitPrice : priceOrNull(draft.exitPrice);
  const exit = partials.legged ? (partials.exitTime ? new Date(partials.exitTime) : null) : draftExit;
  // Optional "I moved my stop" rows (issue #36 G2): validated against the initial stop and the trade's times.
  const draftStopMoves = draft.stopMoves ?? [];
  const resolvedStopMoves = resolveDraftStopMoves({
    stopMoves: draftStopMoves, initialStopPrice: stopPrice, entryPrice, direction: draft.direction, symbol: draft.symbol,
    date: draft.date, entryMs: entry.getTime(), exitMs: isOpenDraft || !exit ? null : exit.getTime(), zone,
  });

  // Price, side, size and tick rules live in the lib, including the stop-side and target-side rules.
  // An off-tick price is rejected, never snapped.
  const executionErrors = validateTradeInput({
    symbol: draft.symbol, direction: draft.direction, quantity,
    entry_price: entryPrice ?? Number.NaN, exit_price: isOpenDraft ? null : exitPrice ?? Number.NaN,
    stop_loss_price: stopPrice, planned_target_price: targetPrice, key_level_price: null,
  });
  const errors: Partial<Record<ErrorKey, string>> = {
    symbol: executionErrors.symbol,
    quantity: executionErrors.quantity,
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
  // UX-09: a trade dated in the future (beyond the 5-minute clock allowance) is refused, not just warned.
  const future = validateFutureTimes(entry.getTime(), isOpenDraft || !exit ? null : exit.getTime(), nowMs, zone);
  errors.entryClock = errors.entryClock ?? future.entry;
  if (!isOpenDraft) errors.exitClock = errors.exitClock ?? future.exit;
  const hasErrors = Object.values(errors).some(Boolean) || statedRiskError(draft.statedRiskR) != null || resolvedStopMoves.error != null || partials.error != null;
  const show = (key: ErrorKey) => (submitted ? errors[key] : undefined);
  // A price error shows as soon as the price is typed (wrong-side stop, off-tick), not only on save.
  const showPrice = (key: PriceKey) => (submitted || draft[key].trim() !== "" ? errors[key] : undefined);

  const priced = entryPrice != null && entryPrice > 0 && !errors.entryPrice
    ? { symbol: draft.symbol, direction: draft.direction, quantity, entry_price: entryPrice, exit_price: !isOpenDraft && exitPrice != null && exitPrice > 0 && !errors.exitPrice ? exitPrice : null, stop_loss_price: errors.stopPrice ? null : stopPrice, planned_target_price: errors.targetPrice ? null : targetPrice }
    : null;
  const riskUsd = priced ? initialRiskUsd(priced) : null;
  const riskPoints = priced && priced.stop_loss_price != null ? formatPointDistance(priced.entry_price - priced.stop_loss_price, draft.symbol) : null;
  const plan = priced ? plannedRewardRisk(priced) : null;
  const pnl = partials.metrics ? partials.metrics.pnlUsd : priced ? tradePnl(priced) : null;
  // Result in account R (resultR, 04 §3.1): P&L ÷ the selected account's R size. Computed here because the draft is not a full TradeRecord yet.
  const rSize = resolveRSize({ account_id: accountId }, accounts.accounts, prefs);
  const r = pnl == null ? null : (pnl * 100) / rSize.cents;

  // Find the times from the prices (OD-41 (5), docs/20 §2.2). Runs a moment after the prices settle,
  // or on "Find times". A hand-set time is a hint and is never overwritten.
  const dayRange = dayWindow(draft.date, zone);
  const entryReady = entryPrice != null && entryPrice > 0 && !errors.entryPrice;
  const hint = draft.entryEdited && !Number.isNaN(entry.getTime()) ? entry.getTime() : null;
  const finderInput = entryPrice != null && entryReady && dayRange && dayRange.from < nowMs
    ? { symbol: draft.symbol, direction: draft.direction, entryPrice, exitPrice: !isOpenDraft && exitPrice != null && exitPrice > 0 && !errors.exitPrice ? exitPrice : null, stopPrice: !errors.stopPrice ? stopPrice : null, targetPrice: !errors.targetPrice ? targetPrice : null, hint, window: dayRange }
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
          setDayBars({ from: finderInput.window.from, candles: day.candles });
          setFinder({ state: "done", key: finderKey, result, message: finderMessage(result, { symbol: finderInput.symbol, entryPrice: finderInput.entryPrice, exitPrice: finderInput.exitPrice, dateLabel }, zone) });
          setDraft((current) => keepDraft(DRAFT_KEY, { ...current, ...suggestionPatch(current, result, zone) }));
        })
        .catch(() => {
          if (run !== finderRun.current) return;
          setFinder({ state: "error", key: finderKey, message: navigator.onLine ? `No bars for ${dateLabel} yet. Yahoo may not have published them. Set the times yourself.` : "Offline, so the bars cannot be searched. Set the times yourself." });
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
    const submitNow = new Date().getTime();
    setNowMs(submitNow);
    setSubmitted(true);
    const submitFuture = validateFutureTimes(entry.getTime(), isOpenDraft || !exit ? null : exit.getTime(), submitNow, zone);
    if (hasErrors || submitFuture.entry || (!isOpenDraft && submitFuture.exit) || entryPrice == null) return;
    // Missing is null, never 0 or the entry price (R-03).
    const exitFields = isOpenDraft
      ? { status: "open" as const, exit_time: null, exit_price: null }
      : exitPrice == null || !exit ? null : { status: "closed" as const, exit_time: exit.toISOString(), exit_price: exitPrice };
    if (!exitFields) return;
    const trade = normalizeTrade({
      id: draft.pendingTradeId ?? crypto.randomUUID(), symbol: draft.symbol, direction: draft.direction, quantity,
      entry_time: entry.toISOString(), ...exitFields,
      entry_price: entryPrice,
      exit_reason: !isOpenDraft ? (draft.exitReason ?? null) : null,
      // R-10: a stop typed here is the stop and the frozen initial stop. Stop moves freeze it the same way (SM-3).
      ...entryStopFields(stopPrice, resolvedStopMoves, entry.toISOString(), new Date().toISOString()),
      quick_tags: draft.quickTags ?? [],
      partial_targets: partials.targets, partial_exits: partials.exits,
      planned_target_price: targetPrice,
      key_level_price: null,
      note: notesDraft.note.trim(),
      pre_trade_thesis: notesDraft.preTradeThesis.trim(),
      account_id: accountId,
      // 04 §2: what the trader said (never computed), and the R size frozen on save (D-B).
      stated_risk_r: statedRiskRFrom(draft.statedRiskR),
      r_size_cents: rSize.cents,
    });
    const saved = addTradeAndFlush(trade);
    if (draft.entryMoodSpoke) {
      const nowIso = new Date().toISOString();
      recordUserMood(trade.id, { [draft.entryMoodSpoke]: ONE_TAP_MOOD_SCORE }, nowIso, entry.toISOString(), nowIso);
    }
    const nextDraft = entryDraftAfterSave(draft, trade.id, saved);
    keepDraft(DRAFT_KEY, nextDraft);
    if (nextDraft) setDraft(nextDraft);
    if (saved) {
      keepDraft(NOTES_DRAFT_KEY, null);
      setNotesDraft({ note: "", preTradeThesis: "" });
    }
    closeAddTrade();
    showToast(saved
      ? isOpenDraft ? "Open trade saved on this device" : "Trade saved on this device"
      : "Trade kept for this session — storage is blocked. Draft kept for retry.");
    router.push(`/trades/${trade.id}`);
  };

  // Warning only (Q-10): a typed price far outside the loaded day's bars never blocks the save.
  const barsForDay = dayBars && dayRange && dayBars.from === dayRange.from ? dayBars.candles : [];
  const priceWarning = checkPriceAgainstDayRange(entryPrice, draft.symbol, barsForDay) ?? checkPriceAgainstDayRange(exitPrice, draft.symbol, barsForDay);
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
            <AccountSelect className="field wide" value={accountId} onChange={(id) => change({ accountId: id })} />
            {replaySession && <p className="banner wide" role="status" style={{ margin: 0 }}>Pretend / Replay session — gets full charts &amp; notes, excluded from live stats.</p>}
          </div>

          <fieldset className="price-ladder" aria-label="Prices">
            <PriceRow id="entry-price" label="Entry" value={draft.entryPrice} placeholder="6844.25" step={step} error={showPrice("entryPrice")} onChange={(value) => change({ entryPrice: value })} onStep={(ticks) => stepPrice("entryPrice", ticks)} />
            {!isOpenDraft && !partials.legged && <PriceRow id="exit-price" label="Exit" value={draft.exitPrice} placeholder="6849.00" step={step} error={showPrice("exitPrice")} onChange={(value) => change({ exitPrice: value })} onStep={(ticks) => stepPrice("exitPrice", ticks)} />}
            <PriceRow id="stop-price" label="Stop" optional value={draft.stopPrice} placeholder={draft.direction === "LONG" ? "below entry" : "above entry"} step={step} error={showPrice("stopPrice")} onChange={(value) => change({ stopPrice: value })} onStep={(ticks) => stepPrice("stopPrice", ticks)} />
            <PriceRow id="target-price" label="Target" optional value={draft.targetPrice} placeholder={draft.direction === "LONG" ? "above entry" : "below entry"} step={step} error={showPrice("targetPrice")} onChange={(value) => change({ targetPrice: value })} onStep={(ticks) => stepPrice("targetPrice", ticks)} />
          </fieldset>
          {priceWarning && <p className="banner warn" role="status">{priceWarning}</p>}

          <RiskRow
            statedRiskR={draft.statedRiskR ?? ""} stopPrice={draft.stopPrice} entryPrice={entryPrice} direction={draft.direction} symbol={draft.symbol}
            quantity={quantity} rSizeCents={rSize.cents} shield={prefs.shield}
            onStated={(text) => change({ statedRiskR: text })} onUseStop={(price) => change({ stopPrice: price.toFixed(tickDecimals(spec?.tickSize ?? 0.01)) })}
          />

          <EntryStopMoves
            symbol={draft.symbol} stopPrice={draft.stopPrice} entryPrice={draft.entryPrice} zone={zone}
            exitClock={isOpenDraft ? null : draft.exitClock} rows={draftStopMoves} error={resolvedStopMoves.error}
            widened={resolvedStopMoves.widened} quickTags={draft.quickTags ?? []}
            onRows={(stopMoves) => change({ stopMoves })} onAcceptTag={() => change({ quickTags: [...(draft.quickTags ?? []), MOVED_STOP_TAG] })}
          />

          {!isOpenDraft && <EntryExitReasonRow value={draft.exitReason} onChange={(exitReason) => change({ exitReason })} />}
          <EntryPartialsSection draft={draft} error={partials.error ?? (partials.legged ? errors.exitClock ?? null : null)} onChange={change} />

          <div className="form-preview" aria-live="polite">
            <span>{riskUsd != null || riskPoints != null
              ? <>Risk {prefs.shield ? riskPoints : `${formatUsdAmount(riskUsd)} · ${riskPoints}`}{plan != null && <> · Plan R:R {plan.toFixed(1)}:1</>}</>
              : "Add a stop to see the risk"}</span>
            <span>{isOpenDraft
              ? "Open. The result appears when you close it."
              : priced && priced.exit_price != null
                ? <><b className={pnl == null ? "" : pnl >= 0 ? "positive" : "negative"}>{prefs.shield ? (r != null ? formatR(r) : formatPoints(tradePoints(priced), draft.symbol)) : formatMoney(pnl)}</b>{!prefs.shield && <> · {formatR(r)}</>}</>
                : "Result appears with the exit"}</span>
          </div>

          <div className="mood-entry-section">
            <div className="mood-entry-head"><span className="mood-entry-title">Feeling at entry <i>optional</i></span></div>
            <div className="chip-row" role="group" aria-label="Feeling at entry">
              {moodState.registry.spokes.map((spoke) => {
                const selected = draft.entryMoodSpoke === spoke.id;
                return (
                  <button key={spoke.id} type="button" className="chip" aria-pressed={selected} aria-label={`${spoke.label} feeling at entry`} onClick={() => change({ entryMoodSpoke: selected ? null : spoke.id })}>
                    {spokeChipLabel(spoke)}
                  </button>
                );
              })}
            </div>
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
            {/* UX-e (#15): Under Shield, Contracts stays editable and bound to state while masked on screen. */}
            <label className="field">
              <span>Contracts {prefs.shield && <i className="shield-tag" style={{ opacity: 0.6, fontSize: "0.8em", marginLeft: 4 }}>masked</i>}</span>
              <input inputMode="numeric" type={prefs.shield ? "password" : "number"} min={1} step={1} value={draft.quantity} placeholder={prefs.shield ? "••" : "1"} aria-label={prefs.shield ? "Contracts (masked under Shield)" : "Contracts"} aria-invalid={!!show("quantity")} onChange={(event) => change({ quantity: event.target.value })} />
              {show("quantity") && <span className="error">{show("quantity")}</span>}
            </label>
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
            {!isOpenDraft && !partials.legged && (
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
          <div className="add-notes-section">
            <label className="field wide">
              <span>Quick Takeaway <i>optional · feed &amp; cards</i></span>
              <textarea rows={1} value={notesDraft.note} placeholder="One-line takeaway for cards & feed — reasoning/lesson only, no prices or R" aria-label="Quick Takeaway" autoCapitalize="sentences" enterKeyHint="done" onChange={(event) => changeNotes({ note: event.target.value })} />
            </label>
            <label className="field wide">
              <span>Before Entry <i>optional · thesis</i></span>
              <textarea rows={2} value={notesDraft.preTradeThesis} placeholder="Why was this setup worth taking?" aria-label="Before Entry: Thesis and invalidation" autoCapitalize="sentences" onChange={(event) => changeNotes({ preTradeThesis: event.target.value })} />
            </label>
            <p className="notes-hint">Commentary only — prices, stop, risk and R are saved above.</p>
          </div>
          <button className="btn-primary btn-block" type="submit" style={{ marginTop: 14 }}>{isOpenDraft ? "Save open trade and open chart" : "Save trade and open chart"}</button>
        </form>
      </section>
    </div>
  );
}
