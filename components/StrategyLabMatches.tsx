"use client";

// Matches list (docs/design-2026-11-24/09 §12.5). Each row opens a sheet with the bar window as a sparkline and
// "Open at this time", which starts a new mark at that bar. Rows and sheet text come from lib/strategy-lab/results-view.ts.
import { useState, type CSSProperties } from "react";
import type { BarSeries, Match, SkillOutputRef } from "@/lib/strategy-lab/types";
import {
  defaultSliceLabel, matchPage, riskMultipleText, sparkline, MATCH_PAGE_SIZE, type Sign,
} from "@/lib/strategy-lab/results-view";

const TONE: Record<Sign, string> = { pos: "var(--profit-text)", neg: "var(--loss-text)", zero: "var(--text-muted)", none: "var(--text-faint)" };
const MONO: CSSProperties = { fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" };
const ROW_BUTTON: CSSProperties = {
  width: "100%", minHeight: 44, padding: "8px 10px", borderRadius: 10, textAlign: "left", cursor: "pointer",
  background: "var(--bg-surface)", color: "var(--text-primary)", border: "1px solid var(--border-subtle)", font: "inherit",
  display: "grid", gap: 2, minWidth: 0,
};

export interface StrategyLabMatchesProps {
  matches: readonly Match[];
  sliceBy: readonly SkillOutputRef[];
  labelOf?: (ref: SkillOutputRef) => string;
  series?: BarSeries | null;
  onOpenAt?: (time: number) => void;
}

export function StrategyLabMatches({ matches, sliceBy, labelOf = defaultSliceLabel, series, onOpenAt }: StrategyLabMatchesProps) {
  const [shown, setShown] = useState(MATCH_PAGE_SIZE);
  const [open, setOpen] = useState<number | null>(null);
  if (matches.length === 0) return <p className="sl-hint">No matches in this run.</p>;

  const page = matchPage(matches, sliceBy, shown, labelOf);
  return (
    <div style={{ display: "grid", gap: 8, minWidth: 0 }}>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
        {page.rows.map((row) => {
          const match = matches[row.index];
          const expanded = open === row.index;
          return (
            <li key={row.index}>
              <button
                type="button"
                style={ROW_BUTTON}
                aria-expanded={expanded}
                onClick={() => setOpen(expanded ? null : row.index)}
              >
                <span style={{ ...MONO, fontSize: "0.8125rem" }}>{row.when}</span>
                <span style={{ ...MONO, fontWeight: 700, color: TONE[row.sign] }}>
                  {row.r} <span style={{ fontWeight: 400, color: "var(--text-muted)" }}>· {row.exit}</span>
                </span>
                <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", overflowWrap: "anywhere" }}>
                  {row.features.map((f) => `${f.label}: ${f.value}`).join(" · ") || "no slices"}
                </span>
              </button>
              {expanded ? <MatchSheet match={match} series={series ?? null} onOpenAt={onOpenAt} /> : null}
            </li>
          );
        })}
      </ul>
      {page.hidden > 0 ? (
        <button
          type="button"
          className="sl-btn sl-btn--block"
          onClick={() => setShown((n) => n + MATCH_PAGE_SIZE)}
        >
          Show {Math.min(MATCH_PAGE_SIZE, page.hidden)} more · {page.hidden} left
        </button>
      ) : null}
    </div>
  );
}

function MatchSheet({ match, series, onOpenAt }: { match: Match; series: BarSeries | null; onOpenAt?: (time: number) => void }) {
  const spark = series ? sparkline(series, match.i) : null;
  return (
    <div role="region" aria-label="Match detail" style={{ display: "grid", gap: 8, padding: 10, minWidth: 0 }}>
      <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--text-muted)", ...MONO }}>
        entry {match.entry.toFixed(2)} · stop {match.stop.toFixed(2)} · target {match.target.toFixed(2)} · {match.qty} ct
        {match.oversized ? " · oversized" : ""}
      </p>
      <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--text-muted)", ...MONO }}>
        MFE {riskMultipleText(match.outcome.mfeR)} · MAE {riskMultipleText(match.outcome.maeR)} · {match.outcome.minutesToExit} min
      </p>
      {spark && spark.points.length > 1 ? (
        <svg viewBox="0 0 100 40" width="100%" height="64" preserveAspectRatio="none" role="img" aria-label="Closes around this match">
          <polyline
            fill="none"
            stroke="var(--text-muted)"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
            points={spark.points.map((p) => `${(p.x * 100).toFixed(2)},${(p.y * 40).toFixed(2)}`).join(" ")}
          />
          {spark.markerAt >= 0 ? (
            <circle
              cx={spark.points[spark.markerAt].x * 100}
              cy={spark.points[spark.markerAt].y * 40}
              r="1.6"
              fill="var(--gold-mid)"
            />
          ) : null}
        </svg>
      ) : (
        <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--text-muted)" }}>No bars around this match in the loaded data.</p>
      )}
      {onOpenAt ? (
        <button type="button" className="sl-btn sl-btn--block" onClick={() => onOpenAt(match.time)}>
          Open at this time
        </button>
      ) : null}
    </div>
  );
}
