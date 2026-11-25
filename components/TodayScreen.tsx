"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { AccountCards } from "./AccountCard";
import { ChallengeCard } from "./ChallengeCard";
import { DayHeader } from "./DayHeader";
import { PlanCard } from "./PlanCard";
import { RunningStatsCard } from "./RunningStatsCard";
import { TradeRow } from "./TradeRow";
import { formatMoney, formatPercent, formatR } from "@/lib/format";
import { usePrefs } from "@/lib/prefs";
import { groupByDay, parseSessionDateParam, resolveViewedDate, stepRegularSessionDate, withSamples } from "@/lib/selectors";
import type { DayGroup } from "@/lib/selectors";
import { dayTradeCounts, formatDayTradeHeader, formatReviewQueueSummary } from "@/lib/day-counts";
import { formatSessionDate, sessionDate } from "@/lib/session";
import { useJournal } from "@/lib/store";
import { openAddTrade, rememberList, useToday } from "@/lib/ui";

// The session rolls at 18:00 ET (17:00 CT). Reading the clock 7 hours back keeps the close banner up until midnight CT.
const CLOSE_LOOKBACK_MS = 7 * 3_600_000;

const TOUCH_TARGET = { minHeight: 44, minWidth: 44 } as const;

function DaySummary({ group, shield }: { group: DayGroup; shield: boolean }) {
  const { stats } = group;
  const grossValue = shield ? stats.netR ?? 0 : stats.gross;
  const winText = stats.pricedCount ? `${formatPercent(stats.winRate)} (${stats.wins}/${stats.pricedCount})` : "—";
  return (
    <div className="specular-card stat-row">
      <div className="stat"><small>Gross</small><b className={grossValue > 0 ? "positive" : grossValue < 0 ? "negative" : ""}>{shield ? formatR(stats.netR) : formatMoney(stats.gross)}</b></div>
      <div className="stat"><small>Trades</small><b>{stats.count}</b>{stats.incomplete && <small className="incomplete"> · {stats.unpriceableCount} unpriced</small>}{stats.openCount > 0 && <small className="incomplete"> · {stats.openCount} open</small>}</div>
      <div className="stat"><small>Win rate</small><b>{winText}</b></div>
      <div className="stat"><small>By the rules</small><b className="gold">{stats.processGraded ? `${stats.processFollowed}/${stats.processGraded}` : "—"}</b></div>
    </div>
  );
}

const tradeWord = (count: number) => (count === 1 ? "trade" : "trades");

/** Today, or any earlier trading day chosen with `?date=YYYY-MM-DD`. The reader needs `Suspense` for search params. */
export function TodayScreen() {
  return (
    <Suspense fallback={<div className="page" role="status" aria-label="Loading your journal…"><div className="page-head"><div><span className="eyebrow">Today</span><h1>Loading your journal…</h1></div></div></div>}>
      <TodayView />
    </Suspense>
  );
}

function TodayView() {
  const journal = useJournal();
  const prefs = usePrefs();
  const { date: todayDate, closed, now } = useToday();
  const router = useRouter();
  const requestedDate = useSearchParams().get("date");

  if (!journal.hydrated || !todayDate) {
    return <div className="page" role="status" aria-label="Loading your journal…"><div className="page-head"><div><span className="eyebrow">Today</span><h1>Loading your journal…</h1></div></div>{[0, 1, 2].map((key) => <div key={key} className="skeleton skeleton-row" />)}</div>;
  }

  const viewedDate = resolveViewedDate(requestedDate, todayDate);
  const viewingToday = viewedDate === todayDate;
  // Today keeps the bare "/" URL so the default view is unchanged.
  const dayHref = (date: string) => (date === todayDate ? "/" : `/?date=${date}`);
  const goTo = (date: string) => router.push(dayHref(date));
  const previousDay = stepRegularSessionDate(viewedDate, -1);
  const nextDay = stepRegularSessionDate(viewedDate, 1);
  const closedDate = sessionDate(now - CLOSE_LOOKBACK_MS);
  const rolledOver = viewingToday && todayDate > closedDate;

  const trades = withSamples(journal.trades, prefs.showSamples);
  const groups = groupByDay(trades);
  const focus = groups.find((group) => group.date === viewedDate);
  const previous = groups.find((group) => group.date < viewedDate);
  const onlySamples = journal.trades.every((trade) => trade.is_sample);
  const needsTags = trades.filter((trade) => trade.review_status === "new").length;
  const unreviewed = trades.filter((trade) => trade.review_status !== "reviewed").length;
  const open = (group: DayGroup) => () => rememberList({ ids: group.trades.map((trade) => trade.id), label: formatSessionDate(group.date), href: dayHref(group.date) });

  // UX-04: one rule for the header ("1 trade today (0 closed)"). Past days keep their own session wording.
  const subtitle = viewingToday
    ? formatDayTradeHeader(dayTradeCounts(trades, viewedDate), closed)
    : focus ? `${focus.stats.count} ${tradeWord(focus.stats.count)} that session` : "No trades that session";

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <span className="eyebrow">{viewingToday ? (closed ? "Next session" : "Today") : "Trading day"}</span>
          <h1>{formatSessionDate(viewedDate, true)}</h1>
          <p>{subtitle}</p>
        </div>
      </div>

      <div className="day-nav" role="group" aria-label="Choose a trading day" style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 0 14px" }}>
        <button type="button" className="btn-secondary" style={TOUCH_TARGET} aria-label="Previous trading day" onClick={() => goTo(previousDay)}>‹</button>
        <input
          type="date"
          aria-label="Pick a trading day"
          value={viewedDate}
          max={todayDate}
          style={{ minHeight: 44, padding: "0 10px", borderRadius: 10, border: "1px solid var(--border-subtle)", background: "var(--bg-surface)", color: "inherit", font: "inherit" }}
          onChange={(event) => {
            const picked = parseSessionDateParam(event.target.value);
            if (picked && picked <= todayDate) goTo(picked);
          }}
        />
        <button type="button" className="btn-secondary" style={TOUCH_TARGET} aria-label="Next trading day" disabled={nextDay > todayDate} onClick={() => goTo(nextDay)}>›</button>
      </div>

      {!viewingToday && (
        <div className="banner" style={{ margin: "0 0 14px" }}>
          <span>Viewing <b>{formatSessionDate(viewedDate)}</b> · </span>
          <Link href="/" style={{ minHeight: 44, minWidth: 44, display: "inline-flex", alignItems: "center" }}>Back to today</Link>
        </div>
      )}
      {rolledOver && (
        <div className="banner" style={{ margin: "0 0 14px" }}>
          <span>Session closed. <Link href={dayHref(closedDate)} style={{ minHeight: 44, display: "inline-flex", alignItems: "center" }}>Review {formatSessionDate(closedDate)} →</Link></span>
        </div>
      )}

      <div className="two-col">
        <div>
          {onlySamples && (
            <div className="banner" style={{ margin: "0 0 14px" }}>
              <span>These are <b>sample trades</b> to show how a review looks. They never count in your statistics.</span>
              <button type="button" style={TOUCH_TARGET} onClick={openAddTrade}>Add yours</button>
            </div>
          )}

          {/* Account balances and challenges describe now, so they only show on Today. */}
          {viewingToday && <AccountCards shield={prefs.shield} />}

          {focus && <DaySummary group={focus} shield={prefs.shield} />}
          <PlanCard sessionDate={viewedDate} trades={trades} zone={prefs.timeZone} />
          {viewingToday && <ChallengeCard shield={prefs.shield} />}

          {focus ? (
            <div className="trade-list">{focus.trades.map((trade) => <TradeRow key={trade.id} trade={trade} zone={prefs.timeZone} shield={prefs.shield} onOpen={open(focus)} />)}</div>
          ) : (
            <div className="specular-card empty-state">
              <h3>{viewingToday ? (closed ? "Nothing to log yet" : "No trades yet today") : "No trades that day"}</h3>
              <p>{viewingToday
                ? (closed ? "A good time to finish last week's reviews. New trades can be logged for any day." : "When you close a trade, log it here while it is fresh. It takes about a minute.")
                : "Nothing was logged for this session."}</p>
              {viewingToday && <div className="actions"><button type="button" className="btn-primary" style={TOUCH_TARGET} onClick={openAddTrade}>＋ Add a trade</button></div>}
            </div>
          )}

          {previous && (
            <section aria-label={`Last trading day, ${formatSessionDate(previous.date)}`}>
              <div className="section-title"><h2>Last trading day</h2><Link href="/feed" style={{ minHeight: 44, minWidth: 44, display: "inline-flex", alignItems: "center" }}>All days →</Link></div>
              <div className="card" style={{ overflow: "hidden", marginBottom: 2 }}><DayHeader group={previous} shield={prefs.shield} sticky={false} /></div>
              <div className="trade-list">{previous.trades.map((trade) => <TradeRow key={trade.id} trade={trade} zone={prefs.timeZone} shield={prefs.shield} onOpen={open(previous)} />)}</div>
            </section>
          )}

          <RunningStatsCard shield={prefs.shield} trades={journal.trades} now={now} />
        </div>

        <aside aria-label="Review queue">
          <div className="section-title" style={{ marginTop: previous || focus ? 20 : 0 }}><h2>Review queue</h2><span>{formatReviewQueueSummary(unreviewed, needsTags)}</span></div>
          {unreviewed === 0 ? (
            <div className="card card-pad muted" style={{ fontSize: 13 }}>All caught up.</div>
          ) : (
            <Link href="/review" className="card card-pad" aria-label={`Review queue, ${needsTags ? `${needsTags} ${needsTags === 1 ? "trade needs" : "trades need"} tags` : `${unreviewed} open`}`} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, minHeight: 64 }}>
              <span><b>{needsTags ? `${needsTags} ${needsTags === 1 ? "trade needs" : "trades need"} tags` : `${unreviewed} to mark reviewed`}</b><br /><span className="muted" style={{ fontSize: 12 }}>{needsTags ? "Ten seconds each: playbook, tags, one line." : "Tagged already. Finish the review when you sit down."}</span></span>
              <span className="muted" aria-hidden="true">→</span>
            </Link>
          )}
        </aside>
      </div>
    </div>
  );
}
