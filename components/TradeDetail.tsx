"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PitStop } from "./PitStop";
import { RiskChips } from "./RiskChips";
import { TradeCardSheet } from "./TradeCardSheet";
import { RStrip } from "./RStrip";
import { TradeChart } from "./TradeChart";
import { TradeLevelEditor } from "./TradeLevelEditor";
import type { ChartExtension, TradeChartHandle } from "./TradeChart";
import { TradeRow } from "./TradeRow";
import { ensureCandles, useCandles } from "@/lib/candles";
import { approx, formatDuration, formatMoney, formatPoints, formatPrice, formatR } from "@/lib/format";
import { usePrefs } from "@/lib/prefs";
import { withSamples } from "@/lib/selectors";
import { formatSessionDate, sessionDate } from "@/lib/session";
import { buildShareCard, shouldBuildShareCard } from "@/lib/shareCard";
import { addTrade, removeTrade, updateTrade, useJournal } from "@/lib/store";
import { formatDetailTime } from "@/lib/time";
import { showToast } from "@/lib/toast";
import { validateTradeAgainstBars } from "@/lib/trade-bar-validation";
import { TIMEFRAMES, TIMEFRAME_MINUTES, defaultTimeframe, isClosed, excursions, fillInsideBar, holdSeconds, processRead, rMultiple, tradePnl, tradePoints } from "@/lib/trades";
import { SAMPLE_CAPTION, SAMPLE_CHIP } from "@/lib/fixtures";
import type { Timeframe, TradeRecord } from "@/lib/trades";
import { useListContext } from "@/lib/ui";
import { DataNotesChip } from "./DataNotesChip";
import { collectDataNotes } from "@/lib/data-notes";
import { buildHindsight, hindsightCollapsedText, hindsightExpandedText } from "@/lib/hindsight";
import type { ChartDetailLevel } from "@/lib/hindsight";

export function TradeDetail({ id }: { id: string }) {
  const journal = useJournal();
  const prefs = usePrefs();
  const context = useListContext();
  const trade = journal.trades.find((item) => item.id === id);

  if (!journal.hydrated) {
    return <div className="page" role="status" aria-label="Loading trade…"><div className="skeleton" style={{ height: 420 }} /></div>;
  }

  if (!trade) {
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
  const [cardOpen, setCardOpen] = useState(false);
  const [cardPrivacy, setCardPrivacy] = useState(prefs.shield);
  const [fitted, setFitted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);
  const [detailLevel, setDetailLevel] = useState<ChartDetailLevel>("medium");
  const [extension, setExtension] = useState<ChartExtension>({ before: 0, after: 0, canBefore: true, canAfter: true });
  const [hindsightOpen, setHindsightOpen] = useState(false);
  const candles = useCandles(trade.id);
  // Until R-03c an open trade has no chart: its candles never load, so this stays null for it.
  const closedTrade = isClosed(trade) ? trade : null;
  const chartRef = useRef<TradeChartHandle>(null);
  const viewMenuRef = useRef<HTMLDivElement>(null);
  const cardBuild = useRef(0);
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
  const renderPrivacy = cardOpen ? cardPrivacy : prefs.shield;
  const setTimeframe = (value: Timeframe) => {
    setChosen(value);
    cardBuild.current += 1;
    setShareBlob(null);
    window.history.replaceState(null, "", `${pathname}?tf=${value}`);
  };

  const go = useCallback((target: TradeRecord | undefined) => { if (target) router.push(`/trades/${target.id}`, { scroll: false }); }, [router]);

  const encodeCard = useCallback((reason: "sheet-open" | "share" | "privacy" | "view-change" | "chart-render") => {
    if (!shouldBuildShareCard(reason, true)) return;
    const snapshot = chartRef.current?.screenshot();
    if (!snapshot) return;
    const build = ++cardBuild.current;
    setShareBlob(null);
    void buildShareCard(snapshot, trade, zone, cardPrivacy)
      .then((blob) => { if (cardBuild.current === build) setShareBlob(blob); })
      .catch(() => { if (cardBuild.current === build) setShareBlob(null); });
  }, [cardPrivacy, trade, zone]);

  // After pan, pinch, fit, or ‹30/30› the live chart redraws. If the sheet is
  // open, rebuild the card from that current view (AC-10). Notes typing still
  // does not encode: the sheet is a dialog, and shouldBuildShareCard("notes")
  // stays false. A leftover blob is dropped when the sheet is closed.
  const onRendered = useCallback(() => {
    if (cardOpen && shouldBuildShareCard("view-change", true)) encodeCard("view-change");
    else if (!cardOpen) setShareBlob((prev) => (prev ? null : prev));
  }, [cardOpen, encodeCard]);

  const openCard = useCallback(() => {
    setCardPrivacy(prefs.shield);
    setShareBlob(null);
    setCardOpen(true);
  }, [prefs.shield]);

  useEffect(() => {
    if (cardOpen) encodeCard("sheet-open");
  }, [cardOpen, cardPrivacy, encodeCard]);

  const closeCard = useCallback(() => {
    if (cardPrivacy !== prefs.shield) {
      cardBuild.current += 1;
      setShareBlob(null);
    }
    setCardOpen(false);
  }, [cardPrivacy, prefs.shield]);

  const changeCardPrivacy = useCallback((privacy: boolean) => {
    setShareBlob(null);
    setCardPrivacy(privacy);
  }, []);

  useEffect(() => {
    if (!viewOpen) return;
    const onPointer = (event: PointerEvent) => {
      if (viewMenuRef.current && !viewMenuRef.current.contains(event.target as Node)) {
        setViewOpen(false);
      }
    };
    window.addEventListener("pointerdown", onPointer);
    return () => window.removeEventListener("pointerdown", onPointer);
  }, [viewOpen]);

  // Keyboard (UX-69): J/K next and previous, F fit, N notes, C Trade Card.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || document.querySelector('[role="dialog"]')) return;
      const target = event.target as HTMLElement | null;
      if (event.key === "Escape") { setFullscreen(false); setViewOpen(false); return; }
      if (target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
      const key = event.key.toLowerCase();
      if (key === "j") go(next);
      else if (key === "k") go(previous);
      else if (key === "f") chartRef.current?.fit();
      else if (key === "[") chartRef.current?.extend("before");
      else if (key === "]") chartRef.current?.extend("after");
      else if (key === "c") openCard();
      else if (key === "n") { event.preventDefault(); document.getElementById("review-note")?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, next, openCard, previous]);

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
  const tone = (pnl ?? 0) > 0 ? "positive" : (pnl ?? 0) < 0 ? "negative" : "";
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
  // A missing bar is a coverage issue, not a fill-alignment issue: only test bars that exist (issue #60).
  const misaligned = useMemo(() => {
    if (!ready || candles.source !== "Yahoo Finance" || trade.is_sample) return false;
    const barMs = baseMinutes * 60_000;
    const barAt = (iso: string) => { const time = Math.floor(Date.parse(iso) / barMs) * barMs; return candles.candles.find((bar) => bar.time === time); };
    const entryBar = barAt(trade.entry_time);
    const exitBar = trade.exit_time == null ? undefined : barAt(trade.exit_time);
    const entryOff = Boolean(entryBar) && !fillInsideBar(trade.entry_price, entryBar, trade.symbol);
    const exitOff = Boolean(exitBar) && trade.exit_price != null && !fillInsideBar(trade.exit_price, exitBar, trade.symbol);
    return entryOff || exitOff;
  }, [ready, candles, trade, baseMinutes]);
  const barCheck = useMemo(() => {
    if (!ready || trade.is_sample) return null;
    return validateTradeAgainstBars(trade, candles.candles, baseMinutes);
  }, [ready, candles, trade, baseMinutes]);
  const hindsight = useMemo(() => {
    if (!ready || !closedTrade) return null;
    return buildHindsight(closedTrade, candles.candles, candles.baseTimeframe);
  }, [ready, closedTrade, candles]);
  const barIssues = barCheck?.issues ?? [];
  const barCoverage = barCheck?.coverage ?? (candles?.status === "none" && !trade.is_sample ? "missing" as const : null);
  // Issue #83: every data-quality note collapses into one chip. Hindsight is not a data note.
  const dataNotes = collectDataNotes({
    noCandles: candles?.status === "none" && !trade.is_sample,
    base: ready ? base : null,
    misaligned,
    ticker: trade.yahoo_ticker,
    coverage: barCoverage,
    chronologyUnresolved: barCheck?.chronology === "unresolved",
    issueCodes: barIssues.map((issue) => issue.code),
  });
  const sourceLabel = candles?.source === "Yahoo Finance" ? "Yahoo" : candles?.source === "Demo fixture" ? "Demo fixture" : "No candles";
  const sourceText = `${trade.yahoo_ticker} · ${sourceLabel} · ${ready ? timeframe : "—"}`;

  return <>
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
              <span className={`direction ${trade.direction === "LONG" ? "long" : "short"}`}><span aria-hidden="true">{trade.direction === "LONG" ? "▲ " : "▼ "}</span>{trade.direction}</span>
              {trade.is_sample && <span className="tag-chip" title={SAMPLE_CAPTION}>{SAMPLE_CHIP}</span>}
            </div>
            <p className="when">{formatSessionDate(sessionDate(trade.entry_time))} · {formatDetailTime(trade.entry_time, zone)} · {formatDuration(holdSeconds(trade))}{prefs.shield ? "" : ` · ${trade.quantity}×`}</p>
            {trade.is_sample && <p className="muted" style={{ fontSize: 11, margin: "4px 0 0" }}>{SAMPLE_CAPTION}</p>}
          </div>
          <div className="headline-result"><b className={tone}>{headline}</b><span>{secondary}</span></div>
        </div>

        {candles?.status === "none" && <DataNotesChip notes={dataNotes} />}
        {candles?.status === "none" ? null : <>
          <div className={`chart-card specular-card ${fullscreen ? "fullscreen" : ""}`}>
          <div className="chart-toolbar">
            <div className="timeframes" role="group" aria-label="Timeframe">
              {TIMEFRAMES.map((value) => <button key={value} type="button" aria-pressed={value === timeframe} disabled={TIMEFRAME_MINUTES[value] < baseMinutes} onClick={() => setTimeframe(value)}>{value}</button>)}
            </div>
            <div className="view-menu-wrapper" ref={viewMenuRef}>
              <button
                type="button"
                className="tool-button view-button"
                aria-expanded={viewOpen}
                aria-haspopup="true"
                aria-label="Chart view options"
                onClick={() => setViewOpen((open) => !open)}
              >
                <span>View</span>
                <svg viewBox="0 0 16 16" fill="currentColor" width="12" height="12" aria-hidden="true">
                  <path d="M4.5 6L8 9.5 11.5 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                </svg>
              </button>
              {viewOpen && (
                <div className="view-menu" role="menu" aria-label="Chart view options">
                  <div className="view-menu-section">
                    <button
                      type="button"
                      className="view-menu-item"
                      role="menuitem"
                      onClick={() => {
                        chartRef.current?.fit();
                        setViewOpen(false);
                      }}
                      title="Fit the trade (F)"
                    >
                      <span>{fitted ? "Fitted ✓" : "Fit trade"}</span>
                      <span className="shortcut">F</span>
                    </button>
                  </div>
                  <div className="view-menu-section">
                    <span className="view-menu-label">Continuation</span>
                    <div className="view-menu-toggle-group" role="group" aria-label="Chart detail">
                      <button
                        type="button"
                        aria-pressed={detailLevel === "low"}
                        onClick={() => setDetailLevel("low")}
                        title="No post-exit continuation"
                      >
                        <span>Simple</span>
                        <small>No extra</small>
                      </button>
                      <button
                        type="button"
                        aria-pressed={detailLevel === "medium"}
                        onClick={() => setDetailLevel("medium")}
                        title="Dotted continuation on"
                      >
                        <span>After exit</span>
                        <small>Continuation</small>
                      </button>
                    </div>
                  </div>
                  <div className="view-menu-section">
                    <button
                      type="button"
                      className="view-menu-item"
                      role="menuitem"
                      onClick={() => {
                        setFullscreen(!fullscreen);
                        setViewOpen(false);
                      }}
                      title={fullscreen ? "Exit full screen" : "Full-screen chart"}
                    >
                      <span>{fullscreen ? "Exit full screen" : "Full screen"}</span>
                      <span className="shortcut">{fullscreen ? "Esc" : ""}</span>
                    </button>
                  </div>
                  <div className="view-menu-section">
                    <span className="view-menu-label">Extend range</span>
                    <div className="view-menu-row">
                      <button
                        type="button"
                        className="tool-button"
                        disabled={!extension.canBefore}
                        title={extension.canBefore ? "Show 30 earlier bars ([)" : "No more candles"}
                        aria-label={extension.canBefore ? "Show 30 earlier bars" : "No more candles"}
                        onClick={() => chartRef.current?.extend("before")}
                      >
                        ‹ 30 earlier
                      </button>
                      <button
                        type="button"
                        className="tool-button"
                        disabled={!extension.canAfter}
                        title={extension.canAfter ? "Show 30 later bars (])" : "No more candles"}
                        aria-label={extension.canAfter ? "Show 30 later bars" : "No more candles"}
                        onClick={() => chartRef.current?.extend("after")}
                      >
                        30 later ›
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="chart-frame">
            {ready && closedTrade ? (
              <>
                <TradeChart ref={chartRef} trade={closedTrade} candles={candles.candles} baseTimeframe={base} timeframe={timeframe} zone={zone} privacy={renderPrivacy} readout={readoutRef} onRendered={onRendered} onFitChange={setFitted} detailLevel={detailLevel} onExtensionChange={setExtension} />
                <button
                  type="button"
                  className="chart-edge-hit left"
                  disabled={!extension.canBefore}
                  title={extension.canBefore ? "Show 30 earlier bars ([)" : "No more candles"}
                  aria-label={extension.canBefore ? "Show 30 earlier bars" : "No more candles"}
                  onClick={() => chartRef.current?.extend("before")}
                >
                  ‹
                </button>
                <button
                  type="button"
                  className="chart-edge-hit right"
                  disabled={!extension.canAfter}
                  title={extension.canAfter ? "Show 30 later bars (])" : "No more candles"}
                  aria-label={extension.canAfter ? "Show 30 later bars" : "No more candles"}
                  onClick={() => chartRef.current?.extend("after")}
                >
                  ›
                </button>
              </>
            ) : (
              <div className="chart-skeleton" role="status"><div className="skeleton" /><span>Loading candles…</span></div>
            )}
          </div>
          <div className="chart-source">
            <span className="source-text">{sourceText}</span>
            <span className="readout num" ref={readoutRef} aria-hidden="true" />
            <span className="source-text">{candles?.fetching ? "Checking Yahoo…" : ""}</span>
          </div>
          <DataNotesChip notes={dataNotes} />
          {hindsight && detailLevel === "low" && (
            <div className="chart-note fact" aria-label="After the exit — hindsight">
              <button type="button" className={`hindsight-line${hindsightOpen ? " open" : ""}`} aria-expanded={hindsightOpen} onClick={() => setHindsightOpen((open) => !open)}>
                {hindsightOpen ? hindsightExpandedText(hindsight) : hindsightCollapsedText(hindsight, "low")}
              </button>
            </div>
          )}
          {hindsight && detailLevel !== "low" && (
            <div className="chart-note fact" aria-label="After the exit — hindsight">
              <button type="button" className="tool-button" aria-expanded={hindsightOpen} onClick={() => setHindsightOpen((open) => !open)}>
                After the exit — hindsight
              </button>
              <span>{hindsightOpen ? hindsightExpandedText(hindsight) : hindsightCollapsedText(hindsight, detailLevel)}</span>
            </div>
          )}
          </div>


          <div className="detail-actions">
            <button type="button" className="btn-primary" disabled={!ready} onClick={openCard}>{ready ? "Trade Card" : "Trade Card needs candles"}</button>
          </div>
        </>}

        <div className="trade-levels-card specular-card">
          <RStrip trade={trade} excursions={ex} size="detail" />
          <div className="levels">
            <div><small>ENTRY</small><b>{formatPrice(trade.entry_price, trade.symbol)}</b></div>
            <div><small>EXIT</small><b>{formatPrice(trade.exit_price, trade.symbol)}</b></div>
            <TradeLevelEditor trade={trade} field="stop_loss_price" />
            <TradeLevelEditor trade={trade} field="planned_target_price" />
            <TradeLevelEditor trade={trade} field="key_level_price" />
            <div title={ex?.coverage === "partial" ? "Partial: some bars in the hold are missing, so this is not a complete measurement." : "Worst price against you during the hold, estimated from bars"}><small>HEAT (MAE){ex?.coverage === "partial" ? " · partial" : ""}</small><b className={mae == null ? "empty" : ""}>{mae == null ? "—" : approx(formatPoints(Math.min(0, mae), trade.symbol))}</b></div>
            <div title={ex?.coverage === "partial" ? "Partial: some bars in the hold are missing, so this is not a complete measurement." : "Best price in your favour during the hold, estimated from bars"}><small>BEST (MFE){ex?.coverage === "partial" ? " · partial" : ""}</small><b className={mfe == null ? "empty" : ""}>{mfe == null ? "—" : approx(formatPoints(Math.max(0, mfe), trade.symbol))}</b></div>
          </div>
          {trade.stop_loss_price == null && <RiskChips trade={trade} budgetUsd={prefs.riskBudgetUsd} shield={prefs.shield} />}
        </div>

        <div className="pager">
          <button type="button" aria-label="Previous trade (K)" disabled={!previous} onClick={() => go(previous)}>‹ Prev</button>
          <span className="where num">{index >= 0 ? `${index + 1} / ${list.length}` : ""} · {listLabel}</span>
          <button type="button" aria-label="Next trade (J)" disabled={!next} onClick={() => go(next)}>Next ›</button>
        </div>
      </section>

      <aside className="detail-side">
        <section className="specular-card card-pad">
          <div className="card-head"><h3>Pit Stop</h3><span>{trade.review_status === "reviewed" ? "Reviewed ✓" : trade.review_status === "tagged" ? "Tagged" : "Needs tags"} · private</span></div>
          <PitStop trade={trade} />
        </section>
        <div className="review-actions">
          <button type="button" className="icon-button" aria-pressed={trade.flagged} aria-label={trade.flagged ? "Flagged for the weekly review. Tap to unflag." : "Flag for the weekly review"} title="Flag for the weekly review" onClick={() => updateTrade(trade.id, { flagged: !trade.flagged })}><span aria-hidden="true">⚑</span></button>
          {trade.review_status === "reviewed"
            ? <button type="button" className="btn-secondary" onClick={() => updateTrade(trade.id, { review_status: "new" })}>Reviewed ✓ · Reopen</button>
            : <button type="button" className="btn-primary" onClick={() => { updateTrade(trade.id, { review_status: "reviewed" }); showToast("Marked reviewed", { label: "Undo", run: () => updateTrade(trade.id, { review_status: "new" }) }); }}>Mark reviewed</button>}
        </div>
        {trade.take_again && <p className="note-state" style={{ textAlign: "left" }}>Blind review: you said <b>{trade.take_again === "yes" ? "take it again" : trade.take_again === "smaller" ? "take it smaller" : "pass"}</b> before seeing the result.</p>}
        {!trade.is_sample && <button type="button" className="btn-danger-ghost" onClick={removeThis}>Remove this trade</button>}
      </aside>
    </div>
    {cardOpen && <TradeCardSheet trade={trade} blob={shareBlob} privacy={cardPrivacy} onPrivacyChange={changeCardPrivacy} onClose={closeCard} />}
  </>;
}
