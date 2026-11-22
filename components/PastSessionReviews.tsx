"use client";

// PS-4c: review a past day's planning sessions. Today's plans open from the Today screen; this lists
// the last two weeks so an evening missed is still reviewable (docs/24 §4).
import { useState } from "react";
import { SessionReview } from "./SessionReview";
import { usePlansStore } from "@/lib/plans-store";
import { usePrefs } from "@/lib/prefs";
import { withSamples } from "@/lib/selectors";
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

  return (
    <section className="card card-pad past-reviews" aria-labelledby="past-reviews-title" style={{ marginTop: 14 }}>
      <span className="eyebrow" id="past-reviews-title">Session reviews</span>
      {days.map(({ date: day, plans: list }) => (
        <div key={day} className="past-reviews-day">
          <b>{formatSessionDate(day)}</b>
          <div className="past-reviews-plans">
            {list.map((plan) => (
              <button key={plan.id} type="button" className="chip" onClick={() => setOpenId(plan.id)} aria-label={`Review ${plan.name}, ${formatSessionDate(day)}`}>
                {plan.name}{plan.lesson ? " ✓" : ""}
              </button>
            ))}
          </div>
        </div>
      ))}
      {open && <SessionReview plan={open} trades={withSamples(journal.trades, prefs.showSamples)} zone={prefs.timeZone} onClose={() => setOpenId(null)} />}
    </section>
  );
}
