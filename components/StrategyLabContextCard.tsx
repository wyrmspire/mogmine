"use client";

// Context Card view (docs/design-2026-11-24/09 §12.2). Presentation only: the rows come from
// lib/strategy-lab/context-card.ts. Every state the spec names is rendered here: loading, partial,
// error, offline, and ready.
import { useState, type ReactNode } from "react";
import type { CardGroup, CardRow, CardState, ContextCard } from "@/lib/strategy-lab/context-card";
import type { SkipReason } from "@/lib/strategy-lab/types";

export interface ExcludedSession { date: string; reason: string }

export interface StrategyLabContextCardProps {
  state: CardState;
  card: ContextCard | null;
  message: string | null;
  progress: { done: number; total: number } | null;
  excluded: readonly ExcludedSession[];
  onRetry: () => void;
}

const REASON_TEXT: Record<SkipReason | "no-value", string> = {
  "needs-1m": "needs 1m bars",
  coverage: "bars missing",
  "volume-missing": "volume missing",
  warmup: "not enough prior sessions yet",
  "no-level": "no level here",
  "not-known-yet": "not known yet at this time",
  "out-of-session": "outside the session",
  "bad-params": "bad settings",
  "no-value": "no value",
};

export function gapText(row: CardRow): string {
  return row.detail && row.reason !== "no-value" ? row.detail : REASON_TEXT[row.reason ?? "no-value"];
}

function RowView({ row }: { row: CardRow }) {
  const [open, setOpen] = useState(false);
  const gap = row.status === "skipped";
  const classes = ["sl-row", gap ? "sl-row--gap" : "", row.when === "after-mark" ? "sl-row--after" : ""].filter(Boolean).join(" ");
  const note = gap ? gapText(row) : row.note;
  return (
    <li className={classes} data-when={row.when} data-status={row.status}>
      <div className="sl-row-main">
        <span className="sl-row-label">
          {row.when === "after-mark" ? "After the mark · " : ""}
          {row.label}
          {row.proxy ? <span className="sl-chip">Δ proxy</span> : null}
        </span>
        {note ? <span className="sl-row-note">{note}</span> : null}
      </div>
      <span className="sl-row-value">{row.value ?? "—"}</span>
      <button
        type="button"
        className="sl-info-btn"
        aria-label={`About ${row.label}`}
        aria-expanded={open}
        onClick={() => setOpen((next) => !next)}
      >
        <span className="sl-info-icon" aria-hidden="true">i</span>
      </button>
      {open ? (
        <p className="sl-info">
          {row.info}
          {row.proxy ? " Estimated from 1-minute bars. Not real order flow." : ""}
        </p>
      ) : null}
    </li>
  );
}

function GroupView({ group }: { group: CardGroup }) {
  const gaps = group.rows.filter((row) => row.status === "skipped").length;
  return (
    <details className="sl-group" open={group.open}>
      <summary>
        <span>{group.title}</span>
        {gaps > 0 ? <span className="sl-gaps">{gaps} missing</span> : null}
      </summary>
      <ul className="sl-rows">
        {group.rows.map((row) => <RowView key={`${row.key}-${row.when}`} row={row} />)}
      </ul>
    </details>
  );
}

function StatusBox({ tone, children }: { tone: "info" | "error"; children: ReactNode }) {
  return <div className={`sl-status${tone === "error" ? " sl-status--error" : ""}`}>{children}</div>;
}

export function StrategyLabContextCard({ state, card, message, progress, excluded, onRetry }: StrategyLabContextCardProps) {
  if (state === "loading") {
    const detail = progress ? ` ${progress.done} of ${progress.total} sessions` : "";
    return (
      <div className="sl-result" aria-busy="true">
        <StatusBox tone="info">
          <p role="status" aria-live="polite" style={{ margin: 0 }}>Loading bars ·{detail}</p>
        </StatusBox>
        <div className="sl-skeleton" aria-hidden="true" />
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="sl-result">
        <StatusBox tone="error">
          <p role="alert" style={{ margin: 0 }}>{message ?? "Could not load bars, retry"}</p>
          <button type="button" className="sl-btn" onClick={onRetry}>Retry</button>
        </StatusBox>
      </div>
    );
  }

  if (!card) return null;

  return (
    <div className="sl-result">
      {state === "offline" ? (
        <p className="sl-notice" role="status">Offline. Showing cached sessions only; the rest will load when you are back online.</p>
      ) : null}
      {card.missing.map((text) => (
        <p key={text} className="sl-notice" role="status">{text}</p>
      ))}
      <section className="sl-card" aria-label="Context card">
        <header className="sl-card-head">
          <h2 className="sl-card-title">{card.header}</h2>
          <p className="sl-basis">{card.basis}</p>
          <p className="sl-data">{card.dataLine}{state === "partial" ? " · partial" : ""}</p>
        </header>
        {card.groups.map((group) => <GroupView key={group.id} group={group} />)}
        {excluded.length > 0 ? (
          <p className="sl-excluded">
            Not used: {excluded.map((session) => `${session.date} (${session.reason})`).join("; ")}
          </p>
        ) : null}
      </section>
      <div className="sl-actions">
        <button type="button" className="sl-btn sl-btn--block" disabled title="Find similar is not built yet">Find similar</button>
        <button type="button" className="sl-btn sl-btn--block" disabled title="Saving recipes is not built yet">Save as recipe</button>
      </div>
    </div>
  );
}
