"use client";

import { useAccounts } from "@/lib/accounts-store";

/**
 * Which account a trade was taken in (docs/20). Renders nothing until an account exists, so the entry
 * form stays as short as before for a trader who does not track accounts.
 */
export function AccountSelect({ value, onChange, className = "field" }: { value: string | null; onChange: (id: string | null) => void; className?: string }) {
  const store = useAccounts();
  const options = store.accounts.filter((account) => !account.archived || account.id === value);
  if (!store.hydrated || options.length === 0) return null;
  return (
    <label className={className}><span>Account</span>
      <select value={value ?? ""} onChange={(event) => onChange(event.target.value || null)}>
        <option value="">No account</option>
        {options.map((account) => <option key={account.id} value={account.id}>{account.name}{account.archived ? " (archived)" : ""}</option>)}
      </select>
    </label>
  );
}
