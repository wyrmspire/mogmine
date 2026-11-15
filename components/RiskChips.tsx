"use client";

import { useState } from "react";
import { formatPrice } from "@/lib/format";
import { usePrefs } from "@/lib/prefs";
import { updateTrade } from "@/lib/store";
import { showToast } from "@/lib/toast";
import { snapToTick, specFor } from "@/lib/trades";
import type { TradeRecord } from "@/lib/trades";

/**
 * Risk in one tap when no stop was recorded (UX-36). The chips come from the trader's risk budget
 * and this trade's size (docs/12 LV-17), not from fixed point distances.
 */
export function RiskChips({ trade, budgetUsd, shield }: { trade: TradeRecord; budgetUsd: number; shield?: boolean }) {
  const prefs = usePrefs();
  const hideMoney = shield ?? prefs.shield;
  const [custom, setCustom] = useState("");
  const spec = specFor(trade.symbol);
  const sign = trade.direction === "LONG" ? 1 : -1;
  const options = [0.5, 1, 2].map((multiple) => {
    const usd = budgetUsd * multiple;
    const points = usd / (trade.quantity * spec.pointValueUsd);
    return { usd, points, price: snapToTick(trade.entry_price - sign * points, trade.symbol) };
  }).filter((option) => option.price > 0 && option.price !== trade.entry_price);

  const setStop = (price: number) => {
    updateTrade(trade.id, { stop_loss_price: price });
    showToast(`Stop set at ${formatPrice(price, trade.symbol)}`, { label: "Undo", run: () => updateTrade(trade.id, { stop_loss_price: null }) });
  };
  const customPrice = Number(custom);
  const customValid = custom !== "" && customPrice > 0 && (customPrice - trade.entry_price) * sign < 0;

  return (
    <div className="risk-chips">
      <p><b>No stop recorded.</b> Add the risk you took to unlock R.</p>
      <div className="chip-row">
        {options.map((option) => (
          <button key={option.usd} className="chip" onClick={() => setStop(option.price)}>
            <span className="num">{option.points.toFixed(2)} pts</span>{!hideMoney && <small className="shield-hide">${option.usd}</small>}
          </button>
        ))}
      </div>
      <form className="inline-form" onSubmit={(event) => { event.preventDefault(); if (customValid) setStop(snapToTick(customPrice, trade.symbol)); }}>
        <input inputMode="decimal" type="number" step={spec.tickSize} placeholder="Stop price" value={custom} onChange={(event) => setCustom(event.target.value)} aria-label="Stop price" />
        <button className="btn-secondary" type="submit" disabled={!customValid}>Set stop</button>
      </form>
    </div>
  );
}
