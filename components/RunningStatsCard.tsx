"use client";

import { useMemo, useState } from "react";
import { formatMoney, formatPercent, formatR } from "@/lib/format";
import { playbookName } from "@/lib/playbooks";
import { runningStats } from "@/lib/selectors";
import type { RunningStats, SummaryStats } from "@/lib/selectors";
import { useJournal } from "@/lib/store";
import type { TradeRecord } from "@/lib/trades";
import { useToday } from "@/lib/ui";

type WindowTab = "last20" | "thisWeek" | "thisMonth" | "overall";

function StatItem({
  label,
  value,
  subtext,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  subtext?: React.ReactNode;
  tone?: "positive" | "negative" | "gold";
}) {
  return (
    <div className="running-stat-item">
      <span className="running-stat-label">{label}</span>
      <b className={`running-stat-val tabular ${tone ? tone : ""}`}>{value}</b>
      {subtext && <small className="running-stat-subtext">{subtext}</small>}
    </div>
  );
}

function WindowSummaryView({
  summary,
  shield,
}: {
  summary: SummaryStats;
  shield: boolean;
}) {
  if (summary.tradeCount === 0) {
    return (
      <div className="running-stats-empty muted">
        No closed trades in this window yet.
      </div>
    );
  }

  const pnlTone =
    summary.grossPnl > 0 ? "positive" : summary.grossPnl < 0 ? "negative" : undefined;
  const pnlDisplay = shield ? "Hidden" : formatMoney(summary.grossPnl);

  const winRateDisplay =
    summary.winRate != null ? formatPercent(summary.winRate) : "—";
  const winRateSub =
    summary.pricedCount > 0
      ? `${summary.wins}W / ${summary.losses}L · ${summary.pricedCount} priced`
      : undefined;

  const rTotalDisplay =
    summary.totalR != null ? formatR(summary.totalR) : "—R";
  const rAvgDisplay =
    summary.avgR != null ? formatR(summary.avgR) : "—R";

  return (
    <div className="running-summary-body">
      <div className="running-stat-grid">
        <StatItem
          label="Gross P&L"
          value={pnlDisplay}
          tone={shield ? undefined : pnlTone}
          subtext={
            summary.incomplete ? (
              <span className="incomplete-note">
                Incomplete · {summary.unpriceableCount} unpriced
              </span>
            ) : undefined
          }
        />
        <StatItem
          label="Win Rate"
          value={winRateDisplay}
          subtext={winRateSub}
        />
        <StatItem
          label="Total R"
          value={rTotalDisplay}
          subtext={
            summary.skippedRCount > 0
              ? `${summary.skippedRCount} skipped (no stop)`
              : `${summary.withR} with stop`
          }
        />
        <StatItem
          label="Avg R"
          value={rAvgDisplay}
          subtext={summary.withR > 0 ? `${summary.withR} trades` : undefined}
        />
        <StatItem
          label="By the Rules"
          value={
            summary.ruleAdherence && summary.ruleAdherence.gradedTrades > 0
              ? `${summary.ruleAdherence.perfectTrades}/${summary.ruleAdherence.gradedTrades}`
              : "—"
          }
          tone={
            summary.ruleAdherence && summary.ruleAdherence.perfectTrades > 0
              ? "gold"
              : undefined
          }
          subtext={
            summary.ruleAdherence && summary.ruleAdherence.total > 0
              ? `${Math.round(summary.ruleAdherence.ratio * 100)}% rules checked`
              : undefined
          }
        />
        <StatItem
          label="Trades"
          value={summary.tradeCount}
          subtext={
            summary.scratches > 0
              ? `${summary.scratches} scratch (0R)`
              : undefined
          }
        />
      </div>
    </div>
  );
}

export function RunningStatsCard({
  shield,
  trades: tradesProp,
  now: nowProp,
}: {
  shield: boolean;
  trades?: TradeRecord[];
  now?: string | number;
}) {
  const journal = useJournal();
  const { now: todayNow } = useToday();
  const [activeWindow, setActiveWindow] = useState<WindowTab>("last20");
  const [breakdown, setBreakdown] = useState<"none" | "playbook" | "tag">("none");

  const trades = tradesProp ?? journal.trades;
  const currentInstant = nowProp ?? todayNow;

  const stats: RunningStats = useMemo(() => {
    return runningStats(trades, currentInstant);
  }, [trades, currentInstant]);

  const onlySamples = trades.length > 0 && trades.every((t) => t.is_sample);
  const realTrades = trades.filter((t) => !t.is_sample);
  const totalClosed = stats.overall.tradeCount;

  if (realTrades.length === 0 || onlySamples) {
    return (
      <section
        className="specular-card card-pad running-stats-card"
        aria-label="Running Statistics"
      >
        <div className="card-head">
          <h3>Running Stats</h3>
          <span className="muted">Gross figures</span>
        </div>
        <p className="muted" style={{ margin: "10px 0 0", fontSize: "0.8125rem" }}>
          No real trades logged yet. Sample trades never count in your statistics.
        </p>
      </section>
    );
  }

  const currentSummary: SummaryStats =
    activeWindow === "last20"
      ? stats.last20
      : activeWindow === "thisWeek"
      ? stats.thisWeek
      : activeWindow === "thisMonth"
      ? stats.thisMonth
      : stats.overall;

  return (
    <section
      className="specular-card card-pad running-stats-card"
      aria-label="Running Statistics"
    >
      <div className="card-head">
        <div className="running-stats-title-wrap">
          <h3>Running Stats</h3>
          <span className="gross-badge">Gross</span>
        </div>
        <span className="muted running-stats-count-header">
          {totalClosed} {totalClosed === 1 ? "trade" : "trades"}
        </span>
      </div>

      <div className="running-window-tabs" role="tablist" aria-label="Time Windows">
        <button
          type="button"
          role="tab"
          aria-selected={activeWindow === "last20"}
          className={`running-tab-btn ${activeWindow === "last20" ? "active" : ""}`}
          onClick={() => setActiveWindow("last20")}
        >
          Last 20
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeWindow === "thisWeek"}
          className={`running-tab-btn ${activeWindow === "thisWeek" ? "active" : ""}`}
          onClick={() => setActiveWindow("thisWeek")}
        >
          This Week
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeWindow === "thisMonth"}
          className={`running-tab-btn ${activeWindow === "thisMonth" ? "active" : ""}`}
          onClick={() => setActiveWindow("thisMonth")}
        >
          This Month
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeWindow === "overall"}
          className={`running-tab-btn ${activeWindow === "overall" ? "active" : ""}`}
          onClick={() => setActiveWindow("overall")}
        >
          All-Time
        </button>
      </div>

      <WindowSummaryView summary={currentSummary} shield={shield} />

      <div className="running-breakdown-toggles">
        <span className="breakdown-label">Breakdown:</span>
        <button
          type="button"
          className={`pill-btn ${breakdown === "playbook" ? "active" : ""}`}
          onClick={() => setBreakdown(breakdown === "playbook" ? "none" : "playbook")}
        >
          By Playbook
        </button>
        <button
          type="button"
          className={`pill-btn ${breakdown === "tag" ? "active" : ""}`}
          onClick={() => setBreakdown(breakdown === "tag" ? "none" : "tag")}
        >
          By Tag
        </button>
      </div>

      {breakdown === "playbook" && (
        <div className="running-breakdown-table-wrap">
          <table className="running-table">
            <thead>
              <tr>
                <th scope="col">Playbook</th>
                <th scope="col" className="num">Trades</th>
                <th scope="col" className="num">Win %</th>
                <th scope="col" className="num">Gross P&L</th>
                <th scope="col" className="num">Total R</th>
                <th scope="col" className="num">Rules</th>
              </tr>
            </thead>
            <tbody>
              {stats.byPlaybook.map((pb) => {
                const name = pb.playbookId ? playbookName(pb.playbookId) ?? pb.playbookId : "Unassigned";
                return (
                  <tr key={pb.playbookId ?? "unassigned"}>
                    <th scope="row">{name}</th>
                    <td className="num">{pb.tradeCount}</td>
                    <td className="num">
                      {pb.winRate != null ? formatPercent(pb.winRate) : "—"}
                    </td>
                    <td
                      className={`num ${
                        !shield && pb.grossPnl > 0
                          ? "positive"
                          : !shield && pb.grossPnl < 0
                          ? "negative"
                          : ""
                      }`}
                    >
                      {shield ? "Hidden" : formatMoney(pb.grossPnl)}
                    </td>
                    <td className="num">
                      {pb.totalR != null ? formatR(pb.totalR) : "—R"}
                    </td>
                    <td className="num gold">
                      {pb.ruleAdherence && pb.ruleAdherence.gradedTrades > 0
                        ? `${pb.ruleAdherence.perfectTrades}/${pb.ruleAdherence.gradedTrades}`
                        : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {breakdown === "tag" && (
        <div className="running-breakdown-table-wrap">
          <table className="running-table">
            <thead>
              <tr>
                <th scope="col">Tag</th>
                <th scope="col" className="num">Trades</th>
                <th scope="col" className="num">Win %</th>
                <th scope="col" className="num">Gross P&L</th>
                <th scope="col" className="num">Total R</th>
              </tr>
            </thead>
            <tbody>
              {stats.byTag.map((tg) => (
                <tr key={tg.tag}>
                  <th scope="row">#{tg.tag}</th>
                  <td className="num">{tg.tradeCount}</td>
                  <td className="num">
                    {tg.winRate != null ? formatPercent(tg.winRate) : "—"}
                  </td>
                  <td
                    className={`num ${
                      !shield && tg.grossPnl > 0
                        ? "positive"
                        : !shield && tg.grossPnl < 0
                        ? "negative"
                        : ""
                    }`}
                  >
                    {shield ? "Hidden" : formatMoney(tg.grossPnl)}
                  </td>
                  <td className="num">
                    {tg.totalR != null ? formatR(tg.totalR) : "—R"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(stats.undatedCount > 0 ||
        stats.excludedOpenCount > 0 ||
        stats.excludedSampleCount > 0) && (
        <div className="running-footer-notes muted">
          {stats.undatedCount > 0 && (
            <span>
              · {stats.undatedCount} {stats.undatedCount === 1 ? "trade has" : "trades have"} an invalid exit date (included in all-time only).
            </span>
          )}
          {stats.excludedOpenCount > 0 && (
            <span>
              · {stats.excludedOpenCount} open {stats.excludedOpenCount === 1 ? "trade" : "trades"} excluded.
            </span>
          )}
          {stats.excludedSampleCount > 0 && (
            <span>
              · {stats.excludedSampleCount} sample {stats.excludedSampleCount === 1 ? "trade" : "trades"} excluded.
            </span>
          )}
        </div>
      )}
    </section>
  );
}
