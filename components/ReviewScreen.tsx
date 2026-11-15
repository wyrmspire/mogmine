"use client";

import Link from "next/link";
import { useState } from "react";
import { PitStop } from "./PitStop";
import { Sparkline } from "./Sparkline";
import { formatDuration, formatMoney, formatPoints, formatPrice, formatR } from "@/lib/format";
import { setPrefs, usePrefs } from "@/lib/prefs";
import { withSamples } from "@/lib/selectors";
import { formatSessionDate, sessionDate } from "@/lib/session";
import { updateTrade, useJournal } from "@/lib/store";
import { formatListTime } from "@/lib/time";
import { showToast } from "@/lib/toast";
import { holdSeconds, rMultiple, tradePnl, tradePoints } from "@/lib/trades";
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

/** One trade at a time, untagged first, so a session's tagging is finished in about a minute (docs/05 §2C). */
function Queue() {
  const journal = useJournal();
  const prefs = usePrefs();
  // The queue is fixed when the screen opens: tagging a trade must not make the card jump away.
  const [ids] = useState(() => {
    const open = withSamples(journal.trades, prefs.showSamples).filter((trade) => trade.review_status !== "reviewed");
    return [...open.filter((trade) => trade.review_status === "new"), ...open.filter((trade) => trade.review_status !== "new")].map((trade) => trade.id);
  });
  const [position, setPosition] = useState(0);
  const [revealed, setRevealed] = useState<string | null>(null);

  const trade = journal.trades.find((item) => item.id === ids[position]);
  const done = ids.filter((id) => journal.trades.find((item) => item.id === id)?.review_status === "reviewed").length;

  if (!trade) {
    return (
      <div className="page" style={{ maxWidth: 720 }}>
        <div className="page-head"><div><span className="eyebrow">Review queue</span><h1>All caught up</h1></div></div>
        <div className="specular-card empty-state">
          <h3>{ids.length ? `${done} of ${ids.length} reviewed this pass` : "Nothing is waiting"}</h3>
          <p>{ids.length && done < ids.length ? "Skipped trades stay in the queue for next time." : "Every trade has been reviewed."}</p>
          <div className="actions"><Link className="btn-secondary" href="/feed">Open the feed</Link></div>
        </div>
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
  const r = rMultiple(trade);
  const points = formatPoints(tradePoints(trade), trade.symbol);

  return (
    <div className="page" style={{ maxWidth: 720 }}>
      <div className="page-head">
        <div><span className="eyebrow">Review queue</span><h1>{position + 1} of {ids.length}</h1><p>Playbook, tags, one line. Then mark it reviewed.</p></div>
      </div>

      <section className="specular-card queue-card" aria-label={`Trade ${position + 1} of ${ids.length}`}>
        <div className="queue-progress" aria-hidden="true"><i style={{ width: `${(position / ids.length) * 100}%` }} /></div>
        <div className="queue-head">
          <span className="row-main">
            <span className="row-title">
              <strong>{trade.symbol}</strong>
              <span className={`direction ${trade.direction === "LONG" ? "long" : "short"}`}><span aria-hidden="true">{trade.direction === "LONG" ? "▲ " : "▼ "}</span>{trade.direction}</span>
              {trade.is_sample && <span className="tag-chip" title={SAMPLE_CAPTION}>{SAMPLE_CHIP}</span>}
            </span>
            <span className="row-meta" style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)" }}>
              {formatSessionDate(sessionDate(trade.entry_time))} · {formatListTime(trade.entry_time, prefs.timeZone)} · in at {formatPrice(trade.entry_price, trade.symbol)}{sealed ? "" : ` · ${formatDuration(holdSeconds(trade))}`}
            </span>
          </span>
          <span className={sealed ? "sealed" : ""} aria-hidden={sealed}><Sparkline points={trade.sparkline} /></span>
          <span className={`row-result num ${sealed ? "sealed" : ""}`} aria-hidden={sealed} style={{ textAlign: "right" }}>
            <b className={(pnl ?? 0) > 0 ? "positive" : (pnl ?? 0) < 0 ? "negative" : ""} style={{ display: "block", fontSize: 16 }}>{prefs.shield ? (r != null ? formatR(r) : points) : formatMoney(pnl)}</b>
            <span className="muted" style={{ fontSize: 11 }}>{prefs.shield ? (r != null ? points : "") : formatR(r)}</span>
          </span>
        </div>

        {sealed ? (
          <div className="blind-ask">
            <h3>Take it again?</h3>
            <p>Judge the entry before you see how it ended. The result stays hidden until you answer.</p>
            <div className="choices">
              <button type="button" className="btn-secondary" onClick={() => grade("yes")}>Yes</button>
              <button type="button" className="btn-secondary" onClick={() => grade("smaller")}>Smaller</button>
              <button type="button" className="btn-secondary" onClick={() => grade("pass")}>Pass</button>
            </div>
          </div>
        ) : (
          <div className="queue-body"><PitStop trade={trade} compact /></div>
        )}

        <div className="queue-foot">
          <button type="button" className="btn-ghost" onClick={advance}>Skip</button>
          <Link className="btn-secondary" href={`/trades/${trade.id}`} onClick={() => rememberList({ ids, label: "Review queue", href: "/review" })}>{sealed ? "Chart later" : "Open chart"}</Link>
          <button type="button" className="btn-primary" disabled={sealed} onClick={finish}>Reviewed ✓</button>
        </div>
      </section>

      <div className="card card-pad" style={{ marginTop: 14 }}>
        <div className="toggle-row">
          <span>Blind review<small>Hide the result until you have judged the entry. Works best on trades older than a week.</small></span>
          <button type="button" className="switch-hit" role="switch" aria-checked={prefs.blindReview} aria-label="Blind review" onClick={() => setPrefs({ blindReview: !prefs.blindReview })}><span className="switch" data-checked={prefs.blindReview} aria-hidden="true" /></button>
        </div>
      </div>
    </div>
  );
}
