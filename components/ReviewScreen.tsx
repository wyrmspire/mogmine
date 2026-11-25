"use client";

import Link from "next/link";
import { useState } from "react";
import { PastSessionReviews } from "./PastSessionReviews";
import { PitStop } from "./PitStop";
import { RStrip } from "./RStrip";
import { ReviewChart } from "./ReviewChart";
import { MoodShape, useTradeMood } from "./MoodShape";
import { describeMood } from "@/lib/mood";
import { formatDuration, formatMoney, formatPoints, formatPrice, formatR } from "@/lib/format";
import { setPrefs, usePrefs } from "@/lib/prefs";
import { withSamples } from "@/lib/selectors";
import { formatSessionDate, sessionDate } from "@/lib/session";
import { updateTrade, useJournal } from "@/lib/store";
import { formatListTime } from "@/lib/time";
import { showToast } from "@/lib/toast";
import { holdSeconds, tradePnl, tradePoints } from "@/lib/trades";
import { resolveRSize, resultR } from "@/lib/r-size";
import { useAccounts } from "@/lib/accounts-store";
import type { TradeRecord } from "@/lib/trades";
import { rememberList } from "@/lib/ui";
import { SAMPLE_CAPTION, SAMPLE_CHIP } from "@/lib/fixtures";

export function ReviewScreen() {
  const journal = useJournal();
  if (!journal.hydrated) {
    return <div className="page" style={{ maxWidth: 720 }}><div className="page-head"><div><span className="eyebrow">Review queue</span><h1>Loading…</h1></div></div><div className="skeleton" style={{ height: 380 }} /></div>;
  }
  return <Queue />;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_CHIP_LIMIT = 14;

/** Short day chip label, `Mon 23`. Session dates are labels, so UTC is the calendar. */
function dayChipLabel(date: string) {
  const day = new Date(`${date}T00:00:00Z`);
  return `${WEEKDAYS[day.getUTCDay()]} ${day.getUTCDate()}`;
}

/** One trade at a time, untagged first, so a session's tagging is finished in about a minute (docs/05 §2C). */
function Queue() {
  const journal = useJournal();
  const prefs = usePrefs();
  const accounts = useAccounts();
  const pending = withSamples(journal.trades, prefs.showSamples).filter((trade) => trade.review_status !== "reviewed");
  // Queue and day chips are fixed when the screen opens: tagging a trade must not make the card or the chips jump away.
  const [dayOptions] = useState(() => [...new Set(pending.map((trade) => sessionDate(trade.entry_time)))].sort((a, b) => (a < b ? 1 : -1)).slice(0, DAY_CHIP_LIMIT));
  const queueFor = (day: string | null) => {
    const open = day ? pending.filter((trade) => sessionDate(trade.entry_time) === day) : pending;
    return [...open.filter((trade) => trade.review_status === "new"), ...open.filter((trade) => trade.review_status !== "new")].map((trade) => trade.id);
  };
  const [day, setDay] = useState<string | null>(null);
  const [ids, setIds] = useState(() => queueFor(null));
  const [position, setPosition] = useState(0);
  const [revealed, setRevealed] = useState<string | null>(null);
  // Only a different day chip rebuilds the queue; tagging alone never does.
  const chooseDay = (next: string | null) => {
    if (next === day) return;
    setDay(next);
    setIds(queueFor(next));
    setPosition(0);
    setRevealed(null);
  };

  const dayChips = dayOptions.length > 0 && (
    <div className="filter-bar" role="group" aria-label="Review by trading day" style={{ margin: "0 0 14px" }}>
      {[null, ...dayOptions].map((option) => (
        <button
          key={option ?? "all"}
          type="button"
          className="pill"
          style={{ minHeight: 44, minWidth: 44 }}
          aria-pressed={day === option}
          onClick={() => chooseDay(option)}
        >
          {option ? dayChipLabel(option) : "All days"}
        </button>
      ))}
    </div>
  );

  const trade = journal.trades.find((item) => item.id === ids[position]);
  const done = ids.filter((id) => journal.trades.find((item) => item.id === id)?.review_status === "reviewed").length;

  if (!trade) {
    return (
      <div className="page" style={{ maxWidth: 720 }}>
        <div className="page-head"><div><span className="eyebrow">Review queue</span><h1>All caught up</h1></div></div>
        {dayChips}
        <div className="specular-card empty-state">
          <h3>{ids.length ? `${done} of ${ids.length} reviewed this pass` : "Nothing is waiting"}</h3>
          <p>{ids.length && done < ids.length ? "Skipped trades stay in the queue for next time." : "Every trade has been reviewed."}</p>
          <div className="actions"><Link className="btn-secondary" style={{ minHeight: 44, minWidth: 44, display: "inline-flex", alignItems: "center", justifyContent: "center" }} href="/feed">Open the feed</Link><Link className="btn-secondary" style={{ minHeight: 44, minWidth: 44, display: "inline-flex", alignItems: "center", justifyContent: "center" }} href="/drills">Drills: Take it?</Link></div>
        </div>
        <PastSessionReviews />
      </div>
    );
  }

  const sealed = prefs.blindReview && revealed !== trade.id && !trade.take_again;
  const advance = () => { setPosition(position + 1); setRevealed(null); };
  const finish = () => {
    updateTrade(trade.id, { review_status: "reviewed" });
    showToast("Marked reviewed", { label: "Undo", run: () => updateTrade(trade.id, { review_status: "new" }) });
    advance();
  };
  const grade = (answer: NonNullable<TradeRecord["take_again"]>) => {
    updateTrade(trade.id, { take_again: answer, take_again_at: new Date().toISOString() });
    setRevealed(trade.id);
  };

  const pnl = tradePnl(trade);
  const r = resultR(trade, resolveRSize(trade, accounts.accounts, prefs));
  const points = formatPoints(tradePoints(trade), trade.symbol);

  return (
    <div className="page" style={{ maxWidth: 720 }}>
      <div className="page-head">
        <div><span className="eyebrow">Review queue</span><h1>{position + 1} of {ids.length}</h1><p>Playbook, tags, one line. Then mark it reviewed.</p></div>
        <Link className="btn-secondary drill-link" style={{ minHeight: 44, minWidth: 44, display: "inline-flex", alignItems: "center", justifyContent: "center" }} href="/drills">Drills</Link>
      </div>
      {dayChips}

      <section className="specular-card queue-card" aria-label={`Trade ${position + 1} of ${ids.length}`}>
        <div className="queue-progress" role="progressbar" aria-valuenow={position + 1} aria-valuemin={1} aria-valuemax={ids.length} aria-label={`Review progress, trade ${position + 1} of ${ids.length}`}><i style={{ width: `${(position / ids.length) * 100}%` }} /></div>
        <div className="queue-head">
          <span className="row-main">
            <span className="row-title">
              <strong>{trade.symbol}</strong>
              <span className={`direction ${trade.direction === "LONG" ? "long" : "short"}`}><span aria-hidden="true">{trade.direction === "LONG" ? "▲ " : "▼ "}</span>{trade.direction}</span>
              {trade.is_sample && <span className="tag-chip" title={SAMPLE_CAPTION}>{SAMPLE_CHIP}</span>}
            </span>
            {/* UX-c: each unit stays whole ("Fri, Nov 13", "3m 30s"); the line breaks only between units. */}
            <span className="row-meta queue-meta">
              <span>{formatSessionDate(sessionDate(trade.entry_time))}</span>
              <span>· {formatListTime(trade.entry_time, prefs.timeZone)}</span>
              <span>· in at {formatPrice(trade.entry_price, trade.symbol)}</span>
              {!sealed && <span>· {formatDuration(holdSeconds(trade))}</span>}
            </span>
          </span>
          {sealed ? (
            // Not rendered at all while sealed: a blur still showed the result's red or green.
            <>
              <span aria-hidden="true" />
              <span className="row-result muted" style={{ textAlign: "right", fontSize: 12 }}>Result hidden</span>
            </>
          ) : (
            <>
              <span><RStrip trade={trade} blind={false} /></span>
              <span className="row-result num" style={{ textAlign: "right" }}>
                <b className={(pnl ?? 0) > 0 ? "positive" : (pnl ?? 0) < 0 ? "negative" : ""} style={{ display: "block", fontSize: 16 }}>{prefs.shield ? (r != null ? formatR(r) : points) : formatMoney(pnl)}</b>
                <span className="muted" style={{ fontSize: 11 }}>{prefs.shield ? (r != null ? points : "") : formatR(r)}</span>
              </span>
            </>
          )}
        </div>

        <ReviewChart key={trade.id} trade={trade} sealed={sealed} zone={prefs.timeZone} privacy={prefs.shield} />

        {sealed ? (
          <div className="blind-ask">
            <h3>Take it again?</h3>
            <p>Judge the entry before you see how it ended. The result stays hidden until you answer.</p>
            <SealedMood trade={trade} />
            <div className="choices">
              <button type="button" className="btn-secondary" style={{ minHeight: 44, minWidth: 44 }} onClick={() => grade("yes")}>Yes</button>
              <button type="button" className="btn-secondary" style={{ minHeight: 44, minWidth: 44 }} onClick={() => grade("smaller")}>Smaller</button>
              <button type="button" className="btn-secondary" style={{ minHeight: 44, minWidth: 44 }} onClick={() => grade("pass")}>Pass</button>
            </div>
          </div>
        ) : (
          <div className="queue-body"><PitStop trade={trade} compact /></div>
        )}

        <div className="queue-foot">
          <button type="button" className="btn-ghost" style={{ minHeight: 44, minWidth: 44 }} onClick={advance} aria-label="Skip trade">Skip</button>
          <Link className="btn-secondary" style={{ minHeight: 44, minWidth: 44, display: "inline-flex", alignItems: "center", justifyContent: "center" }} href={`/trades/${trade.id}`} onClick={() => rememberList({ ids, label: "Review queue", href: "/review" })}>{sealed ? "Chart later" : "Full chart"}</Link>
          <button type="button" className="btn-primary" style={{ minHeight: 44, minWidth: 44 }} disabled={sealed} onClick={finish} aria-label="Mark trade reviewed">Reviewed ✓</button>
        </div>
      </section>

      <div className="card card-pad" style={{ marginTop: 14 }}>
        <div className="toggle-row">
          <span>Blind review<small>Hide the result until you have judged the entry. Works best on trades older than a week.</small></span>
          <button type="button" className="switch-hit" style={{ minHeight: 44, minWidth: 44 }} role="switch" aria-checked={prefs.blindReview} aria-label="Blind review" onClick={() => setPrefs({ blindReview: !prefs.blindReview })}><span className="switch" data-checked={prefs.blindReview} aria-hidden="true" /></button>
        </div>
      </div>
      <PastSessionReviews />
    </div>
  );
}

/** Blind review keeps the Mood Shape visible: judge the trade by the state of mind, not the result. */
function SealedMood({ trade }: { trade: TradeRecord }) {
  const vector = useTradeMood(trade);
  if (!vector.values.some((value) => value != null)) return null;
  return (
    <div className="blind-mood">
      <MoodShape vector={vector} size={96} />
      <span>How it felt: {describeMood(vector)}</span>
    </div>
  );
}
