"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { accountMode, dollarsToCents } from "@/lib/accounts";
import type { AccountMode, DrawdownMode, TradingAccount } from "@/lib/accounts";
import { addAccount, updateAccount } from "@/lib/accounts-store";
import { usePrefs } from "@/lib/prefs";
import { DEFAULT_R_SIZE_CENTS } from "@/lib/r-size";
import { showToast } from "@/lib/toast";

const ACCOUNT_TYPES: Array<{ value: AccountMode; label: string }> = [
  { value: "eval", label: "Eval" },
  { value: "live", label: "Live / Funded" },
  { value: "sim", label: "Sim" },
  { value: "replay", label: "Pretend / Replay" },
];

const DRAWDOWN_MODES: Array<{ value: DrawdownMode; label: string }> = [
  { value: "trailing_eod", label: "Trails the high at each day's close" },
  { value: "trailing", label: "Trails the high after every trade" },
  { value: "static", label: "Fixed below the starting balance" },
];

const R_SIZE_PRESETS = [150, 300, 500, 1000] as const;

const centsText = (cents: number | null) => (cents == null ? "" : (cents / 100).toFixed(2).replace(/\.00$/, ""));
/** 1R in this account is $1 to $100,000 (04 §3.3). Empty means the Default R size applies. */
const R_SIZE_MIN_CENTS = 100;
const R_SIZE_MAX_CENTS = 10_000_000;

const NAME_PLACEHOLDER: Record<AccountMode, string> = {
  eval: "Topstep 50K Combine",
  live: "Topstep 50K Funded",
  sim: "Sim Practice",
  replay: "Pretend Replay",
};

/**
 * Add or edit an account (docs/21). Name and starting balance are required for real/eval/sim accounts;
 * Pretend / Replay defaults to "Pretend Replay", $0 start, and $300 R for 2-tap setup.
 */
export function AccountSheet({
  account,
  defaultMode,
  onCreated,
  onClose,
}: {
  account?: TradingAccount;
  defaultMode?: AccountMode;
  onCreated?: (account: TradingAccount) => void;
  onClose: () => void;
}) {
  const { shield } = usePrefs();
  const [acctMode, setAcctMode] = useState<AccountMode>(() => (account ? accountMode(account) : (defaultMode ?? "eval")));
  const [name, setName] = useState(account?.name ?? "");
  const [start, setStart] = useState(account ? centsText(account.starting_balance_cents) : "");
  const [maxLoss, setMaxLoss] = useState(centsText(account?.rules.max_loss_cents ?? null));
  const [drawdown, setDrawdown] = useState<DrawdownMode>(account?.rules.drawdown ?? "trailing_eod");
  const [daily, setDaily] = useState(centsText(account?.rules.daily_loss_cents ?? null));
  const [target, setTarget] = useState(centsText(account?.rules.profit_target_cents ?? null));
  const [rSizeText, setRSizeText] = useState(() =>
    account ? centsText(account.r_size_cents) : defaultMode === "replay" ? String(DEFAULT_R_SIZE_CENTS / 100) : "",
  );
  const [submitted, setSubmitted] = useState(false);
  const firstField = useRef<HTMLInputElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    firstField.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onCloseRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      previousFocus?.focus();
    };
  }, []);

  const isReplay = acctMode === "replay";
  const isNewReplay = !account && isReplay;

  const pickAccountType = (next: AccountMode) => {
    setAcctMode(next);
    if (!account && next === "replay") {
      if (rSizeText.trim() === "") setRSizeText(String(DEFAULT_R_SIZE_CENTS / 100));
      setMaxLoss("");
      setDaily("");
      setTarget("");
    }
  };

  const rawStartCents = dollarsToCents(start);
  const startCents = isNewReplay && start.trim() === "" ? 0 : rawStartCents;
  const finalName = isNewReplay && name.trim() === "" ? "Pretend Replay" : name.trim();

  /** Empty is "no rule"; anything typed must be a positive amount. */
  const optional = (text: string) => (text.trim() === "" ? { cents: null, error: undefined } : (() => {
    const cents = dollarsToCents(text);
    return cents == null || cents <= 0 ? { cents: null, error: "Enter an amount above $0, or leave it empty" } : { cents, error: undefined };
  })());
  const loss = optional(maxLoss);
  const dailyLoss = optional(daily);
  const profit = optional(target);
  const rSizeCents = rSizeText.trim() === "" ? null : dollarsToCents(rSizeText);
  const rSizeError = shield || rSizeText.trim() === "" || (rSizeCents != null && rSizeCents >= R_SIZE_MIN_CENTS && rSizeCents <= R_SIZE_MAX_CENTS)
    ? undefined
    : "Enter an amount from $1 to $100,000, or leave it empty to use the Default R size";
  const errors = {
    rSize: rSizeError,
    name: finalName ? undefined : "Give the account a name",
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
    const nextRSizeCents = shield ? (account ? account.r_size_cents : (isReplay ? DEFAULT_R_SIZE_CENTS : null)) : rSizeCents;
    const rules = { max_loss_cents: loss.cents, drawdown, daily_loss_cents: dailyLoss.cents, profit_target_cents: profit.cents };
    if (account) {
      updateAccount(account.id, { name: finalName, starting_balance_cents: startCents, r_size_cents: nextRSizeCents, rules, mode: acctMode });
      showToast("Account updated. The total is recalculated from your trades.");
    } else {
      const created = addAccount({ name: finalName, starting_balance_cents: startCents, r_size_cents: nextRSizeCents, rules, mode: acctMode });
      onCreated?.(created);
      showToast(isReplay ? "Pretend / Replay account ready." : "Account added. Pick it when you log a trade.");
    }
    onClose();
  };

  const archive = () => {
    if (!account) return;
    updateAccount(account.id, { archived: true });
    showToast(`${account.name} archived`, { label: "Undo", run: () => updateAccount(account.id, { archived: false }) });
    onClose();
  };

  const sheet = (
    <div className="sheet-backdrop" style={{ zIndex: 70 }} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="sheet" role="dialog" aria-modal="true" aria-labelledby="account-sheet-title">
        <div className="sheet-head">
          <div>
            <span className="eyebrow">Account</span>
            <h2 id="account-sheet-title">{account ? "Edit account" : "Add an account"}</h2>
            <p>
              {isReplay
                ? "Pretend sessions with full charts and notes — separate from your live journal totals."
                : "Totals come from the trades you log here. They are not your broker&apos;s balance."}
            </p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">×</button>
        </div>
        <form onSubmit={submit} noValidate>
          <div className="form-grid">
            <div className="field wide">
              <span>Account type</span>
              <div className="chip-row" role="group" aria-label="Account type">
                {ACCOUNT_TYPES.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    className="chip"
                    aria-pressed={acctMode === item.value}
                    onClick={() => pickAccountType(item.value)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              {isReplay && (
                <span className="hint" role="note">
                  Replay trades get full charts, notes, and daily reviews — excluded from live stats and drawdown limits.
                </span>
              )}
            </div>
            <label className="field wide"><span>Name {isNewReplay && <i>optional</i>}</span>
              <input ref={firstField} value={name} placeholder={NAME_PLACEHOLDER[acctMode]} aria-invalid={!!show("name")} onChange={(event) => setName(event.target.value)} />
              {show("name") && <span className="error">{show("name")}</span>}
            </label>
            <label className="field"><span>Starting balance ($) {isNewReplay && <i>optional</i>}</span>
              <input className="num" inputMode="decimal" value={start} placeholder={isNewReplay ? "0" : "50000"} aria-invalid={!!show("start")} onChange={(event) => setStart(event.target.value)} />
              {show("start") && <span className="error">{show("start")}</span>}
            </label>
            <label className="field"><span>Profit target ($) <i>optional</i></span>
              <input className="num" inputMode="decimal" value={target} placeholder={isReplay ? "—" : "3000"} aria-invalid={!!show("target")} onChange={(event) => setTarget(event.target.value)} />
              {show("target") && <span className="error">{show("target")}</span>}
            </label>
            <label className="field"><span>Loss limit ($) <i>optional</i></span>
              <input className="num" inputMode="decimal" value={maxLoss} placeholder={isReplay ? "—" : "2000"} aria-invalid={!!show("maxLoss")} onChange={(event) => setMaxLoss(event.target.value)} />
              {show("maxLoss") && <span className="error">{show("maxLoss")}</span>}
            </label>
            <label className="field"><span>Daily loss limit ($) <i>optional</i></span>
              <input className="num" inputMode="decimal" value={daily} placeholder={isReplay ? "—" : "1000"} aria-invalid={!!show("daily")} onChange={(event) => setDaily(event.target.value)} />
              {show("daily") && <span className="error">{show("daily")}</span>}
            </label>
            <div className="field wide">
              <label htmlFor="account-r-size-input"><span>{shield ? "R size" : "R size ($)"} <i>optional</i></span></label>
              {shield ? (
                <input
                  id="account-r-size-input"
                  type="text"
                  value="Hidden"
                  disabled
                  readOnly
                  aria-label="Account R size (hidden while Shield mode is on)"
                  aria-describedby="r-size-hint"
                />
              ) : (
                <>
                  <input
                    id="account-r-size-input"
                    className="num"
                    inputMode="decimal"
                    value={rSizeText}
                    placeholder="300"
                    aria-invalid={!!show("rSize")}
                    aria-describedby="r-size-hint"
                    onChange={(event) => setRSizeText(event.target.value)}
                  />
                  <div className="suggest" role="group" aria-label="Account R size presets" style={{ marginTop: 4 }}>
                    {R_SIZE_PRESETS.map((amount) => (
                      <button
                        key={amount}
                        type="button"
                        className="num"
                        style={{ minHeight: 44, minWidth: 44 }}
                        aria-pressed={rSizeCents === amount * 100}
                        onClick={() => setRSizeText(String(amount))}
                      >
                        ${amount}
                      </button>
                    ))}
                  </div>
                </>
              )}
              <span id="r-size-hint" className="hint">
                {shield
                  ? "1R is your fixed at-least risk unit (rounding up by <1 micro is fine). Existing trades keep their saved R. Turn Shield mode off to view or set the dollar amount."
                  : "1R is your fixed at-least risk unit (rounding up by <1 micro is fine). Existing trades keep their saved R."}
              </span>
              {show("rSize") && <span className="error">{show("rSize")}</span>}
            </div>
            {maxLoss.trim() !== "" && (
              <label className="field wide"><span>How the loss limit moves</span>
                <select value={drawdown} onChange={(event) => setDrawdown(event.target.value as DrawdownMode)}>
                  {DRAWDOWN_MODES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
              </label>
            )}
          </div>
          <button className="btn-primary btn-block" type="submit" style={{ marginTop: 14 }}>
            {account ? "Save account" : isReplay ? "Start Pretend / Replay" : "Add account"}
          </button>
          {account && <button type="button" className="btn-danger-ghost btn-block" style={{ marginTop: 8 }} onClick={archive}>Archive this account</button>}
        </form>
      </section>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(sheet, document.body) : sheet;
}
