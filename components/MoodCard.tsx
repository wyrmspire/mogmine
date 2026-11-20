"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { MoodAxes, MoodShape, MoodShapeLayer, useTradeMood } from "./MoodShape";
import { formatR } from "@/lib/format";
import { MIN_MOOD_SAMPLE, describeMood, knownCount, moodOutcomeStats, similarTrades, spokeById } from "@/lib/mood";
import type { RSummary } from "@/lib/mood";
import { useMood } from "@/lib/mood-store";
import { useJournal } from "@/lib/store";
import type { TradeRecord } from "@/lib/trades";

/** "12 trades · not enough data yet (20 needed)". Sample size is always shown (docs/13 BET-03, docs/18 §6). */
function sampleText(n: number) {
  return n >= MIN_MOOD_SAMPLE ? `${n} trades` : `${n} ${n === 1 ? "trade" : "trades"} · not enough data yet (${MIN_MOOD_SAMPLE} needed)`;
}

/** R values on one line: a dot per trade, zero marked. Distribution, not a verdict. */
function RDots({ summary }: { summary: RSummary }) {
  if (!summary.n) return null;
  const low = Math.min(-1, ...summary.values);
  const high = Math.max(1, ...summary.values);
  const x = (value: number) => 6 + ((value - low) / (high - low)) * 188;
  return (
    <svg className="r-dots" viewBox="0 0 200 20" role="img" aria-label={`R of each trade: ${summary.values.map((value) => formatR(value)).join(", ")}`}>
      <line className="zero" x1={x(0)} x2={x(0)} y1={2} y2={18} />
      {summary.values.map((value, index) => <circle key={index} cx={x(value)} cy={10} r={3} className={value > 0 ? "up" : value < 0 ? "down" : ""} />)}
    </svg>
  );
}

/** Trade detail: the shape, what it says, and the R of trades that felt like this. */
export function MoodCard({ trade, onEdit }: { trade: TradeRecord; onEdit: () => void }) {
  const journal = useJournal();
  const mood = useMood();
  const vector = useTradeMood(trade);
  const similar = useMemo(() => similarTrades(trade, journal.trades, mood.records, mood.registry), [trade, journal.trades, mood.records, mood.registry]);
  const scored = knownCount(vector);
  const pending = mood.suggestions[trade.id];

  return (
    <section className="specular-card card-pad mood-card" aria-label="Mood Shape">
      <div className="card-head"><h3>Mood Shape</h3><span>private</span></div>
      <div className="mood-card-body">
        <button type="button" className="mood-open" onClick={onEdit} aria-label="Edit the Mood Shape">
          <MoodShape vector={vector} size={112} labels={false} />
        </button>
        <div className="mood-card-text">
          <p>{describeMood(vector)}</p>
          {pending && <p className="muted">Suggestions from your notes are waiting.</p>}
          <button type="button" className="btn-secondary" onClick={onEdit}>{scored ? "Adjust" : "Add mood"}</button>
        </div>
      </div>
      {scored > 0 && (
        <div className="mood-similar">
          <h4>Trades that felt like this</h4>
          {similar.matches.length === 0 ? (
            <p className="muted">None yet. Shapes are compared once at least three spokes are scored on both trades.</p>
          ) : (
            <>
              <p className="num">
                {similar.summary.n ? `${similar.summary.wins} up · ${similar.summary.losses} down · mean ${formatR(similar.summary.meanR)}` : "No R yet"}
                {similar.summary.skipped ? ` · ${similar.summary.skipped} without R` : ""}
              </p>
              <RDots summary={similar.summary} />
              <p className="muted">{sampleText(similar.summary.n)}</p>
              <ul className="mood-similar-list">
                {similar.matches.slice(0, 3).map((match) => (
                  <li key={match.trade.id}><Link href={`/trades/${match.trade.id}`}>{match.trade.symbol} {match.trade.direction === "LONG" ? "▲" : "▼"} <span className="num">{match.r == null ? (match.trade.exit_time == null ? "Open" : "—R") : formatR(match.r)}</span></Link></li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * Average shape of winners against losers, and expectancy by the spoke that dominated. Real, closed
 * trades with an R only. "Before exit only" uses scores captured before the exit, so the result cannot
 * have shaped them.
 */
export function MoodStatsCard({ trades }: { trades: TradeRecord[] }) {
  const mood = useMood();
  const [preExit, setPreExit] = useState(false);
  const stats = useMemo(() => moodOutcomeStats(trades, mood.records, mood.registry, { phase: preExit ? "pre_exit" : "any" }), [trades, mood.records, mood.registry, preExit]);
  const size = 168;
  const padding = 34;
  const labels = mood.registry.spokes.map((spoke) => spoke.short);
  const skipped = [
    stats.skipped.sample && `${stats.skipped.sample} sample`,
    stats.skipped.open && `${stats.skipped.open} open`,
    stats.skipped.noR && `${stats.skipped.noR} without a stop`,
    stats.skipped.noMood && `${stats.skipped.noMood} without a mood`,
  ].filter(Boolean);

  return (
    <details className="specular-card card-pad mood-stats">
      <summary>Mood and result <span>{sampleText(stats.used)}</span></summary>
      <div className="toggle-row">
        <span>Before exit only<small>Use only feelings captured while the trade was open. After the exit, the result can colour how it felt.</small></span>
        <button type="button" className="switch-hit" role="switch" aria-checked={preExit} aria-label="Before exit only" onClick={() => setPreExit(!preExit)}><span className="switch" data-checked={preExit} aria-hidden="true" /></button>
      </div>
      {stats.used === 0 ? (
        <p className="muted">No real, closed trade with a stop has a Mood Shape yet. Sample trades never count.</p>
      ) : <div className="mood-overlay">
        <svg className="mood-shape" viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label={`Average shape: ${stats.winners.n} winning trades against ${stats.losers.n} losing trades`}>
          <MoodAxes count={labels.length} size={size} padding={padding} labels={labels} />
          {stats.winners.n > 0 && <MoodShapeLayer values={stats.winners.shape} size={size} padding={padding} tone="profit" outlineOnly />}
          {stats.losers.n > 0 && <MoodShapeLayer values={stats.losers.shape} size={size} padding={padding} tone="loss" outlineOnly />}
        </svg>
        <ul className="mood-legend">
          <li className="profit"><i aria-hidden="true" />Winners · {stats.winners.n}</li>
          <li className="loss"><i aria-hidden="true" />Losers · {stats.losers.n}</li>
        </ul>
      </div>}
      {stats.byDominant.length > 0 && (
        <table className="mood-table">
          <caption>Mean R by the strongest feeling</caption>
          <thead><tr><th scope="col">Strongest</th><th scope="col">Trades</th><th scope="col">Mean R</th></tr></thead>
          <tbody>
            {stats.byDominant.map((group) => (
              <tr key={group.spoke ?? "balanced"}>
                <th scope="row">{group.spoke ? spokeById(mood.registry, group.spoke)?.label ?? group.spoke : "None stands out"}</th>
                <td className="num">{group.summary.n}</td>
                <td className="num">{formatR(group.summary.meanR)}{group.summary.enough ? "" : " · too few"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="note-state" style={{ textAlign: "left" }}>
        {stats.enough ? "" : `Not enough data yet: ${stats.used} of ${MIN_MOOD_SAMPLE} trades. `}
        {skipped.length ? `Left out: ${skipped.join(", ")}.` : ""} Gross R. A pattern here is a question to look into, not a rule.
      </p>
    </details>
  );
}
