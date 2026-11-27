"use client";

// PS-4c: list planning sessions from the last 14 days so a checkpoint can be reviewed later.
import { useState } from "react";
import { SessionReview } from "./SessionReview";
import { usePlansStore } from "@/lib/plans-store";
import { shouldShowSamples, usePrefs } from "@/lib/prefs";
import { formatSessionDate } from "@/lib/session";
import { recentPlanDays } from "@/lib/session-review";
import { useJournal } from "@/lib/store";
import { useToday } from "@/lib/ui";

export function PastSessionReviews() {
  const { plans } = usePlansStore();
  const journal = useJournal();
  const prefs = usePrefs();
  const { date } = useToday();
  const [openId, setOpenId] = useState<string | null>(null);
  // `useToday` is empty until the client clock is read; nothing is listed until then.
  const days = date ? recentPlanDays(plans, date) : [];
  const open = plans.find((plan) => plan.id === openId) ?? null;
  if (!days.length) return null;

  const realTrades = journal.trades.filter((trade) => !trade.is_sample);
  const reviewTrades = shouldShowSamples(prefs.showSamples, realTrades.length > 0) ? journal.trades : realTrades;

  return (
    <section className="card card-pad past-reviews" aria-labelledby="past-reviews-title" style={{ marginTop: 14 }}>
      <span className="eyebrow" id="past-reviews-title">Session reviews</span>
      {days.map(({ date: day, plans: list }) => (
        <div key={day} className="past-reviews-day">
          <b>{formatSessionDate(day)}</b>
          <div className="past-reviews-plans">
            {list.map((plan) => (
              <button
                key={plan.id}
                type="button"
                className="chip"
                style={{ minHeight: 44, minWidth: 44 }}
                onClick={() => setOpenId(plan.id)}
                aria-label={`Review ${plan.name}, ${formatSessionDate(day)}`}
              >
                {plan.name}{plan.lesson ? " ✓" : ""}
              </button>
            ))}
          </div>
        </div>
      ))}
      {open && <SessionReview plan={open} trades={reviewTrades} zone={prefs.timeZone} onClose={() => setOpenId(null)} />}
    </section>
  );
}
