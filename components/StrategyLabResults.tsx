"use client";

// Results screen for one run (docs/design-2026-11-24/09 §8.2, §8.4, §12.5). Presentation only: every line comes from
// lib/strategy-lab/results-view.ts. R is always the run's fixed account R size (never a stop width); Shield removes
// dollars, and the R basis line comes from rSizeBasis so that rule lives in one place.
import { useState, type CSSProperties, type ReactNode } from "react";
import type { BarSeries, RunResult, SkillOutputRef } from "@/lib/strategy-lab/types";
import { rSizeBasis } from "@/lib/strategy-lab/context-card";
import {
  comparisonNote, dataLines, defaultSliceLabel, edgeRows, HYPOTHETICAL_LABEL, HYPOTHETICAL_NOTE,
  headerLine, slippageAssumptionText, statLines, type EdgeRow,
  researchGovernanceLines,
} from "@/lib/strategy-lab/results-view";
import { StrategyLabSplits, StrategyLabTimeOfDay } from "@/components/StrategyLabSplits";
import { StrategyLabMatches } from "@/components/StrategyLabMatches";

type Tab = "splits" | "tod" | "matches";
const TABS: readonly { id: Tab; label: string }[] = [
  { id: "splits", label: "Splits" },
  { id: "tod", label: "Time of day" },
  { id: "matches", label: "Matches" },
];

const EDGE_LIST: CSSProperties = { listStyle: "none", margin: 0, padding: "0 0 6px", display: "grid", gap: 2, minWidth: 0 };
const EDGE_ROW: CSSProperties = { display: "grid", gap: 2, padding: "6px 0", minWidth: 0 };

export interface StrategyLabResultsProps {
  result: RunResult;
  /** Recipe name, for example "Premarket bottom". The version comes from the run. */
  title: string;
  /** Account name for the R basis line, or null for the default risk budget. */
  accountName: string | null;
  shield: boolean;
  labelOf?: (ref: SkillOutputRef) => string;
  /** Bars for the match sheet's sparkline. Optional. */
  series?: BarSeries | null;
  onOpenAt?: (time: number) => void;
  /** Slot for the real-trades overlay (SL-11). */
  overlay?: ReactNode;
  /** The recipe's deterministic execution-cost assumption, shown without changing run math. */
  slippageTicks?: { stop: number; market: number };
}

export function StrategyLabResults({
  result, title, accountName, shield, labelOf = defaultSliceLabel, series = null, onOpenAt, overlay, slippageTicks,
}: StrategyLabResultsProps) {
  const [tab, setTab] = useState<Tab>("splits");
  const basis = rSizeBasis(
    {
      usd: result.data.rSize.usd,
      source: result.data.rSize.source === "account" ? "account" : "default",
      accountName,
    },
    shield,
  );
  const sliceBy = result.splits.map((s) => s.ref);
  const { works, fails } = edgeRows(result.separators, result.splits, result.stats.avgR, labelOf);
  const [headline, ...details] = statLines(result.stats);

  return (
    <div
      className="sl-result"
      data-result-kind="hypothetical"
      aria-label="Hypothetical simulated strategy results"
      style={{ minWidth: 0 }}
    >
      <section className="sl-card" aria-label="Hypothetical simulated run results">
        <header className="sl-card-head">
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center" }}>
            <h2 className="sl-card-title" style={{ margin: 0 }}>
              {headerLine(title, result.recipe.version, result.data.sessionsUsed.length, result.data.sessionsRequested)}
            </h2>
            <span
              data-result-badge="hypothetical"
              aria-label="Hypothetical simulated result"
              style={{
                border: "1px solid var(--border-strong)",
                borderRadius: "999px",
                padding: "3px 8px",
                color: "var(--text-primary)",
                fontSize: "0.75rem",
                fontWeight: 700,
                letterSpacing: "0.02em",
                whiteSpace: "nowrap",
              }}
            >
              {HYPOTHETICAL_LABEL}
            </span>
          </div>
          <p className="sl-hint" role="note">{HYPOTHETICAL_NOTE}</p>
          <p className="sl-basis">{basis}</p>
          <p className="sl-basis">{slippageAssumptionText(slippageTicks)}</p>
          {researchGovernanceLines(result.data).map((line) => <p key={line} className="sl-basis">{line}</p>)}
        </header>
        <p className="sl-basis" style={{ color: "var(--text-primary)", fontWeight: 700 }}>{headline}</p>
        {details.map((line) => <p key={line} className="sl-basis">{line}</p>)}
      </section>

      <section className="sl-card" aria-label="Where it works and fails">
        <EdgeGroup title="Where it works" rows={works} empty="No slice has enough trades to rank yet." />
        <EdgeGroup title="Where it fails" rows={fails} empty="Nothing ranks as a clear loser yet." />
        <p className="sl-hint" role="note">{comparisonNote(sliceBy.length)}</p>
      </section>

      {overlay}

      <div className="sl-seg" role="group" aria-label="Results detail" style={{ maxWidth: "100%" }}>
        {TABS.map((t) => (
          <button key={t.id} type="button" aria-pressed={tab === t.id} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      <section aria-label={TABS.find((t) => t.id === tab)?.label} style={{ minWidth: 0 }}>
        {tab === "splits" ? <StrategyLabSplits splits={result.splits} labelOf={labelOf} /> : null}
        {tab === "tod" ? <StrategyLabTimeOfDay cells={result.timeOfDay} /> : null}
        {tab === "matches" ? (
          <StrategyLabMatches
            matches={result.matches}
            sliceBy={sliceBy}
            labelOf={labelOf}
            series={series}
            onOpenAt={onOpenAt}
          />
        ) : null}
      </section>

      <details className="sl-group" aria-label="Data">
        <summary><span>Data</span></summary>
        <ul style={EDGE_LIST}>
          {dataLines(result.data, basis).map((line) => (
            <li key={line} className="sl-excluded">{line}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}

function EdgeGroup({ title, rows, empty }: { title: string; rows: readonly EdgeRow[]; empty: string }) {
  return (
    <details className="sl-group" open>
      <summary><span>{title}</span></summary>
      {rows.length === 0 ? (
        <p className="sl-hint" style={{ padding: "0 0 8px" }}>{empty}</p>
      ) : (
        <ul style={EDGE_LIST}>
          {rows.map((row) => (
            <li
              key={`${row.role}-${row.slice}-${row.bucket}`}
              data-role={row.role}
              data-greyed={row.greyed ? "true" : "false"}
              style={{ ...EDGE_ROW, ...(row.greyed ? { color: "var(--text-muted)", opacity: 0.65 } : {}) }}
            >
              <span style={{ fontSize: "0.8125rem", overflowWrap: "anywhere" }}>
                <b>{row.role === "works" ? "Works" : "Fails"}:</b> {row.slice}: {row.bucket}
              </span>
              <span className="sl-row-note">
                {row.wins} of {row.n} won · {row.shrunkR} shrunk vs {row.overallR} overall
                {row.thin ? " · thin" : ""} · {row.stability} · {row.clarity}
              </span>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
