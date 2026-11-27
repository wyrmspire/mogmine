"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";
import { AccountSheet } from "./AccountSheet";
import { accountMode, accountSummary, dollarsToCents, isReplayAccount } from "@/lib/accounts";
import type { AccountMode, AccountSummary, TradingAccount } from "@/lib/accounts";
import { addBalanceCheck, removeBalanceCheck, useAccounts } from "@/lib/accounts-store";
import { formatBalance, formatCents, formatR, formatUsdAmount } from "@/lib/format";
import { usePrefs } from "@/lib/prefs";
import { DEFAULT_R_SIZE_CENTS, resolveRSize, resultR } from "@/lib/r-size";
import { formatSessionDate } from "@/lib/session";
import { useJournal } from "@/lib/store";
import { showToast } from "@/lib/toast";

const MODE_LABEL: Record<AccountMode, string> = {
  replay: "REPLAY",
  live: "LIVE",
  eval: "EVAL",
  sim: "SIM",
};

function ModeBadge({ account }: { account: TradingAccount }) {
  const mode = accountMode(account);
  const style = mode === "replay"
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
  return <span className="tag-chip" style={style}>{MODE_LABEL[mode]}</span>;
}

/** Balance over time, neutral ink: a balance line is not a verdict (UX-65). */
function BalanceLine({ curve, floor }: { curve: number[]; floor: number | null }) {
  if (curve.length < 2) return null;
  const values = floor == null ? curve : [...curve, floor];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const x = (index: number) => 2 + (index / (curve.length - 1)) * 196;
  const y = (value: number) => 38 - ((value - min) / span) * 34;
  const path = curve.map((value, index) => `${index ? "L" : "M"}${x(index).toFixed(1)} ${y(value).toFixed(1)}`).join("");
  return (
    <svg className="balance-line" viewBox="0 0 200 40" preserveAspectRatio="none" aria-hidden="true">
      {floor != null && <line className="floor" x1={0} x2={200} y1={y(floor)} y2={y(floor)} />}
      <path d={path} />
    </svg>
  );
}

/** A plain progress bar with its numbers in text (never colour alone). */
function Meter({ value, label }: { value: number; label: string }) {
  const clamped = Math.max(0, Math.min(1, value));
  return <span className="meter" role="img" aria-label={label}><i style={{ width: `${clamped * 100}%` }} /></span>;
}

/** A share of a limit or target. Above 100% (room grew past the limit) reads "100%+", never "105%". */
const pct = (value: number) => (value > 1 ? "100%+" : `${Math.round(Math.max(0, value) * 100)}%`);

function Limits({ account, summary, shield }: { account: TradingAccount; summary: AccountSummary; shield: boolean }) {
  const lines = [];
  const { limit, daily, target } = summary;
  if (limit && account.rules.max_loss_cents) {
    const share = limit.room_cents / account.rules.max_loss_cents;
    lines.push(
      <div key="limit" className={`account-limit ${limit.breached_at ? "reached" : ""}`}>
        <span>{limit.breached_at
          ? `Reached the loss limit on ${formatSessionDate(summary.rows.find((row) => row.at === limit.breached_at?.at)?.session ?? "")}`
          : shield ? `Room before the loss limit · ${pct(share)}` : `Room before the loss limit · ${formatBalance(Math.max(0, limit.room_cents))}`}</span>
        <Meter value={share} label={`${pct(Math.max(0, share))} of the loss limit left`} />
      </div>,
    );
  }
  if (daily) {
    const share = daily.today_room_cents / daily.limit_cents;
    lines.push(
      <div key="daily" className={`account-limit ${daily.today_room_cents <= 0 ? "reached" : ""}`}>
        <span>{daily.today_room_cents <= 0 ? "Reached today's loss limit" : shield ? `Room today · ${pct(share)}` : `Room today · ${formatBalance(daily.today_room_cents)}`}</span>
        <Meter value={share} label={`${pct(Math.max(0, share))} of today's loss limit left`} />
      </div>,
    );
  }
  if (target && account.rules.profit_target_cents) {
    const share = (summary.balance_cents - summary.starting_cents) / account.rules.profit_target_cents;
    lines.push(
      <div key="target" className="account-limit">
        <span>{target.reached_at ? "Target reached" : shield ? `Toward the target · ${pct(Math.max(0, share))}` : `${formatBalance(target.remaining_cents)} to the target`}</span>
        <Meter value={share} label={`${pct(Math.max(0, share))} of the profit target`} />
      </div>,
    );
  }
  return lines.length ? <div className="account-limits">{lines}</div> : null;
}

function OneAccount({ account, shield }: { account: TradingAccount; shield: boolean }) {
  const journal = useJournal();
  const store = useAccounts();
  const prefs = usePrefs();
  const [editing, setEditing] = useState(false);
  const [checking, setChecking] = useState(false);
  const [actual, setActual] = useState("");
  const summary = useMemo(() => accountSummary(account, journal.trades, store.checks, new Date().toISOString()), [account, journal.trades, store.checks]);
  const byId = useMemo(() => new Map(journal.trades.map((trade) => [trade.id, trade])), [journal.trades]);
  const actualCents = dollarsToCents(actual);
  const defaultRCents = Number.isFinite(prefs.riskBudgetUsd) && prefs.riskBudgetUsd >= 10
    ? Math.round(prefs.riskBudgetUsd * 100)
    : DEFAULT_R_SIZE_CENTS;
  const formatRUsd = (cents: number) => formatUsdAmount(cents / 100).replace(/\.00$/, "");
  const defaultRText = formatRUsd(defaultRCents);
  const accountRText = account.r_size_cents != null ? formatRUsd(account.r_size_cents) : null;

  const replay = isReplayAccount(account);
  const hasLimits = account.rules.max_loss_cents != null || account.rules.daily_loss_cents != null || account.rules.profit_target_cents != null;
  const calmReplay = replay && !hasLimits;

  const netR = useMemo(() => {
    let sum = 0;
    let count = 0;
    for (const trade of journal.trades) {
      if (trade.account_id !== account.id || trade.is_sample || trade.exit_time == null) continue;
      const r = resultR(trade, resolveRSize(trade, store.accounts, prefs));
      if (r != null) { sum += r; count += 1; }
    }
    return count > 0 ? sum : null;
  }, [journal.trades, account.id, store.accounts, prefs]);

  const saveCheck = (event: FormEvent) => {
    event.preventDefault();
    if (actualCents == null) return;
    const check = addBalanceCheck({ account_id: account.id, balance_cents: actualCents });
    const difference = actualCents - summary.balance_cents;
    showToast(difference === 0 ? "Matches your journal" : `Recorded ${formatCents(difference)} as an adjustment`, { label: "Undo", run: () => removeBalanceCheck(check.id) });
    setActual("");
    setChecking(false);
  };

  const undatedCount = summary.issues.filter((issue) => issue.reason === "undated").length;
  const unpricedCount = summary.issues.length - undatedCount;
  const notes = [
    summary.openTrades ? `${summary.openTrades} open, not counted yet` : "",
    unpricedCount ? `${unpricedCount} ${unpricedCount === 1 ? "trade" : "trades"} could not be priced` : "",
    undatedCount ? `${undatedCount} ${undatedCount === 1 ? "trade needs" : "trades need"} a valid exit date` : "",
    !calmReplay && summary.adjustments_cents && !shield ? `${formatCents(summary.adjustments_cents)} adjustments` : "",
  ].filter(Boolean);

  return (
    <section className="specular-card card-pad account-card" aria-labelledby={`account-title-${account.id}`}>
      <div className="card-head">
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", minWidth: 0 }}>
          <h3 id={`account-title-${account.id}`}>{account.name}</h3>
          <ModeBadge account={account} />
        </div>
        <span className="num" aria-label="Account data basis">
          {calmReplay
            ? (shield || !accountRText ? "Pretend / Replay" : `Pretend / Replay · 1R ${accountRText}`)
            : (shield || !accountRText ? "From your journal · gross" : `From your journal · gross · 1R ${accountRText}`)}
        </span>
      </div>
      {account.r_size_cents == null && (
        <button
          type="button"
          className="account-r-nudge num"
          onClick={() => setEditing(true)}
          aria-label={shield ? "Using default R — set account R" : `Using ${defaultRText} default — set account R`}
        >
          <span>{shield ? "Using default R — set account R" : `Using ${defaultRText} default — set account R`}</span>
          <span className="account-r-nudge-cta" aria-hidden="true">Set R →</span>
        </button>
      )}
      {calmReplay ? (
        <>
          <p className="account-balance num">
            <b className={netR != null && netR > 0 ? "positive" : netR != null && netR < 0 ? "negative" : ""} style={{ color: netR == null ? "var(--text-muted)" : undefined }}>
              {formatR(netR)}
            </b>
            <span>
              {summary.sessions} {summary.sessions === 1 ? "session" : "sessions"} · {summary.closedTrades} {summary.closedTrades === 1 ? "trade" : "trades"}
            </span>
          </p>
          <p className="account-today num">
            Today · {summary.today.trades} {summary.today.trades === 1 ? "trade" : "trades"}
          </p>
        </>
      ) : (
        <>
          {shield ? (
            <p className="account-balance muted" role="status">Balance unavailable while Shield is on <span>Shield</span></p>
          ) : (
            <p className="account-balance num">{formatBalance(summary.balance_cents)}<span>{summary.closedTrades ? `${account.rules.drawdown === "trailing_eod" && account.rules.max_loss_cents ? "high at a close" : "high"} ${formatBalance(summary.peak_cents)}` : "No closed trades logged yet"}</span></p>
          )}
          <p className="account-today num">
            Today {shield ? `${summary.today.trades} ${summary.today.trades === 1 ? "trade" : "trades"}` : `${formatCents(summary.today.realized_cents)} · ${summary.today.trades} ${summary.today.trades === 1 ? "trade" : "trades"}`}
            {!shield && summary.drawdown_cents > 0 ? ` · ${formatBalance(summary.drawdown_cents)} below the high` : ""}
          </p>
          {!shield && <BalanceLine curve={summary.curve} floor={summary.limit?.floor_cents ?? null} />}
          <Limits account={account} summary={summary} shield={shield} />
        </>
      )}
      {notes.length > 0 && <p className="account-notes">{notes.join(" · ")}</p>}

      {!calmReplay && checking && (
        <form
          className="account-check"
          onSubmit={saveCheck}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setChecking(false);
            }
          }}
          aria-label={`Match broker balance for ${account.name}`}
        >
          <label className="field"><span>Balance your broker shows ($)</span>
            <input inputMode="decimal" autoFocus value={actual} placeholder={(summary.balance_cents / 100).toFixed(2)} onChange={(event) => setActual(event.target.value)} />
          </label>
          <p className="muted">{actualCents == null ? "The difference is kept as an adjustment, for fees or trades not logged. Old trades are not changed." : `Adjustment: ${formatCents(actualCents - summary.balance_cents)}`}</p>
          <div className="actions">
            <button type="submit" className="btn-secondary" disabled={actualCents == null} aria-label="Save broker balance check">Save</button>
            <button type="button" className="btn-ghost" onClick={() => setChecking(false)} aria-label="Cancel broker balance check">Cancel</button>
          </div>
        </form>
      )}

      <div className="actions account-actions">
        {!replay && !checking && !shield && <button type="button" className="btn-secondary" onClick={() => setChecking(true)} aria-label={`Match broker balance for ${account.name}`}>Match broker balance</button>}
        <button type="button" className="btn-secondary" onClick={() => setEditing(true)} aria-label={`Edit ${account.name}`}>Edit</button>
      </div>

      {summary.rows.length > 0 && !shield && (
        <details className="account-history">
          <summary aria-label={`Show history for ${account.name}: ${summary.closedTrades} ${summary.closedTrades === 1 ? "trade" : "trades"} across ${summary.sessions} ${summary.sessions === 1 ? "day" : "days"}`}>History <span>{summary.closedTrades} {summary.closedTrades === 1 ? "trade" : "trades"} · {summary.sessions} {summary.sessions === 1 ? "day" : "days"}</span></summary>
          <ol>
            {[...summary.rows].reverse().slice(0, 30).map((row) => {
              const trade = row.kind === "trade" ? byId.get(row.trade_id) : null;
              return (
                <li key={row.kind === "trade" ? row.trade_id : row.check_id}>
                  {trade ? <Link href={`/trades/${trade.id}`}>{formatSessionDate(row.session)} · {trade.symbol} {trade.direction === "LONG" ? "▲" : "▼"}</Link> : <span>{formatSessionDate(row.session)} · Balance check</span>}
                  <span className="num">{formatCents(row.delta_cents)}</span>
                  <span className="num muted">{formatBalance(row.balance_cents)}</span>
                </li>
              );
            })}
          </ol>
        </details>
      )}
      {summary.rows.length === 0 && !shield && <p className="account-history muted" role="status">No account history yet.</p>}
      {summary.rows.length > 0 && shield && <p className="account-history muted" role="status">Account history unavailable while Shield is on.</p>}
      {editing && <AccountSheet account={account} onClose={() => setEditing(false)} />}
    </section>
  );
}

/** Today: one card per active account, or an offer to add one. */
export function AccountCards({ shield }: { shield: boolean }) {
  const store = useAccounts();
  const [addingMode, setAddingMode] = useState<AccountMode | null>(null);
  if (!store.hydrated) return null;
  const active = store.accounts.filter((account) => !account.archived);
  return (
    <div className="account-cards">
      {active.length === 0 ? (
        <div className="specular-card card-pad account-empty" style={{ flexWrap: "wrap" }}>
          <span><b>Track an account</b><br /><span className="muted">Running totals for eval or live accounts, or a Pretend / Replay session on external charts.</span></span>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="btn-primary" style={{ minHeight: 44 }} onClick={() => setAddingMode("eval")}>+ Add account</button>
            <button type="button" className="btn-secondary" style={{ minHeight: 44 }} onClick={() => setAddingMode("replay")}>+ Pretend / Replay</button>
          </div>
        </div>
      ) : (
        <>
          {active.map((account) => <OneAccount key={account.id} account={account} shield={shield} />)}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="btn-secondary account-add" style={{ minHeight: 44 }} onClick={() => setAddingMode("eval")}>+ Add account</button>
            <button type="button" className="btn-secondary account-add" style={{ minHeight: 44 }} onClick={() => setAddingMode("replay")}>+ Pretend / Replay</button>
          </div>
        </>
      )}
      {addingMode && <AccountSheet defaultMode={addingMode} onClose={() => setAddingMode(null)} />}
    </div>
  );
}
