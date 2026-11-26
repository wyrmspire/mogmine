"use client";

// The day review screen, /review/day/[date] (docs/06 §3, Q-3 and Q-4 in 92). Saves go through lib/daily-review-store.ts.
// Trade totals come from dailyReviewTotals (Shield-aware). "Done for the day" never changes a trade's review_status.

import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useAccounts } from "@/lib/accounts-store";
import {
  DAILY_REVIEW_LIMITS, dailyReviewTotals, findExistingDailyReview, makeDailyReview, proposePlanIds, proposeTradeIds, unlinkedDayTradeIds,
} from "@/lib/daily-review";
import type { DailyReview, ReviewPoint, ReviewPointKind } from "@/lib/daily-review";
import { updateDailyReview, upsertDailyReview, useDailyReviewsStore } from "@/lib/daily-review-store";
import { markLinkedTradesReviewed } from "@/lib/day-review-screen";
import { buildDaySheetModel, daySheetFileName, encodeDaySheet } from "@/lib/day-sheet";
import type { DaySheetSnapshots } from "@/lib/day-sheet";
import { formatSessionDate, sessionDate } from "@/lib/session";
import { parseSessionDateParam, stepRegularSessionDate } from "@/lib/selectors";
import { usePlansStore } from "@/lib/plans-store";
import { setPrefs, usePrefs } from "@/lib/prefs";
import type { ReviewCardOrientation } from "@/lib/prefs-sanitize";
import { formatListTime } from "@/lib/time";
import { updateTrade, useJournal } from "@/lib/store";
import { showToast } from "@/lib/toast";
import type { TradeRecord } from "@/lib/trades";
import type { LocalSave } from "@/lib/save-label";
import { useInlineSaveText } from "./useSaveLabel";
import { ReviewCard, ReviewCardStyles } from "./ReviewCard";

const POINT_GROUPS: { kind: ReviewPointKind; title: string; placeholder: string }[] = [
  { kind: "went_well", title: "Went well", placeholder: "What worked, and why it worked" },
  { kind: "mistake", title: "Mistakes", placeholder: "What went wrong in your process" },
  { kind: "observation", title: "Observations", placeholder: "What you saw in the market" },
  { kind: "next_time", title: "Next time", placeholder: "What to do differently" },
];

const pathFor = (date: string, account: string | null) => `/review/day/${date}${account ? `?account=${encodeURIComponent(account)}` : ""}`;
const newPointId = () => `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const ORIENTATIONS: ReadonlyArray<[ReviewCardOrientation, string]> = [["portrait", "Portrait 4:5"], ["landscape", "Landscape 16:9"]];
const SHEET_STYLE: CSSProperties = {
  position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 60, maxHeight: "85vh", overflowY: "auto",
  display: "grid", gap: 12, padding: 16, background: "var(--elevated, #11131c)", borderTop: "1px solid var(--chart-border)",
};
const snapshotKey = (tradeId: string, shield: boolean) => `${tradeId}|${shield ? 1 : 0}`;

/** Online state for the offline note. Server render assumes online (the screen waits for hydration anyway). */
function useOnline() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => { window.removeEventListener("online", sync); window.removeEventListener("offline", sync); };
  }, []);
  return online;
}

/** Entry point. Waits for the journal and the day store, then renders the review for this (date, account) scope. */
export function DayReviewScreen({ date }: { date: string }) {
  const journal = useJournal();
  const { hydrated } = useDailyReviewsStore();
  const params = useSearchParams();
  const accountParam = params.get("account") || null;
  if (!parseSessionDateParam(date)) {
    return (
      <div className="page day-review" style={{ maxWidth: 720 }}>
        <div className="page-head"><div><span className="eyebrow">Day review</span><h1>Not a trading day</h1><p>Use a date like 2026-11-23.</p></div></div>
        <Link className="btn-secondary" style={{ minHeight: 44, display: "inline-flex", alignItems: "center" }} href="/review">Back to Review</Link>
      </div>
    );
  }
  if (!journal.hydrated || !hydrated) {
    return <div className="page day-review" style={{ maxWidth: 720 }}><div className="page-head"><div><span className="eyebrow">Day review</span><h1>Loading…</h1></div></div><div className="skeleton" style={{ height: 380 }} /></div>;
  }
  // The key resets the unsaved link draft when the day or the account scope changes.
  return <DayReview key={`${date}|${accountParam ?? "*"}`} date={date} accountId={accountParam} />;
}

function DayReview({ date, accountId }: { date: string; accountId: string | null }) {
  const journal = useJournal();
  const prefs = usePrefs();
  const accounts = useAccounts();
  const plans = usePlansStore();
  const { reviews } = useDailyReviewsStore();
  const router = useRouter();
  const online = useOnline();
  const [today] = useState(() => sessionDate(Date.now()));
  const review = findExistingDailyReview(reviews, date, accountId);
  const [draftIds, setDraftIds] = useState(() => proposeTradeIds(journal.trades, date, accountId, { includeSamples: prefs.showSamples }));
  const linkedIds = review ? review.trade_ids : draftIds;
  const [lessonDraft, setLessonDraft] = useState(review?.lesson ?? "");
  const [saveState, setSaveState] = useState<LocalSave>("idle");
  const saveText = useInlineSaveText(saveState);
  const [adding, setAdding] = useState<ReviewPointKind | null>(null);
  // DR-3: chart snapshots keyed by trade and privacy. Cards behind the Share sheet render with the export's Shield.
  const [snapshots, setSnapshots] = useState<Record<string, HTMLCanvasElement>>({});
  const [shareOpen, setShareOpen] = useState(false);
  const [exportShield, setExportShield] = useState(true); // OD-46a: Shield on by default
  const [encoded, setEncoded] = useState<{ key: string; blob: Blob; url: string; width: number; height: number } | null>(null);
  const onSnapshotReady = useCallback((tradeId: string, canvas: HTMLCanvasElement, shield: boolean) => {
    setSnapshots((prev) => ({ ...prev, [snapshotKey(tradeId, shield)]: canvas }));
  }, []);

  // Writes one patch. With no saved review yet, the first write creates it from the current draft (rule 5 keeps one per scope).
  const save = (patch: Partial<DailyReview>) => {
    setSaveState("saving");
    const saved = review
      ? updateDailyReview(review.id, patch)
      : upsertDailyReview(makeDailyReview({
        session_date: date,
        account_id: accountId,
        trade_ids: draftIds,
        plan_ids: proposePlanIds(plans.plans, date),
        points: [],
        lesson: "",
        status: "draft",
        recorded_at: new Date().toISOString(),
        ...patch,
      }));
    setSaveState(saved ? "saved" : "error");
    return saved;
  };
  const saveRef = useRef(save);
  useEffect(() => { saveRef.current = save; });

  // The lesson saves 600 ms after the last keystroke, and again on blur.
  useEffect(() => {
    if (lessonDraft === (review?.lesson ?? "")) return;
    const timer = setTimeout(() => saveRef.current({ lesson: lessonDraft }), 600);
    return () => clearTimeout(timer);
  }, [lessonDraft, review?.lesson]);

  const points = review?.points ?? [];
  const totals = dailyReviewTotals(
    { session_date: date, trade_ids: linkedIds },
    journal.trades,
    prefs.shield,
    { accounts: accounts.accounts, prefs },
  );
  const byId = new Map(journal.trades.map((trade) => [trade.id, trade] as const));
  const candidateIds = [...new Set([...linkedIds, ...proposeTradeIds(journal.trades, date, accountId, { includeSamples: prefs.showSamples })])];
  const candidates = candidateIds.map((id) => byId.get(id)).filter((trade): trade is TradeRecord => Boolean(trade));
  const linkedTrades = linkedIds.map((id) => byId.get(id)).filter((trade): trade is TradeRecord => Boolean(trade && !trade.is_sample));
  const unreviewed = linkedTrades.filter((trade) => trade.review_status !== "reviewed");
  // Only trades entered after the review was first written count as "new" (no logged-at field on a trade).
  const newTradeIds = review
    ? unlinkedDayTradeIds(review, journal.trades, { includeSamples: prefs.showSamples }).filter((id) => {
      const trade = byId.get(id);
      return trade ? Date.parse(trade.entry_time) > Date.parse(review.recorded_at) : false;
    })
    : [];
  const dayPlans = plans.plans.filter((plan) => plan.session_date === date && !plan.archived);
  const done = review?.status === "done";
  const nextDate = stepRegularSessionDate(date, 1);

  // UX-70: the PNG is encoded as soon as the sheet opens or an input changes, so the Share tap has a Blob ready.
  const orientation = prefs.reviewCardOrientation;
  const cardShield = shareOpen ? exportShield : prefs.shield;
  const snapKeys = linkedIds.map((id) => (snapshots[snapshotKey(id, exportShield)] ? "1" : "0")).join("");
  const shareKey = `${date}|${orientation}|${exportShield ? 1 : 0}|${linkedIds.join(",")}|${snapKeys}`;
  const readyShare = shareOpen && encoded?.key === shareKey ? encoded : null;
  useEffect(() => {
    if (!shareOpen) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    const byTrade = new Map(journal.trades.map((trade) => [trade.id, trade] as const));
    const shareTrades = linkedIds.map((id) => byTrade.get(id)).filter((trade): trade is TradeRecord => Boolean(trade && !trade.is_sample));
    const picked: DaySheetSnapshots = {};
    for (const trade of shareTrades) picked[trade.id] = snapshots[snapshotKey(trade.id, exportShield)] ?? null;
    const model = buildDaySheetModel(date, shareTrades, orientation, exportShield, { accounts: accounts.accounts, prefs, zone: prefs.timeZone });
    encodeDaySheet(model, picked).then(
      (blob) => {
        if (cancelled || !blob) return;
        objectUrl = URL.createObjectURL(blob);
        setEncoded({ key: shareKey, blob, url: objectUrl, width: model.width, height: model.height });
      },
      () => { if (!cancelled) setEncoded(null); },
    );
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [shareOpen, shareKey, exportShield, orientation, linkedIds, journal.trades, snapshots, date, accounts.accounts, prefs]);
  // The tap calls navigator.share (or the download link) synchronously: the file is already encoded.
  const shareDay = () => {
    if (!readyShare) return;
    const name = daySheetFileName(date, orientation);
    const file = new File([readyShare.blob], name, { type: "image/png" });
    if (typeof navigator.share === "function" && navigator.canShare?.({ files: [file] })) {
      navigator.share({ files: [file] }).catch(() => undefined);
      return;
    }
    const url = URL.createObjectURL(readyShare.blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const toggleLink = (id: string) => {
    const next = linkedIds.includes(id) ? linkedIds.filter((item) => item !== id) : [...linkedIds, id];
    if (review) save({ trade_ids: next });
    else setDraftIds(next);
  };
  const addPoint = (kind: ReviewPointKind, text: string, tradeId: string | null) => {
    const point: ReviewPoint = { id: newPointId(), kind, text: text.trim().slice(0, DAILY_REVIEW_LIMITS.pointText), trade_id: tradeId };
    if (point.text) save({ points: [...points, point] });
    setAdding(null);
  };
  const removePoint = (id: string) => save({ points: points.filter((point) => point.id !== id) });
  const toggleDone = () => save({ status: done ? "draft" : "done" });
  // Q-4: marks the linked trades only; the day's status is separate. Undo restores each trade's own previous status.
  const markReviewed = () => {
    const { count, undo } = markLinkedTradesReviewed(unreviewed, (id, status) => updateTrade(id, { review_status: status }));
    showToast(`Marked ${count} trades reviewed`, {
      label: "Undo",
      run: undo,
    });
  };

  return (
    <div className="page day-review" style={{ maxWidth: 720 }}>
      <div className="page-head day-review-head">
        <div>
          <span className="eyebrow">Day review</span>
          <div className="day-review-nav">
            <Link className="day-review-step" href={pathFor(stepRegularSessionDate(date, -1), accountId)} aria-label="Previous trading day" scroll={false}>‹</Link>
            <h1>{formatSessionDate(date, true)}</h1>
            {nextDate <= today
              ? <Link className="day-review-step" href={pathFor(nextDate, accountId)} aria-label="Next trading day" scroll={false}>›</Link>
              : <span className="day-review-step is-disabled" aria-hidden="true">›</span>}
          </div>
        </div>
        <label className="day-review-scope">
          <span className="sr-only">Account scope</span>
          <select value={accountId ?? ""} onChange={(event) => router.replace(pathFor(date, event.target.value || null))}>
            <option value="">All accounts</option>
            {accounts.accounts.filter((account) => !account.archived || account.id === accountId).map((account) => (
              <option key={account.id} value={account.id}>{account.name}</option>
            ))}
          </select>
        </label>
      </div>

      {!online && <p className="day-review-note" role="status">Offline: this review is kept on this device until you reconnect.</p>}

      <p className="day-review-summary num">
        {totals.tradeCount} {totals.tradeCount === 1 ? "trade" : "trades"} · {totals.formattedNetR} net · rules {totals.rulesFollowed}/{totals.rulesTotal} · From your journal · gross
        {!prefs.shield && totals.formattedNetMoney ? ` · ${totals.formattedNetMoney}` : ""}
      </p>

      {newTradeIds.length > 0 && (
        <div className="day-review-banner" role="status">
          <span>{newTradeIds.length === 1 ? "1 new trade for this day" : `${newTradeIds.length} new trades for this day`}: Add {newTradeIds.length === 1 ? "it" : "them"}?</span>
          <button type="button" className="btn-secondary" style={{ minHeight: 44 }} onClick={() => save({ trade_ids: [...linkedIds, ...newTradeIds] })}>Add</button>
        </div>
      )}

      <div className="day-review-orientation" role="group" aria-label="Review card orientation" style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
        {ORIENTATIONS.map(([value, label]) => (
          <button key={value} type="button" aria-pressed={orientation === value} className={orientation === value ? "btn-primary" : "btn-secondary"} style={{ minHeight: 44 }} onClick={() => setPrefs({ reviewCardOrientation: value })}>
            {label}
          </button>
        ))}
      </div>

      <section className="day-review-trades" data-slot="review-cards" aria-label="Trades this day">
        <ReviewCardStyles />
        {candidates.length === 0 && <p className="day-review-empty">A day without trades is still a review. Write what you saw.</p>}
        <div className="review-card-grid" data-orientation={orientation}>
          {candidates.filter((trade) => linkedIds.includes(trade.id)).map((trade) => (
            <div key={trade.id} className="day-review-cell">
              <label className="day-review-check" style={{ minHeight: 44, display: "flex", alignItems: "center", gap: 8 }}>
                <input type="checkbox" checked onChange={() => toggleLink(trade.id)} aria-label={`Unlink ${trade.symbol} ${formatListTime(trade.entry_time, prefs.timeZone)}`} />
                <span className="muted">Linked to this day</span>
              </label>
              <ReviewCard trade={trade} orientation={orientation} shield={cardShield} zone={prefs.timeZone} onSnapshotReady={onSnapshotReady} />
            </div>
          ))}
        </div>
        <ul className="day-review-list">
          {candidates.filter((trade) => !linkedIds.includes(trade.id)).map((trade) => (
            <li key={trade.id} className="day-review-row is-unlinked">
              <label className="day-review-check">
                <input type="checkbox" checked={false} onChange={() => toggleLink(trade.id)} aria-label={`Link ${trade.symbol} ${formatListTime(trade.entry_time, prefs.timeZone)}`} />
              </label>
              <Link className="day-review-link" href={`/trades/${trade.id}`}>
                <strong>{trade.symbol}</strong>
                <span className={`direction ${trade.direction === "LONG" ? "long" : "short"}`}>{trade.direction}</span>
                <span className="muted">{formatListTime(trade.entry_time, prefs.timeZone)}</span>
                {trade.is_sample && <span className="muted">sample</span>}
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {dayPlans.length > 0 && (
        <section className="day-review-plans" aria-label="Plans today">
          <h2>Plans today</h2>
          <ul>
            {dayPlans.map((plan) => (
              <li key={plan.id}><strong>{plan.name}</strong>{plan.lesson ? <span className="muted"> · lesson: {plan.lesson}</span> : null}</li>
            ))}
          </ul>
        </section>
      )}

      {POINT_GROUPS.map((group) => (
        <PointGroup
          key={group.kind}
          title={group.title}
          placeholder={group.placeholder}
          points={points.filter((point) => point.kind === group.kind)}
          trades={linkedTrades}
          timeZone={prefs.timeZone}
          open={adding === group.kind}
          onOpen={() => setAdding(group.kind)}
          onCancel={() => setAdding(null)}
          onAdd={(text, tradeId) => addPoint(group.kind, text, tradeId)}
          onRemove={removePoint}
        />
      ))}

      <section className="day-review-lesson">
        <label>
          <span>Lesson for tomorrow</span>
          <textarea
            value={lessonDraft}
            maxLength={DAILY_REVIEW_LIMITS.lesson}
            rows={3}
            onChange={(event) => setLessonDraft(event.target.value)}
            onBlur={() => { if (lessonDraft !== (review?.lesson ?? "")) save({ lesson: lessonDraft }); }}
            placeholder="One lesson for the next session"
          />
        </label>
        <small className="num">{saveState === "idle" ? "" : `${saveText} · `}{lessonDraft.length}/{DAILY_REVIEW_LIMITS.lesson}</small>
      </section>

      <div className="day-review-actions">
        <button type="button" className="btn-primary" style={{ minHeight: 44 }} aria-pressed={done} onClick={toggleDone}>
          {done ? "✓ Done for the day" : "Done for the day"}
        </button>
        {unreviewed.length > 0 && (
          <button type="button" className="btn-secondary" style={{ minHeight: 44 }} onClick={markReviewed}>
            Also mark {unreviewed.length} linked trades reviewed
          </button>
        )}
        <button type="button" className="btn-secondary" style={{ minHeight: 44 }} onClick={() => setShareOpen(true)} disabled={shareOpen}>
          Share day
        </button>
      </div>

      {shareOpen && (
        <section className="day-share-sheet" role="dialog" aria-label="Share day" style={SHEET_STYLE}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <strong>Share day</strong>
            <button type="button" className="btn-ghost" style={{ minHeight: 44, minWidth: 44 }} onClick={() => setShareOpen(false)}>Close</button>
          </div>
          <label style={{ minHeight: 44, display: "flex", alignItems: "center", gap: 8 }}>
            <input type="checkbox" checked={exportShield} onChange={(event) => setExportShield(event.target.checked)} />
            <span>Shield: hide dollars and contract size</span>
          </label>
          {readyShare
            ? <Image src={readyShare.url} width={readyShare.width} height={readyShare.height} unoptimized alt={`Day sheet for ${date}`} style={{ width: "100%", height: "auto", borderRadius: 12 }} />
            : <p className="muted">Preparing the image…</p>}
          <button type="button" className="btn-primary" style={{ minHeight: 44 }} disabled={!readyShare} onClick={shareDay}>
            Share image
          </button>
        </section>
      )}
    </div>
  );
}

function PointGroup(props: {
  title: string;
  placeholder: string;
  points: ReviewPoint[];
  trades: TradeRecord[];
  timeZone: string;
  open: boolean;
  onOpen: () => void;
  onCancel: () => void;
  onAdd: (text: string, tradeId: string | null) => void;
  onRemove: (id: string) => void;
}) {
  const [text, setText] = useState("");
  const [tradeId, setTradeId] = useState("");
  const label = (id: string) => props.trades.find((trade) => trade.id === id)?.symbol ?? "a trade";
  return (
    <section className="day-review-group">
      <div className="day-review-group-head">
        <h2>{props.title}</h2>
        {!props.open && <button type="button" className="btn-ghost day-review-add" style={{ minHeight: 44, minWidth: 44 }} onClick={props.onOpen}>+ Add</button>}
      </div>
      <ul className="day-review-points">
        {props.points.map((point) => (
          <li key={point.id}>
            <span>{point.text}{point.trade_id ? <span className="muted"> · about {label(point.trade_id)}</span> : null}</span>
            <button type="button" className="btn-ghost" style={{ minHeight: 44, minWidth: 44 }} onClick={() => props.onRemove(point.id)} aria-label={`Delete ${props.title} point`}>Delete</button>
          </li>
        ))}
      </ul>
      {props.open && (
        <form className="day-review-point-form" onSubmit={(event) => { event.preventDefault(); props.onAdd(text, tradeId || null); setText(""); setTradeId(""); }}>
          <textarea value={text} maxLength={DAILY_REVIEW_LIMITS.pointText} rows={2} placeholder={props.placeholder} onChange={(event) => setText(event.target.value)} aria-label={props.title} />
          <div className="day-review-point-row">
            <select value={tradeId} onChange={(event) => setTradeId(event.target.value)} aria-label="About trade">
              <option value="">Whole day</option>
              {props.trades.map((trade) => <option key={trade.id} value={trade.id}>About {trade.symbol} · {formatListTime(trade.entry_time, props.timeZone)}</option>)}
            </select>
            <button type="submit" className="btn-primary" style={{ minHeight: 44 }} disabled={!text.trim()}>Save point</button>
            <button type="button" className="btn-ghost" style={{ minHeight: 44 }} onClick={props.onCancel}>Cancel</button>
          </div>
        </form>
      )}
    </section>
  );
}
