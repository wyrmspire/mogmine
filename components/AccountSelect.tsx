"use client";

import { useId, useState } from "react";
import { AccountSheet } from "./AccountSheet";
import { isReplayAccount } from "@/lib/accounts";
import { useAccounts } from "@/lib/accounts-store";

/**
 * Which account a trade was taken in (docs/21). Always offers "+ New account" inline so a trader
 * can create a Live, Eval, or Pretend/Replay account directly from entry or detail without losing their form.
 */
export function AccountSelect({ value, onChange, className = "field" }: { value: string | null; onChange: (id: string | null) => void; className?: string }) {
  const store = useAccounts();
  const selectId = useId();
  const [creating, setCreating] = useState(false);
  if (!store.hydrated) return null;
  const options = store.accounts.filter((account) => !account.archived || account.id === value);

  return (
    <div className={className}>
      <label htmlFor={selectId}><span>Account</span></label>
      <div style={{ display: "flex", gap: 8, alignItems: "stretch", flexWrap: "wrap" }}>
        <select
          id={selectId}
          value={value ?? ""}
          style={{ flex: "1 1 160px", minWidth: 0 }}
          onChange={(event) => onChange(event.target.value || null)}
        >
          <option value="">No account</option>
          {options.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
              {isReplayAccount(account) ? " (Replay)" : ""}
              {account.archived ? " (archived)" : ""}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn-secondary"
          style={{ flex: "0 0 auto", minHeight: 44, padding: "0 12px", fontSize: "0.75rem", whiteSpace: "nowrap" }}
          onClick={() => setCreating(true)}
        >
          + New account
        </button>
      </div>
      {creating && (
        <AccountSheet
          onCreated={(acc) => {
            onChange(acc.id);
            setCreating(false);
          }}
          onClose={() => setCreating(false)}
        />
      )}
    </div>
  );
}
