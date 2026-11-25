"use client";

import { useState } from "react";
import { formatRiskLine } from "@/lib/risk-line";
import { isValidStatedRiskR } from "@/lib/r-size";
import type { ResolvedRSize } from "@/lib/r-size";
import { updateTrade } from "@/lib/store";
import type { TradeRecord } from "@/lib/trades";

export { formatRiskLine } from "@/lib/risk-line";

const STATED_PRESETS = [0.25, 0.5, 1];

/**
 * Actual dollar risk, risk in account R, where the R size came from, and what the trader said (04 §3.4).
 * Tapping the line, or "Set stated R", opens a one-row editor that writes `stated_risk_r` only; the stop
 * maths is never copied into it.
 */
export function RiskLine({ trade, rSize, accountName, shield }: { trade: TradeRecord; rSize: ResolvedRSize; accountName: string | null; shield: boolean }) {
  const [editing, setEditing] = useState(false);
  const { primary, sourceHint } = formatRiskLine(trade, rSize, accountName, shield);
  return (
    <div className="risk-line" style={{ marginTop: 8 }}>
      <div className="chip-row" style={{ alignItems: "center" }}>
        <button type="button" className="chip" aria-expanded={editing} onClick={() => setEditing((open) => !open)} style={{ minHeight: 44, fontVariantNumeric: "tabular-nums" }}>
          {primary}
        </button>
        {trade.stated_risk_r == null && (
          <button type="button" className="btn-secondary" aria-expanded={editing} onClick={() => setEditing((open) => !open)} style={{ minHeight: 44 }}>
            Set stated R
          </button>
        )}
      </div>
      {sourceHint && <small style={{ display: "block", color: "var(--text-dim)" }}>{sourceHint}</small>}
      {editing && <StatedRiskEditor trade={trade} />}
    </div>
  );
}

function StatedRiskEditor({ trade }: { trade: TradeRecord }) {
  const [custom, setCustom] = useState("");
  const customValue = Number(custom);
  const customValid = custom.trim() !== "" && isValidStatedRiskR(customValue);
  const setStated = (value: number | null) => updateTrade(trade.id, { stated_risk_r: value });

  return (
    <div className="chip-row" role="group" aria-label="Stated risk" style={{ marginTop: 8, alignItems: "center" }}>
      {STATED_PRESETS.map((preset) => (
        <button key={preset} type="button" className="chip" aria-pressed={trade.stated_risk_r === preset} onClick={() => setStated(preset)} style={{ minHeight: 44, fontVariantNumeric: "tabular-nums" }}>
          {preset}R
        </button>
      ))}
      <form className="inline-form" onSubmit={(event) => { event.preventDefault(); if (customValid) setStated(customValue); }}>
        <input inputMode="decimal" placeholder="0.01–10" aria-label="Other stated risk in R" value={custom} onChange={(event) => setCustom(event.target.value)} style={{ minHeight: 44, width: 96 }} />
        <button className="btn-secondary" type="submit" disabled={!customValid} style={{ minHeight: 44 }}>Set</button>
      </form>
      <button type="button" className="btn-secondary" disabled={trade.stated_risk_r == null} onClick={() => setStated(null)} style={{ minHeight: 44 }}>Clear</button>
    </div>
  );
}
