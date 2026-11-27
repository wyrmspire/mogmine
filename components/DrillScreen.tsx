"use client";

// CD-2c: drill cards (docs/23 §4, OD-46). Take it? on your own older trades: a sealed front cut at the
// entry, one answer, then the reveal. Bars come only from the per-trade candle cache; a drill never
// fetches (invariant 2). Answers go to `mogmine-drills-v1` (CD-2b), never to `take_again`.
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { TradeChart } from "./TradeChart";
import type { StoredCandles } from "@/lib/candles";
import { DRILL_HIDDEN, DRILL_SCORE_MIN_ANSWERS, cutAtEntry, drillRevealRuleNote, drillSkipReason, isMiss, missesDeck, playbookDeck, takeVsPass, warmupDeck } from "@/lib/drills";
import type { Deck, DrillAnswer, DrillSkip } from "@/lib/drills";
import { addDrillAnswer, useDrills } from "@/lib/drills-store";
import { formatR } from "@/lib/format";
import { idbGet } from "@/lib/idb";
import { playbookName } from "@/lib/playbooks";
import { usePrefs } from "@/lib/prefs";
import { useJournal } from "@/lib/store";
import { formatListTime } from "@/lib/time";
import { observeTrade } from "@/lib/trade-bar-validation";
import { deriveTrade, fromLegacy } from "@/lib/trade-document";
import { buildMarks } from "@/lib/trade-marks";
import { TIMEFRAME_MINUTES, candleCacheKey, processRead } from "@/lib/trades";
import { resolveRSize, resultR, riskR } from "@/lib/r-size";
import { useAccounts } from "@/lib/accounts-store";
import type { TradeRecord } from "@/lib/trades";

const SKIP_TEXT: Record<DrillSkip, string> = {
  open: "still open", sample: "demo", too_recent: "newer than 7 days", no_bars: "no saved bars",
};
const ANSWERS: readonly [DrillAnswer, string][] = [["take", "Take it"], ["smaller", "Smaller"], ["pass", "Pass"]];

export function DrillScreen() {
  const journal = useJournal();
  const { records } = useDrills();
  const prefs = usePrefs();
  const accounts = useAccounts();
  const rSize = useMemo(() => ({ accounts: accounts.accounts, prefs }), [accounts.accounts, prefs]);
  const [bars, setBars] = useState<Map<string, StoredCandles> | null>(null);
  const [deck, setDeck] = useState<(Deck & { name: string; playbook: string | null }) | null>(null);
  const [position, setPosition] = useState(0);
  const [answered, setAnswered] = useState<Map<string, DrillAnswer>>(new Map());
  const [playbook, setPlaybook] = useState("");
  // The clock is read once, so a deck and its due dates do not shift while the screen is open.
  const [now] = useState(() => Date.now());

  // Read saved bars for every trade that could be dealt. Nothing is fetched.
  useEffect(() => {
    if (!journal.hydrated) return;
    let alive = true;
    const candidates = journal.trades.filter((trade) => drillSkipReason(trade, now, true) === null);
    void Promise.all(candidates.map(async (trade) => [trade.id, await idbGet<StoredCandles>(candleCacheKey(trade)).catch(() => undefined)] as const))
      .then((entries) => {
        if (!alive) return;
        setBars(new Map(entries.flatMap(([id, stored]) => (stored?.candles?.length ? [[id, stored] as const] : []))));
      });
    return () => { alive = false; };
  }, [journal.hydrated, journal.trades, now]);

  const hasBars = useMemo(() => (id: string) => Boolean(bars?.has(id)), [bars]);
  const byId = useMemo(() => new Map(journal.trades.map((trade) => [trade.id, trade])), [journal.trades]);
  const playbooks = useMemo(() => [...new Set(journal.trades.flatMap((trade) => (trade.playbook_id ? [trade.playbook_id] : [])))], [journal.trades]);
  const misses = useMemo(() => (bars ? missesDeck(journal.trades, records, now, hasBars, rSize) : null), [bars, journal.trades, records, now, hasBars, rSize]);
  const score = useMemo(() => takeVsPass(records, journal.trades, rSize), [records, journal.trades, rSize]);

  if (!journal.hydrated || !bars) {
    return (
      <div className="page drill-page" role="status" aria-label="Loading drills…">
        <div className="page-head"><div><span className="eyebrow">Drills</span><h1>Loading…</h1></div></div>
        <div className="skeleton" style={{ height: 320 }} aria-hidden="true" />
      </div>
    );
  }

  const start = (next: Deck, name: string, pb: string | null = null) => { setDeck({ ...next, name, playbook: pb }); setPosition(0); setAnswered(new Map()); };
  const trade = deck ? byId.get(deck.trade_ids[position]) : undefined;

  if (!deck) {
    const warm = warmupDeck(journal.trades, now, hasBars, now);
    return (
      <div className="page drill-page">
        <div className="page-head"><div><span className="eyebrow">Drills</span><h1>Take it?</h1><p>Judge your own older trades from the chart at entry. The result shows after you answer.</p></div></div>
        <div className="specular-card card-pad drill-decks">
          <button type="button" className="btn-primary" disabled={!warm.trade_ids.length} onClick={() => start(warm, "Warm-up")} aria-label={`Start Warm-up drill, ${warm.trade_ids.length} ${warm.trade_ids.length === 1 ? "trade" : "trades"}`}>
            Warm-up · {warm.trade_ids.length} {warm.trade_ids.length === 1 ? "trade" : "trades"}
          </button>
          <button type="button" className="btn-secondary" disabled={!misses?.trade_ids.length} onClick={() => misses && start(misses, "Misses")} aria-label={`Start Misses due drill, ${misses?.trade_ids.length ?? 0} ${misses?.trade_ids.length === 1 ? "trade" : "trades"}`}>
            Misses due · {misses?.trade_ids.length ?? 0}
          </button>
          <div className="drill-playbook">
            <select value={playbook} onChange={(event) => setPlaybook(event.target.value)} aria-label="Choose a playbook deck">
              <option value="">Choose a playbook…</option>
              {playbooks.map((id) => <option key={id} value={id}>{playbookName(id) ?? id}</option>)}
            </select>
            <button type="button" className="btn-secondary" disabled={!playbook} onClick={() => start(playbookDeck(journal.trades, playbook, now, hasBars), playbookName(playbook) ?? "Playbook", playbook)} aria-label={playbook ? `Start drill for playbook ${playbookName(playbook) ?? playbook}` : "Start playbook drill"}>Start</button>
          </div>
          <SkipLine skipped={warm.skipped} />
        </div>
        <ScoreCard score={score} />
      </div>
    );
  }

  if (!trade) {
    return (
      <div className="page drill-page">
        <div className="page-head"><div><span className="eyebrow">Drills · {deck.name}</span><h1>{deck.trade_ids.length ? "Deck done" : "Nothing to drill"}</h1></div></div>
        <div className="specular-card card-pad drill-decks">
          <p className="num">{answered.size} answered this round.</p>
          <SkipLine skipped={deck.skipped} />
          <button type="button" className="btn-primary" onClick={() => setDeck(null)} aria-label="Choose another drill deck">Choose another deck</button>
        </div>
        <ScoreCard score={score} />
      </div>
    );
  }

  const answer = answered.get(trade.id) ?? null;
  const stored = bars.get(trade.id)!;
  return (
    <div className="page drill-page">
      <div className="page-head"><div><span className="eyebrow num">Drills · {deck.name} · {position + 1} of {deck.trade_ids.length}</span><h1>Take it?</h1></div></div>
      <DrillCard
        key={trade.id}
        trade={trade}
        stored={stored}
        answer={answer}
        showPlaybook={deck.playbook != null}
        zone={prefs.timeZone}
        privacy={prefs.shield}
        onAnswer={(value) => {
          addDrillAnswer({ trade_id: trade.id, kind: "take_it", answer: value, hidden: DRILL_HIDDEN });
          setAnswered(new Map(answered).set(trade.id, value));
        }}
        onNext={() => setPosition(position + 1)}
      />
    </div>
  );
}

function DrillCard({ trade, stored, answer, showPlaybook, zone, privacy, onAnswer, onNext }: {
  trade: TradeRecord; stored: StoredCandles; answer: DrillAnswer | null; showPlaybook: boolean; zone: string; privacy: boolean;
  onAnswer: (answer: DrillAnswer) => void; onNext: () => void;
}) {
  const timeframe = stored.baseTimeframe;
  // The front never sees the exit: it is drawn as an open trade on bars that closed by the entry.
  const sealedTrade = useMemo(() => ({ ...trade, exit_time: null, exit_price: null, status: "open" as const }), [trade]);
  const frontBars = useMemo(() => cutAtEntry(stored.candles, trade.entry_time, timeframe), [stored, trade.entry_time, timeframe]);
  const accounts = useAccounts();
  const prefs = usePrefs();
  const marks = useMemo(() => {
    if (!answer) return [];
    const derived = deriveTrade(fromLegacy(trade));
    const observed = observeTrade(derived, stored.candles, TIMEFRAME_MINUTES[timeframe]);
    const accountRiskR = riskR(trade, resolveRSize(trade, accounts.accounts, prefs));
    return buildMarks(derived, observed, timeframe, "low", privacy, { candleTimes: stored.candles.map(({ time }) => time), accountRiskR });
  }, [answer, trade, stored, timeframe, privacy, accounts.accounts, prefs]);
  const r = resultR(trade, resolveRSize(trade, accounts.accounts, prefs));
  const process = processRead(trade);
  const miss = answer ? isMiss(answer, trade, { accounts: accounts.accounts, prefs }) : null;
  // docs/23 §9: teach the frozen rule on the reveal, whichever deck dealt the trade.
  const ruleNote = drillRevealRuleNote(trade);

  return (
    <div className="specular-card drill-card">
      <div className="card-pad drill-front-meta num">
        <b>{trade.direction === "LONG" ? "Long" : "Short"} {trade.symbol}</b>
        <span>{formatListTime(trade.entry_time, zone)}</span>
        {showPlaybook && <span>{playbookName(trade.playbook_id)}</span>}
        <span className="muted">{answer ? "Revealed" : "Sealed at entry"}</span>
      </div>
      <div className="chart-frame drill-chart">
        {answer
          ? <TradeChart trade={trade} bars={stored.candles} timeframe={timeframe} marks={marks} zone={zone} privacy={privacy} />
          : frontBars.length
            ? <TradeChart trade={sealedTrade} bars={frontBars} timeframe={timeframe} marks={[]} zone={zone} privacy={privacy} />
            : <div className="chart-skeleton"><span>No bars before the entry were saved.</span></div>}
      </div>
      <div className="card-pad">
        {!answer ? (
          <div className="drill-answers" role="group" aria-label="Would you take this trade?">
            {ANSWERS.map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={value === "take" ? "btn-primary" : "btn-secondary"}
                onClick={() => onAnswer(value)}
                aria-label={`Answer: ${label}`}
                style={{ minHeight: 46 }}
              >
                {label}
              </button>
            ))}
          </div>
        ) : (
          <div className="drill-reveal" role="status" aria-live="polite">
            <p className="num">
              <b>{formatR(r)}</b>
              {process && <span> · rules {process === "clean" ? "followed (clean)" : "broken"}</span>}
              <span> · you said {ANSWERS.find(([value]) => value === answer)?.[1]}</span>
            </p>
            {ruleNote.kind !== "none" && (
              <p className="drill-rule num">
                {ruleNote.kind === "broken"
                  ? <>Broken rule: <b>{ruleNote.ruleLabel}</b> ({ruleNote.followed}/{ruleNote.total} followed)</>
                  : <>All {ruleNote.total} rules followed</>}
              </p>
            )}
            {playbookName(trade.playbook_id) && <p className="muted drill-playbook-name">{playbookName(trade.playbook_id)}</p>}
            {miss && (
              <p className="drill-miss" role="alert">
                <span aria-hidden="true">⚠️ </span>
                This one comes back tomorrow: your answer disagreed with how it went.
              </p>
            )}
            <div className="drill-answers">
              <Link
                className="btn-secondary"
                href={`/trades/${trade.id}`}
                aria-label={`Open trade ${trade.symbol} entered at ${formatListTime(trade.entry_time, zone)}`}
                style={{ minHeight: 46 }}
              >
                Open trade
              </Link>
              <button
                type="button"
                className="btn-primary"
                onClick={onNext}
                aria-label="Next drill trade"
                style={{ minHeight: 46 }}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SkipLine({ skipped }: { skipped: Deck["skipped"] }) {
  const parts = (Object.entries(skipped) as [DrillSkip, number][]).filter(([, n]) => n > 0)
    .map(([reason, n]) => `${n} ${n === 1 ? "trade" : "trades"} skipped: ${SKIP_TEXT[reason]}`);
  return parts.length ? <p className="drill-skips num">{parts.join(" · ")}</p> : null;
}

function ScoreCard({ score }: { score: ReturnType<typeof takeVsPass> }) {
  const answered = score.take.n + score.smaller.n + score.pass.n + score.noR;
  return (
    <div className="specular-card card-pad drill-score num" role="region" aria-label="Drill score summary">
      <span className="eyebrow">Your read</span>
      {score.ready ? (
        <p>Take it: {formatR(score.take.avgR)} avg (n {score.take.n}) · Pass: {formatR(score.pass.avgR)} avg (n {score.pass.n})</p>
      ) : (
        <p>{answered}/{DRILL_SCORE_MIN_ANSWERS} trades answered. The take-versus-pass comparison appears at {DRILL_SCORE_MIN_ANSWERS}.</p>
      )}
    </div>
  );
}
