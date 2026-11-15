"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PitStop } from "./PitStop";
import { RiskChips } from "./RiskChips";
import { TradeChart } from "./TradeChart";
import type { TradeChartHandle } from "./TradeChart";
import { TradeRow } from "./TradeRow";
import { ensureCandles, useCandles } from "@/lib/candles";
import { approx, formatDuration, formatMoney, formatPoints, formatPrice, formatR } from "@/lib/format";
import { usePrefs } from "@/lib/prefs";
import { withSamples } from "@/lib/selectors";
import { formatSessionDate, sessionDate } from "@/lib/session";
import { buildShareCard } from "@/lib/shareCard";
import { addTrade, removeTrade, updateTrade, useJournal } from "@/lib/store";
import { formatDetailTime } from "@/lib/time";
import { showToast } from "@/lib/toast";
import { TIMEFRAMES, TIMEFRAME_MINUTES, defaultTimeframe, excursions, fillInsideBar, holdSeconds, processRead, rMultiple, tradePnl, tradePoints } from "@/lib/trades";
import type { Timeframe, TradeRecord } from "@/lib/trades";
import { useListContext } from "@/lib/ui";

export function TradeDetail({ id }: { id: string }) {
  const journal = useJournal();
  const prefs = usePrefs();
  const context = useListContext();
  const trade = journal.trades.find((item) => item.id === id);

  if (!trade) {
    if (!journal.hydrated) return <div className="page"><div className="skeleton" style={{ height: 420 }} /></div>;
    return (
      <div className="page"><div className="specular-card empty-state">
        <h3>This trade is not on this device</h3>
        <p>Trades are stored on the device they were entered on. It may have been removed, or the link came from another device.</p>
        <div className="actions"><Link className="btn-secondary" href="/feed">Open the feed</Link></div>
      </div></div>
    );
  }

  // Previous and next follow the list the trade was opened from (UX-11).
  const visible = withSamples(journal.trades, prefs.showSamples);
  const fromContext = context?.ids.includes(id) ? context.ids.flatMap((item) => journal.trades.find((candidate) => candidate.id === item) ?? []) : null;
  const list = fromContext ?? visible;
  const listLabel = fromContext ? context!.label : "All trades";
  const backHref = fromContext ? context!.href : "/feed";

  return <DetailBody key={trade.id} trade={trade} list={list} listLabel={listLabel} backHref={backHref} />;
}

function DetailBody({ trade, list, listLabel, backHref }: { trade: TradeRecord; list: TradeRecord[]; listLabel: string; backHref: string }) {
  const prefs = usePrefs();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const zone = prefs.timeZone;
  const [chosen, setChosen] = useState<Timeframe>(() => {
    const fromUrl = searchParams.get("tf") as Timeframe | null;
    return fromUrl && TIMEFRAMES.includes(fromUrl) ? fromUrl : defaultTimeframe(holdSeconds(trade));
  });
  const [shareBlob, setShareBlob] = useState<Blob | null>(null);
  const [fitted, setFitted] = useState(true);
  const [xray, setXray] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const candles = useCandles(trade.id);
  const chartRef = useRef<TradeChartHandle>(null);
  const readoutRef = useRef<HTMLSpanElement>(null);
  const swipeStart = useRef<{ x: number; y: number } | null>(null);

  const index = list.findIndex((item) => item.id === trade.id);
  const previous = index > 0 ? list[index - 1] : undefined;
  const next = index >= 0 && index < list.length - 1 ? list[index + 1] : undefined;

  useEffect(() => { ensureCandles(trade); }, [trade]);
  // Neighbours are warmed up so stepping through the list is instant (docs/08 §2).
  useEffect(() => { if (previous) ensureCandles(previous); if (next) ensureCandles(next); }, [previous, next]);

  // A timeframe finer than what was captured cannot be drawn; show the best available one and say so (B-11).
  const base = candles?.baseTimeframe ?? "1m";
  const timeframe = TIMEFRAME_MINUTES[chosen] < TIMEFRAME_MINUTES[base] ? base : chosen;
  const setTimeframe = (value: Timeframe) => {
    setChosen(value);
    setShareBlob(null);
    window.history.replaceState(null, "", `${pathname}?tf=${value}`);
  };

  const go = useCallback((target: TradeRecord | undefined) => { if (target) router.push(`/trades/${target.id}`, { scroll: false }); }, [router]);

  const onRendered = useCallback(() => {
    const snapshot = chartRef.current?.screenshot();
    if (snapshot) void buildShareCard(snapshot, trade, zone).then(setShareBlob).catch(() => setShareBlob(null));
  }, [trade, zone]);

  const shareCard = useCallback(async () => {
    if (!shareBlob) return;
    const file = new File([shareBlob], `${trade.symbol}-trade-card.png`, { type: "image/png" });
    try {
      if (navigator.share && navigator.canShare?.({ files: [file] })) await navigator.share({ title: `${trade.symbol} trade review`, files: [file] });
      else {
        const link = document.createElement("a");
        link.href = URL.createObjectURL(shareBlob);
        link.download = file.name;
        link.click();
        showToast("Trade card downloaded");
      }
    } catch (error) { if ((error as DOMException).name !== "AbortError") showToast("Share failed"); }
  }, [shareBlob, trade.symbol]);

  // Keyboard (UX-69): J/K next and previous, F fit, N notes, C Trade Card. X (hold for X-Ray) lives in the chart.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (event.key === "Escape") { setFullscreen(false); return; }
      if (target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
      const key = event.key.toLowerCase();
      if (key === "j") go(next);
      else if (key === "k") go(previous);
      else if (key === "f") chartRef.current?.fit();
      else if (key === "c") void shareCard();
      else if (key === "n") { event.preventDefault(); document.getElementById("review-note")?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, next, previous, shareCard]);

  // Trade-to-trade swipe lives on the header strip only, never on the chart (UX-40).
  const onSwipeEnd = (event: React.PointerEvent) => {
    const start = swipeStart.current;
    swipeStart.current = null;
    if (!start) return;
    const dx = event.clientX - start.x;
    if (Math.abs(dx) < 64 || Math.abs(event.clientY - start.y) > 40) return;
    go(dx < 0 ? next : previous);
  };

  const removeThis = () => {
    const removed = removeTrade(trade.id);
    if (!removed) return;
    showToast("Trade removed", { label: "Undo", run: () => addTrade(removed) });
    router.push(backHref);
  };

  const pnl = tradePnl(trade);
  const r = rMultiple(trade);
  const tone = pnl > 0 ? "positive" : pnl < 0 ? "negative" : "";
  const sign = trade.direction === "LONG" ? 1 : -1;
  const points = formatPoints(tradePoints(trade), trade.symbol);
  const headline = prefs.shield ? (r != null ? formatR(r) : points) : formatMoney(pnl);
  const secondary = prefs.shield ? (r != null ? points : "—R") : formatR(r);

  const ready = candles?.status === "ready";
  const baseMinutes = TIMEFRAME_MINUTES[base];
  const ex = useMemo(() => (ready ? excursions(trade, candles.candles, baseMinutes) : null), [ready, candles, trade, baseMinutes]);
  const mae = ex ? (ex.maePrice - trade.entry_price) * sign : null;
  const mfe = ex ? (ex.mfePrice - trade.entry_price) * sign : null;
  // Do the fills sit inside the bars they are drawn on? If not, say so instead of looking like a bug (B-12).
  const misaligned = useMemo(() => {
    if (!ready || candles.source !== "Yahoo Finance" || trade.is_sample) return false;
    const barMs = baseMinutes * 60_000;
    const barAt = (iso: string) => { const time = Math.floor(Date.parse(iso) / barMs) * barMs; return candles.candles.find((bar) => bar.time === time); };
    return !fillInsideBar(trade.entry_price, barAt(trade.entry_time), trade.symbol) || !fillInsideBar(trade.exit_price, barAt(trade.exit_time), trade.symbol);
  }, [ready, candles, trade, baseMinutes]);
  const sourceText = `${trade.yahoo_ticker} · ${candles?.source === "Yahoo Finance" ? "Yahoo" : candles?.source === "Demo fixture" ? "Sample candles, not market data" : "No candles"} · ${ready ? timeframe : "—"}`;

  return (
    <div className="detail-layout">
      <aside className="detail-rail" aria-label={`Trades: ${listLabel}`}>
        <h2>{listLabel}</h2>
        <div className="trade-list">{list.map((item) => <TradeRow key={item.id} trade={item} zone={zone} shield={prefs.shield} current={item.id === trade.id} />)}</div>
      </aside>

      <section className="detail-main">
        <div className="trade-header" data-process={processRead(trade) ?? undefined} onPointerDown={(event) => { swipeStart.current = { x: event.clientX, y: event.clientY }; }} onPointerUp={onSwipeEnd} onPointerCancel={() => { swipeStart.current = null; }}>
          <Link className="nav-button" href={backHref} aria-label={`Back to ${listLabel}`}>←</Link>
          <div className="head-main">
            <div className="title-line">
              <h1>{trade.symbol}</h1>
              <span className={`direction ${trade.direction === "LONG" ? "long" : "short"}`}>{trade.direction === "LONG" ? "▲ LONG" : "▼ SHORT"}</span>
              {trade.is_sample && <span className="tag-chip">SAMPLE</span>}
            </div>
            <p className="when">{formatSessionDate(sessionDate(trade.entry_time))} · {formatDetailTime(trade.entry_time, zone)} · {formatDuration(holdSeconds(trade))}{prefs.shield ? "" : ` · ${trade.quantity}×`}</p>
          </div>
          <div className="headline-result"><b className={tone}>{headline}</b><span>{secondary}</span></div>
        </div>

        {candles?.status !== "none" && <>
          <div className={`chart-card specular-card ${fullscreen ? "fullscreen" : ""}`}>
          <div className="chart-toolbar">
            <div className="timeframes" role="group" aria-label="Timeframe">
              {TIMEFRAMES.map((value) => <button key={value} aria-pressed={value === timeframe} disabled={TIMEFRAME_MINUTES[value] < baseMinutes} onClick={() => setTimeframe(value)}>{value}</button>)}
            </div>
            <div className="chart-tools">
              {!fitted && <button className="tool-button attention" onClick={() => chartRef.current?.fit()} title="Fit the trade (F)">Fit</button>}
              <button className="tool-button" aria-pressed={xray} aria-label="X-Ray: fade the position box" title="X-Ray: fade the box to read the candles (hold X)" onClick={() => { chartRef.current?.setXray(!xray); setXray(!xray); }}>X-Ray</button>
              <button className="tool-button" aria-pressed={fullscreen} aria-label={fullscreen ? "Exit full screen" : "Full-screen chart"} onClick={() => setFullscreen(!fullscreen)}>
                {fullscreen ? "Done" : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>}
              </button>
            </div>
          </div>
          <div className="chart-frame">
            {ready ? (
              <TradeChart ref={chartRef} trade={trade} candles={candles.candles} baseTimeframe={base} timeframe={timeframe} zone={zone} privacy={prefs.shield} readout={readoutRef} onRendered={onRendered} onFitChange={setFitted} />
            ) : (
              <div className="chart-skeleton"><div className="skeleton" /><span>Loading candles…</span></div>
            )}
          </div>
          <div className="chart-source">
            <span className="source-text">{sourceText}</span>
            <span className="readout num" ref={readoutRef} aria-hidden="true" />
            <span className="source-text">{candles?.fetching ? "Checking Yahoo…" : ""}</span>
          </div>
          {ready && base !== "1m" && <div className="chart-note"><span>1m data was not captured for this trade — showing {base} bars.</span></div>}
          {ready && candles.source === "Demo fixture" && !candles.fetching && <div className="chart-note"><span>Sample candles. Real market data was not available.</span><button onClick={() => ensureCandles(trade, true)}>Retry</button></div>}
          {misaligned && <div className="chart-note"><span>Candles are from the {trade.yahoo_ticker} continuous contract. Your fills may sit slightly off the bars.</span></div>}
          <div className="levels">
            <div><small>ENTRY</small><b>{formatPrice(trade.entry_price, trade.symbol)}</b></div>
            <div><small>EXIT</small><b>{formatPrice(trade.exit_price, trade.symbol)}</b></div>
            <div><small>STOP</small><b className={trade.stop_loss_price == null ? "empty" : ""}>{formatPrice(trade.stop_loss_price, trade.symbol)}</b></div>
            <div><small>TARGET</small><b className={trade.planned_target_price == null ? "empty" : ""}>{formatPrice(trade.planned_target_price, trade.symbol)}</b></div>
            <div title="Worst price against you during the hold, estimated from bars"><small>HEAT (MAE)</small><b className={mae == null ? "empty" : ""}>{mae == null ? "—" : approx(formatPoints(Math.min(0, mae), trade.symbol))}</b></div>
            <div title="Best price in your favour during the hold, estimated from bars"><small>BEST (MFE)</small><b className={mfe == null ? "empty" : ""}>{mfe == null ? "—" : approx(formatPoints(Math.max(0, mfe), trade.symbol))}</b></div>
          </div>
          {trade.stop_loss_price == null && <RiskChips trade={trade} budgetUsd={prefs.riskBudgetUsd} />}
          </div>

          <div className="detail-actions">
            <button className="btn-primary" disabled={!shareBlob} onClick={shareCard}>{shareBlob ? "Share Trade Card" : ready ? "Preparing card…" : "Trade Card needs candles"}</button>
          </div>
        </>}

        <div className="pager">
          <button aria-label="Previous trade (K)" disabled={!previous} onClick={() => go(previous)}>‹ Prev</button>
          <span className="where num">{index >= 0 ? `${index + 1} / ${list.length}` : ""} · {listLabel}</span>
          <button aria-label="Next trade (J)" disabled={!next} onClick={() => go(next)}>Next ›</button>
        </div>
      </section>

      <aside className="detail-side">
        <section className="specular-card card-pad">
          <div className="card-head"><h3>Pit Stop</h3><span>{trade.review_status === "reviewed" ? "Reviewed ✓" : trade.review_status === "tagged" ? "Tagged" : "Needs tags"} · private</span></div>
          <PitStop trade={trade} />
        </section>
        <div className="review-actions">
          <button className="icon-button" aria-pressed={trade.flagged} aria-label={trade.flagged ? "Flagged for the weekly review. Tap to unflag." : "Flag for the weekly review"} title="Flag for the weekly review" onClick={() => updateTrade(trade.id, { flagged: !trade.flagged })}>⚑</button>
          {trade.review_status === "reviewed"
            ? <button className="btn-secondary" onClick={() => updateTrade(trade.id, { review_status: "new" })}>Reviewed ✓ · Reopen</button>
            : <button className="btn-primary" onClick={() => { updateTrade(trade.id, { review_status: "reviewed" }); showToast("Marked reviewed", { label: "Undo", run: () => updateTrade(trade.id, { review_status: "new" }) }); }}>Mark reviewed</button>}
        </div>
        {trade.take_again && <p className="note-state" style={{ textAlign: "left" }}>Blind review: you said <b>{trade.take_again === "yes" ? "take it again" : trade.take_again === "smaller" ? "take it smaller" : "pass"}</b> before seeing the result.</p>}
        {!trade.is_sample && <button className="btn-danger-ghost" onClick={removeThis}>Remove this trade</button>}
      </aside>
    </div>
  );
}
