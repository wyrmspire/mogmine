"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CloseTradeSheet } from "./CloseTradeSheet";
import { MoodCard } from "./MoodCard";
import { AccountSelect } from "./AccountSelect";
import { MoodEditorSheet } from "./MoodEditorSheet";
import { MoodShape, useTradeMood } from "./MoodShape";
import { ONE_TAP_MOOD_SCORE, dominantSpoke, spokeChipLabel } from "@/lib/mood";
import { recordUserMood, setSpokeScore, undoMoodRecord, useMood } from "@/lib/mood-store";
import { EXIT_REASONS } from "@/lib/trades";
import { PitStop } from "./PitStop";
import { RiskChips } from "./RiskChips";
import { RiskLine } from "./RiskLine";
import { useAccounts } from "@/lib/accounts-store";
import { resolveRSize, resultR, riskR } from "@/lib/r-size";
import { StopMovesEditor } from "./StopMovesEditor";
import { TradeCardSheet } from "./TradeCardSheet";
import { RStrip } from "./RStrip";
import { TradeChart } from "./TradeChart";
import { LevelsDisclosureList } from "./LevelCard";
import { TradeLevelEditor } from "./TradeLevelEditor";
import type { ChartExtension, TradeChartHandle } from "./TradeChart";
import { TradeRow } from "./TradeRow";
import { useTradeLevels } from "./useTradeLevels";
import { joinSessionBars, tradeSessionVwapReport, vwapOnBars } from "@/lib/chart-indicators";
import type { VwapPoint } from "@/lib/chart-indicators";
import { ema200Status, emaOnBars } from "@/lib/ema";
import { hasRealVolume } from "@/lib/volume";
import { levelsStatusText, levelsTitle, withheldText } from "@/lib/level-withheld";
import { FRESH_EXIT_MS, ensureCandles, exitIsFresh, useCandles } from "@/lib/candles";
import { calculateExitEfficiency } from "@/lib/exit-efficiency";
import { stopHistoryText } from "@/lib/risk-text";
import { noCandlesMessage } from "@/lib/market-data/outcome";
import { findNeighbourTrades } from "@/lib/neighbour-trades";
import { derivePlanVsActual } from "@/lib/plan-vs-actual";
import { approx, formatDuration, formatMoney, formatPoints, formatPrice, formatR } from "@/lib/format";
import { setPrefs, usePrefs } from "@/lib/prefs";
import { withSamples } from "@/lib/selectors";
import { formatSessionDate, sessionDate } from "@/lib/session";
import { buildShareCard, shouldBuildShareCard } from "@/lib/shareCard";
import type { CardSide, CardSize } from "@/lib/shareCard";
import { addTrade, removeTrade, updateTrade, useJournal } from "@/lib/store";
import { formatDetailTime, formatListTime } from "@/lib/time";
import { showToast } from "@/lib/toast";
import { observeTrade, validateTradeAgainstBars } from "@/lib/trade-bar-validation";
import { deriveTrade, fromLegacy } from "@/lib/trade-document";
import { buildMarks } from "@/lib/trade-marks";
import type { DetailLevel, Mark } from "@/lib/trade-marks";
import { TIMEFRAMES, TIMEFRAME_MINUTES, aggregateCandles, defaultTimeframe, isOpen, excursions, fillInsideBar, holdSeconds, processRead, tradePnl, tradePoints } from "@/lib/trades";
import { SAMPLE_CAPTION, SAMPLE_CHIP } from "@/lib/fixtures";
import type { Timeframe, TradeRecord } from "@/lib/trades";
import { useListContext, useOnline } from "@/lib/ui";
import { getCandleFreshness } from "@/lib/freshness";
import { DataNotesChip } from "./DataNotesChip";
import { PartialsCard, PlanVsActualSection } from "./PartialsCard";
import { collectDataNotes } from "@/lib/data-notes";
import { checkExitStopConsistency } from "@/lib/stop-facts";
import { StopFacts } from "./StopFacts";
import { buildHindsight, hindsightCollapsedText, hindsightExpandedText } from "@/lib/hindsight";

const NO_VWAP: readonly VwapPoint[] = [];

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
  // R size in dollars for this trade: its frozen size, else its account's, else the Default R size (04 §3.2).
  const accountsState = useAccounts();
  const accountName = accountsState.accounts.find((account) => account.id === trade.account_id)?.name ?? null;
  const undatedExit = trade.exit_time != null && !Number.isFinite(Date.parse(trade.exit_time));
  const [chosen, setChosen] = useState<Timeframe>(() => {
    const fromUrl = searchParams.get("tf") as Timeframe | null;
    return fromUrl && TIMEFRAMES.includes(fromUrl) ? fromUrl : defaultTimeframe(holdSeconds(trade));
  });
  const [shareBlob, setShareBlob] = useState<Blob | null>(null);
  const [cardOpen, setCardOpen] = useState(false);
  const [cardPrivacy, setCardPrivacy] = useState(prefs.shield);
  const [cardSize, setCardSize] = useState<CardSize>("4:5");
  const [cardSide, setCardSide] = useState<CardSide>("front");
  const [fitted, setFitted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);
  const [showLevels, setShowLevels] = useState(true);
  // LB-B2: the level row a keyboard or pointer is on in the View list; its ray's card opens on the chart.
  const [highlightedTick, setHighlightedTick] = useState<number | null>(null);
  // IND-1: the VWAP anchor is remembered in prefs (default "off"); drill, review and playbook charts do not read it.
  const vwapAnchor = prefs.vwapAnchor;
  const [detailLevel, setDetailLevel] = useState<DetailLevel>("medium");
  const [extension, setExtension] = useState<ChartExtension>({ before: 0, after: 0, canBefore: true, canAfter: true });
  const [hindsightOpen, setHindsightOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const closeSheet = useCallback(() => setClosing(false), [setClosing]);
  const [moodOpen, setMoodOpen] = useState(false);
  const closeMood = useCallback(() => setMoodOpen(false), [setMoodOpen]);
  const mood = useTradeMood(trade);
  const moodState = useMood();
  const candles = useCandles(trade.id);
  const chartRef = useRef<TradeChartHandle>(null);
  const viewMenuRef = useRef<HTMLDivElement>(null);
  const cardBuild = useRef(0);
  const readoutRef = useRef<HTMLSpanElement>(null);
  const swipeStart = useRef<{ x: number; y: number } | null>(null);

  const index = list.findIndex((item) => item.id === trade.id);
  const previous = index > 0 ? list[index - 1] : undefined;
  const next = index >= 0 && index < list.length - 1 ? list[index + 1] : undefined;

  useEffect(() => { ensureCandles(trade); }, [trade]);
  // Fresh trades: Yahoo publishes the newest bars late, so ask again while this trade is on screen and
  // when the page comes back. ensureCandles only fetches when a retry is due (R-02). Samples never poll (#89).
  useEffect(() => {
    if (trade.is_sample) return;
    const check = () => { if (document.visibilityState === "visible") ensureCandles(trade); };
    const timer = window.setInterval(check, 60_000);
    document.addEventListener("visibilitychange", check);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", check); };
  }, [trade]);
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

  const encodeCard = useCallback((
    reason: "sheet-open" | "share" | "privacy" | "view-change" | "chart-render",
    size: CardSize = cardSize,
    side: CardSide = cardSide,
    privacy: boolean = cardPrivacy,
  ) => {
    if (!shouldBuildShareCard(reason, true)) return;
    const snapshot = chartRef.current?.screenshot();
    if (!snapshot) return;
    const build = ++cardBuild.current;
    setShareBlob(null);
    void buildShareCard(snapshot, trade, zone, privacy, mood, { size, side })
      .then((blob) => { if (cardBuild.current === build) setShareBlob(blob); })
      .catch(() => { if (cardBuild.current === build) setShareBlob(null); });
  }, [cardPrivacy, cardSide, cardSize, mood, trade, zone]);

  // After pan, pinch, fit, or ‹30/30› the live chart redraws. If the sheet is
  // open, rebuild the card from that current view (AC-10). Notes typing still
  // does not encode: the sheet is a dialog, and shouldBuildShareCard("notes")
  // stays false. A leftover blob is dropped when the sheet is closed.
  const onRendered = useCallback(() => {
    if (cardOpen && shouldBuildShareCard("view-change", true)) encodeCard("view-change", cardSize, cardSide, cardPrivacy);
    else if (!cardOpen) setShareBlob((prev) => (prev ? null : prev));
  }, [cardOpen, cardPrivacy, cardSide, cardSize, encodeCard]);

  const openCard = useCallback(() => {
    // OD-46 (a): Share opens with Shield on by default
    setCardPrivacy(true);
    setCardSize("4:5");
    setCardSide("front");
    setShareBlob(null);
    setCardOpen(true);
  }, []);

  useEffect(() => {
    if (cardOpen) encodeCard("sheet-open", cardSize, cardSide, cardPrivacy);
  }, [cardOpen, cardPrivacy, cardSize, cardSide, encodeCard]);

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

  const changeCardSize = useCallback((size: CardSize) => {
    setShareBlob(null);
    setCardSize(size);
  }, []);

  const changeCardSide = useCallback((side: CardSide) => {
    setShareBlob(null);
    setCardSide(side);
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
  const rSize = resolveRSize(trade, accountsState.accounts, prefs);
  const r = resultR(trade, rSize);
  const stopHistory = stopHistoryText(trade, (iso) => formatListTime(iso, zone));
  const tone = (pnl ?? 0) > 0 ? "positive" : (pnl ?? 0) < 0 ? "negative" : "";
  const sign = trade.direction === "LONG" ? 1 : -1;
  const points = formatPoints(tradePoints(trade), trade.symbol);
  // An open trade shows `Open` where the result goes, and nothing else (OD-38). Its chart runs
  // from the entry bar to the last loaded bar, with no exit (R-03c).
  const open = isOpen(trade);
  const headline = open ? "Open" : prefs.shield ? (r != null ? formatR(r) : points) : formatMoney(pnl);
  const secondary = open ? "" : prefs.shield ? (r != null ? points : "—R") : formatR(r);

  const ready = candles?.status === "ready";
  const baseMinutes = TIMEFRAME_MINUTES[base];
  const displayedBars = useMemo(() => {
    if (!ready) return null;
    return timeframe === base ? candles.candles : aggregateCandles(candles.candles, timeframe);
  }, [ready, candles, base, timeframe]);
  const derived = useMemo(() => deriveTrade(fromLegacy(trade)), [trade]);
  const observation = useMemo(
    () => displayedBars && observeTrade(derived, displayedBars, TIMEFRAME_MINUTES[timeframe]),
    [derived, displayedBars, timeframe],
  );
  const showEarlier = extension.before > 0;
  const keyPrice = trade.key_level_price;
  const neighbours = useMemo(() => findNeighbourTrades(trade, list), [trade, list]);
  const marks = useMemo(() => {
    if (!displayedBars?.length) return [];
    const candleTimes = displayedBars.map(({ time }) => time);
    const accountRiskR = riskR(trade, resolveRSize(trade, accountsState.accounts, prefs));
    const marks = buildMarks(derived, observation, timeframe, detailLevel, renderPrivacy, {
      candleTimes, continuationEdges: { before: showEarlier }, showRuler: detailLevel === "high", accountRiskR,
    });
    if (keyPrice != null) {
      const keyLevel: Mark = {
        kind: "segment", layer: "plan", tone: "muted", dash: "dotted", faint: true, paneEdge: "both",
        t0: candleTimes[0], t1: candleTimes[candleTimes.length - 1], p0: keyPrice, p1: keyPrice,
      };
      marks.push(keyLevel);
    }
    // K (#40): Neighbouring archived trades in view rendered as faint boxes
    for (const nb of neighbours) {
      const nbEntryMs = Date.parse(nb.entryTime);
      const nbExitMs = nb.exitTime ? Date.parse(nb.exitTime) : nbEntryMs;
      const t0 = Math.min(nbEntryMs, nbExitMs);
      const t1 = Math.max(nbEntryMs, nbExitMs);
      if (t1 >= candleTimes[0] && t0 <= candleTimes[candleTimes.length - 1] && nb.exitPrice != null) {
        marks.push({
          kind: "zone",
          layer: "archived",
          style: "faint",
          tone: nb.isProfit ? "profit" : "risk",
          opacityMultiplier: nb.opacity,
          t0,
          t1,
          p0: nb.entryPrice,
          p1: nb.exitPrice,
        });
      }
    }
    return marks;
  }, [displayedBars, derived, observation, timeframe, detailLevel, renderPrivacy, showEarlier, keyPrice, neighbours, trade, accountsState.accounts, prefs]);
  const ex = useMemo(() => (ready ? excursions(trade, candles.candles, baseMinutes) : null), [ready, candles, trade, baseMinutes]);
  const mae = ex ? (ex.maePrice - trade.entry_price) * sign : null;
  const mfe = ex ? (ex.mfePrice - trade.entry_price) * sign : null;
  const exitEff = useMemo(() => calculateExitEfficiency(trade, mfe, { accounts: accountsState.accounts, prefs }), [trade, mfe, accountsState.accounts, prefs]);
  const planVsActual = useMemo(() => derivePlanVsActual(trade, { accounts: accountsState.accounts, prefs }), [trade, accountsState.accounts, prefs]);
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
  const sourceCheck = useMemo(() => {
    // Keep missing source bars visible when several source bars form one displayed candle.
    if (!ready || trade.is_sample || open) return null;
    return timeframe === base ? observation : validateTradeAgainstBars(trade, candles.candles, baseMinutes);
  }, [ready, candles, trade, base, baseMinutes, timeframe, observation, open]);
  // Null for an open trade: there is no "after the exit" yet.
  const hindsight = useMemo(() => {
    if (!ready) return null;
    return buildHindsight(trade, candles.candles, candles.baseTimeframe);
  }, [ready, trade, candles]);
  const barCoverage = sourceCheck?.coverage ?? (candles?.status === "none" && !trade.is_sample ? "missing" as const : null);
  // Issue #83: every data-quality note collapses into one chip. Hindsight is not a data note.
  const dataNotes = collectDataNotes({
    noCandles: candles?.status === "none" && !trade.is_sample,
    base: ready ? base : null,
    misaligned,
    ticker: trade.yahoo_ticker,
    coverage: barCoverage,
    chronologyUnresolved: observation?.coverage === "complete" && observation.chronology === "unresolved",
    findings: observation?.findings ?? [],
    entryBarPassedStop: observation?.entryBarPassedStop,
    exitStopMismatch: checkExitStopConsistency(trade),
    untimedStopMovePrice: !trade.stop_moves?.length && trade.initial_stop_price != null && trade.stop_loss_price != null && trade.stop_loss_price !== trade.initial_stop_price ? trade.stop_loss_price : null,
    symbol: trade.symbol,
    zone,
  });
  // Computed session levels (LV-1 / LV-2, docs/24 §5, OD-15): the prior session and this session up to
  // entry, read from the chart's own series. The trade's candle window alone never holds the prior session.
  const levels = useTradeLevels(trade, showLevels, vwapAnchor !== "off", prefs.ema200 ? timeframe : null);
  const sessionVwapReport = useMemo(() => (ready && vwapAnchor !== "off" ? tradeSessionVwapReport(trade,
    joinSessionBars(levels.sessionCandles, levels.sessionTimeframe, candles.candles, candles.baseTimeframe),
    candles.baseTimeframe, vwapAnchor) : null), [ready, candles, trade, vwapAnchor, levels.sessionCandles, levels.sessionTimeframe]);
  const sessionVwap = sessionVwapReport?.points ?? null;
  const vwapLine = useMemo(() => (sessionVwap && displayedBars ? vwapOnBars(sessionVwap, displayedBars, timeframe) : NO_VWAP),
    [sessionVwap, displayedBars, timeframe]);
  // IN-3: the 200 EMA on the displayed bars (View → 200 EMA, prefs.ema200).
  const emaLine = useMemo(() => (prefs.ema200 && levels.ema200 && displayedBars ? emaOnBars(levels.ema200.points, displayedBars) : []), [prefs.ema200, levels.ema200, displayedBars]);
  // VOL-1: the volume band (View → Volume) needs real traded volume. Sample bars carry none, so it is hidden there.
  const volumeReal = useMemo(() => (displayedBars ? hasRealVolume(displayedBars) : false), [displayedBars]);

  const online = useOnline();
  const freshness = getCandleFreshness({
    candles: candles?.candles,
    source: candles?.source,
    fetching: candles?.fetching,
    online,
  });
  const sourceLabel = candles?.source === "Yahoo Finance" ? "Yahoo" : candles?.source === "Demo fixture" ? "Demo fixture" : "No candles";
  const sourceInterval = `${base} source${base !== "1m" ? " (1m unavailable)" : ""}`;
  const sourceText = `${trade.yahoo_ticker} · ${sourceLabel} · ${ready ? `${timeframe} chart · ${sourceInterval}${barCoverage === "partial" ? " · gaps in trade" : ""}` : "—"}`;

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
            <p className="when">{formatSessionDate(sessionDate(trade.entry_time))} · {formatDetailTime(trade.entry_time, zone)} · <span style={{ whiteSpace: "nowrap" }}>{formatDuration(holdSeconds(trade))}</span>{prefs.shield ? "" : ` · ${trade.quantity}×`}</p>
            {trade.is_sample && <p className="muted" style={{ fontSize: 11, margin: "4px 0 0" }}>{SAMPLE_CAPTION}</p>}
          </div>
          <div className="headline-result"><b className={tone}>{headline}</b><span>{secondary}</span></div>
        </div>

        {undatedExit && <p className="chart-note fact" role="status">Chart needs a valid exit date.</p>}
        {!undatedExit && candles?.status === "none" && <DataNotesChip notes={dataNotes} />}
        {!undatedExit && candles?.status === "none" && !trade.is_sample && (
          <div className="chart-note fact candle-retry" role="status">
            <span>{noCandlesMessage(candles.reason, open ? candles.lastAttemptAt - Date.parse(trade.entry_time) < FRESH_EXIT_MS : exitIsFresh(trade, candles.lastAttemptAt))}</span>
            <button type="button" disabled={candles.fetching} onClick={() => ensureCandles(trade, true)}>{candles.fetching ? "Checking…" : "Retry"}</button>
          </div>
        )}
        {undatedExit || candles?.status === "none" ? null : <>
          <div className={`chart-card specular-card ${fullscreen ? "fullscreen" : ""}`}>
          <div className="chart-toolbar">
            <div className="timeframes" role="group" aria-label="Timeframe">
              {TIMEFRAMES.map((value) => <button key={value} type="button" aria-pressed={value === timeframe} disabled={TIMEFRAME_MINUTES[value] < baseMinutes} onClick={() => setTimeframe(value)}>{value}</button>)}
            </div>
            {/* ‹30 / 30›: widen the time window. In the toolbar, not floating over the chart, so the
                price axis stays free for dragging (owner feedback 2026-11-20, docs/20 §3). */}
            <div className="chart-extend" role="group" aria-label="Show more bars">
              <button type="button" className="tool-button" disabled={!ready || !extension.canBefore} title={extension.canBefore ? "Show 30 earlier bars ([)" : "No more candles"} aria-label={extension.canBefore ? "Show 30 earlier bars" : "No earlier candles"} onClick={() => chartRef.current?.extend("before")}>‹30</button>
              <button type="button" className="tool-button" disabled={!ready || !extension.canAfter} title={extension.canAfter ? "Show 30 later bars (])" : "No more candles"} aria-label={extension.canAfter ? "Show 30 later bars" : "No later candles"} onClick={() => chartRef.current?.extend("after")}>30›</button>
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
                  {!open && <div className="view-menu-section">
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
                  </div>}
                  <div className="view-menu-section">
                    <button
                      type="button"
                      className="view-menu-item"
                      role="menuitemcheckbox"
                      aria-checked={showLevels}
                      onClick={() => setShowLevels((prev) => !prev)}
                      title={levelsTitle(levels)}
                    >
                      <span>{showLevels ? "Session levels ✓" : "Session levels"}</span>
                      <span className="shortcut">{levelsStatusText(levels)}</span>
                    </button>
                    {/* Withheld levels are named with their reason, never hidden (docs/12 §5, OD-55). Visible: touch has no tooltip. */}
                    {levels.withheld.length > 0 && <small style={{ display: "block", padding: "2px 4px", fontSize: "0.6875rem", color: "var(--text-muted)" }}>Withheld: {withheldText(levels.withheld)}</small>}
                    <LevelsDisclosureList levels={levels.lines} symbol={trade.symbol} onHighlightTick={setHighlightedTick} />
                  </div>
                  <div className="view-menu-section">
                    <span className="view-menu-label">
                      Session VWAP{vwapAnchor !== "off" && ready && !sessionVwap ? (volumeReal ? " · unavailable: bars missing in the session" : " · unavailable: no volume in these bars") : sessionVwapReport?.reason ? ` · ${sessionVwapReport.reason}` : ""}
                    </span>
                    <div className="view-menu-toggle-group three" role="group" aria-label="Session VWAP anchor">
                      {([["off", "Off", "No VWAP"], ["rth", "RTH", "From 09:30 ET"], ["globex", "Globex", "From 18:00 ET"]] as const).map(([value, label, hint]) => (
                        <button key={value} type="button" aria-pressed={vwapAnchor === value} onClick={() => setPrefs({ vwapAnchor: value })} title={hint}>
                          <span>{label}</span>
                          <small>{hint}</small>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="view-menu-section">
                    <span className="view-menu-label">200 EMA{prefs.ema200 ? ema200Status(levels.ema200) : ""}</span>
                    <div className="view-menu-toggle-group" role="group" aria-label="200 EMA">{([[false, "Off"], [true, "On"]] as const).map(([value, label]) => <button key={label} type="button" aria-pressed={prefs.ema200 === value} onClick={() => setPrefs({ ema200: value })}><span>{label}</span></button>)}</div>
                  </div>
                  <div className="view-menu-section">
                    <span className="view-menu-label">{volumeReal ? "Volume" : trade.is_sample ? "Volume unavailable for sample bars" : "Volume unavailable for these bars"}</span>
                    <div className="view-menu-toggle-group" role="group" aria-label="Volume">{([[false, "Off"], [true, "On"]] as const).map(([value, label]) => <button key={label} type="button" aria-pressed={prefs.showVolume === value} disabled={!volumeReal} onClick={() => setPrefs({ showVolume: value })}><span>{label}</span></button>)}</div>
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
            <div className="chart-hud" aria-label="Chart HUD">
              <span className="readout num" ref={readoutRef} aria-hidden="true" />
            </div>
            {ready ? (
              <>
                {displayedBars && <TradeChart ref={chartRef} trade={trade} bars={displayedBars} timeframe={timeframe} marks={marks} levels={levels.lines} highlightedLineTick={highlightedTick} vwap={vwapLine} vwapApproximate={sessionVwapReport?.approximate} showVolume={volumeReal && prefs.showVolume} ema={emaLine} emaApproximate={levels.ema200?.approximate} zone={zone} privacy={renderPrivacy} readout={readoutRef} onRendered={onRendered} onFitChange={setFitted} onExtensionChange={setExtension} neighbourTrades={neighbours} onSelectNeighbour={(tradeId) => router.push(`/trades/${tradeId}`)} />}
              </>
            ) : (
              <div className="chart-skeleton" role="status"><div className="skeleton" /><span>Loading candles…</span></div>
            )}
          </div>
          <div className="chart-source">
            <span className="source-text">{sourceText}</span>
            <div className="source-right">
              {candles?.fetching && <span className="fetching-text">Checking Yahoo…</span>}
              <span className={`freshness-pill ${freshness.status}`} title={`Data freshness: ${freshness.label}`}>
                {freshness.label}
              </span>
            </div>
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
              <span>{hindsightOpen ? hindsightExpandedText(hindsight) : hindsightCollapsedText(hindsight, "medium")}</span>
            </div>
          )}
          </div>
        </>}

        {/* UX-b: Pit Stop sits right beneath the chart on mobile so notes are taken with chart in view */}
        <div className="mobile-pitstop">
          <section className="specular-card card-pad">
            <div className="card-head"><h3>Pit Stop</h3><span>{trade.review_status === "reviewed" ? "Reviewed ✓" : trade.review_status === "tagged" ? "Tagged" : "Needs tags"} · private</span></div>
            <PitStop trade={trade} />
          </section>
        </div>

        <div className="trade-levels-card specular-card">
          <div className="rstrip-row">
            <RStrip trade={trade} excursions={ex} size="detail" rSizeCents={rSize.cents} />
            <button type="button" className="mood-mini" onClick={() => setMoodOpen(true)} aria-label="Mood Shape. Tap to edit.">
              <MoodShape vector={mood} size={44} />
            </button>
          </div>
          <div className="levels">
            <div><small>ENTRY</small><b>{formatPrice(trade.entry_price, trade.symbol)}</b></div>
            <div><small>EXIT</small><b>{formatPrice(trade.exit_price, trade.symbol)}</b></div>
            <TradeLevelEditor trade={trade} field="stop_loss_price" />
            <TradeLevelEditor trade={trade} field="planned_target_price" />
            <TradeLevelEditor trade={trade} field="key_level_price" />
            <div title={ex?.coverage === "partial" ? "Partial: some bars in the hold are missing, so this is not a complete measurement." : "Worst price against you during the hold, estimated from bars"}><small>HEAT (MAE){ex?.coverage === "partial" ? " · partial" : ""}</small><b className={mae == null ? "empty" : ""}>{mae == null ? "—" : approx(formatPoints(Math.min(0, mae), trade.symbol))}</b></div>
            <div title={ex?.coverage === "partial" ? "Partial: some bars in the hold are missing, so this is not a complete measurement." : "Best price in your favour during the hold, estimated from bars"}><small>BEST (MFE){ex?.coverage === "partial" ? " · partial" : ""}</small><b className={mfe == null ? "empty" : ""}>{mfe == null ? "—" : approx(formatPoints(Math.max(0, mfe), trade.symbol))}</b></div>
            <div title={exitEff ? exitEff.summary : "Ratio of realized gain to the best gain available during the hold"}><small>EFFICIENCY{ex?.coverage === "partial" ? " · partial" : ""}</small><b className={exitEff?.efficiencyPercent == null ? "empty" : ""}>{exitEff?.efficiencyPercent != null ? `${exitEff.efficiencyPercent}%` : "—"}</b></div>
          </div>
          {!open && (
            <div className="exit-reason-detail-row">
              <span className="exit-reason-label">HOW DID IT END?</span>
              <div className="chip-row" role="group" aria-label="How did it end?">
                {EXIT_REASONS.map((reason) => {
                  const selected = trade.exit_reason === reason.value;
                  return (
                    <button
                      key={reason.value}
                      type="button"
                      className="chip"
                      aria-pressed={selected}
                      aria-label={`Exit reason: ${reason.label}`}
                      onClick={() => {
                        const previous = trade.exit_reason;
                        const next = selected ? null : reason.value;
                        updateTrade(trade.id, { exit_reason: next });
                        showToast(next ? `Exit reason: ${reason.label}` : "Exit reason cleared", {
                          label: "Undo",
                          run: () => updateTrade(trade.id, { exit_reason: previous }),
                        });
                      }}
                    >
                      {reason.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <RiskLine trade={trade} rSize={rSize} accountName={accountName} shield={renderPrivacy} />
          {trade.stop_loss_price == null && <RiskChips trade={trade} budgetUsd={rSize.cents / 100} shield={prefs.shield} />}
          {/* The frozen first stop once the working stop has moved, or why R is blank (R-10). */}
          {stopHistory && <p className="initial-stop">{stopHistory}</p>}
          <StopFacts trade={trade} rSize={rSize} />

          {/* G2 (#36): Interactive stop-move editor & widening suggestion (UX-33) */}
          <StopMovesEditor
            trade={trade}
            onChange={(moves) => updateTrade(trade.id, { stop_moves: moves })}
            onSuggestMovedStop={
              !trade.quick_tags.includes("Moved Stop")
                ? () => updateTrade(trade.id, { quick_tags: [...trade.quick_tags, "Moved Stop"] })
                : undefined
            }
          />

          <PartialsCard trade={trade} rSize={rSize} shield={prefs.shield} zone={zone} />
          <PlanVsActualSection comparison={planVsActual} />
        </div>

        {undatedExit || candles?.status === "none" ? null : (
          <div className="detail-actions">
            <button type="button" className="btn-primary" disabled={!ready} onClick={openCard}>{ready ? "Trade Card" : "Trade Card needs candles"}</button>
          </div>
        )}

        {open && (
          <section className="open-mood-section specular-card card-pad" aria-label="Pre-exit feeling">
            <div className="open-mood-head">
              <div>
                <span className="eyebrow">Pre-exit feeling</span>
                <p className="open-mood-sub">How do you feel in this trade? <i>optional</i></p>
              </div>
              <button
                type="button"
                className="mood-mini"
                onClick={() => setMoodOpen(true)}
                aria-label="Mood Shape. Tap to open editor."
              >
                <MoodShape vector={mood} size={40} />
              </button>
            </div>
            <div className="chip-row" role="group" aria-label="Pre-exit feeling">
              {moodState.registry.spokes.map((spoke) => {
                const selected = dominantSpoke(mood) === spoke.id;
                return (
                  <button
                    key={spoke.id}
                    type="button"
                    className="chip"
                    aria-pressed={selected}
                    aria-label={`${spoke.label} pre-exit feeling`}
                    onClick={() => {
                      if (selected) {
                        const rec = setSpokeScore(trade.id, spoke.id, null);
                        showToast(`${spokeChipLabel(spoke)} cleared`, {
                          label: "Undo",
                          run: () => undoMoodRecord(rec.id),
                        });
                      } else {
                        const previousDominant = dominantSpoke(mood);
                        const scores: Record<string, number | null> = { [spoke.id]: ONE_TAP_MOOD_SCORE };
                        if (previousDominant && previousDominant !== spoke.id) {
                          scores[previousDominant] = null;
                        }
                        const now = new Date().toISOString();
                        const rec = recordUserMood(trade.id, scores, now, now);
                        showToast(`Feeling recorded: ${spokeChipLabel(spoke)}`, {
                          label: "Undo",
                          run: () => undoMoodRecord(rec.id),
                        });
                      }
                    }}
                  >
                    {spokeChipLabel(spoke)}
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {open && (
          <div className="detail-actions">
            <button type="button" className="btn-primary" onClick={() => setClosing(true)}>Close trade</button>
          </div>
        )}

        <div className="pager">
          <button type="button" aria-label="Previous trade (K)" disabled={!previous} onClick={() => go(previous)}>‹ Prev</button>
          <span className="where num">{index >= 0 ? `${index + 1} / ${list.length}` : ""} · {listLabel}</span>
          <button type="button" aria-label="Next trade (J)" disabled={!next} onClick={() => go(next)}>Next ›</button>
        </div>
      </section>

      <aside className="detail-side">
        <div className="desktop-pitstop">
          <section className="specular-card card-pad">
            <div className="card-head"><h3>Pit Stop</h3><span>{trade.review_status === "reviewed" ? "Reviewed ✓" : trade.review_status === "tagged" ? "Tagged" : "Needs tags"} · private</span></div>
            <PitStop trade={trade} />
          </section>
        </div>
        {!trade.is_sample && <AccountSelect className="field account-pick" value={trade.account_id} onChange={(id) => updateTrade(trade.id, { account_id: id })} />}
        <MoodCard trade={trade} onEdit={() => setMoodOpen(true)} />
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
    {moodOpen && <MoodEditorSheet trade={trade} onClose={closeMood} />}
    {closing && open && <CloseTradeSheet trade={trade} zone={zone} onClose={closeSheet} />}
    {cardOpen && (
      <TradeCardSheet
        trade={trade}
        blob={shareBlob}
        privacy={cardPrivacy}
        size={cardSize}
        side={cardSide}
        onPrivacyChange={changeCardPrivacy}
        onSizeChange={changeCardSize}
        onSideChange={changeCardSide}
        onClose={closeCard}
      />
    )}
  </>;
}
