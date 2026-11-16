"use client";

import { FormEvent, useState } from "react";
import { formatPrice } from "@/lib/format";
import { updateTrade } from "@/lib/store";
import { showToast } from "@/lib/toast";
import { specFor, validateTradeInput } from "@/lib/trades";
import type { TradeRecord } from "@/lib/trades";

type LevelField = "stop_loss_price" | "planned_target_price" | "key_level_price";

const LABELS: Record<LevelField, string> = {
  stop_loss_price: "STOP",
  planned_target_price: "TARGET",
  key_level_price: "KEY",
};

function levelPatch(field: LevelField, value: number | null): Partial<TradeRecord> {
  if (field === "stop_loss_price") return { stop_loss_price: value };
  if (field === "planned_target_price") return { planned_target_price: value };
  return { key_level_price: value };
}

export function TradeLevelEditor({ trade, field }: { trade: TradeRecord; field: LevelField }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const label = LABELS[field];
  const value = trade[field];
  const spec = specFor(trade.symbol);

  const close = () => {
    setEditing(false);
    setDraft("");
    setError(null);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const price = draft.trim() === "" ? Number.NaN : Number(draft);
    const errors = validateTradeInput({
      symbol: trade.symbol,
      direction: trade.direction,
      quantity: trade.quantity,
      entry_price: trade.entry_price,
      exit_price: trade.exit_price,
      stop_loss_price: field === "stop_loss_price" ? price : trade.stop_loss_price,
      planned_target_price: field === "planned_target_price" ? price : trade.planned_target_price,
      key_level_price: field === "key_level_price" ? price : trade.key_level_price,
    });
    const nextError = errors[field];
    if (nextError) {
      setError(nextError);
      return;
    }
    updateTrade(trade.id, levelPatch(field, price));
    showToast(`${label[0]}${label.slice(1).toLowerCase()} set at ${formatPrice(price, trade.symbol)}`, {
      label: "Undo",
      run: () => updateTrade(trade.id, levelPatch(field, null)),
    });
    close();
  };

  if (value != null) {
    return <div><small>{label}</small><b>{formatPrice(value, trade.symbol)}</b></div>;
  }

  if (!editing) {
    return (
      <div className="level-editor">
        <small>{label}</small>
        <button type="button" className="level-add" onClick={() => setEditing(true)} aria-label={`Add ${label.toLowerCase()}`}>Add</button>
      </div>
    );
  }

  return (
    <div className="level-editor editing">
      <small>{label}</small>
      <form onSubmit={submit} noValidate>
        <input
          autoFocus
          inputMode="decimal"
          type="number"
          step={spec?.tickSize}
          value={draft}
          aria-label={`${label.toLowerCase()} price`}
          aria-invalid={error != null}
          aria-describedby={error ? `${trade.id}-${field}-error` : undefined}
          onChange={(event) => { setDraft(event.target.value); setError(null); }}
        />
        <div className="level-editor-actions">
          <button type="submit">Set</button>
          <button type="button" onClick={close} aria-label={`Cancel adding ${label.toLowerCase()}`}>×</button>
        </div>
        {error && <span className="error" id={`${trade.id}-${field}-error`} role="alert">{error}</span>}
      </form>
    </div>
  );
}
