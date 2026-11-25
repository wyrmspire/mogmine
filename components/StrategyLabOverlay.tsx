"use client";

// Real trades overlay view (docs/design-2026-11-24/09 §8.6, SL-11). Presentation only: the model comes from
// lib/strategy-lab/overlay.ts. Samples are excluded until the owner turns the toggle on.
import type { ReactNode } from "react";
import type { OverlayGroup, OverlaySummary } from "@/lib/strategy-lab/overlay";
import { overlayHeadline } from "@/lib/strategy-lab/overlay";
import type { Value } from "@/lib/strategy-lab/types";

export interface StrategyLabOverlayProps {
  /** Null while the trades or bars are still loading. */
  summary: OverlaySummary | null;
  includeSamples: boolean;
  onIncludeSamplesChange: (next: boolean) => void;
}

const ET_TIME = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
});

function signedR(value: number | null): string {
  if (value === null) return "n/a";
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(2)}R`;
}

function actualText(actual: Value): string {
  if (actual === null) return "no value";
  if (typeof actual === "number") return Number.isInteger(actual) ? String(actual) : actual.toFixed(2);
  return String(actual);
}

function GroupRow({ title, group }: { title: string; group: OverlayGroup }): ReactNode {
  return (
    <tr>
      <th scope="row">{title}</th>
      <td className="tabular-nums">{group.n}</td>
      <td className="tabular-nums">{group.withR}</td>
      <td className="tabular-nums">{signedR(group.avgR)}</td>
      <td className="tabular-nums">{signedR(group.totalR)}</td>
    </tr>
  );
}

export function StrategyLabOverlay({ summary, includeSamples, onIncludeSamplesChange }: StrategyLabOverlayProps) {
  const toggle = (
    <label className="sl-overlay__toggle">
      <input
        type="checkbox"
        checked={includeSamples}
        onChange={(event) => onIncludeSamplesChange(event.currentTarget.checked)}
      />
      {" "}Include sample trades
    </label>
  );

  if (!summary) {
    return (
      <section className="sl-overlay" aria-label="Your real trades">
        <h3>Your real trades</h3>
        {toggle}
        <p className="sl-overlay__state">Loading your trades and bars…</p>
      </section>
    );
  }

  const labels = new Map(summary.legend.map((item) => [item.path, item.label]));
  const older = summary.olderThanHistory;

  return (
    <section className="sl-overlay" aria-label="Your real trades">
      <h3>Your real trades</h3>
      <p className="sl-overlay__basis">{summary.basis}</p>
      {toggle}
      {summary.samplesExcluded > 0 ? (
        <p className="sl-overlay__note">{summary.samplesExcluded} sample {summary.samplesExcluded === 1 ? "trade" : "trades"} excluded.</p>
      ) : null}
      <p className="sl-overlay__headline">{overlayHeadline(summary)}</p>

      <table className="sl-overlay__table">
        <caption>Fit vs not fit, in account R</caption>
        <thead>
          <tr>
            <th scope="col">Group</th>
            <th scope="col">Trades</th>
            <th scope="col">Priced</th>
            <th scope="col">Avg R</th>
            <th scope="col">Total R</th>
          </tr>
        </thead>
        <tbody>
          <GroupRow title="Fits the recipe" group={summary.fit} />
          <GroupRow title="Does not fit" group={summary.notFit} />
        </tbody>
      </table>

      {older.count > 0 ? (
        <p className="sl-overlay__note">
          {older.count} older than the 1-minute bar history, not computed.
        </p>
      ) : null}
      {summary.afterHistory > 0 ? (
        <p className="sl-overlay__note">{summary.afterHistory} after the loaded bars.</p>
      ) : null}
      {summary.noBarAtEntry > 0 ? (
        <p className="sl-overlay__note">{summary.noBarAtEntry} in range with no 1-minute bar at entry.</p>
      ) : null}

      <ul className="sl-overlay__rows">
        {summary.rows.map((row) => (
          <li key={row.tradeId} className={row.fits ? "sl-overlay__row sl-overlay__row--fit" : "sl-overlay__row"}>
            <div className="sl-overlay__row-head">
              <span className="tabular-nums">{ET_TIME.format(new Date(row.time))} ET</span>
              <span>{row.fits ? "Fits" : "Doesn't fit"}</span>
              <span className="tabular-nums">{signedR(row.realResultR)}</span>
            </div>
            <ul className="sl-overlay__conditions">
              {row.conditions.map((cond) => (
                <li key={cond.path}>
                  <span aria-hidden="true">{cond.passed ? "✓" : "✗"}</span>{" "}
                  <span className="sr-only">{cond.passed ? "pass:" : "fail:"}</span>
                  {labels.get(cond.path) ?? cond.path} <span className="tabular-nums">({actualText(cond.actual)})</span>
                </li>
              ))}
            </ul>
            {row.simulated ? (
              <p className="sl-overlay__sim">
                Recipe simulated: {signedR(row.simulated.resultR)} ({row.simulated.exitReason})
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
