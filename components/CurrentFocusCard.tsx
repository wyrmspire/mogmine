"use client";

import { currentFocusCandidate, pinCurrentFocus, readPinnedCurrentFocus, clearCurrentFocus, type CurrentFocusCandidate, type PinnedCurrentFocus } from "@/lib/current-focus";
import type { TradingAccount } from "@/lib/accounts";
import type { DailyReview } from "@/lib/daily-review";
import { usePrefs } from "@/lib/prefs";

export function CurrentFocusCard({ reviews, sessionDate, accountId, accountName, accounts }: {
  reviews: readonly DailyReview[];
  sessionDate: string;
  accountId: string | null;
  accountName: string | null;
  accounts: readonly TradingAccount[];
}) {
  const prefs = usePrefs();
  const candidate = currentFocusCandidate(reviews, sessionDate, accountId);
  const pinned: PinnedCurrentFocus | null = readPinnedCurrentFocus(accountId, prefs);
  const sourceAccountName = pinned?.sourceAccountId
    ? accounts.find((account) => account.id === pinned.sourceAccountId)?.name ?? "Unknown account"
    : "All accounts";

  const pin = (value: CurrentFocusCandidate) => pinCurrentFocus(value, accountId);
  return (
    <section className="specular-card card-pad" aria-label="Current focus" style={{ marginBottom: 14 }}>
      <div className="card-head"><h2>Current focus</h2><span className="muted">Only you can pin this</span></div>
      {pinned ? (
        <>
          <p style={{ margin: "10px 0 6px", fontWeight: 700 }}>{pinned.text}</p>
          <p className="muted" style={{ margin: 0, fontSize: 12 }}>
            Pinned from the {pinned.sessionDate} daily review · {sourceAccountName}. Scope: {accountName ?? "All accounts"}.
          </p>
          <button type="button" className="btn-secondary" style={{ minHeight: 44, marginTop: 10 }} onClick={() => clearCurrentFocus(accountId)}>Unpin focus</button>
        </>
      ) : candidate ? (
        <>
          <p className="muted" style={{ margin: "10px 0 6px" }}>A lesson is ready for your confirmation:</p>
          <p style={{ margin: 0 }}>{candidate.text}</p>
          <button type="button" className="btn-primary" style={{ minHeight: 44, marginTop: 10 }} onClick={() => pin(candidate)}>Pin as current focus</button>
        </>
      ) : (
        <p className="muted" style={{ margin: "10px 0 0" }}>Finish a daily review lesson, then pin it here when it is the rule you want to carry forward.</p>
      )}
    </section>
  );
}
