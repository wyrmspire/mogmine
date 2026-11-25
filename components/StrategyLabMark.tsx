"use client";

// Mark a point, then build its Context Card (docs/design-2026-11-24/09 §1, §10.1 step 1–2, §12.1).
// Loads the recent 1m sessions through lib/strategy-lab/bars.ts, builds the card with the pure model, and
// hands the result to StrategyLabContextCard. The R size comes from labRSize, never from a stop width.
import { useEffect, useState, type FormEvent } from "react";
import { StrategyLabContextCard, type ExcludedSession } from "@/components/StrategyLabContextCard";
import { useAccounts } from "@/lib/accounts-store";
import { sessionDate } from "@/lib/session";
import { usePrefs } from "@/lib/prefs";
import { labRSize } from "@/lib/strategy-lab/r";
import {
  buildContextCard, deriveCardState, markTimeUtc, rSizeBasis,
  type CardMark, type CardRSize, type CardSide, type CardState, type ContextCard,
} from "@/lib/strategy-lab/context-card";
import { loadBarSeries, recentSessionDates, type ExclusionReason } from "@/lib/strategy-lab/bars";

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

type RunState =
  | { status: "idle" }
  | { status: "loading"; mark: CardMark; progress: { done: number; total: number } }
  | { status: "error"; mark: CardMark; message: string }
  | { status: "done"; mark: CardMark; card: ContextCard; excluded: ExcludedSession[] };

export function StrategyLabMark() {
  const accountStore = useAccounts();
  const prefs = usePrefs();
  const accounts = accountStore.accounts.filter((account) => !account.archived);

  // Set after mount, so the server and the first client render match.
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [priceText, setPriceText] = useState("");
  const [side, setSide] = useState<CardSide>("long");
  const [accountId, setAccountId] = useState("");
  const [offline, setOffline] = useState(false);
  const [run, setRun] = useState<RunState>({ status: "idle" });

  useEffect(() => {
    const now = Date.now();
    setDate(etDay.format(new Date(now)));
    setTime(etClock.format(new Date(now)));
    const sync = () => setOffline(!navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  const minuteOfDay = parseTime(time);
  const price = Number(priceText);
  const priceValid = priceText.trim() !== "" && Number.isFinite(price) && price > 0;
  const selectedAccount = accounts.find((account) => account.id === accountId) ?? null;
  const rSize = labRSize(selectedAccount?.id ?? null, accounts, prefs);
  const cardRSize: CardRSize = { usd: rSize.usd, source: rSize.source, accountName: selectedAccount?.name ?? null };
  const canBuild = date !== "" && minuteOfDay !== null && priceValid && run.status !== "loading";

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
      setRun({ status: "done", mark, card, excluded });
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
        />
      ) : null}
    </>
  );
}
