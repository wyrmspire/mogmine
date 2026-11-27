"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChallengeSetupSheet } from "./ChallengeSetupSheet";
import { evaluateChallenge, formatChallengeRoomLabel } from "@/lib/challenges";
import type { ChallengeDefinition, ChallengeResult } from "@/lib/challenges";
import { endChallenge, useChallenges } from "@/lib/challenge-store";
import { useAccounts } from "@/lib/accounts-store";
import { formatBalance } from "@/lib/format";
import { formatSessionDate } from "@/lib/session";
import { useJournal } from "@/lib/store";
import { useToday } from "@/lib/ui";

function DrawdownBar({ share, isClose, isBreached }: { share: number; isClose: boolean; isBreached: boolean }) {
  const clamped = Math.max(0, Math.min(1, share));
  const fillClass = isBreached ? "breached" : isClose ? "close" : "";
  const pct = Math.round(clamped * 100);
  return (
    <span
      className={`challenge-meter ${fillClass}`}
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`Drawdown limit used: ${pct}%${isBreached ? " (limit breached)" : isClose ? " (approaching limit)" : ""}`}
    >
      <i style={{ width: `${pct}%` }} />
    </span>
  );
}

function CleanRunDots({
  target,
  run,
}: {
  target: number;
  run: number;
}) {
  const elements = [];
  for (let i = 0; i < target; i++) {
    const isFilled = i < run;
    elements.push(
      <span
        key={i}
        className={`challenge-dot ${isFilled ? "filled" : "empty"}`}
        aria-hidden="true"
      >
        {isFilled ? "●" : "○"}
      </span>,
    );
  }
  return (
    <div
      className="challenge-dots"
      role="progressbar"
      aria-valuenow={run}
      aria-valuemin={0}
      aria-valuemax={target}
      aria-label={`Clean run progress: ${run} of ${target} trades`}
    >
      {elements}
    </div>
  );
}

/** Names the account a challenge is scoped to (UX-08). Renders nothing for all-accounts challenges. */
export function ChallengeAccountBadge({ accountId }: { accountId: string | null }) {
  const { accounts } = useAccounts();
  if (accountId == null) return null;
  const name = accounts.find((account) => account.id === accountId)?.name ?? "Removed account";
  return <span className="challenge-account-badge">{name}</span>;
}

function DrawdownRow({
  challenge,
  result,
  shield,
  onRestart,
}: {
  challenge: ChallengeDefinition;
  result: ChallengeResult;
  shield: boolean;
  onRestart?: () => void;
}) {
  const rules = challenge.rules;
  if (rules.kind !== "drawdown") return null;

  const targetSessions = rules.sessions;
  const sessionsDone = result.sessions_done ?? 0;
  const maxDrawdownCents = rules.max_drawdown_cents;
  const currentDrawdownCents = result.drawdown_cents ?? 0;
  const remainingCents = Math.max(0, result.remaining_cents ?? maxDrawdownCents - currentDrawdownCents);

  const usedShare = maxDrawdownCents > 0 ? currentDrawdownCents / maxDrawdownCents : 0;
  const pctUsed = Math.min(100, Math.max(0, Math.round(usedShare * 100)));
  const isClose = usedShare >= 0.75 && result.state === "active";
  const isBreached = usedShare >= 1;

  const openCount = result.issues.filter((issue) => issue.reason === "open").length;
  const unpriceableCount = result.issues.filter((i) => i.reason === "unpriceable").length;
  const undatedCount = result.issues.filter((issue) => issue.reason === "undated").length;

  const renderContent = () => {
    if (result.state === "passed") {
      return (
        <div className="challenge-status-passed" role="status">
          <span>Passed: {targetSessions} {targetSessions === 1 ? "day" : "days"} inside {shield ? "the limit" : formatBalance(maxDrawdownCents)}</span>
          <span className="challenge-badge-check" aria-hidden="true">✓</span>
        </div>
      );
    }

    if (result.state === "failed") {
      const breachPoint = result.decided_by
        ? result.points.find((p) => p.trade_id === result.decided_by)
        : result.points[result.points.length - 1];
      const sessionDateStr = breachPoint && Number.isFinite(Date.parse(`${breachPoint.session}T00:00:00Z`))
        ? formatSessionDate(breachPoint.session)
        : "";
      return (
        <div className="challenge-status-failed" role="status">
          <span>Limit reached{sessionDateStr ? ` on ${sessionDateStr}` : ""}</span>
          <span className="challenge-badge-fail" aria-hidden="true">✕</span>
        </div>
      );
    }

    return (
      <>
        <div className={`challenge-row-metrics ${isBreached ? "breached" : isClose ? "close" : ""}`}>
          {shield ? (
            <span className="num">{formatChallengeRoomLabel(remainingCents, maxDrawdownCents, true)}{isBreached ? " · limit reached" : isClose ? " · close" : ""}</span>
          ) : (
            <span className="num">
              {formatChallengeRoomLabel(remainingCents, maxDrawdownCents, false)}
              {isBreached ? " · limit reached" : isClose ? " · close" : ""}
            </span>
          )}
          {result.provisional && (
            <span className="challenge-estimate"> · estimate{unpriceableCount > 0 && `, ${unpriceableCount} ${unpriceableCount === 1 ? "trade needs" : "trades need"} a price`}{undatedCount > 0 && `, ${undatedCount} undated`}{openCount > 0 && `, ${openCount} open`}</span>
          )}
        </div>
        <div className="challenge-meter-wrap">
          <DrawdownBar share={usedShare} isClose={isClose} isBreached={isBreached} />
          {!shield && <span className="num challenge-pct">{pctUsed}% used</span>}
        </div>
      </>
    );
  };

  const statusDesc = result.state === "passed"
    ? `Passed, ${targetSessions} days inside limit`
    : result.state === "failed"
      ? "Failed, limit reached"
      : `${sessionsDone} of ${targetSessions} days completed, ${pctUsed}% of limit used`;

  return (
    <div className={`challenge-row ${isBreached ? "failed" : ""}`}>
      <Link href={`/challenges/${encodeURIComponent(challenge.id)}`} className="challenge-row-link" aria-label={`Drawdown Defender challenge: ${statusDesc}`}>
        <div className="challenge-row-head">
          <span className="challenge-name">DRAWDOWN DEFENDER</span>
          <ChallengeAccountBadge accountId={challenge.account_id ?? null} />
          <span className="challenge-header-stat num">
            {sessionsDone} / {targetSessions} days
          </span>
        </div>
        {renderContent()}
      </Link>
      {result.state === "failed" && onRestart && (
        <button type="button" className="btn-ghost challenge-failed-action" onClick={onRestart} aria-label="Start Drawdown Defender challenge again" style={{ minHeight: 44, minWidth: 44 }}>
          Start again
        </button>
      )}
    </div>
  );
}

function CleanRunRow({
  challenge,
  result,
}: {
  challenge: ChallengeDefinition;
  result: ChallengeResult;
}) {
  const rules = challenge.rules;
  if (rules.kind !== "clean_run") return null;

  const targetTrades = rules.target_trades;
  const run = result.run ?? 0;
  const bestRun = result.best_run ?? 0;
  const ungraded = result.issues.filter((i) => i.reason === "ungraded");
  const undatedCount = result.issues.filter((issue) => issue.reason === "undated").length;

  const cleanStatusDesc = result.state === "passed"
    ? `Passed, ${targetTrades} in a row by the rules`
    : `${run} of ${targetTrades} by the rules, best streak ${bestRun}`;

  return (
    <div className="challenge-row">
      <Link href={`/challenges/${encodeURIComponent(challenge.id)}`} className="challenge-row-link" aria-label={`Clean Run challenge: ${cleanStatusDesc}`}>
        <div className="challenge-row-head">
          <span className="challenge-name">CLEAN RUN</span>
          <ChallengeAccountBadge accountId={challenge.account_id ?? null} />
          <span className="challenge-header-stat num">best {bestRun}</span>
        </div>

        {result.state === "passed" ? (
          <div className="challenge-status-passed" role="status">
            <span>Passed: {targetTrades} in a row by the rules</span>
            <span className="challenge-badge-check" aria-hidden="true">✓</span>
          </div>
        ) : (
          <>
            <div className="challenge-row-metrics num">{run} / {targetTrades} by the rules</div>
            {undatedCount > 0 && <span className="challenge-estimate">{undatedCount} undated</span>}
            <CleanRunDots target={targetTrades} run={run} />
          </>
        )}
      </Link>
      {result.state !== "passed" && ungraded.length > 0 && (
        <div className="challenge-grading-note">
          <span>{ungraded.length} {ungraded.length === 1 ? "needs" : "need"} grading</span>
          {ungraded.map(({ trade_id }, index) => (
            <Link key={trade_id} href={`/trades/${encodeURIComponent(trade_id)}`} aria-label={`Grade trade ${index + 1} for Clean Run`} style={{ display: "inline-flex", alignItems: "center", minHeight: 44, minWidth: 44, padding: "0 8px" }}>
              Grade trade {index + 1}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export function ChallengeCard({ shield }: { shield: boolean }) {
  const { challenges, saved, hydrated } = useChallenges();
  const journal = useJournal();
  const { now } = useToday();
  const [setup, setSetup] = useState<{ kind: ChallengeDefinition["rules"]["kind"]; rules?: ChallengeDefinition["rules"] } | null>(null);
  const closeSetup = useCallback(() => setSetup(null), []);
  const onlySamples = journal.trades.every((trade) => trade.is_sample);

  const results = useMemo(() => {
    const rows = [];
    for (const kind of ["drawdown", "clean_run"] as const) {
      const attempts = challenges.filter((challenge) => challenge.rules.kind === kind);
      const challenge = attempts.find((attempt) => attempt.ended_at === null)
        ?? attempts.filter((attempt) => attempt.final?.state === "passed" || attempt.final?.state === "failed")
          .sort((a, b) => Date.parse(b.ended_at!) - Date.parse(a.ended_at!))[0];
      if (!challenge) continue;
      const result = challenge.ended_at === null
        ? evaluateChallenge(challenge, journal.trades, now)
        : challenge.final;
      if (result) rows.push({ challenge, result });
    }
    return rows;
  }, [challenges, journal.trades, now]);

  useEffect(() => {
    if (!hydrated || !journal.hydrated || !now) return;
    for (const { challenge, result } of results) {
      if (challenge.ended_at === null && result.state !== "active") {
        endChallenge(challenge.id, result);
      }
    }
  }, [hydrated, journal.hydrated, now, results]);

  if (!hydrated || onlySamples) return null;

  const manualHistory = (["drawdown", "clean_run"] as const).flatMap((kind) => {
    if (results.some(({ challenge }) => challenge.rules.kind === kind)) return [];
    const latest = challenges
      .filter((challenge) => challenge.rules.kind === kind && challenge.ended_at !== null)
      .sort((a, b) => Date.parse(b.ended_at!) - Date.parse(a.ended_at!))[0];
    return latest ? [latest] : [];
  });

  const availableKind = (["drawdown", "clean_run"] as const).find((kind) =>
    !results.some(({ challenge }) => challenge.rules.kind === kind && challenge.ended_at === null),
  );

  return (
    <section className="specular-card card-pad challenge-card" aria-label="Trading Challenges">
      {!saved && (
        <div className="banner warn" style={{ margin: "0 0 10px" }}>
          Not saved on this device
        </div>
      )}

      {results.length === 0 ? (
        <div className="challenge-empty">
          <button
            type="button"
            className="challenge-start-link"
            onClick={() => setSetup({ kind: availableKind ?? "drawdown" })}
            aria-label="Start a trading challenge"
            style={{ minHeight: 44, minWidth: 44, display: "inline-flex", alignItems: "center" }}
          >
            Start a challenge →
          </button>
        </div>
      ) : (
        <div className="challenge-active-list">
          {results.map(({ challenge, result }) => (
            <div key={challenge.id} className="challenge-entry">
              {challenge.rules.kind === "drawdown" ? (
                <DrawdownRow challenge={challenge} result={result} shield={shield} onRestart={() => setSetup({ kind: "drawdown", rules: challenge.rules })} />
              ) : (
                <CleanRunRow challenge={challenge} result={result} />
              )}
            </div>
          ))}

          {availableKind && (
            <div className="challenge-add-another">
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setSetup({ kind: availableKind ?? "drawdown" })}
                aria-label="Start another challenge"
                style={{ minHeight: 44, minWidth: 44 }}
              >
                ＋ Start another challenge
              </button>
            </div>
          )}
        </div>
      )}

      {manualHistory.map((attempt) => (
        <Link
          key={attempt.id}
          className="challenge-past-row"
          href={`/challenges/${encodeURIComponent(attempt.id)}`}
          aria-label={`View past ${attempt.rules.kind === "drawdown" ? "Drawdown Defender" : "Clean Run"} attempts`}
          style={{ minHeight: 44, minWidth: 44, display: "flex", alignItems: "center" }}
        >
          Past {attempt.rules.kind === "drawdown" ? "Drawdown Defender" : "Clean Run"} attempts
        </Link>
      ))}

      {setup && <ChallengeSetupSheet initialKind={setup.kind} initialRules={setup.rules} onClose={closeSetup} />}
    </section>
  );
}
