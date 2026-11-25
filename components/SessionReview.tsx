"use client";

// PS-4b: after-session review (docs/24 §4) over the pure `sessionReview` (PS-4a). Every number comes
// from code (guardrail 11). The lesson saves as it is typed, like trade notes (UX-30).
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatPrice, formatTicks } from "@/lib/format";
import { playbookName } from "@/lib/playbooks";
import { PLAN_LIMITS } from "@/lib/plans";
import type { PlanningSession } from "@/lib/plans";
import { setPlanLesson, usePlansStore } from "@/lib/plans-store";
import { reviewWindow, sessionReview } from "@/lib/session-review";
import { formatSessionDate } from "@/lib/session";
import { formatListTime } from "@/lib/time";
import { useInlineSaveText } from "./useSaveLabel";
import type { TradeRecord } from "@/lib/trades";

interface Props {
  plan: PlanningSession;
  /** The trades the review may include: the screen's own list, samples per the trader's setting. */
  trades: readonly TradeRecord[];
  zone: string;
  onClose: () => void;
}

export function SessionReview({ plan, trades, zone, onClose }: Props) {
  const { plans, saved } = usePlansStore();
  const saveText = useInlineSaveText(saved ? "saved" : "error", { blocked: "Storage is blocked: this lesson will not be kept", check: false });
  const dialogRef = useRef<HTMLElement>(null);
  const start = reviewWindow(plan).from;
  // Later checkpoints of the same day end the window: "Pre-market → Pre-power hour".
  const later = useMemo(() => plans
    .filter((other) => other.id !== plan.id && !other.archived && other.session_date === plan.session_date)
    .filter((other) => Date.parse(other.anchor_time_utc ?? other.created_at) > start)
    .sort((a, b) => Date.parse(a.anchor_time_utc ?? a.created_at) - Date.parse(b.anchor_time_utc ?? b.created_at)), [plans, plan, start]);
  const [untilId, setUntilId] = useState<string>(() => later[0]?.id ?? "close");
  const until = later.find((other) => other.id === untilId) ?? null;
  const review = useMemo(() => sessionReview(plan, trades, until), [plan, trades, until]);
  const [lesson, setLesson] = useState(plan.lesson ?? "");

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.querySelector<HTMLElement>("select, textarea")?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); previous?.focus(); };
  }, [onClose]);

  const byId = new Map(trades.map((trade) => [trade.id, trade]));

  return (
    <div className="sheet-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="sheet plan-sheet" role="dialog" aria-modal="true" aria-labelledby="review-title" ref={dialogRef}>
        <div className="sheet-head">
          <div>
            <span className="eyebrow">{formatSessionDate(plan.session_date)} · After-session review</span>
            <h2 id="review-title">{plan.name}</h2>
            <p className="num">{formatListTime(review.from, zone)} → {formatListTime(review.to, zone)}</p>
            {review.writtenAfterClose && <p className="muted" style={{ fontSize: 12, margin: "2px 0 0" }}>Written after the close: showing the whole day</p>}
          </div>
          <button type="button" className="icon-button" style={{ minHeight: 44, minWidth: 44 }} onClick={onClose} aria-label="Close review">✕</button>
        </div>

        <div className="plan-form-body">
          <label className="review-until">
            <span>Until</span>
            <select value={until ? until.id : "close"} style={{ minHeight: 44 }} onChange={(event) => setUntilId(event.target.value)}>
              {later.map((other) => <option key={other.id} value={other.id}>{other.name}</option>)}
              <option value="close">Session close</option>
            </select>
          </label>

          <p className="review-summary num" role="status">
            {review.rows.length} {review.rows.length === 1 ? "trade" : "trades"}
            {review.rules.total > 0 && ` · rules ${review.rules.followed}/${review.rules.total}`}
            {review.watched.of > 0 && ` · watched setups ${review.watched.yes}/${review.watched.of}`}
          </p>

          {review.rows.length ? (
            <ul className="review-rows">
              {review.rows.map((row) => {
                const trade = byId.get(row.trade_id);
                return (
                  <li key={row.trade_id}>
                    <Link href={`/trades/${row.trade_id}`} className="review-row" style={{ minHeight: 44 }}>
                      <span className="review-row-head">
                        <b className="num">{formatListTime(row.entry_time, zone)}</b>
                        <span>{playbookName(trade?.playbook_id ?? null) ?? "No playbook"}</span>
                        {row.rules && <span className={`seal ${row.rules.followed === row.rules.total ? "full" : ""}`}>{row.rules.followed}/{row.rules.total} followed</span>}
                      </span>
                      <span className="review-row-facts num">
                        <span>{row.nearest
                          ? `Nearest level ${row.nearest.label} ${formatPrice(row.nearest.price, trade?.symbol)} · ${formatTicks(row.nearest.distance_ticks)}`
                          : "No planned level at entry"}</span>
                        <span>{row.watched === null ? "" : row.watched ? "On the watch list" : "Not on the watch list"}</span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="review-empty">No trades in this window. A session without trades is still a review: write what you saw.</p>
          )}

          <label className="review-lesson">
            <span>One lesson for the next session</span>
            <textarea
              value={lesson}
              maxLength={PLAN_LIMITS.lesson}
              rows={3}
              onChange={(event) => { setLesson(event.target.value); setPlanLesson(plan.id, event.target.value); }}
              placeholder="Wait for the reclaim before sizing up."
            />
            <small className="num">{saveText} · {lesson.length}/{PLAN_LIMITS.lesson}</small>
          </label>
        </div>
      </section>
    </div>
  );
}
