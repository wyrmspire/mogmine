"use client";

import Link from "next/link";
import { AccountCards } from "./AccountCard";
import { DayHeader } from "./DayHeader";
import { TradeRow } from "./TradeRow";
import { formatMoney, formatPercent, formatR } from "@/lib/format";
import { usePrefs } from "@/lib/prefs";
import { groupByDay, withSamples } from "@/lib/selectors";
import type { DayGroup } from "@/lib/selectors";
import { formatSessionDate } from "@/lib/session";
import { useJournal } from "@/lib/store";
import { openAddTrade, rememberList, useToday } from "@/lib/ui";

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

export function TodayScreen() {
  const journal = useJournal();
  const prefs = usePrefs();
  const { date: todayDate, closed } = useToday();

  if (!journal.hydrated || !todayDate) {
    return <div className="page" role="status" aria-label="Loading your journal…"><div className="page-head"><div><span className="eyebrow">Today</span><h1>Loading your journal…</h1></div></div>{[0, 1, 2].map((key) => <div key={key} className="skeleton skeleton-row" />)}</div>;
  }

  const trades = withSamples(journal.trades, prefs.showSamples);
  const groups = groupByDay(trades);
  const today = groups.find((group) => group.date === todayDate);
  const previous = groups.find((group) => group.date < todayDate);
  const onlySamples = journal.trades.every((trade) => trade.is_sample);
  const needsTags = trades.filter((trade) => trade.review_status === "new").length;
  const unreviewed = trades.filter((trade) => trade.review_status !== "reviewed").length;
  const open = (group: DayGroup) => () => rememberList({ ids: group.trades.map((trade) => trade.id), label: formatSessionDate(group.date), href: "/" });

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <span className="eyebrow">{closed ? "Next session" : "Today"}</span>
          <h1>{formatSessionDate(todayDate, true)}</h1>
          <p>{closed ? "Markets are closed for the weekend." : today ? `${today.stats.count} ${today.stats.count === 1 ? "trade" : "trades"} this session` : "No trades yet this session"}</p>
        </div>
      </div>

      <div className="two-col">
        <div>
          {onlySamples && (
            <div className="banner" style={{ margin: "0 0 14px" }}>
              <span>These are <b>sample trades</b> to show how a review looks. They never count in your statistics.</span>
              <button type="button" onClick={openAddTrade}>Add yours</button>
            </div>
          )}

          <AccountCards shield={prefs.shield} />

          {today ? (
            <>
              <DaySummary group={today} shield={prefs.shield} />
              <div className="trade-list">{today.trades.map((trade) => <TradeRow key={trade.id} trade={trade} zone={prefs.timeZone} shield={prefs.shield} onOpen={open(today)} />)}</div>
            </>
          ) : (
            <div className="specular-card empty-state">
              <h3>{closed ? "Nothing to log yet" : "No trades yet today"}</h3>
              <p>{closed ? "A good time to finish last week's reviews. New trades can be logged for any day." : "When you close a trade, log it here while it is fresh. It takes about a minute."}</p>
              <div className="actions"><button type="button" className="btn-primary" onClick={openAddTrade}>＋ Add a trade</button></div>
            </div>
          )}

          {previous && (
            <section aria-label={`Last trading day, ${formatSessionDate(previous.date)}`}>
              <div className="section-title"><h2>Last trading day</h2><Link href="/feed">All days →</Link></div>
              <div className="card" style={{ overflow: "hidden", marginBottom: 2 }}><DayHeader group={previous} shield={prefs.shield} sticky={false} /></div>
              <div className="trade-list">{previous.trades.map((trade) => <TradeRow key={trade.id} trade={trade} zone={prefs.timeZone} shield={prefs.shield} onOpen={open(previous)} />)}</div>
            </section>
          )}
        </div>

        <aside>
          <div className="section-title" style={{ marginTop: previous || today ? 20 : 0 }}><h2>Review queue</h2><span>{unreviewed ? `${unreviewed} open` : ""}</span></div>
          {unreviewed === 0 ? (
            <div className="card card-pad muted" style={{ fontSize: 13 }}>All caught up.</div>
          ) : (
            <Link href="/review" className="card card-pad" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, minHeight: 64 }}>
              <span><b>{needsTags ? `${needsTags} ${needsTags === 1 ? "trade needs" : "trades need"} tags` : `${unreviewed} to mark reviewed`}</b><br /><span className="muted" style={{ fontSize: 12 }}>{needsTags ? "Ten seconds each: playbook, tags, one line." : "Tagged already. Finish the review when you sit down."}</span></span>
              <span className="muted" aria-hidden="true">→</span>
            </Link>
          )}
        </aside>
      </div>
    </div>
  );
}
