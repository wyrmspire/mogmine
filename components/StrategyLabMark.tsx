"use client";

// Mark a point, then build its Context Card (docs/design-2026-11-24/09 §1, §10.1 step 1–2, §12.1).
// Loads the recent 1m sessions through lib/strategy-lab/bars.ts, builds the card with the pure model, and
// hands the result to StrategyLabContextCard. The R size comes from labRSize, never from a stop width.
import { useState, useSyncExternalStore, type FormEvent } from "react";
import { StrategyLabContextCard, type ExcludedSession } from "@/components/StrategyLabContextCard";
import { useAccounts } from "@/lib/accounts-store";
import { activePlaybooks, usePlaybooks } from "@/lib/playbooks-store";
import { sessionDate } from "@/lib/session";
import { usePrefs } from "@/lib/prefs";
import { useJournal } from "@/lib/store";
import type { TradeRecord } from "@/lib/trades";
import { etParts } from "@/lib/strategy-lab/et-clock";
import { labRSize } from "@/lib/strategy-lab/r";
import {
  buildContextCard, deriveCardState, markTimeUtc, rSizeBasis,
  type CardMark, type CardRSize, type CardSide, type CardState, type ContextCard,
} from "@/lib/strategy-lab/context-card";
import { loadBarSeries, recentSessionDates, type ExclusionReason } from "@/lib/strategy-lab/bars";
import type { BarSeries } from "@/lib/strategy-lab/types";

/** Sessions loaded for a mark: the mark's session and the 11 before it (§10.2: ≤ 12 requests on first load). */
export const CONTEXT_SESSIONS = 12;
const MES_TICK = 0.25;
const ERROR_TEXT = "Could not load bars, retry";
const EXCLUSION_TEXT: Record<ExclusionReason, string> = {
  "not-1m": "only 5m left at Yahoo",
  "no-data": "no data",
  upstream: "Yahoo did not answer",
  "bad-response": "bad response",
};

const etDay = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
const etClock = new Intl.DateTimeFormat("en-GB", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

function snapToTick(price: number): number {
  return Math.round(price / MES_TICK) * MES_TICK;
}

function parseTime(text: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(text);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : null;
}

function timeText(minuteOfDay: number): string {
  return `${String(Math.floor(minuteOfDay / 60)).padStart(2, "0")}:${String(minuteOfDay % 60).padStart(2, "0")}`;
}

export interface MarkSeed {
  key: string;
  date: string;
  time: string;
  priceText: string;
  side: CardSide;
  accountId?: string;
  tradeId?: string;
}

export function seedFromTrade(trade: TradeRecord): MarkSeed | null {
  const entryMs = Date.parse(trade.entry_time);
  if (!Number.isFinite(entryMs) || !Number.isFinite(trade.entry_price)) return null;
  const p = etParts(entryMs);
  const date = `${String(p.year).padStart(4, "0")}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
  const time = `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
  return {
    key: `trade:${trade.id}`,
    date,
    time,
    priceText: String(snapToTick(trade.entry_price)),
    side: trade.direction === "SHORT" ? "short" : "long",
    accountId: trade.account_id ?? "",
    tradeId: trade.id,
  };
}

export interface StrategyLabMarkProps {
  seed?: MarkSeed | null;
  playbookId?: string | null;
  onPlaybookChange?: (next: string | null) => void;
  accountId?: string;
  onAccountChange?: (next: string) => void;
  onFindSimilar?: (series: BarSeries, mark: CardMark, rSize: CardRSize) => void;
  onSaveAsRecipe?: (series: BarSeries, mark: CardMark, rSize: CardRSize) => void;
}

type RunState =
  | { status: "idle" }
  | { status: "loading"; mark: CardMark; progress: { done: number; total: number } }
  | { status: "error"; mark: CardMark; message: string }
  | { status: "done"; mark: CardMark; series: BarSeries; card: ContextCard; excluded: ExcludedSession[] };

const noSub = () => () => {};
let clientDefaultClock = "";
function getDefaultClock(): string {
  if (!clientDefaultClock) {
    const now = new Date();
    clientDefaultClock = `${etDay.format(now)}|${etClock.format(now)}`;
  }
  return clientDefaultClock;
}

function subscribeOnline(listener: () => void) {
  window.addEventListener("online", listener);
  window.addEventListener("offline", listener);
  return () => {
    window.removeEventListener("online", listener);
    window.removeEventListener("offline", listener);
  };
}

export function StrategyLabMark({
  seed = null, playbookId, onPlaybookChange, accountId: controlledAccount, onAccountChange, onFindSimilar, onSaveAsRecipe,
}: StrategyLabMarkProps = {}) {
  const accountStore = useAccounts();
  const playbooksStore = usePlaybooks();
  const journal = useJournal();
  const prefs = usePrefs();
  const accounts = accountStore.accounts.filter((account) => !account.archived);
  const playbooks = activePlaybooks(playbooksStore.playbooks, playbookId ?? null);
  const mesTrades = journal.trades.filter((t) => t.symbol === "MES" && !t.is_sample);

  // Empty on server render so SSR and hydration match; defaults populate from the client snapshot.
  const [defaultDate, defaultTime] = useSyncExternalStore(noSub, getDefaultClock, () => "|").split("|");
  const offline = useSyncExternalStore(subscribeOnline, () => !navigator.onLine, () => false);
  const [userDate, setDate] = useState<string | null>(seed?.date ?? null);
  const [userTime, setTime] = useState<string | null>(seed?.time ?? null);
  const date = userDate ?? defaultDate;
  const time = userTime ?? defaultTime;
  const [priceText, setPriceText] = useState(seed?.priceText ?? "");
  const [side, setSide] = useState<CardSide>(seed?.side ?? "long");
  const [localAccountId, setLocalAccountId] = useState(seed?.accountId ?? "");
  const [pickedTradeId, setPickedTradeId] = useState(seed?.tradeId ?? "");
  const [run, setRun] = useState<RunState>({ status: "idle" });

  const accountId = controlledAccount ?? localAccountId;
  const setAccountId = (next: string) => {
    setLocalAccountId(next);
    onAccountChange?.(next);
  };

  const minuteOfDay = parseTime(time);
  const price = Number(priceText);
  const priceValid = priceText.trim() !== "" && Number.isFinite(price) && price > 0;
  const selectedAccount = accounts.find((account) => account.id === accountId) ?? null;
  const rSize = labRSize(selectedAccount?.id ?? null, accounts, prefs);
  const cardRSize: CardRSize = { usd: rSize.usd, source: rSize.source, accountName: selectedAccount?.name ?? null };
  const canBuild = date !== "" && minuteOfDay !== null && priceValid && run.status !== "loading";

  function applyTrade(tradeId: string) {
    setPickedTradeId(tradeId);
    const found = journal.trades.find((t) => t.id === tradeId);
    if (!found) return;
    const next = seedFromTrade(found);
    if (!next) return;
    setDate(next.date);
    setTime(next.time);
    setPriceText(next.priceText);
    setSide(next.side);
    if (next.accountId !== undefined) setAccountId(next.accountId);
    if (found.playbook_id && onPlaybookChange) onPlaybookChange(found.playbook_id);
  }

  function stepTime(delta: number) {
    const base = minuteOfDay ?? 0;
    setTime(timeText((base + delta + 1440) % 1440));
  }

  function stepPrice(delta: number) {
    const base = priceValid ? snapToTick(price) : 0;
    setPriceText(String(Math.max(0, snapToTick(base + delta))));
  }

  async function build(mark: CardMark) {
    setRun({ status: "loading", mark, progress: { done: 0, total: 0 } });
    const session = sessionDate(markTimeUtc(mark));
    const dates = recentSessionDates(session, CONTEXT_SESSIONS);
    try {
      const data = await loadBarSeries(dates, {
        onProgress: (done, total) => setRun((prev) => (prev.status === "loading" ? { ...prev, progress: { done, total } } : prev)),
      });
      const loaded = data.loads.filter((load) => load.status === "loaded").length;
      if (loaded === 0) {
        setRun({ status: "error", mark, message: ERROR_TEXT });
        return;
      }
      const excluded: ExcludedSession[] = data.loads.flatMap((load) => (
        load.status === "excluded" ? [{ date: load.date, reason: EXCLUSION_TEXT[load.reason] }] : []
      ));
      const card = buildContextCard(data.series, mark, { rSize: cardRSize, shield: prefs.shield, excludedSessions: excluded.length });
      setRun({ status: "done", mark, series: data.series, card, excluded });
    } catch {
      setRun({ status: "error", mark, message: ERROR_TEXT });
    }
  }

  function onBuild(event: FormEvent) {
    event.preventDefault();
    if (!canBuild || minuteOfDay === null) return;
    void build({ date, minuteOfDay, price: snapToTick(price), side });
  }

  const state: CardState = deriveCardState({
    loading: run.status === "loading",
    error: run.status === "error" ? run.message : null,
    offline,
    card: run.status === "done" ? run.card : null,
  });

  return (
    <>
      <form className="sl-form" onSubmit={onBuild} aria-label="Mark a point">
        {onPlaybookChange ? (
          <div className="sl-field">
            <label className="sl-label" htmlFor="sl-playbook">Playbook</label>
            <select id="sl-playbook" className="sl-input" value={playbookId ?? ""} onChange={(e) => onPlaybookChange(e.target.value || null)}>
              <option value="">All playbooks (exploration)</option>
              {playbooks.map((pb) => <option key={pb.id} value={pb.id}>{pb.name}</option>)}
            </select>
          </div>
        ) : null}

        {mesTrades.length > 0 ? (
          <div className="sl-field">
            <label className="sl-label" htmlFor="sl-from-trade">From a trade</label>
            <select id="sl-from-trade" className="sl-input" value={pickedTradeId} onChange={(e) => applyTrade(e.target.value)}>
              <option value="">Choose an MES trade…</option>
              {mesTrades.slice(0, 40).map((t) => (
                <option key={t.id} value={t.id}>{t.entry_time.slice(0, 16).replace("T", " ")} · {t.direction} {t.entry_price}</option>
              ))}
            </select>
          </div>
        ) : null}

        <div className="sl-field">
          <label className="sl-label" htmlFor="sl-date">Date (ET)</label>
          <input id="sl-date" className="sl-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>

        <div className="sl-field">
          <label className="sl-label" htmlFor="sl-time">Time (ET, minute)</label>
          <div className="sl-row-inputs">
            <input id="sl-time" className="sl-input" type="time" step={60} value={time} onChange={(e) => setTime(e.target.value)} />
            <button type="button" className="sl-btn" onClick={() => stepTime(-1)} aria-label="Back one minute">−1m</button>
            <button type="button" className="sl-btn" onClick={() => stepTime(1)} aria-label="Forward one minute">+1m</button>
          </div>
        </div>

        <div className="sl-field">
          <label className="sl-label" htmlFor="sl-price">Price (tick 0.25)</label>
          <div className="sl-row-inputs">
            <input
              id="sl-price"
              className="sl-input"
              inputMode="decimal"
              placeholder="5912.25"
              value={priceText}
              onChange={(e) => setPriceText(e.target.value)}
              aria-invalid={priceText !== "" && !priceValid}
            />
            <button type="button" className="sl-btn" onClick={() => stepPrice(-MES_TICK)} aria-label="Down one tick">−</button>
            <button type="button" className="sl-btn" onClick={() => stepPrice(MES_TICK)} aria-label="Up one tick">+</button>
          </div>
        </div>

        <div className="sl-field">
          <span className="sl-label" id="sl-side-label">Side</span>
          <div className="sl-seg" role="group" aria-labelledby="sl-side-label">
            <button type="button" aria-pressed={side === "long"} onClick={() => setSide("long")}>Long</button>
            <button type="button" aria-pressed={side === "short"} onClick={() => setSide("short")}>Short</button>
          </div>
        </div>

        <div className="sl-field">
          <label className="sl-label" htmlFor="sl-account">Account</label>
          <select id="sl-account" className="sl-input" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">No account · default R</option>
            {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
          </select>
          {run.status === "idle" ? <p className="sl-hint">{rSizeBasis(cardRSize, prefs.shield)}</p> : null}
        </div>

        {!priceValid && priceText !== "" ? <p className="sl-error-text" role="alert">Enter a price above 0.</p> : null}
        <button type="submit" className="sl-btn sl-btn--primary sl-btn--block" disabled={!canBuild}>Build context card</button>
      </form>

      {run.status !== "idle" ? (
        <StrategyLabContextCard
          state={state}
          card={run.status === "done" ? run.card : null}
          message={run.status === "error" ? run.message : null}
          progress={run.status === "loading" ? run.progress : null}
          excluded={run.status === "done" ? run.excluded : []}
          onRetry={() => { void build(run.mark); }}
          onFindSimilar={run.status === "done" && onFindSimilar ? () => onFindSimilar(run.series, run.mark, cardRSize) : undefined}
          onSaveAsRecipe={run.status === "done" && onSaveAsRecipe ? () => onSaveAsRecipe(run.series, run.mark, cardRSize) : undefined}
        />
      ) : null}
    </>
  );
}
