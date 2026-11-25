"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { dollarsToCents } from "@/lib/accounts";
import type { DrawdownMode, TradingAccount } from "@/lib/accounts";
import { addAccount, updateAccount } from "@/lib/accounts-store";
import { showToast } from "@/lib/toast";

const MODES: Array<{ value: DrawdownMode; label: string }> = [
  { value: "trailing_eod", label: "Trails the high at each day's close" },
  { value: "trailing", label: "Trails the high after every trade" },
  { value: "static", label: "Fixed below the starting balance" },
];

const centsText = (cents: number | null) => (cents == null ? "" : (cents / 100).toFixed(2).replace(/\.00$/, ""));
/** 1R in this account is $1 to $100,000 (04 §3.3). Empty means the Default R size applies. */
const R_SIZE_MIN_CENTS = 100;
const R_SIZE_MAX_CENTS = 10_000_000;

/**
 * Add or edit an account (docs/21). Name and starting balance are required; rules are optional and only
 * describe the account. They never block or change a trade.
 */
export function AccountSheet({ account, onClose }: { account?: TradingAccount; onClose: () => void }) {
  const [name, setName] = useState(account?.name ?? "");
  const [start, setStart] = useState(account ? centsText(account.starting_balance_cents) : "");
  const [maxLoss, setMaxLoss] = useState(centsText(account?.rules.max_loss_cents ?? null));
  const [mode, setMode] = useState<DrawdownMode>(account?.rules.drawdown ?? "trailing_eod");
  const [daily, setDaily] = useState(centsText(account?.rules.daily_loss_cents ?? null));
  const [target, setTarget] = useState(centsText(account?.rules.profit_target_cents ?? null));
  const [rSizeText, setRSizeText] = useState(centsText(account?.r_size_cents ?? null));
  const [submitted, setSubmitted] = useState(false);
  const firstField = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    firstField.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); previousFocus?.focus(); };
  }, [onClose]);

  const startCents = dollarsToCents(start);
  /** Empty is "no rule"; anything typed must be a positive amount. */
  const optional = (text: string) => (text.trim() === "" ? { cents: null, error: undefined } : (() => {
    const cents = dollarsToCents(text);
    return cents == null || cents <= 0 ? { cents: null, error: "Enter an amount above $0, or leave it empty" } : { cents, error: undefined };
  })());
  const loss = optional(maxLoss);
  const dailyLoss = optional(daily);
  const profit = optional(target);
  const rSizeCents = rSizeText.trim() === "" ? null : dollarsToCents(rSizeText);
  const rSizeError = rSizeText.trim() === "" || (rSizeCents != null && rSizeCents >= R_SIZE_MIN_CENTS && rSizeCents <= R_SIZE_MAX_CENTS)
    ? undefined
    : "Enter an amount from $1 to $100,000, or leave it empty to use the Default R size";
  const errors = {
    rSize: rSizeError,
    name: name.trim() ? undefined : "Give the account a name",
    start: startCents == null ? "Enter the starting balance" : startCents < 0 ? "The starting balance cannot be below $0" : undefined,
    maxLoss: loss.error,
    daily: dailyLoss.error,
    target: profit.error,
  };
  const hasErrors = Object.values(errors).some(Boolean);
  const show = (key: keyof typeof errors) => (submitted ? errors[key] : undefined);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (hasErrors || startCents == null) return;
    const rules = { max_loss_cents: loss.cents, drawdown: mode, daily_loss_cents: dailyLoss.cents, profit_target_cents: profit.cents };
    if (account) {
      updateAccount(account.id, { name: name.trim(), starting_balance_cents: startCents, r_size_cents: rSizeCents, rules });
      showToast("Account updated. The total is recalculated from your trades.");
    } else {
      addAccount({ name: name.trim(), starting_balance_cents: startCents, r_size_cents: rSizeCents, rules });
      showToast("Account added. Pick it when you log a trade.");
    }
    onClose();
  };

  const archive = () => {
    if (!account) return;
    updateAccount(account.id, { archived: true });
    showToast(`${account.name} archived`, { label: "Undo", run: () => updateAccount(account.id, { archived: false }) });
    onClose();
  };

  return (
    <div className="sheet-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="sheet" role="dialog" aria-modal="true" aria-labelledby="account-sheet-title">
        <div className="sheet-head">
          <div>
            <span className="eyebrow">Account</span>
            <h2 id="account-sheet-title">{account ? "Edit account" : "Add an account"}</h2>
            <p>Totals come from the trades you log here. They are not your broker&apos;s balance.</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">×</button>
        </div>
        <form onSubmit={submit} noValidate>
          <div className="form-grid">
            <label className="field wide"><span>Name</span>
              <input ref={firstField} value={name} placeholder="Topstep 50K Combine" aria-invalid={!!show("name")} onChange={(event) => setName(event.target.value)} />
              {show("name") && <span className="error">{show("name")}</span>}
            </label>
            <label className="field"><span>Starting balance ($)</span>
              <input inputMode="decimal" value={start} placeholder="50000" aria-invalid={!!show("start")} onChange={(event) => setStart(event.target.value)} />
              {show("start") && <span className="error">{show("start")}</span>}
            </label>
            <label className="field"><span>Profit target ($) <i>optional</i></span>
              <input inputMode="decimal" value={target} placeholder="3000" aria-invalid={!!show("target")} onChange={(event) => setTarget(event.target.value)} />
              {show("target") && <span className="error">{show("target")}</span>}
            </label>
            <label className="field"><span>Loss limit ($) <i>optional</i></span>
              <input inputMode="decimal" value={maxLoss} placeholder="2000" aria-invalid={!!show("maxLoss")} onChange={(event) => setMaxLoss(event.target.value)} />
              {show("maxLoss") && <span className="error">{show("maxLoss")}</span>}
            </label>
            <label className="field"><span>Daily loss limit ($) <i>optional</i></span>
              <input inputMode="decimal" value={daily} placeholder="1000" aria-invalid={!!show("daily")} onChange={(event) => setDaily(event.target.value)} />
              {show("daily") && <span className="error">{show("daily")}</span>}
            </label>
            <label className="field"><span>R size ($) <i>optional</i></span>
              <input inputMode="decimal" value={rSizeText} placeholder="300" aria-invalid={!!show("rSize")} aria-describedby="r-size-hint" onChange={(event) => setRSizeText(event.target.value)} />
              <span id="r-size-hint" style={{ fontSize: 12, color: "var(--text-dim)" }}>1R in this account. Empty uses the Default R size in Tune.</span>
              {show("rSize") && <span className="error">{show("rSize")}</span>}
            </label>
            {maxLoss.trim() !== "" && (
              <label className="field wide"><span>How the loss limit moves</span>
                <select value={mode} onChange={(event) => setMode(event.target.value as DrawdownMode)}>
                  {MODES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
              </label>
            )}
          </div>
          <button className="btn-primary btn-block" type="submit" style={{ marginTop: 14 }}>{account ? "Save account" : "Add account"}</button>
          {account && <button type="button" className="btn-danger-ghost btn-block" style={{ marginTop: 8 }} onClick={archive}>Archive this account</button>}
        </form>
      </section>
    </div>
  );
}
