"use client";

import { useState } from "react";
import { AccountSheet } from "./AccountSheet";
import { accountMode, isReplayAccount } from "@/lib/accounts";
import type { AccountMode, TradingAccount } from "@/lib/accounts";
import { useAccounts } from "@/lib/accounts-store";
import { formatUsdAmount } from "@/lib/format";
import { usePrefs } from "@/lib/prefs";
import { DEFAULT_R_SIZE_CENTS } from "@/lib/r-size";

const MODE_LABEL: Record<AccountMode, string> = {
  replay: "REPLAY",
  live: "LIVE",
  eval: "EVAL",
  sim: "SIM",
};

const formatR = (cents: number) => formatUsdAmount(cents / 100).replace(/\.00$/, "");

/** Compact accounts manager for Tune → Tools (lists active accounts + 1-tap Add / Pretend Replay). */
export function AccountsSection({ shield }: { shield: boolean }) {
  const store = useAccounts();
  const prefs = usePrefs();
  const [addingMode, setAddingMode] = useState<AccountMode | null>(null);
  const [editing, setEditing] = useState<TradingAccount | null>(null);

  const active = store.accounts.filter((account) => !account.archived);
  const defaultRCents = Number.isFinite(prefs.riskBudgetUsd) && prefs.riskBudgetUsd >= 10
    ? Math.round(prefs.riskBudgetUsd * 100)
    : DEFAULT_R_SIZE_CENTS;

  const rStatus = (account: TradingAccount) => {
    if (shield) return "1R hidden (Shield)";
    if (account.r_size_cents != null) return `1R ${formatR(account.r_size_cents)}`;
    return `Default 1R (${formatR(defaultRCents)})`;
  };

  return (
    <section className="specular-card card-pad" aria-label="Accounts manager" aria-busy={!store.hydrated}>
      <p className="muted" style={{ fontSize: "0.8125rem", margin: 0 }}>
        Eval, funded, sim, or Pretend / Replay chart accounts. Replay accounts stay out of live totals and drawdown limits.
      </p>

      {store.hydrated && active.length === 0 && (
        <p className="muted" style={{ fontSize: "0.8125rem", marginTop: 10 }}>
          No accounts yet. Create one for your eval/live account or launch a Pretend / Replay session.
        </p>
      )}

      {store.hydrated && active.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0, margin: "12px 0 0", display: "grid", gap: 6 }}>
          {active.map((account) => {
            const mode = accountMode(account);
            const replay = isReplayAccount(account);
            const chipStyle = replay
              ? {
                  color: "var(--box-planned)",
                  borderColor: "color-mix(in srgb, var(--box-planned) 48%, transparent)",
                  background: "color-mix(in srgb, var(--box-planned) 14%, var(--bg-elevated))",
                }
              : mode === "live"
                ? {
                    color: "var(--profit-text)",
                    borderColor: "color-mix(in srgb, var(--profit-emerald) 40%, transparent)",
                    background: "color-mix(in srgb, var(--profit-emerald) 12%, var(--bg-elevated))",
                  }
                : undefined;
            return (
              <li
                key={account.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                  minHeight: 52,
                  padding: "8px 10px",
                  borderRadius: 11,
                  border: "1px solid var(--border-subtle)",
                  background: "var(--bg-inset)",
                }}
              >
                <div style={{ minWidth: 0, display: "grid", gap: 2 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                    <b style={{ fontSize: "0.875rem", overflowWrap: "anywhere" }}>{account.name}</b>
                    <span className="tag-chip" style={chipStyle}>{MODE_LABEL[mode]}</span>
                  </div>
                  <small className="num muted" style={{ fontSize: "0.75rem" }}>{rStatus(account)}</small>
                </div>
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ flex: "none", minHeight: 44, padding: "0 14px", fontSize: "0.8125rem" }}
                  onClick={() => setEditing(account)}
                >
                  Edit
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
        <button type="button" className="btn-primary" style={{ minHeight: 44 }} disabled={!store.hydrated} onClick={() => setAddingMode("eval")}>
          + Add account
        </button>
        <button type="button" className="btn-secondary" style={{ minHeight: 44 }} disabled={!store.hydrated} onClick={() => setAddingMode("replay")}>
          + Pretend / Replay
        </button>
      </div>

      {addingMode && <AccountSheet defaultMode={addingMode} onClose={() => setAddingMode(null)} />}
      {editing && <AccountSheet account={editing} onClose={() => setEditing(null)} />}
    </section>
  );
}
