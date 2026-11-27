"use client";

import { useId, useMemo, useState } from "react";
import { isReplayAccount } from "@/lib/accounts";
import { useAccounts } from "@/lib/accounts-store";
import { formatMoney, formatPercent, formatR } from "@/lib/format";
import { playbookName } from "@/lib/playbooks";
import { usePrefs } from "@/lib/prefs";
import { usePlaybooks } from "@/lib/playbooks-store";
import { runningStats } from "@/lib/selectors";
import type { SummaryStats } from "@/lib/selectors";
import type { TradeRecord } from "@/lib/trades";

const WINDOWS = [
  { id: "last20", label: "Last 20" },
  { id: "thisWeek", label: "This Week" },
  { id: "thisMonth", label: "This Month" },
  { id: "overall", label: "All-Time" },
] as const;

type Window = (typeof WINDOWS)[number]["id"];
type Breakdown = "playbook" | "tag";

function StatItem({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  detail?: string;
  tone?: "positive" | "negative" | "gold";
}) {
  return (
    <div className="running-stat-item">
      <dt>{label}</dt>
      <dd className={`running-stat-value num ${tone ?? ""}`}>{value}</dd>
      {detail && <dd className="running-stat-detail">{detail}</dd>}
    </div>
  );
}

function grossDisplay(summary: SummaryStats, shield: boolean) {
  return shield ? "Hidden" : formatMoney(summary.pricedCount ? summary.grossPnl : null);
}

function incompleteDetail(summary: SummaryStats) {
  return summary.incomplete ? `Incomplete · ${summary.unpriceableCount} unpriced` : undefined;
}

function skippedRDetail(summary: SummaryStats) {
  return summary.skippedRCount > 0 ? `${summary.skippedRCount} skipped` : undefined;
}

function WindowSummary({ summary, shield }: { summary: SummaryStats; shield: boolean }) {
  if (!summary.tradeCount) {
    return <p className="running-stats-empty muted">No closed trades in this window yet.</p>;
  }

  const rules = summary.ruleAdherence;
  return (
    <dl className="running-stat-grid">
      <StatItem
        label="Gross P&L"
        value={grossDisplay(summary, shield)}
        detail={incompleteDetail(summary)}
        tone={shield ? undefined : summary.grossPnl > 0 ? "positive" : summary.grossPnl < 0 ? "negative" : undefined}
      />
      <StatItem
        label="Win rate"
        value={formatPercent(summary.winRate)}
        detail={`${summary.wins} ${summary.wins === 1 ? "win" : "wins"} / ${summary.pricedCount} priced`}
      />
      <StatItem label="Total R" value={formatR(summary.totalR)} detail={skippedRDetail(summary)} />
      <StatItem label="Avg R" value={formatR(summary.avgR)} detail={`${summary.withR} scored`} />
      <StatItem
        label="By the rules"
        value={rules ? `${rules.perfectTrades}/${rules.gradedTrades}` : "—"}
        detail={rules ? `${formatPercent(rules.ratio)} of rules followed` : undefined}
        tone={rules?.perfectTrades ? "gold" : undefined}
      />
      <StatItem
        label="Closed trades"
        value={summary.tradeCount}
        detail={summary.scratches ? `${summary.scratches} at breakeven` : undefined}
      />
    </dl>
  );
}

function BreakdownTable({
  name,
  rows,
  shield,
}: {
  name: "Playbook" | "Tag";
  rows: Array<{ key: string | null; label: string; summary: SummaryStats }>;
  shield: boolean;
}) {
  if (!rows.length) {
    return <p className="running-stats-empty muted">No quick tags on closed trades yet.</p>;
  }

  return (
    <div className="running-table-wrap" role="region" aria-label={`All-time ${name.toLowerCase()} breakdown`} tabIndex={0}>
      <table className="running-table">
        <caption className="visually-hidden">All-time results by {name.toLowerCase()}</caption>
        <thead>
          <tr>
            <th scope="col">{name}</th>
            <th scope="col" className="num">Win rate</th>
            <th scope="col" className="num">Gross P&L</th>
            <th scope="col" className="num">Total / avg R</th>
            <th scope="col" className="num">Rules followed</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ key, label, summary }) => (
            <tr key={key === null ? "unassigned" : `group-${key}`}>
              <th scope="row">
                {label}
                <small>{summary.tradeCount} {summary.tradeCount === 1 ? "trade" : "trades"}</small>
              </th>
              <td className="num">
                {formatPercent(summary.winRate)}
                <small>{summary.pricedCount} priced</small>
              </td>
              <td className="num">
                {grossDisplay(summary, shield)}
                {summary.incomplete && <small>{incompleteDetail(summary)}</small>}
              </td>
              <td className="num">
                {formatR(summary.totalR)} / {formatR(summary.avgR)}
                {summary.skippedRCount > 0 && <small>{skippedRDetail(summary)}</small>}
              </td>
              <td className="num">
                {formatPercent(summary.ruleAdherence?.ratio ?? null)}
                {summary.ruleAdherence && (
                  <small>{summary.ruleAdherence.followed}/{summary.ruleAdherence.total} rules</small>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RunningStatsCard({
  shield,
  trades: allTrades,
  now,
}: {
  shield: boolean;
  trades: readonly TradeRecord[];
  now: number;
}) {
  const id = useId();
  const { playbooks } = usePlaybooks();
  const [activeWindow, setActiveWindow] = useState<Window>("last20");
  const [breakdown, setBreakdown] = useState<Breakdown | null>(null);
  const accounts = useAccounts();
  const prefs = usePrefs();
  const { trades, excludedReplayCount } = useMemo(() => {
    const replayIds = new Set(accounts.accounts.filter((account) => isReplayAccount(account)).map((account) => account.id));
    if (!replayIds.size) return { trades: allTrades, excludedReplayCount: 0 };
    const filtered: TradeRecord[] = [];
    let replayCount = 0;
    for (const trade of allTrades) {
      if (trade.account_id && replayIds.has(trade.account_id)) {
        replayCount += 1;
      } else {
        filtered.push(trade);
      }
    }
    return { trades: filtered, excludedReplayCount: replayCount };
  }, [allTrades, accounts.accounts]);
  const stats = useMemo(() => runningStats(trades, now, { accounts: accounts.accounts, prefs }), [trades, now, accounts.accounts, prefs]);
  const hasClosedTrades = stats.overall.tradeCount > 0;
  const rows = breakdown === "playbook"
    ? stats.byPlaybook.map((summary) => ({
        key: summary.playbookId,
        label: playbookName(summary.playbookId, playbooks) ?? summary.playbookId ?? "Unassigned",
        summary,
      }))
    : breakdown === "tag"
      ? stats.byTag.map((summary) => ({ key: summary.tag, label: summary.tag, summary }))
      : [];

  return (
    <section className="specular-card card-pad running-stats-card" aria-labelledby={id}>
      <div className="card-head">
        <h2 id={id}>Running stats</h2>
      </div>
      {hasClosedTrades ? (
        <>
          <fieldset className="running-window-options">
            <legend className="visually-hidden">Time window</legend>
            {WINDOWS.map(({ id: window, label }) => (
              <label key={window} className="running-option">
                <input
                  className="visually-hidden"
                  type="radio"
                  name={id}
                  checked={activeWindow === window}
                  onChange={() => setActiveWindow(window)}
                />
                <span>{label}</span>
              </label>
            ))}
          </fieldset>

          <WindowSummary summary={stats[activeWindow]} shield={shield} />

          <div className="running-breakdown-options" role="group" aria-label="All-time breakdown">
            <span>All-time breakdown</span>
            <button type="button" aria-pressed={breakdown === "playbook"} onClick={() => setBreakdown(breakdown === "playbook" ? null : "playbook")}>
              By Playbook
            </button>
            <button type="button" aria-pressed={breakdown === "tag"} onClick={() => setBreakdown(breakdown === "tag" ? null : "tag")}>
              By Tag
            </button>
          </div>
          {breakdown && <BreakdownTable name={breakdown === "playbook" ? "Playbook" : "Tag"} rows={rows} shield={shield} />}
        </>
      ) : (
        <p className="running-stats-empty muted">
          {stats.excludedOpenCount ? "No closed trades yet." : "Log a trade to start tracking your results."}
        </p>
      )}

      {(stats.undatedCount > 0 || stats.excludedOpenCount > 0 || stats.excludedSampleCount > 0 || excludedReplayCount > 0) && (
        <ul className="running-footer-notes muted">
          {stats.undatedCount > 0 && (
            <li>{stats.undatedCount} {stats.undatedCount === 1 ? "trade has an invalid exit date and counts" : "trades have invalid exit dates and count"} only in all-time results.</li>
          )}
          {stats.excludedOpenCount > 0 && (
            <li>{stats.excludedOpenCount} open {stats.excludedOpenCount === 1 ? "trade" : "trades"} excluded.</li>
          )}
          {stats.excludedSampleCount > 0 && (
            <li>{stats.excludedSampleCount} sample {stats.excludedSampleCount === 1 ? "trade" : "trades"} excluded.</li>
          )}
          {excludedReplayCount > 0 && (
            <li>{excludedReplayCount} replay {excludedReplayCount === 1 ? "trade" : "trades"} excluded.</li>
          )}
        </ul>
      )}
    </section>
  );
}
