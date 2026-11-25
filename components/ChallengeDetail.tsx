"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { evaluateChallenge, formatChallengeRoomLabel } from "@/lib/challenges";
import { ChallengeAccountBadge } from "./ChallengeCard";
import type { ChallengePoint } from "@/lib/challenges";
import { endChallenge, useChallenges } from "@/lib/challenge-store";
import { formatBalance, formatMoney } from "@/lib/format";
import { usePrefs } from "@/lib/prefs";
import { formatSessionDate, sessionDate } from "@/lib/session";
import { useJournal } from "@/lib/store";
import { formatDetailTime } from "@/lib/time";
import type { TradeRecord } from "@/lib/trades";
import { useToday } from "@/lib/ui";

function DrawdownPathChart({
  points,
  maxDrawdownCents,
  shield,
}: {
  points: ChallengePoint[];
  maxDrawdownCents: number;
  shield: boolean;
}) {
  if (points.length === 0) {
    return (
      <div className="challenge-path-empty">
        <span>No scored trades yet</span>
      </div>
    );
  }

  // Points have equity_cents and peak_cents
  // Baseline is trade 0 start at 0 equity
  // Path points: (0, 0), then each trade's step (x, equity_cents)
  const equities: number[] = [0];
  const floors: number[] = [-maxDrawdownCents];

  for (const pt of points) {
    const eq = pt.equity_cents ?? 0;
    const peak = pt.peak_cents ?? 0;
    equities.push(eq);
    floors.push(peak - maxDrawdownCents);
  }

  const allValues = [...equities, ...floors];
  const minVal = Math.min(...allValues);
  const maxVal = Math.max(...allValues);
  const span = maxVal - minVal || 1;

  const width = 350;
  const height = 120;
  const padX = 12;
  const padY = 14;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;

  const count = equities.length;
  const getX = (index: number) => padX + (index / (count - 1 || 1)) * innerW;
  const getY = (val: number) => padY + (1 - (val - minVal) / span) * innerH;

  // Build step line for equity: from (x0, y0) to (x1, y0) then (x1, y1)
  let equityPath = `M ${getX(0).toFixed(1)} ${getY(equities[0]).toFixed(1)}`;
  for (let i = 1; i < count; i++) {
    const currX = getX(i);
    const currY = getY(equities[i]);
    equityPath += ` H ${currX.toFixed(1)} V ${currY.toFixed(1)}`;
  }

  // Step line for floor
  let floorPath = `M ${getX(0).toFixed(1)} ${getY(floors[0]).toFixed(1)}`;
  for (let i = 1; i < count; i++) {
    const currX = getX(i);
    const currY = getY(floors[i]);
    floorPath += ` H ${currX.toFixed(1)} V ${currY.toFixed(1)}`;
  }

  const zeroY = getY(0);

  return (
    <div className="challenge-chart-wrap">
      <svg
        className="challenge-path-svg"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Drawdown path chart: equity and floor across ${points.length} trades`}
      >
        <title>Drawdown path chart</title>
        <desc>Shows equity step line against trailing drawdown floor limit across {points.length} trades.</desc>
        {/* Zero baseline */}
        {zeroY >= padY && zeroY <= height - padY && (
          <line
            x1={padX}
            y1={zeroY.toFixed(1)}
            x2={width - padX}
            y2={zeroY.toFixed(1)}
            stroke="var(--border-subtle)"
            strokeDasharray="3 3"
          />
        )}

        {/* Floor line (peak - limit) */}
        <path
          d={floorPath}
          fill="none"
          stroke="var(--loss-text)"
          strokeWidth="1.5"
          strokeDasharray="4 4"
        />

        {/* Equity step line */}
        <path
          d={equityPath}
          fill="none"
          stroke="var(--text-primary)"
          strokeWidth="2"
        />

        {/* Dots on equity steps */}
        {equities.map((eq, i) => (
          <circle
            key={i}
            cx={getX(i).toFixed(1)}
            cy={getY(eq).toFixed(1)}
            r={i === count - 1 ? "3.5" : "2"}
            fill="var(--text-primary)"
          />
        ))}
      </svg>
      <div className="challenge-chart-legend">
        <span className="legend-item"><i className="legend-swatch equity" aria-hidden="true" /> Equity</span>
        <span className="legend-item"><i className="legend-swatch floor" aria-hidden="true" /> Floor (limit)</span>
        {!shield && (
          <span className="legend-scale num">
            Floor: {formatBalance(floors[floors.length - 1])}
          </span>
        )}
      </div>
    </div>
  );
}

function CleanRunDotsDetail({
  points,
}: {
  points: ChallengePoint[];
}) {
  return (
    <div className="challenge-dots-detail" aria-label="Clean Run process history">
      <div className="challenge-dots-grid" role="list" aria-label="Clean Run trade results">
        {points.map((pt, idx) => {
          const isClean = pt.read === "clean";
          const isBroken = pt.read === "broken";
          const isOffPlan = pt.read === "off_plan";

          const statusText = isClean
            ? "Clean (rules followed)"
            : isBroken
              ? "Broken rule"
              : isOffPlan
                ? "Off-plan"
                : "Pending or ungraded";

          return (
            <div
              key={pt.trade_id}
              className={`challenge-dot-cell ${isClean ? "clean" : isBroken ? "broken" : isOffPlan ? "off-plan" : "pending"}`}
              title={`Trade #${idx + 1}: ${pt.read ?? "ungraded"}`}
              role="listitem"
              aria-label={`Trade #${idx + 1}: ${statusText}`}
            >
              <span className="dot-shape" aria-hidden="true">
                {isClean ? "●" : isBroken ? "▲" : isOffPlan ? "■" : "○"}
              </span>
              <span className="dot-idx num">#{idx + 1}</span>
            </div>
          );
        })}
      </div>
      <div className="challenge-dots-legend" role="list" aria-label="Shape legend">
        <span className="legend-item" role="listitem"><span className="legend-dot clean" aria-hidden="true">●</span> Clean (followed)</span>
        <span className="legend-item" role="listitem"><span className="legend-dot broken" aria-hidden="true">▲</span> Broken rule</span>
        <span className="legend-item" role="listitem"><span className="legend-dot off-plan" aria-hidden="true">■</span> Off-plan</span>
      </div>
    </div>
  );
}

export function ChallengeDetail({ id }: { id: string }) {
  const { challenges, saved, hydrated } = useChallenges();
  const journal = useJournal();
  const prefs = usePrefs();
  const { now } = useToday();
  const [confirmEndId, setConfirmEndId] = useState<string | null>(null);
  const confirmEnd = confirmEndId === id;

  const challenge = useMemo(
    () => challenges.find((item) => item.id === id),
    [challenges, id],
  );

  const liveResult = useMemo(() => {
    if (!challenge) return null;
    if (challenge.ended_at === null) {
      return evaluateChallenge(challenge, journal.trades, now);
    }

    const cutoff = Date.parse(challenge.ended_at);
    const tradesAtEnd = journal.trades
      .filter((trade) => Date.parse(trade.entry_time) <= cutoff)
      .map((trade): TradeRecord => trade.exit_time && Date.parse(trade.exit_time) > cutoff
        ? { ...trade, status: "open", exit_time: null }
        : trade);
    return evaluateChallenge(challenge, tradesAtEnd, cutoff);
  }, [challenge, journal.trades, now]);

  const displayResult = challenge?.ended_at === null ? liveResult : challenge?.final;
  const resultDiffers = Boolean(challenge?.final && liveResult
    && JSON.stringify(challenge.final) !== JSON.stringify(liveResult));

  useEffect(() => {
    if (hydrated && journal.hydrated && now && challenge?.ended_at === null
      && liveResult && liveResult.state !== "active") {
      endChallenge(challenge.id, liveResult);
    }
  }, [hydrated, journal.hydrated, now, challenge, liveResult]);

  // Past attempts of this kind (excluding current challenge)
  const pastAttempts = useMemo(() => {
    if (!challenge) return [];
    return challenges
      .filter((c) => c.rules.kind === challenge.rules.kind && c.id !== challenge.id && c.ended_at !== null)
      .sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at));
  }, [challenges, challenge]);

  if (!hydrated || !journal.hydrated) {
    return (
      <div className="page" role="status" aria-label="Loading challenge…">
        <div className="skeleton" style={{ height: 360 }} />
      </div>
    );
  }

  if (!challenge || !displayResult) {
    return (
      <div className="page">
        <div className="specular-card empty-state">
          <h3>{challenge ? "Challenge ended" : "Challenge not found"}</h3>
          <p>{challenge ? "This attempt has no saved result." : "This challenge is not on this device or may have been removed."}</p>
          <div className="actions">
            <Link className="btn-secondary" href="/">Back to Today</Link>
          </div>
        </div>
      </div>
    );
  }

  const isEnded = challenge.ended_at !== null;
  const isDrawdown = challenge.rules.kind === "drawdown";
  const rules = challenge.rules;

  // Build trade list for scored trades, in order newest first
  const tradeMap = new Map<string, TradeRecord>();
  for (const t of journal.trades) {
    tradeMap.set(t.id, t);
  }

  const scoredPointsNewestFirst = [...displayResult.points].reverse();

  const handleEndChallenge = () => {
    endChallenge(challenge.id, displayResult);
    setConfirmEndId(null);
  };

  return (
    <div className="page challenge-detail-page">
      <div className="page-head">
        <div>
          <Link href="/" className="btn-secondary challenge-back-link" aria-label="Back to Today screen" style={{ minHeight: 44, display: "inline-flex", alignItems: "center" }}>← Today</Link>
          <span className="eyebrow">
            {isDrawdown ? "Drawdown Defender" : "Clean Run"} · {isEnded ? "Ended" : "Active"}
          </span>
          <h1>
            {isDrawdown ? "Drawdown Defender" : "Clean Run"}
          </h1>
          <ChallengeAccountBadge accountId={challenge.account_id ?? null} />
          <p className="challenge-start-date">
            Started {formatSessionDate(sessionDate(new Date(challenge.started_at).getTime()), true)}
            {challenge.ended_at && ` · Ended ${formatSessionDate(sessionDate(new Date(challenge.ended_at).getTime()), true)}`}
          </p>
        </div>
      </div>

      {!saved && (
        <div className="banner warn" role="status" style={{ margin: "0 0 14px" }}>
          Not saved on this device — storage is blocked
        </div>
      )}

      {resultDiffers && (
        <div className="banner warn" role="status" style={{ margin: "0 0 14px" }}>
          A trade was edited after this ended. Today&apos;s numbers differ. Showing saved final result below.
          {liveResult && (
            <div className="num">
              Recalculated: {challenge.rules.kind === "drawdown"
                ? `${liveResult.sessions_done ?? 0} days · ${Math.round(((liveResult.drawdown_cents ?? 0) / challenge.rules.max_drawdown_cents) * 100)}% of limit used`
                : `${liveResult.run ?? 0} in a row · best ${liveResult.best_run ?? 0}`}
            </div>
          )}
        </div>
      )}

      {/* Primary Headline Card */}
      <section className="specular-card card-pad challenge-headline-card" aria-label="Challenge Status">
        {displayResult.state === "passed" && (
          <div className="challenge-status-passed" role="status" style={{ marginBottom: 12 }}>
            <span className="challenge-detail-banner-title">
              Done: {isDrawdown
                ? `${rules.kind === "drawdown" ? rules.sessions : ""} days inside ${prefs.shield ? "the limit" : formatBalance(rules.kind === "drawdown" ? rules.max_drawdown_cents : 0)}`
                : `${rules.kind === "clean_run" ? rules.target_trades : ""} in a row by the rules`}
            </span>
            <span className="challenge-badge-check" aria-hidden="true">✓</span>
          </div>
        )}

        {displayResult.state === "failed" && (
          <div className="challenge-status-failed" role="status" style={{ marginBottom: 12 }}>
            <span className="challenge-detail-banner-title">
              {isDrawdown ? "Limit reached" : "Failed rule"}
            </span>
            <span className="challenge-badge-fail" aria-hidden="true">✕</span>
          </div>
        )}

        <div className="challenge-metrics-grid" role="region" aria-label="Challenge metrics summary">
          {isDrawdown && rules.kind === "drawdown" && (
            <>
              <div className="metric-box">
                <small id="metric-sessions-label">Days Completed</small>
                <b className="num" aria-labelledby="metric-sessions-label">{displayResult.sessions_done ?? 0} / {rules.sessions}</b>
              </div>
              <div className="metric-box">
                <small id="metric-dd-label">Drawdown Used</small>
                {prefs.shield ? (
                  <b className="num" aria-labelledby="metric-dd-label">
                    {Math.round(((displayResult.drawdown_cents ?? 0) / rules.max_drawdown_cents) * 100)}% of limit
                  </b>
                ) : (
                  <b className="num" aria-labelledby="metric-dd-label">
                    {formatBalance(displayResult.drawdown_cents ?? 0)}
                    <span className="metric-sub"> / {formatBalance(rules.max_drawdown_cents)}</span>
                  </b>
                )}
              </div>
              <div className="metric-box">
                <small id="metric-room-label">Room Remaining</small>
                {prefs.shield ? (
                  <b className="num" aria-labelledby="metric-room-label">
                    {formatChallengeRoomLabel(displayResult.remaining_cents ?? 0, rules.max_drawdown_cents, true)}
                  </b>
                ) : (
                  <b className="num" aria-labelledby="metric-room-label">
                    {formatChallengeRoomLabel(displayResult.remaining_cents ?? 0, rules.max_drawdown_cents, false)}
                  </b>
                )}
              </div>
              <div className="metric-box">
                <small id="metric-peak-label">Peak Equity</small>
                {prefs.shield ? (
                  <b className="num" aria-labelledby="metric-peak-label">—</b>
                ) : (
                  <b className="num" aria-labelledby="metric-peak-label">{formatBalance(displayResult.peak_cents ?? 0)}</b>
                )}
              </div>
            </>
          )}

          {!isDrawdown && rules.kind === "clean_run" && (
            <>
              <div className="metric-box">
                <small id="metric-streak-label">Current Streak</small>
                <b className="num gold" aria-labelledby="metric-streak-label">{displayResult.run ?? 0} / {rules.target_trades}</b>
              </div>
              <div className="metric-box">
                <small id="metric-best-label">Best Streak</small>
                <b className="num gold" aria-labelledby="metric-best-label">{displayResult.best_run ?? 0}</b>
              </div>
              <div className="metric-box">
                <small id="metric-playbooks-label">Playbooks Included</small>
                <b aria-labelledby="metric-playbooks-label">{rules.playbook_ids.length > 0 ? `${rules.playbook_ids.length} playbooks` : "None selected"}</b>
              </div>
            </>
          )}
        </div>

        {displayResult.provisional && (
          <div className="challenge-estimate" role="note" style={{ marginTop: 12 }}>
            ⚠️ Numbers are estimates while trades need attention.
          </div>
        )}
      </section>

      {/* Path Section */}
      <section className="specular-card card-pad" style={{ marginTop: 14 }}>
        <h3>Path</h3>
        {isDrawdown && rules.kind === "drawdown" ? (
          <DrawdownPathChart
            points={displayResult.points}
            maxDrawdownCents={rules.max_drawdown_cents}
            shield={prefs.shield}
          />
        ) : (
          <CleanRunDotsDetail
            points={displayResult.points}
          />
        )}
      </section>

      {/* Needs Attention / Issues */}
      {displayResult.issues.length > 0 && (
        <section className="specular-card card-pad" style={{ marginTop: 14 }}>
          <h3>Needs Attention</h3>
          <div className="challenge-issues-list">
            {displayResult.issues.map((issue, idx) => {
              const trade = tradeMap.get(issue.trade_id);
              const label =
                issue.reason === "open"
                  ? "Trade is still open"
                  : issue.reason === "unpriceable"
                    ? "Trade cannot be priced (needs exit/quantity)"
                    : issue.reason === "undated"
                      ? "Trade needs a valid exit date"
                      : "Clean Run checklist needs grading";
              return (
                <div key={idx} className="challenge-issue-item">
                  <div className="issue-info">
                    <span className="issue-label">{label}</span>
                    {trade && (
                      <span className="issue-meta num">
                        {trade.symbol} · {trade.direction} · {formatDetailTime(trade.entry_time)}
                      </span>
                    )}
                  </div>
                  <Link href={`/trades/${encodeURIComponent(issue.trade_id)}`} className="btn-secondary issue-fix-link" aria-label={`${issue.reason === "undated" ? "View" : "Fix"} trade ${trade ? `${trade.symbol} ${trade.direction}` : ""}`} style={{ minHeight: 44, display: "inline-flex", alignItems: "center" }}>
                    {issue.reason === "undated" ? "View trade →" : "Fix trade →"}
                  </Link>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Scored Trades List */}
      <section className="specular-card card-pad" style={{ marginTop: 14 }}>
        <div className="section-title" style={{ margin: "0 0 10px" }}>
          <h3>Scored Trades</h3>
          <span className="num">{scoredPointsNewestFirst.length} scored</span>
        </div>

        {scoredPointsNewestFirst.length === 0 ? (
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>No trades have been scored for this challenge yet.</p>
        ) : (
          <div className="trade-list">
            {scoredPointsNewestFirst.map((pt, index) => {
              const trade = tradeMap.get(pt.trade_id);
              const isDeciding = displayResult.decided_by === pt.trade_id;

              const pnl = pt.equity_cents === undefined
                ? null
                : (pt.equity_cents - (scoredPointsNewestFirst[index + 1]?.equity_cents ?? 0)) / 100;

              return (
                <div key={pt.trade_id} className={`challenge-trade-row-wrap ${isDeciding ? "deciding" : ""}`}>
                  {isDeciding && (
                    <div className="challenge-deciding-badge" role="status">
                      {displayResult.state === "failed" ? "Deciding Trade (Breached Limit)" : "Deciding Trade (Target Reached)"}
                    </div>
                  )}
                  <Link href={`/trades/${encodeURIComponent(pt.trade_id)}`} className="trade-row" aria-label={`Trade #${scoredPointsNewestFirst.length - index}: ${trade?.symbol ?? "Trade"} ${trade?.direction ?? ""}, ${pt.read ? (pt.read === "clean" ? "Clean rules followed" : pt.read === "broken" ? "Broken rule" : "Off-plan") : "unclassified"}, closed ${formatSessionDate(pt.session)}`}>
                    <span className="row-main">
                      <span className="row-title">
                        <strong>{trade?.symbol ?? "Trade unavailable"}</strong>
                        {trade && (
                          <span className={`direction ${trade.direction === "LONG" ? "long" : "short"}`}>
                            {trade.direction === "LONG" ? "▲ LONG" : "▼ SHORT"}
                          </span>
                        )}
                        {pt.read && (
                          <span className={`challenge-read-chip ${pt.read}`}>
                            {pt.read === "clean" ? "● Clean" : pt.read === "broken" ? "▲ Broken Rule" : "■ Off-Plan"}
                          </span>
                        )}
                      </span>
                      <span className="row-meta">
                        {formatDetailTime(new Date(pt.closed_at).toISOString())} · {formatSessionDate(pt.session)}
                      </span>
                    </span>
                    <span className="row-result">
                      <b>{!prefs.shield && pnl !== null ? formatMoney(pnl) : ""}</b>
                      <span>{pt.drawdown_cents !== undefined && !prefs.shield ? `${formatBalance(pt.drawdown_cents)} DD` : ""}</span>
                    </span>
                  </Link>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Fine Print Disclosure */}
      <section className="specular-card card-pad challenge-fine-print" style={{ marginTop: 14 }}>
        <p>
          Gross: fees are not included. Closed trades only: this does not see how far a trade went against you while it was open. From your own log, not from your broker.
        </p>
        {displayResult.excluded_before_start > 0 && (
          <p>
            {displayResult.excluded_before_start} {displayResult.excluded_before_start === 1 ? "trade was" : "trades were"} already open at the start and {displayResult.excluded_before_start === 1 ? "is" : "are"} not counted.
          </p>
        )}
      </section>

      {/* Manual End Challenge Action */}
      {!isEnded && (
        <div className="challenge-end-section" style={{ marginTop: 20 }}>
          {confirmEnd ? (
            <div
              className="challenge-confirm-box specular-card card-pad"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="confirm-end-title"
              aria-describedby="confirm-end-desc"
            >
              <h4 id="confirm-end-title" style={{ margin: "0 0 8px" }}>End Challenge Early?</h4>
              <p id="confirm-end-desc">Are you sure you want to end this challenge? It will be saved in your past attempts and cannot be resumed.</p>
              <div className="challenge-confirm-actions">
                <button type="button" className="btn-secondary" onClick={() => setConfirmEndId(null)} aria-label="Cancel ending challenge" style={{ minHeight: 44 }}>
                  Cancel
                </button>
                <button type="button" className="btn-primary" onClick={handleEndChallenge} aria-label="Confirm end challenge" style={{ minHeight: 44 }}>
                  Confirm End Challenge
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="btn-ghost challenge-end-btn"
              onClick={() => setConfirmEndId(id)}
              aria-label="End this challenge early"
              style={{ minHeight: 44 }}
            >
              End challenge…
            </button>
          )}
        </div>
      )}

      {/* Past Attempts */}
      {pastAttempts.length > 0 && (
        <section className="specular-card card-pad challenge-past-section" style={{ marginTop: 24 }} aria-label="Past challenge attempts">
          <h3>Past Attempts</h3>
          <div className="challenge-past-list">
            {pastAttempts.map((past) => {
              const res = past.final;
              const passed = res?.state === "passed";
              const failed = res?.state === "failed";
              return (
                <Link
                  key={past.id}
                  href={`/challenges/${encodeURIComponent(past.id)}`}
                  className="challenge-past-row"
                  aria-label={`View attempt from ${formatSessionDate(sessionDate(new Date(past.started_at).getTime()))}, status ${passed ? "Passed" : failed ? "Failed" : "Ended"}`}
                  style={{ minHeight: 44, display: "flex", alignItems: "center" }}
                >
                  <div className="past-info">
                    <span className="past-dates num">
                      {formatSessionDate(sessionDate(new Date(past.started_at).getTime()))}
                      {past.ended_at && ` – ${formatSessionDate(sessionDate(new Date(past.ended_at).getTime()))}`}
                    </span>
                    <span className="past-status">
                      {passed ? "Passed ✓" : failed ? "Failed ✕" : "Ended"}
                    </span>
                  </div>
                  <span className="past-arrow" aria-hidden="true">→</span>
                </Link>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
