// Partial exits on the trade detail (issue #38): the planned targets, the executed fills and the
// plan-vs-actual comparison. `buildPartialsCardView` is pure so the shield rules are testable without a DOM.
import React from "react";
import { calculatePartials } from "../lib/partials.ts";
import type { PlanVsActualComparison } from "../lib/plan-vs-actual.ts";
import type { ResolvedRSize } from "../lib/r-size.ts";
import { formatPoints, formatPrice } from "../lib/format.ts";
import { formatListTime } from "../lib/time.ts";
import { EXIT_REASONS } from "../lib/trades.ts";
import type { TradeRecord } from "../lib/trades.ts";

/** Account R to two decimals (`+0.29R`). `formatR` keeps one decimal, which would show 0.29 as 0.3. */
function accountR(r: number | null | undefined): string {
  if (r == null || !Number.isFinite(r)) return "—R";
  return `${r < 0 ? "−" : "+"}${Math.abs(r).toFixed(2)}R`;
}

/** A stop-width or reward:risk ratio, `1.0×`, `2.5×`, `1.75×`. Never called R. */
function ratio(value: number): string {
  return `${value.toFixed(2).replace(/0$/, "")}×`;
}

function reasonLabel(reason: string | null | undefined): string {
  if (reason == null) return "—";
  return EXIT_REASONS.find((item) => item.value === reason)?.label ?? reason;
}

export interface PartialsCardTarget {
  key: string;
  price: string;
  /** `null` when shielded: contract quantities never show under Shield. */
  qty: string | null;
  rewardRisk: string;
  accountR: string;
}

export interface PartialsCardExit {
  time: string;
  price: string;
  qty: string | null;
  reason: string;
  points: string;
  accountR: string;
}

export interface PartialsCardView {
  status: "Open" | "Partly open" | "Closed";
  avgEntry: string;
  avgExit: string;
  resultLabel: "Result" | "Realized";
  /** Account R: the closed result, or the realized part while runner lots stay open. */
  result: string;
  /** Stop-width ratio, `1.75× risk`; `null` without a valid stop. */
  riskMultiple: string | null;
  targets: PartialsCardTarget[];
  exits: PartialsCardExit[];
}

/**
 * The view model for the partials card. `null` for a trade without partial exits or targets, so an ordinary
 * single-exit trade renders nothing here. Under `shield`, no contract quantity and no dollar figure is returned.
 */
export function buildPartialsCardView(
  trade: TradeRecord,
  rSize: ResolvedRSize,
  shield: boolean,
  zone: string,
): PartialsCardView | null {
  const exits = trade.partial_exits ?? [];
  const targets = trade.partial_targets ?? [];
  if (!exits.length && !targets.length) return null;

  const summary = calculatePartials({
    symbol: trade.symbol,
    direction: trade.direction,
    entryPrice: trade.entry_price,
    entryTime: trade.entry_time,
    totalQty: trade.quantity,
    initialStopPrice: trade.initial_stop_price ?? trade.stop_loss_price ?? null,
    exits,
    targets,
    rSizeCents: rSize.cents,
  });
  const symbol = trade.symbol;
  const qty = (count: number) => (shield ? null : `${count}×`);

  return {
    status: summary.isClosed ? "Closed" : summary.totalExitQty > 0 ? "Partly open" : "Open",
    avgEntry: formatPrice(summary.avgEntryPrice, symbol),
    avgExit: formatPrice(summary.avgExitPrice, symbol),
    resultLabel: summary.isClosed ? "Result" : "Realized",
    result: accountR(summary.isClosed ? summary.resultR : summary.realizedAccountR),
    riskMultiple: summary.riskMultiple == null ? null : `${ratio(summary.riskMultiple)} risk`,
    targets: summary.targets.map((target) => ({
      key: target.key.toUpperCase(),
      price: formatPrice(target.price, symbol),
      qty: qty(target.qty),
      rewardRisk: target.plannedRewardRisk == null ? "—" : ratio(target.plannedRewardRisk),
      accountR: accountR(target.plannedAccountR),
    })),
    exits: summary.bands.flatMap((band) => (band.isOpen || band.exitTime == null ? [] : [{
      time: formatListTime(band.exitTime, zone),
      price: formatPrice(band.exitPrice, symbol),
      qty: qty(band.qty),
      reason: reasonLabel(band.exitReason),
      points: formatPoints(band.points, symbol),
      accountR: accountR(band.accountR),
    }])),
  };
}

const CARD_STYLE: React.CSSProperties = { marginTop: 14, padding: "12px 14px", background: "rgba(255,255,255,0.03)", borderRadius: 8, border: "1px solid rgba(255,255,255,0.08)" };
const CELL_STYLE: React.CSSProperties = { padding: "6px 4px 6px 0", fontVariantNumeric: "tabular-nums", overflowWrap: "anywhere" };
const HEAD_STYLE: React.CSSProperties = { padding: "4px 4px 4px 0", fontWeight: 500, color: "var(--text-dim)", textAlign: "left" };
const TABLE_STYLE: React.CSSProperties = { width: "100%", fontSize: 12, borderCollapse: "collapse", tableLayout: "fixed", fontVariantNumeric: "tabular-nums" };

export function PartialsCard({ trade, rSize, shield, zone }: { trade: TradeRecord; rSize: ResolvedRSize; shield: boolean; zone: string }) {
  const view = buildPartialsCardView(trade, rSize, shield, zone);
  if (!view) return null;
  return (
    <section className="partials-card" aria-label="Partial exits" style={CARD_STYLE}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
        <span className="eyebrow" style={{ fontSize: 10, letterSpacing: "0.08em", color: "var(--gold-mid, #d4af37)" }}>PARTIALS · {view.status}</span>
        <span style={{ fontSize: 12, fontVariantNumeric: "tabular-nums" }}>{view.resultLabel} {view.result}{view.riskMultiple ? ` · ${view.riskMultiple}` : ""}</span>
      </div>

      {view.targets.length > 0 && (
        <table style={TABLE_STYLE} aria-label="Planned targets">
          <thead>
            <tr>
              <th style={HEAD_STYLE}>Target</th>
              <th style={HEAD_STYLE}>Price</th>
              {!shield && <th style={HEAD_STYLE}>Qty</th>}
              <th style={HEAD_STYLE}>R:R</th>
              <th style={{ ...HEAD_STYLE, textAlign: "right" }}>Planned</th>
            </tr>
          </thead>
          <tbody>
            {view.targets.map((target) => (
              <tr key={target.key} style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
                <td style={CELL_STYLE}>{target.key}</td>
                <td style={CELL_STYLE}>{target.price}</td>
                {!shield && <td style={CELL_STYLE}>{target.qty}</td>}
                <td style={CELL_STYLE}>{target.rewardRisk}</td>
                <td style={{ ...CELL_STYLE, textAlign: "right" }}>{target.accountR}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {view.exits.length > 0 && (
        <table style={{ ...TABLE_STYLE, marginTop: 10 }}>
          <caption style={{ captionSide: "top", textAlign: "left", paddingBottom: 6, fontSize: 11, color: "var(--text-dim)", fontVariantNumeric: "tabular-nums" }}>
            Avg entry {view.avgEntry} · Avg exit {view.avgExit}
          </caption>
          <thead>
            <tr>
              <th style={HEAD_STYLE}>Time</th>
              <th style={HEAD_STYLE}>Price</th>
              {!shield && <th style={HEAD_STYLE}>Qty</th>}
              <th style={HEAD_STYLE}>Reason</th>
              <th style={HEAD_STYLE}>Points</th>
              <th style={{ ...HEAD_STYLE, textAlign: "right" }}>R</th>
            </tr>
          </thead>
          <tbody>
            {view.exits.map((exit, index) => (
              <tr key={`${exit.time}-${index}`} style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
                <td style={CELL_STYLE}>{exit.time}</td>
                <td style={CELL_STYLE}>{exit.price}</td>
                {!shield && <td style={CELL_STYLE}>{exit.qty}</td>}
                <td style={CELL_STYLE}>{exit.reason}</td>
                <td style={CELL_STYLE}>{exit.points}</td>
                <td style={{ ...CELL_STYLE, textAlign: "right" }}>{exit.accountR}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/** Plan vs actual (M2, #42): the comparison table, moved out of TradeDetail. Renders nothing without a plan. */
export function PlanVsActualSection({ comparison }: { comparison: PlanVsActualComparison }) {
  if (!comparison.hasPlan || comparison.rows.length === 0) return null;
  const fidelityColor = comparison.fidelity === "Executed to Plan" ? "var(--profit-text)" : comparison.fidelity === "Widened Stop" ? "var(--loss-text)" : "var(--text-dim)";
  return (
    <div className="plan-vs-actual-card" style={CARD_STYLE}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span className="eyebrow" style={{ fontSize: 10, letterSpacing: "0.08em", color: "var(--gold-mid, #d4af37)" }}>PLAN VS ACTUAL</span>
        <span style={{ fontSize: 11, fontWeight: 600, color: fidelityColor }}>{comparison.fidelity}</span>
      </div>
      <table style={{ ...TABLE_STYLE, fontSize: 12, tableLayout: "auto", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ color: "var(--text-dim)", textAlign: "left", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
            <th style={{ padding: "4px 0", fontWeight: 500 }}>Item</th>
            <th style={{ padding: "4px 0", fontWeight: 500 }}>Plan</th>
            <th style={{ padding: "4px 0", fontWeight: 500 }}>Actual</th>
            <th style={{ padding: "4px 0", fontWeight: 500, textAlign: "right" }}>Delta</th>
          </tr>
        </thead>
        <tbody>
          {comparison.rows.map((row) => (
            <tr key={row.label} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
              <td style={{ padding: "6px 0", color: "var(--text-dim)" }}>{row.label}</td>
              <td style={{ padding: "6px 0" }}>{row.planned}</td>
              <td style={{ padding: "6px 0" }}>{row.actual}</td>
              <td style={{ padding: "6px 0", textAlign: "right", color: row.tone === "positive" ? "var(--profit-text)" : row.tone === "negative" ? "var(--loss-text)" : "inherit" }}>
                {row.deltaDisplay}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ margin: "8px 0 0", fontSize: 11, color: "var(--text-dim)" }}>{comparison.fidelityNote}</p>
    </div>
  );
}
