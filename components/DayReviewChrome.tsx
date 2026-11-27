"use client";

import Link from "next/link";
import type { TradingAccount } from "@/lib/accounts";
import type { LocalSave } from "@/lib/save-label";
import { formatSessionDate } from "@/lib/session";

export function DayReviewHeader(props: {
  date: string;
  accountId: string | null;
  accounts: TradingAccount[];
  previousHref: string;
  nextHref: string | null;
  onAccountChange: (accountId: string | null) => void;
}) {
  return <div className="page-head day-review-head">
    <div>
      <span className="eyebrow">Day review</span>
      <div className="day-review-nav">
        <Link className="day-review-step" href={props.previousHref} aria-label="Previous trading day" scroll={false}>‹</Link>
        <h1>{formatSessionDate(props.date, true)}</h1>
        {props.nextHref
          ? <Link className="day-review-step" href={props.nextHref} aria-label="Next trading day" scroll={false}>›</Link>
          : <span className="day-review-step is-disabled" aria-hidden="true">›</span>}
      </div>
    </div>
    <label className="day-review-scope">
      <span className="sr-only">Account scope</span>
      <select value={props.accountId ?? ""} onChange={(event) => props.onAccountChange(event.target.value || null)}>
        <option value="">All accounts</option>
        {props.accounts.filter((account) => !account.archived || account.id === props.accountId).map((account) => (
          <option key={account.id} value={account.id}>{account.name}</option>
        ))}
      </select>
    </label>
  </div>;
}

export function DayReviewSaveStatus(props: {
  online: boolean;
  saveState: LocalSave;
  retryMessage: string | null;
  onRetry: () => void;
}) {
  return <>
    {!props.online && <p className="day-review-note" role="status">Offline: this review is kept on this device until you reconnect.</p>}
    {props.saveState === "error" && <p className="day-review-note" role="alert">
      Couldn’t save this review on this device. Your latest change is still in the form; reconnect or try again.
      <button type="button" className="btn-secondary" style={{ minHeight: 44, marginInlineStart: 8 }} onClick={props.onRetry} aria-label="Retry saving this review">Try again</button>
    </p>}
    {props.retryMessage && <p className="day-review-note" role={props.saveState === "error" ? "alert" : "status"}>{props.retryMessage}</p>}
  </>;
}
