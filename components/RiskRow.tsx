"use client";

// The optional stated-risk row on the add-trade form (docs/design-2026-11-24/04 §4). It records what the trader
// said the trade risked, as a share of the account R size. It never copies stop maths into the stated value.
import { useState } from "react";
import { formatPrice } from "@/lib/format";
import { isValidStatedRiskR, riskCents } from "@/lib/r-size";
import { formatDollars } from "@/lib/risk-line";
import { statedRiskRFrom, statedRiskError, suggestedStopFromRiskR } from "@/lib/entry-form";
import type { TradeDirection } from "@/lib/trades";

const PRESETS = ["0.25", "0.5", "1"];

export interface RiskRowProps {
  /** Draft text: "" when unstated. */
  statedRiskR: string;
  /** Draft stop text. The "Use stop" offer only appears while this is empty, so a typed stop is never overwritten. */
  stopPrice: string;
  entryPrice: number | null;
  direction: TradeDirection;
  symbol: string;
  quantity: number;
  /** The resolved R size in cents (04 §3.2). */
  rSizeCents: number;
  shield: boolean;
  onStated: (text: string) => void;
  onUseStop: (price: number) => void;
}

/** Plain R text without trailing zeros: 0.25 → "0.25", 1 → "1". */
const rText = (value: number) => String(Number(value.toFixed(2)));

export function RiskRow(props: RiskRowProps) {
  const { statedRiskR, stopPrice, entryPrice, direction, symbol, quantity, rSizeCents, shield, onStated, onUseStop } = props;
  const [otherOpen, setOtherOpen] = useState(false);
  const isOther = otherOpen || (statedRiskR !== "" && !PRESETS.includes(statedRiskR));
  const stated = statedRiskRFrom(statedRiskR);
  const statedValid = stated != null && isValidStatedRiskR(stated);
  const error = statedRiskError(statedRiskR);

  // Offer the stop that risks the chosen R, only while the stop is empty (never silently overwrite a typed stop).
  const offered = statedValid && stopPrice.trim() === "" && entryPrice != null
    ? suggestedStopFromRiskR(entryPrice, direction, symbol, quantity, rSizeCents, stated)
    : null;

  // Live comparison once a stop is typed: actual dollars, then the ratio, then what the trader said.
  const typedStop = Number(stopPrice);
  const actualCents = stopPrice.trim() !== "" && entryPrice != null && Number.isFinite(typedStop)
    ? riskCents({ symbol, direction, entry_price: entryPrice, quantity, stop_loss_price: typedStop })
    : null;
  const actualR = actualCents != null && rSizeCents > 0 ? actualCents / rSizeCents : null;
  const saidText = statedValid ? ` · you said ${rText(stated)}R` : "";
  const comparison = actualCents != null && actualR != null
    ? shield
      ? `Stop ${formatPrice(typedStop, symbol)} → ${actualR.toFixed(2)}R${saidText}`
      : `Stop ${formatPrice(typedStop, symbol)} → ${formatDollars(actualCents)} (${actualR.toFixed(2)}R)${saidText}`
    : null;

  const pick = (preset: string) => onStated(statedRiskR === preset ? "" : preset);
  const chipStyle = { minHeight: 44, fontVariantNumeric: "tabular-nums" as const };

  return (
    <div className="risk-row field wide" style={{ marginTop: 12 }}>
      <span>Risk <i>optional</i></span>
      <div className="chip-row" role="group" aria-label="Stated risk">
        {PRESETS.map((preset) => (
          <button key={preset} type="button" className="chip" aria-pressed={statedRiskR === preset} aria-label={`Stated risk ${preset}R`} onClick={() => pick(preset)} style={chipStyle}>
            {preset}R
          </button>
        ))}
        <button type="button" className="chip" aria-pressed={isOther} onClick={() => { if (isOther) { setOtherOpen(false); onStated(""); } else setOtherOpen(true); }} style={chipStyle}>
          Other
        </button>
      </div>
      {isOther && (
        <input inputMode="decimal" placeholder="0.01–10 R" aria-label="Other stated risk in R" aria-invalid={!!error} value={statedRiskR} onChange={(event) => onStated(event.target.value)} style={{ minHeight: 44, width: 120 }} />
      )}
      {error && <span className="error">{error}</span>}
      {offered != null && (
        <button type="button" className="now-button" onClick={() => onUseStop(offered)} style={{ minHeight: 44, fontVariantNumeric: "tabular-nums" }}>
          Use stop {formatPrice(offered, symbol)}{shield ? "" : ` (${formatDollars(Math.round(rSizeCents * (stated ?? 0)))})`}
        </button>
      )}
      {comparison != null && <span className="hint" style={{ fontVariantNumeric: "tabular-nums" }}>{comparison}</span>}
    </div>
  );
}
