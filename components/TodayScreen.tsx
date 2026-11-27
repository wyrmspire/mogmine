"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { KeyboardEvent, Suspense, useRef, useState } from "react";
import { AccountCards } from "./AccountCard";
import { AccountSheet } from "./AccountSheet";
import { ChallengeCard } from "./ChallengeCard";
import { DayHeader } from "./DayHeader";
import { PlanCard } from "./PlanCard";
import { RunningStatsCard } from "./RunningStatsCard";
import { TradeRow } from "./TradeRow";
import { defaultAccountId, isReplayAccount } from "@/lib/accounts";
import type { TradingAccount } from "@/lib/accounts";
import { useAccounts } from "@/lib/accounts-store";
import { useDailyReviewsStore } from "@/lib/daily-review-store";
import { dayTradeCounts, formatDayTradeHeader, formatReviewQueueSummary } from "@/lib/day-counts";
import { dayStatus } from "@/lib/day-review-screen";
import { isPreOpenWarmupWindow } from "@/lib/drills";
import { formatUsdAmount } from "@/lib/format";
import { usePlansStore } from "@/lib/plans-store";
import { usePrefs } from "@/lib/prefs";
import { DEFAULT_R_SIZE_CENTS } from "@/lib/r-size";
import { dayStats, groupByDay, parseSessionDateParam, resolveViewedDate, stepRegularSessionDate, withSamples } from "@/lib/selectors";
import type { DayGroup } from "@/lib/selectors";
import { formatSessionDate, sessionDate } from "@/lib/session";
import { useJournal } from "@/lib/store";
import type { TradeRecord } from "@/lib/trades";
import { openAddTrade, rememberList, useToday } from "@/lib/ui";

// The session rolls at 18:00 ET (17:00 CT). Reading the clock 7 hours back keeps the close banner up until midnight CT.
const CLOSE_LOOKBACK_MS = 7 * 3_600_000;
const TOUCH_TARGET = { minHeight: 44, minWidth: 44 } as const;
type CockpitTab = "today" | "progress";

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
  const accounts = useAccounts();
  const dailyReviews = useDailyReviewsStore();
  const plansStore = usePlansStore();
  const { date: todayDate, closed, now } = useToday();
  const router = useRouter();
  const requestedDate = useSearchParams().get("date");

  const [tab, setTab] = useState<CockpitTab>("today");
  // `undefined` = closed, `null` = adding a new account, `TradingAccount` = editing that account.
  const [accountSheetTarget, setAccountSheetTarget] = useState<TradingAccount | null | undefined>(undefined);
  const todayTabRef = useRef<HTMLButtonElement>(null);
  const progressTabRef = useRef<HTMLButtonElement>(null);

  if (!journal.hydrated || !todayDate) {
    return <div className="page" role="status" aria-label="Loading your journal…"><div className="page-head"><div><span className="eyebrow">Today</span><h1>Loading your journal…</h1></div></div>{[0, 1, 2].map((key) => <div key={key} className="skeleton skeleton-row" />)}</div>;
  }

  const viewedDate = resolveViewedDate(requestedDate, todayDate);
  const viewingToday = viewedDate === todayDate;
  const dayHref = (date: string) => (date === todayDate ? "/" : `/?date=${date}`);
  const goTo = (date: string) => router.push(dayHref(date));
  const previousDay = stepRegularSessionDate(viewedDate, -1);
  const nextDay = stepRegularSessionDate(viewedDate, 1);
  const closedDate = sessionDate(now - CLOSE_LOOKBACK_MS);
  const rolledOver = viewingToday && todayDate > closedDate;

  const trades = withSamples(journal.trades, prefs.showSamples);
  const preOpen = viewingToday && isPreOpenWarmupWindow(journal.trades, now).show;
  const groups = groupByDay(trades, { accounts: accounts.accounts, prefs });

  const activeAccounts = accounts.accounts.filter((account) => !account.archived);
  const replayAccountIds = new Set(accounts.accounts.filter((account) => isReplayAccount(account)).map((account) => account.id));
  const isReplayTrade = (trade: TradeRecord) => Boolean(trade.account_id && replayAccountIds.has(trade.account_id));

  const realTrades = journal.trades.filter((trade) => !trade.is_sample);
  const liveTrades = realTrades.filter((trade) => !isReplayTrade(trade));
  const liveGroups = groupByDay(liveTrades, { accounts: accounts.accounts, prefs });
  const focus = liveGroups.find((group) => group.date === viewedDate);
  const previous = liveGroups.find((group) => group.date < viewedDate);

  const rawFocus = groups.find((group) => group.date === viewedDate);
  const replayFocusTrades = rawFocus ? rawFocus.trades.filter((trade) => !trade.is_sample && isReplayTrade(trade)) : [];
  const sampleFocusTrades = rawFocus ? rawFocus.trades.filter((trade) => trade.is_sample) : [];

  const summaryGroup: DayGroup = focus ?? {
    date: viewedDate,
    trades: [],
    stats: dayStats([], { accounts: accounts.accounts, prefs }),
    sampleOnly: false,
  };

  const liveAccounts = activeAccounts.filter((account) => !isReplayAccount(account));
  const preferredAccountId = defaultAccountId(liveAccounts.length ? liveAccounts : activeAccounts, journal.trades);
  const activeAccount = activeAccounts.find((account) => account.id === preferredAccountId) ?? null;
  const defaultRCents = Number.isFinite(prefs.riskBudgetUsd) && prefs.riskBudgetUsd >= 10
    ? Math.round(prefs.riskBudgetUsd * 100)
    : DEFAULT_R_SIZE_CENTS;
  const activeRCents = activeAccount?.r_size_cents ?? defaultRCents;
  const rUnitText = prefs.shield
    ? "1R hidden"
    : `1R ${formatUsdAmount(activeRCents / 100).replace(/\.00$/, "")}`;

  const onlySamples = journal.trades.every((trade) => trade.is_sample);
  const needsTags = realTrades.filter((trade) => trade.review_status === "new").length;
  const unreviewed = realTrades.filter((trade) => trade.review_status !== "reviewed").length;
  const sessionTradesCount = focus?.stats.count ?? 0;
  const sessionPlansCount = plansStore.plans.filter((plan) => plan.session_date === viewedDate && !plan.archived).length;
  const dayReviewState = dayStatus(dailyReviews.reviews, viewedDate);
  const dayReviewLabel = dayReviewState === "done" ? "Done ✓" : dayReviewState === "draft" ? "Draft saved" : "Not written yet";
  const dayReviewAction = dayReviewState === "done" ? "View ✓" : dayReviewState === "draft" ? "Continue →" : "Start →";
  const open = (group: DayGroup) => () => rememberList({ ids: group.trades.map((trade) => trade.id), label: formatSessionDate(group.date), href: dayHref(group.date) });

  const subtitle = viewingToday
    ? formatDayTradeHeader(dayTradeCounts(liveTrades, viewedDate), closed)
    : focus ? `${focus.stats.count} ${tradeWord(focus.stats.count)} that session` : "No trades that session";

  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const next: CockpitTab = event.key === "Home" ? "today" : event.key === "End" ? "progress" : tab === "today" ? "progress" : "today";
    setTab(next);
    (next === "today" ? todayTabRef : progressTabRef).current?.focus();
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <span className="eyebrow">{viewingToday ? (closed ? "Next session" : "Today") : "Trading day"}</span>
          <h1>{formatSessionDate(viewedDate, true)}</h1>
          <p>{subtitle}</p>
        </div>
      </div>

      <div className="seg-tabs" role="tablist" aria-label="Today views" style={{ marginBottom: 14 }}>
        <button
          ref={todayTabRef}
          type="button"
          role="tab"
          id="today-tab-cockpit"
          className="seg-tab"
          aria-selected={tab === "today"}
          aria-controls="today-panel-cockpit"
          tabIndex={tab === "today" ? 0 : -1}
          style={{ minHeight: 44 }}
          onClick={() => setTab("today")}
          onKeyDown={onTabKeyDown}
        >
          Today
        </button>
        <button
          ref={progressTabRef}
          type="button"
          role="tab"
          id="today-tab-progress"
          className="seg-tab"
          aria-selected={tab === "progress"}
          aria-controls="today-panel-progress"
          tabIndex={tab === "progress" ? 0 : -1}
          style={{ minHeight: 44 }}
          onClick={() => setTab("progress")}
          onKeyDown={onTabKeyDown}
        >
          Progress
        </button>
      </div>

      <div className="two-col">
        <div>
          {tab === "today" ? (
            <div role="tabpanel" id="today-panel-cockpit" aria-labelledby="today-tab-cockpit">
              <div className="day-nav" role="group" aria-label="Choose a trading day" style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 0 14px" }}>
                <button type="button" className="btn-secondary" style={TOUCH_TARGET} aria-label="Previous trading day" onClick={() => goTo(previousDay)}>‹</button>
                <input
                  type="date"
                  aria-label="Pick a trading day"
                  value={viewedDate}
                  max={todayDate}
                  style={{ minHeight: 44, minWidth: 0, padding: "0 10px", borderRadius: 10, border: "1px solid var(--border-subtle)", background: "var(--bg-surface)", color: "inherit", font: "inherit" }}
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
              {onlySamples && (
                <div className="banner" style={{ margin: "0 0 14px" }}>
                  <span>These are <b>sample trades</b> to show how a review looks. They never count in your statistics.</span>
                  <button type="button" style={TOUCH_TARGET} onClick={openAddTrade}>Add yours</button>
                </div>
              )}

              <div className="specular-card" style={{ overflow: "hidden", marginBottom: 12 }}>
                <DayHeader group={summaryGroup} shield={prefs.shield} sticky={false} />
              </div>

              <div
                className="specular-card card-pad"
                role="region"
                aria-label="Active account"
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 14 }}
              >
                {activeAccount ? (
                  <button
                    type="button"
                    className="btn-ghost"
                    style={{ minHeight: 44, padding: "4px 6px", justifyContent: "flex-start", textAlign: "left", minWidth: 0, flex: "1 1 180px" }}
                    onClick={() => setAccountSheetTarget(activeAccount)}
                    aria-label={`Active account ${activeAccount.name}, ${rUnitText}. Tap to edit.`}
                  >
                    <span style={{ display: "grid", gap: 2, minWidth: 0 }}>
                      <span className="eyebrow" style={{ fontSize: "0.6875rem", color: "var(--text-muted)" }}>
                        {isReplayAccount(activeAccount) ? "Replay account" : "Active account"}
                      </span>
                      <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", color: "var(--text-primary)" }}>
                        <b style={{ fontSize: "0.875rem", overflow: "hidden", textOverflow: "ellipsis" }}>{activeAccount.name}</b>
                        <span className="tag-chip num">{rUnitText}</span>
                      </span>
                    </span>
                  </button>
                ) : (
                  <div style={{ display: "grid", gap: 2, minWidth: 0, flex: "1 1 180px" }}>
                    <span className="eyebrow" style={{ fontSize: "0.6875rem", color: "var(--text-muted)" }}>Account</span>
                    <span className="muted num" style={{ fontSize: "0.8125rem" }}>No account yet · {rUnitText} default</span>
                  </div>
                )}
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ minHeight: 44, minWidth: 44, padding: "0 12px", fontSize: "0.75rem", flexShrink: 0 }}
                  onClick={() => setAccountSheetTarget(null)}
                >
                  ＋ Add account
                </button>
              </div>

              {preOpen && (
                <Link href="/drills" className="card card-pad" aria-label="Pre-open warm-up: five-card Take it deck" style={{ display: "flex", alignItems: "center", minHeight: 44, margin: "0 0 14px", fontSize: 13 }}>
                  <span>Pre-open warm-up · 5-card Take it? deck →</span>
                </Link>
              )}

              <Link
                href={`/review/day/${viewedDate}`}
                className="specular-card card-pad daily-review-cta"
                aria-label={`Daily Review for ${formatSessionDate(viewedDate)}: ${sessionTradesCount} ${tradeWord(sessionTradesCount)}, ${sessionPlansCount} ${sessionPlansCount === 1 ? "plan" : "plans"}, ${dayReviewLabel}`}
              >
                <span className="daily-review-cta-copy">
                  <b>Daily Review</b>
                  <span className="muted num">
                    {sessionTradesCount} {tradeWord(sessionTradesCount)} · {sessionPlansCount} {sessionPlansCount === 1 ? "plan" : "plans"} · {dayReviewLabel}
                  </span>
                </span>
                <span className="btn-secondary daily-review-cta-action" aria-hidden="true">{dayReviewAction}</span>
              </Link>

              <PlanCard sessionDate={viewedDate} trades={liveTrades} zone={prefs.timeZone} />

              {focus ? (
                <section aria-label={`Today's trades, ${formatSessionDate(viewedDate)}`}>
                  <div className="section-title">
                    <h2>{viewingToday ? "Today's trades" : "Session trades"}</h2>
                    <span className="num">{focus.trades.length} {tradeWord(focus.trades.length)}</span>
                  </div>
                  <div className="trade-list">
                    {focus.trades.map((trade) => <TradeRow key={trade.id} trade={trade} zone={prefs.timeZone} shield={prefs.shield} onOpen={open(focus)} />)}
                  </div>
                </section>
              ) : (
                <div className="specular-card empty-state">
                  <h3>{viewingToday ? (closed ? "Nothing to log yet" : "No trades yet today") : "No trades that day"}</h3>
                  <p>{viewingToday
                    ? (closed ? "A good time to finish last week's reviews. New trades can be logged for any day." : "When you close a trade, log it here while it is fresh. It takes about a minute.")
                    : "Nothing was logged for this session."}</p>
                  {viewingToday && <div className="actions"><button type="button" className="btn-primary" style={TOUCH_TARGET} onClick={openAddTrade}>＋ Add a trade</button></div>}
                </div>
              )}

              {replayFocusTrades.length > 0 && (
                <details className="card card-pad" style={{ marginTop: 14 }}>
                  <summary style={{ minHeight: 44, display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", fontWeight: 700, fontSize: "0.8125rem" }}>
                    <span>Replay session trades</span>
                    <span className="tag-chip num">{replayFocusTrades.length}</span>
                  </summary>
                  <div className="trade-list">
                    {replayFocusTrades.map((trade) => (
                      <TradeRow
                        key={trade.id}
                        trade={trade}
                        zone={prefs.timeZone}
                        shield={prefs.shield}
                        onOpen={() => rememberList({ ids: replayFocusTrades.map((t) => t.id), label: `${formatSessionDate(viewedDate)} Replay`, href: dayHref(viewedDate) })}
                      />
                    ))}
                  </div>
                </details>
              )}

              {sampleFocusTrades.length > 0 && (
                <details className="card card-pad" style={{ marginTop: 14 }}>
                  <summary style={{ minHeight: 44, display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", fontWeight: 700, fontSize: "0.8125rem" }}>
                    <span>Sample trades (demo)</span>
                    <span className="tag-chip num">{sampleFocusTrades.length}</span>
                  </summary>
                  <div className="trade-list">
                    {sampleFocusTrades.map((trade) => (
                      <TradeRow
                        key={trade.id}
                        trade={trade}
                        zone={prefs.timeZone}
                        shield={prefs.shield}
                        onOpen={() => rememberList({ ids: sampleFocusTrades.map((t) => t.id), label: `${formatSessionDate(viewedDate)} Demo`, href: dayHref(viewedDate) })}
                      />
                    ))}
                  </div>
                </details>
              )}

              {previous && (
                <section aria-label={`Last trading day, ${formatSessionDate(previous.date)}`}>
                  <div className="section-title"><h2>Last trading day</h2><Link href="/feed" style={{ minHeight: 44, minWidth: 44, display: "inline-flex", alignItems: "center" }}>All days →</Link></div>
                  <div className="card" style={{ overflow: "hidden", marginBottom: 2 }}><DayHeader group={previous} shield={prefs.shield} sticky={false} /></div>
                  <div className="trade-list">{previous.trades.map((trade) => <TradeRow key={trade.id} trade={trade} zone={prefs.timeZone} shield={prefs.shield} onOpen={open(previous)} />)}</div>
                </section>
              )}
            </div>
          ) : (
            <div role="tabpanel" id="today-panel-progress" aria-labelledby="today-tab-progress">
              <RunningStatsCard shield={prefs.shield} trades={journal.trades} now={now} />
              <ChallengeCard shield={prefs.shield} />
              <div style={{ marginTop: 14 }}>
                <AccountCards shield={prefs.shield} />
              </div>
            </div>
          )}
        </div>

        <aside aria-label="Review queue">
          <div className="section-title" style={{ marginTop: tab === "today" && (previous || focus) ? 20 : 0 }}><h2>Review queue</h2><span>{formatReviewQueueSummary(unreviewed, needsTags)}</span></div>
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

      {accountSheetTarget !== undefined && (
        <AccountSheet
          account={accountSheetTarget ?? undefined}
          onClose={() => setAccountSheetTarget(undefined)}
        />
      )}
    </div>
  );
}
