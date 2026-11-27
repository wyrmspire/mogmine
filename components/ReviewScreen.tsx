"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { PastSessionReviews } from "./PastSessionReviews";
import { PitStop, showsNoSetupPicked } from "./PitStop";
import { RStrip } from "./RStrip";
import { ReviewChart } from "./ReviewChart";
import { MoodShape, useTradeMood } from "./MoodShape";
import { describeMood } from "@/lib/mood";
import { formatDuration, formatMoney, formatPoints, formatPrice, formatR } from "@/lib/format";
import { formatRealReviewQueueSummary, pendingReviewTrades } from "@/lib/day-counts";
import { setPrefs, usePrefs } from "@/lib/prefs";
import { formatSessionDate, sessionDate } from "@/lib/session";
import { dayStatus, recentTradingDays } from "@/lib/day-review-screen";
import { useDailyReviewsStore } from "@/lib/daily-review-store";
import { usePlansStore } from "@/lib/plans-store";
import { updateTrade, useJournal } from "@/lib/store";
import { formatListTime } from "@/lib/time";
import { showToast } from "@/lib/toast";
import { holdSeconds, tradePnl, tradePoints } from "@/lib/trades";
import { resolveRSize, resultR } from "@/lib/r-size";
import { useAccounts } from "@/lib/accounts-store";
import type { TradeRecord } from "@/lib/trades";
import { rememberList, useToday } from "@/lib/ui";
import { SAMPLE_CAPTION, SAMPLE_CHIP } from "@/lib/fixtures";

export function ReviewScreen() {
  const journal = useJournal();
  if (!journal.hydrated) {
    return (
      <div className="page" style={{ maxWidth: 720 }}>
        <div className="page-head"><div><span className="eyebrow">Review</span><h1>Loading…</h1></div></div>
        <div className="skeleton" style={{ height: 380 }} />
      </div>
    );
  }
  return <ReviewHub />;
}

type ReviewTab = "queue" | "daily";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_CHIP_LIMIT = 14;

/** Short day chip label, `Mon 23`. Session dates are labels, so UTC is the calendar. */
function dayChipLabel(date: string) {
  const day = new Date(`${date}T00:00:00Z`);
  return `${WEEKDAYS[day.getUTCDay()]} ${day.getUTCDate()}`;
}

function buildDayOptions(list: readonly TradeRecord[]) {
  return [...new Set(list.map((trade) => sessionDate(trade.entry_time)))]
    .sort((a, b) => (a < b ? 1 : -1))
    .slice(0, DAY_CHIP_LIMIT);
}

function buildQueueIds(list: readonly TradeRecord[], selectedDay: string | null) {
  const open = selectedDay ? list.filter((trade) => sessionDate(trade.entry_time) === selectedDay) : list;
  return [
    ...open.filter((trade) => trade.review_status === "new"),
    ...open.filter((trade) => trade.review_status !== "new"),
  ].map((trade) => trade.id);
}

/** Days strip (06 §3): last 14 trading days, each linking to its day review. */
function DaysStrip({ focusDate }: { focusDate: string }) {
  const { reviews } = useDailyReviewsStore();
  const [today] = useState(() => sessionDate(Date.now()));
  const days = useMemo(() => recentTradingDays(today), [today]);
  return (
    <nav className="review-days" aria-label="Last 14 trading days">
      <ol className="review-days-track">
        {days.map((date) => {
          const status = dayStatus(reviews, date);
          const text = status === "done" ? "done ✓" : status === "draft" ? "draft" : "—";
          return (
            <li key={date}>
              <Link
                className={`review-day is-${status}`}
                href={`/review/day/${date}`}
                aria-current={date === focusDate ? "date" : undefined}
                aria-label={`Review ${dayChipLabel(date)}, ${text}`}
              >
                <span className="review-day-date">{dayChipLabel(date)}</span>
                <span className="review-day-status">{text}</span>
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** 1-tap Daily Review CTA showing trades, plans, and daily-review status for the focused session. */
function DailyReviewCta({ date, tradesCount, plansCount, status }: { date: string; tradesCount: number; plansCount: number; status: "none" | "draft" | "done" }) {
  const statusLabel = status === "done" ? "Done ✓" : status === "draft" ? "Draft saved" : "Not written yet";
  const actionLabel = status === "done" ? "View ✓" : status === "draft" ? "Continue →" : "Start →";
  return (
    <Link
      href={`/review/day/${date}`}
      className="specular-card card-pad daily-review-cta"
      aria-label={`Daily Review for ${formatSessionDate(date)}: ${tradesCount} ${tradesCount === 1 ? "trade" : "trades"}, ${plansCount} ${plansCount === 1 ? "plan" : "plans"}, ${statusLabel}`}
    >
      <span className="daily-review-cta-copy">
        <b>Daily Review · {formatSessionDate(date)}</b>
        <span className="muted num">
          {tradesCount} {tradesCount === 1 ? "trade" : "trades"} · {plansCount} {plansCount === 1 ? "plan" : "plans"} · {statusLabel}
        </span>
      </span>
      <span className="btn-secondary daily-review-cta-action" aria-hidden="true">{actionLabel}</span>
    </Link>
  );
}

/** Split Review hub: Daily (14-day strip + Daily Review + session checkpoints) and Queue (real trades only). */
function ReviewHub() {
  const journal = useJournal();
  const prefs = usePrefs();
  const accounts = useAccounts();
  const dailyReviews = useDailyReviewsStore();
  const plansStore = usePlansStore();
  const { date: todayClock } = useToday();
  const [fallbackToday] = useState(() => sessionDate(Date.now()));
  const todayDate = todayClock || fallbackToday;

  const realTrades = useMemo(() => journal.trades.filter((trade) => !trade.is_sample), [journal.trades]);
  const hasRealTrades = realTrades.length > 0;
  const realPending = useMemo(() => pendingReviewTrades(journal.trades), [journal.trades]);
  const demoPending = useMemo(
    () => journal.trades.filter((trade) => trade.is_sample && trade.review_status !== "reviewed"),
    [journal.trades],
  );

  const [previewDemo, setPreviewDemo] = useState(false);
  const isPreviewingDemo = previewDemo && !hasRealTrades;
  const activePending = isPreviewingDemo ? demoPending : realPending;

  const [tab, setTab] = useState<ReviewTab>(() => (realPending.length > 0 ? "queue" : "daily"));
  const userPickedTab = useRef(false);

  // Queue and day chips stay fixed during a pass so tagging a trade does not jump the card away.
  const [day, setDay] = useState<string | null>(null);
  const [dayOptions, setDayOptions] = useState<string[]>(() => buildDayOptions(realPending));
  const [ids, setIds] = useState<string[]>(() => buildQueueIds(realPending, null));
  const [position, setPosition] = useState(0);
  const [revealed, setRevealed] = useState<string | null>(null);

  const resetQueue = (list: readonly TradeRecord[], selectedDay: string | null, refreshDays = true) => {
    setDay(selectedDay);
    if (refreshDays) setDayOptions(buildDayOptions(list));
    setIds(buildQueueIds(list, selectedDay));
    setPosition(0);
    setRevealed(null);
  };

  useEffect(() => {
    if (!userPickedTab.current && tab === "daily" && realPending.length > 0) setTab("queue");
  }, [tab, realPending.length]);

  useEffect(() => {
    if (hasRealTrades && previewDemo) {
      setPreviewDemo(false);
      resetQueue(realPending, null);
    }
  }, [hasRealTrades, previewDemo, realPending]);

  useEffect(() => {
    if (!isPreviewingDemo && ids.length === 0 && realPending.length > 0) {
      resetQueue(realPending, null);
    }
  }, [isPreviewingDemo, ids.length, realPending]);

  const selectTab = (next: ReviewTab) => {
    userPickedTab.current = true;
    setTab(next);
    if (next === "queue" && position >= ids.length && activePending.length > 0) resetQueue(activePending, null);
  };

  const startDemoPreview = () => { setPreviewDemo(true); resetQueue(demoPending, null); };
  const stopDemoPreview = () => { setPreviewDemo(false); resetQueue(realPending, null); };
  const chooseDay = (next: string | null) => { if (next !== day) resetQueue(activePending, next, false); };

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
  // UX-05: real trades only so demo fixtures never inflate the pending review summary.
  const queueSummary = formatRealReviewQueueSummary(journal.trades);
  const queueTabCount = isPreviewingDemo ? demoPending.length : realPending.length;
  const focusDate = day ?? todayDate;
  const focusTradesCount = realTrades.filter((item) => sessionDate(item.entry_time) === focusDate).length;
  const focusPlansCount = plansStore.plans.filter((plan) => plan.session_date === focusDate && !plan.archived).length;
  const focusStatus = dayStatus(dailyReviews.reviews, focusDate);

  const sealed = trade ? prefs.blindReview && revealed !== trade.id && !trade.take_again : false;
  const advance = () => { setPosition((prev) => prev + 1); setRevealed(null); };
  const finish = () => {
    if (!trade) return;
    updateTrade(trade.id, { review_status: "reviewed" });
    showToast("Marked reviewed", { label: "Undo", run: () => updateTrade(trade.id, { review_status: "new" }) });
    advance();
  };
  const grade = (answer: NonNullable<TradeRecord["take_again"]>) => {
    if (!trade) return;
    updateTrade(trade.id, { take_again: answer, take_again_at: new Date().toISOString() });
    setRevealed(trade.id);
  };

  const pnl = trade ? tradePnl(trade) : null;
  const rSize = trade ? resolveRSize(trade, accounts.accounts, prefs) : null;
  const r = trade && rSize ? resultR(trade, rSize) : null;
  const points = trade ? formatPoints(tradePoints(trade), trade.symbol) : "";

  const headEyebrow = tab === "daily" ? "Daily review" : "Review queue";
  const headTitle = tab === "daily"
    ? "Daily hub"
    : trade
      ? `${position + 1} of ${ids.length}`
      : !hasRealTrades && !isPreviewingDemo
        ? "No real trades yet"
        : "All caught up";
  const headSub = tab === "daily"
    ? (queueSummary || "14-day status, daily recap, and session checkpoints.")
    : trade
      ? "Playbook, tags, one line. Then mark it reviewed."
      : "";

  return (
    <div className="page" style={{ maxWidth: 720 }}>
      <div className="page-head">
        <div>
          <span className="eyebrow">{headEyebrow}</span>
          <h1>{headTitle}</h1>
          {headSub && <p className={tab === "daily" && queueSummary ? "muted num" : undefined}>{headSub}</p>}
          {tab === "queue" && !isPreviewingDemo && queueSummary && trade && <p className="muted num">{queueSummary}</p>}
        </div>
        <Link className="btn-secondary drill-link" style={{ minHeight: 44, minWidth: 44, display: "inline-flex", alignItems: "center", justifyContent: "center" }} href="/drills">Drills</Link>
      </div>

      <div className="seg-tabs" role="tablist" aria-label="Review sections" style={{ marginBottom: 14 }}>
        <button
          id="review-tab-queue"
          type="button"
          role="tab"
          className="seg-tab"
          style={{ minHeight: 44, minWidth: 44 }}
          aria-selected={tab === "queue"}
          aria-controls="review-panel-queue"
          onClick={() => selectTab("queue")}
        >
          Queue ({queueTabCount})
        </button>
        <button
          id="review-tab-daily"
          type="button"
          role="tab"
          className="seg-tab"
          style={{ minHeight: 44, minWidth: 44 }}
          aria-selected={tab === "daily"}
          aria-controls="review-panel-daily"
          onClick={() => selectTab("daily")}
        >
          Daily
        </button>
      </div>

      {tab === "daily" ? (
        <div id="review-panel-daily" role="tabpanel" aria-labelledby="review-tab-daily">
          <DaysStrip focusDate={focusDate} />
          <DailyReviewCta date={focusDate} tradesCount={focusTradesCount} plansCount={focusPlansCount} status={focusStatus} />
          <PastSessionReviews />
        </div>
      ) : (
        <div id="review-panel-queue" role="tabpanel" aria-labelledby="review-tab-queue">
          {isPreviewingDemo && (
            <div className="card card-pad" style={{ marginBottom: 14, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <span className="muted" style={{ fontSize: 12 }}>Demo preview — sample trades only.</span>
              <button type="button" className="btn-ghost" style={{ minHeight: 44, minWidth: 44 }} onClick={stopDemoPreview}>Exit demo preview</button>
            </div>
          )}

          {!trade ? (
            !hasRealTrades && !isPreviewingDemo ? (
              <div className="specular-card empty-state">
                <h3>Nothing in your queue yet</h3>
                <p>No real trades to review yet — log a trade with + or start a Pretend / Replay session.</p>
                <div className="actions">
                  {demoPending.length > 0 && (
                    <button type="button" className="btn-secondary" style={{ minHeight: 44, minWidth: 44 }} onClick={startDemoPreview}>Preview demo queue</button>
                  )}
                  <button type="button" className="btn-secondary" style={{ minHeight: 44, minWidth: 44 }} onClick={() => selectTab("daily")}>Open Daily hub</button>
                </div>
              </div>
            ) : (
              <>
                {dayChips}
                <div className="specular-card empty-state">
                  <h3>{ids.length ? `${done} of ${ids.length} reviewed this pass` : "Nothing is waiting"}</h3>
                  <p>{ids.length && done < ids.length ? "Skipped trades stay in the queue for next time." : "Every trade has been reviewed."}</p>
                  <div className="actions">
                    {isPreviewingDemo && (
                      <button type="button" className="btn-secondary" style={{ minHeight: 44, minWidth: 44 }} onClick={stopDemoPreview}>Exit demo preview</button>
                    )}
                    <button type="button" className="btn-secondary" style={{ minHeight: 44, minWidth: 44 }} onClick={() => selectTab("daily")}>Open Daily hub</button>
                    <Link className="btn-secondary" style={{ minHeight: 44, minWidth: 44, display: "inline-flex", alignItems: "center", justifyContent: "center" }} href="/feed">Open the feed</Link>
                    <Link className="btn-secondary" style={{ minHeight: 44, minWidth: 44, display: "inline-flex", alignItems: "center", justifyContent: "center" }} href="/drills">Drills: Take it?</Link>
                    <Link className="btn-secondary" style={{ minHeight: 44, minWidth: 44, display: "inline-flex", alignItems: "center", justifyContent: "center" }} href="/playbooks/lab">Playbook Lab</Link>
                  </div>
                </div>
              </>
            )
          ) : (
            <>
              {dayChips}
              <section className="specular-card queue-card" aria-label={`Trade ${position + 1} of ${ids.length}`}>
                <div className="queue-progress" role="progressbar" aria-valuenow={position + 1} aria-valuemin={1} aria-valuemax={ids.length} aria-label={`Review progress, trade ${position + 1} of ${ids.length}`}><i style={{ width: `${(position / ids.length) * 100}%` }} /></div>
                <div className="queue-head">
                  <span className="row-main">
                    <span className="row-title">
                      <strong>{trade.symbol}</strong>
                      <span className={`direction ${trade.direction === "LONG" ? "long" : "short"}`}><span aria-hidden="true">{trade.direction === "LONG" ? "▲ " : "▼ "}</span>{trade.direction}</span>
                      {trade.is_sample && <span className="tag-chip" title={SAMPLE_CAPTION}>{SAMPLE_CHIP}</span>}
                      {!sealed && showsNoSetupPicked(trade) && <span className="tag-chip muted">No setup</span>}
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
                      <span><RStrip trade={trade} blind={false} rSizeCents={rSize?.cents ?? null} /></span>
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
            </>
          )}
        </div>
      )}
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
