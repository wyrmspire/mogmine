"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { TradeChart } from "./TradeChart";
import { TradeRow } from "./TradeRow";
import { ensureCandles, useCandles } from "@/lib/candles";
import { formatDuration, formatMoney, formatPoints, formatPrice, formatR } from "@/lib/format";
import { usePrefs } from "@/lib/prefs";
import { withSamples } from "@/lib/selectors";
import { formatSessionDate, sessionDate } from "@/lib/session";
import { buildShareCard } from "@/lib/shareCard";
import { updateTrade, useJournal } from "@/lib/store";
import { formatDetailTime } from "@/lib/time";
import { showToast } from "@/lib/toast";
import { STYLE_LABEL, TIMEFRAMES, TIMEFRAME_MINUTES, defaultTimeframe, holdSeconds, rMultiple, tradePnl, tradePoints } from "@/lib/trades";
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
  const journal = useJournal();
  const zone = prefs.timeZone;
  const [chosen, setTimeframe] = useState<Timeframe>(defaultTimeframe(trade.trade_style));
  const [shareBlob, setShareBlob] = useState<Blob | null>(null);
  const candles = useCandles(trade.id);

  const index = list.findIndex((item) => item.id === trade.id);
  const previous = index > 0 ? list[index - 1] : undefined;
  const next = index >= 0 && index < list.length - 1 ? list[index + 1] : undefined;

  useEffect(() => { ensureCandles(trade); }, [trade]);
  // Neighbours are warmed up so stepping through the list is instant (docs/08 §2).
  useEffect(() => { if (previous) ensureCandles(previous); if (next) ensureCandles(next); }, [previous, next]);

  // A timeframe finer than what was captured cannot be drawn; show the best available one and say so (B-11).
  const base = candles?.baseTimeframe ?? "1m";
  const timeframe = TIMEFRAME_MINUTES[chosen] < TIMEFRAME_MINUTES[base] ? base : chosen;

  const onSnapshot = useCallback((snapshot: HTMLCanvasElement) => {
    void buildShareCard(snapshot, trade, zone).then(setShareBlob).catch(() => setShareBlob(null));
  }, [trade, zone]);

  const shareCard = async () => {
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
  };

  const pnl = tradePnl(trade);
  const r = rMultiple(trade);
  const tone = pnl > 0 ? "positive" : pnl < 0 ? "negative" : "";
  const points = formatPoints(tradePoints(trade), trade.symbol);
  const headline = prefs.shield ? (r != null ? formatR(r) : points) : formatMoney(pnl);
  const secondary = prefs.shield ? (r != null ? points : "—R") : formatR(r);
  const saveText = journal.saveState === "saving" ? "Saving…" : journal.saveState === "error" ? "Not saved — storage is blocked" : "✓ Saved on this device";

  return (
    <div className="detail-layout">
      <aside className="detail-rail" aria-label={`Trades: ${listLabel}`}>
        <h2>{listLabel}</h2>
        <div className="trade-list">{list.map((item) => <TradeRow key={item.id} trade={item} zone={zone} shield={prefs.shield} current={item.id === trade.id} />)}</div>
      </aside>

      <section className="detail-main">
        <div className="trade-header">
          <Link className="nav-button" href={backHref} aria-label={`Back to ${listLabel}`}>←</Link>
          <div className="head-main">
            <div className="title-line">
              <h1>{trade.symbol}</h1>
              <span className={`direction ${trade.direction === "LONG" ? "long" : "short"}`}>{trade.direction === "LONG" ? "▲ LONG" : "▼ SHORT"}</span>
              <span className="style-pill">{STYLE_LABEL[trade.trade_style]}</span>
              {trade.is_sample && <span className="tag-chip">SAMPLE</span>}
            </div>
            <p className="when">{formatSessionDate(sessionDate(trade.entry_time))} · {formatDetailTime(trade.entry_time, zone)} · {formatDuration(holdSeconds(trade))}</p>
          </div>
          <div className="headline-result"><b className={tone}>{headline}</b><span>{secondary}</span></div>
        </div>

        <div className="chart-card specular-card">
          <div className="chart-toolbar">
            <div className="timeframes" role="group" aria-label="Timeframe">
              {TIMEFRAMES.map((value) => <button key={value} aria-pressed={value === timeframe} disabled={TIMEFRAME_MINUTES[value] < TIMEFRAME_MINUTES[base]} onClick={() => { setTimeframe(value); setShareBlob(null); }}>{value}</button>)}
            </div>
            <div className="chart-tools"><button className="tool-button" onClick={() => document.querySelector(".chart-host")?.dispatchEvent(new Event("mogmine-fit"))}>Fit</button></div>
          </div>
          <div className="chart-frame">
            {candles?.status === "ready"
              ? <TradeChart trade={trade} candles={candles.candles} timeframe={timeframe} zone={zone} onSnapshot={onSnapshot} />
              : candles?.status === "none"
                ? <div className="chart-skeleton"><span>No market data for this trade yet.</span></div>
                : <div className="chart-skeleton"><div className="skeleton" /><span>Loading candles…</span></div>}
          </div>
          <div className="chart-source">
            <span>{trade.yahoo_ticker} · {candles?.source === "Yahoo Finance" ? "Yahoo" : candles?.source === "Demo fixture" ? "Sample candles" : "No candles"} · {timeframe}</span>
            <span>{candles?.fetching ? "Checking Yahoo…" : candles?.source === "Demo fixture" ? "Not market data" : ""}</span>
          </div>
          <div className="levels">
            <div><small>ENTRY</small><b>{formatPrice(trade.entry_price, trade.symbol)}</b></div>
            <div><small>EXIT</small><b>{formatPrice(trade.exit_price, trade.symbol)}</b></div>
            <div><small>STOP</small><b className={trade.stop_loss_price == null ? "empty" : ""}>{formatPrice(trade.stop_loss_price, trade.symbol)}</b></div>
            <div><small>TARGET</small><b className={trade.planned_target_price == null ? "empty" : ""}>{formatPrice(trade.planned_target_price, trade.symbol)}</b></div>
          </div>
        </div>

        <div className="detail-actions">
          <button className="btn-primary" disabled={!shareBlob} onClick={shareCard}>{shareBlob ? "Share Trade Card" : "Preparing card…"}</button>
        </div>

        <div className="pager">
          {previous ? <Link href={`/trades/${previous.id}`} scroll={false}><button aria-label="Previous trade">‹ Prev</button></Link> : <button disabled>‹ Prev</button>}
          <span className="where num">{index >= 0 ? `${index + 1} / ${list.length}` : ""} · {listLabel}</span>
          {next ? <Link href={`/trades/${next.id}`} scroll={false}><button aria-label="Next trade">Next ›</button></Link> : <button disabled>Next ›</button>}
        </div>
      </section>

      <aside className="detail-side">
        <section className="note-card specular-card card-pad">
          <div className="card-head"><h3>Review note</h3><span>Private</span></div>
          <textarea value={trade.note} onChange={(event) => updateTrade(trade.id, { note: event.target.value })} placeholder="Why did you take it? What would you do differently?" aria-label="Review note" />
          <p className="note-state" role="status">{saveText}</p>
        </section>
      </aside>
    </div>
  );
}
