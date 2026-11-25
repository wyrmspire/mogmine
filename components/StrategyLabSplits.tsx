"use client";

// Splits and time-of-day views (docs/design-2026-11-24/09 §8.3, §8.5, §12.5). Presentation only: rows come from
// lib/strategy-lab/results-view.ts. Thin buckets (n 5–9) and counts-only buckets (n < 5) are greyed, never hidden.
import type { CSSProperties } from "react";
import type { SkillOutputRef, Split, TodCell } from "@/lib/strategy-lab/types";
import { defaultSliceLabel, splitRowViews, todRowViews } from "@/lib/strategy-lab/results-view";

const GREY: CSSProperties = { color: "var(--text-muted)", opacity: 0.6 };
const NUM: CSSProperties = {
  fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", textAlign: "right", whiteSpace: "nowrap",
  padding: "8px 6px", fontSize: "0.8125rem",
};
const HEAD: CSSProperties = { ...NUM, textAlign: "right", color: "var(--text-muted)", fontFamily: "var(--font-sans)", fontWeight: 700 };
const STICKY: CSSProperties = {
  position: "sticky", left: 0, background: "var(--bg-surface)", textAlign: "left", padding: "8px 6px",
  fontSize: "0.8125rem", fontWeight: 600, minWidth: 96, maxWidth: 140, overflowWrap: "anywhere",
};
const SMALL: CSSProperties = { display: "block", fontSize: "0.6875rem", color: "var(--text-muted)", fontWeight: 400 };

export interface StrategyLabSplitsProps {
  splits: readonly Split[];
  labelOf?: (ref: SkillOutputRef) => string;
}

export function StrategyLabSplits({ splits, labelOf = defaultSliceLabel }: StrategyLabSplitsProps) {
  if (splits.length === 0) return <p className="sl-hint">No slices were chosen for this recipe.</p>;
  return (
    <div style={{ display: "grid", gap: 16, minWidth: 0 }}>
      {splits.map((split) => {
        const label = labelOf(split.ref);
        const rows = splitRowViews(split);
        return (
          <div key={label} style={{ overflowX: "auto", minWidth: 0 }}>
            <table aria-label={`Splits by ${label}`} style={{ borderCollapse: "collapse", width: "100%", minWidth: 320 }}>
              <thead>
                <tr>
                  <th scope="col" style={{ ...STICKY, ...HEAD, textAlign: "left", background: "var(--bg-surface)" }}>{label}</th>
                  <th scope="col" style={HEAD}>n</th>
                  <th scope="col" style={HEAD}>win</th>
                  <th scope="col" style={HEAD}>avg R</th>
                  <th scope="col" style={HEAD}>shrunk</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key} data-tone={row.tone} style={row.tone === "full" ? undefined : GREY}>
                    <th scope="row" style={STICKY}>
                      {row.label}
                      {row.note ? <small style={SMALL}>{row.note}</small> : null}
                    </th>
                    <td style={NUM}>{row.n}</td>
                    <td style={NUM}>
                      {row.win}
                      {row.winCi ? <small style={SMALL}>{row.winCi}</small> : null}
                    </td>
                    <td style={NUM}>{row.avgR}</td>
                    <td style={NUM}>{row.shrunkR}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

export interface StrategyLabTimeOfDayProps {
  cells: readonly TodCell[];
}

/** Vertical list, one row per 30-minute ET bucket. The bar is a visual aid; the number always prints. */
export function StrategyLabTimeOfDay({ cells }: StrategyLabTimeOfDayProps) {
  if (cells.length === 0) return <p className="sl-hint">No trades in this run to bucket by time.</p>;
  const rows = todRowViews(cells);
  return (
    <ul className="sl-rows" aria-label="Time of day">
      {rows.map((row) => (
        <li
          key={row.bucket}
          data-tone={row.tone}
          className="sl-row"
          style={{ gridTemplateColumns: "56px minmax(0, 1fr) auto", ...(row.tone === "full" ? {} : GREY) }}
        >
          <span style={{ fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", fontSize: "0.875rem" }}>{row.bucket}</span>
          <div style={{ minWidth: 0 }}>
            <div style={{ height: 8, borderRadius: 4, background: "var(--bg-inset)", overflow: "hidden" }}>
              <div
                aria-hidden="true"
                style={{
                  height: "100%",
                  width: `${row.barPct}%`,
                  background: row.sign === "neg" ? "var(--loss-text)" : "var(--profit-text)",
                }}
              />
            </div>
            <small style={SMALL}>n {row.n} · win {row.win}{row.tone === "counts" ? " · counts only" : row.tone === "thin" ? " · thin" : ""}</small>
          </div>
          <span style={{ ...NUM, padding: 0, color: row.sign === "neg" ? "var(--loss-text)" : row.sign === "pos" ? "var(--profit-text)" : "var(--text-primary)" }}>
            {row.avgR}
          </span>
        </li>
      ))}
    </ul>
  );
}
