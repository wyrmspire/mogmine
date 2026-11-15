"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TradeChart } from "./TradeChart";
import { demoTrades, generateCandles } from "@/lib/fixtures";
import {
  DEFAULT_OWNER_USER_ID,
  FUTURES_SPECS,
  Timeframe,
  TradeDirection,
  TradeRecord,
  classifyTrade,
  defaultTimeframe,
  duration,
  money,
  price,
  rMultiple,
  tradePnl,
} from "@/lib/trades";

const STORAGE_KEY = "mogmine-trades-v1";
const timeframes: Timeframe[] = ["1m", "5m", "15m", "1h", "8h"];
const dateTime = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" });
const shortTime = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false });

function buildShareCard(snapshot: HTMLCanvasElement, trade: TradeRecord) {
  return new Promise<Blob>((resolve, reject) => {
    const canvas = document.createElement("canvas");
    canvas.width = 1080;
    canvas.height = 1350;
    const ctx = canvas.getContext("2d");
    if (!ctx) return reject(new Error("Canvas unavailable"));
    const gradient = ctx.createLinearGradient(0, 0, 1080, 1350);
    gradient.addColorStop(0, "#171923");
    gradient.addColorStop(1, "#07080c");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 1080, 1350);
    ctx.fillStyle = "#d4af37";
    ctx.font = "700 28px system-ui";
    ctx.fillText("MOGMINE / TRADE REVIEW", 68, 76);
    ctx.fillStyle = "#f4f5f7";
    ctx.font = "850 86px system-ui";
    ctx.fillText(trade.symbol, 68, 180);
    ctx.font = "700 30px ui-monospace, monospace";
    ctx.fillStyle = trade.direction === "LONG" ? "#10b981" : "#ef5a67";
    ctx.fillText(`${trade.direction === "LONG" ? "▲" : "▼"} ${trade.direction} · ${duration(trade)}`, 72, 228);
    ctx.fillStyle = "#0d0f17";
    ctx.beginPath();
    ctx.roundRect(52, 280, 976, 690, 28);
    ctx.fill();
    const scale = Math.min(910 / snapshot.width, 610 / snapshot.height);
    const width = snapshot.width * scale;
    const height = snapshot.height * scale;
    ctx.drawImage(snapshot, 85 + (910 - width) / 2, 320 + (610 - height) / 2, width, height);
    const pnl = tradePnl(trade);
    const labels = ["ENTRY", "EXIT", "OUTCOME"];
    const values = [price(trade.entry_price), price(trade.exit_price), money(pnl)];
    labels.forEach((label, index) => {
      const x = 68 + index * 330;
      ctx.fillStyle = "#8e95a9";
      ctx.font = "650 24px system-ui";
      ctx.fillText(label, x, 1055);
      ctx.fillStyle = index === 2 ? (pnl >= 0 ? "#10b981" : "#ef5a67") : "#f4f5f7";
      ctx.font = "750 38px ui-monospace, monospace";
      ctx.fillText(values[index], x, 1110);
    });
    ctx.fillStyle = "#8e95a9";
    ctx.font = "500 24px system-ui";
    ctx.fillText(`${dateTime.format(new Date(trade.entry_time))} · Journal notes kept private`, 68, 1248);
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Image export failed")), "image/png");
  });
}

export function TradeJournal() {
  const [trades, setTrades] = useState<TradeRecord[]>(demoTrades);
  const [selectedId, setSelectedId] = useState(demoTrades[0].id);
  const [timeframe, setTimeframe] = useState<Timeframe>(defaultTimeframe(demoTrades[0].trade_style));
  const [formOpen, setFormOpen] = useState(false);
  const [shareBlob, setShareBlob] = useState<Blob | null>(null);
  const [savedState, setSavedState] = useState("Saved");
  const [toast, setToast] = useState("");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as TradeRecord[];
        if (Array.isArray(parsed) && parsed.length) {
          setTrades(parsed);
          setSelectedId(parsed[0].id);
          setTimeframe(defaultTimeframe(parsed[0].trade_style));
        }
      } else localStorage.setItem(STORAGE_KEY, JSON.stringify(demoTrades));
    } catch { /* Demo fixtures remain available if storage is blocked. */ }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    setSavedState("Saving…");
    const timer = window.setTimeout(() => {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(trades)); setSavedState("Saved on this device"); }
      catch { setSavedState("Could not save locally"); }
    }, 220);
    return () => window.clearTimeout(timer);
  }, [trades, hydrated]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 1800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const selectedIndex = Math.max(0, trades.findIndex((trade) => trade.id === selectedId));
  const trade = trades[selectedIndex] ?? trades[0];
  const chartTradeRef = useRef(trade);
  if (chartTradeRef.current.id !== trade.id) chartTradeRef.current = trade;
  const chartTrade = chartTradeRef.current;
  const tradeRef = useRef(trade);
  tradeRef.current = trade;
  const pnl = tradePnl(trade);
  const r = rMultiple(trade);
  const wins = trades.filter((item) => tradePnl(item) > 0).length;
  const net = trades.reduce((sum, item) => sum + tradePnl(item), 0);

  const selectTrade = (id: string) => {
    const next = trades.find((item) => item.id === id);
    if (!next) return;
    setSelectedId(id);
    setTimeframe(defaultTimeframe(next.trade_style));
    setShareBlob(null);
  };

  const updateNote = (note: string) => setTrades((current) => current.map((item) => item.id === trade.id ? { ...item, note, review_status: note ? "tagged" : "new" } : item));

  const onSnapshot = useCallback((snapshot: HTMLCanvasElement) => {
    setShareBlob(null);
    void buildShareCard(snapshot, tradeRef.current).then(setShareBlob).catch(() => setShareBlob(null));
  }, []);

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
        setToast("Trade card downloaded");
      }
    } catch (error) { if ((error as DOMException).name !== "AbortError") setToast("Share failed"); }
  };

  const copyCard = async () => {
    if (!shareBlob || !("ClipboardItem" in window)) return setToast("Copy is not supported here");
    try { await navigator.clipboard.write([new ClipboardItem({ "image/png": shareBlob })]); setToast("Trade card copied"); }
    catch { setToast("Copy permission was blocked"); }
  };

  const submitTrade = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const entry = new Date(String(data.get("entry_time")));
    const exit = new Date(String(data.get("exit_time")));
    if (exit <= entry) return setToast("Exit must be after entry");
    const symbol = String(data.get("symbol")).toUpperCase().trim();
    const number = (key: string) => data.get(key) === "" ? null : Number(data.get(key));
    const base = {
      id: crypto.randomUUID(), user_id: DEFAULT_OWNER_USER_ID, symbol,
      yahoo_ticker: FUTURES_SPECS[symbol]?.yahooTicker ?? symbol,
      direction: String(data.get("direction")) as TradeDirection,
      trade_style: classifyTrade(entry.toISOString(), exit.toISOString()),
      entry_time: entry.toISOString(), exit_time: exit.toISOString(),
      entry_price: Number(data.get("entry_price")), exit_price: Number(data.get("exit_price")),
      stop_loss_price: number("stop_loss_price"), planned_target_price: number("planned_target_price"), key_level_price: number("key_level_price"),
      quantity: 1, note: String(data.get("note") ?? ""), review_status: "new" as const,
    };
    const created: TradeRecord = { ...base, candles: generateCandles(base) };
    setTrades((current) => [created, ...current]);
    setSelectedId(created.id);
    setTimeframe(defaultTimeframe(created.trade_style));
    setFormOpen(false);
    setToast("Trade saved and charted");
  };

  const summary = useMemo(() => ({ wins, net }), [wins, net]);
  if (!trade) return null;

  return (
    <main className="shell">
      <header className="topbar">
        <button className="brand" onClick={() => selectTrade(trades[0].id)} aria-label="MogMine Today"><span className="brand-gem">M</span><span>MOGMINE</span></button>
        <span className="save-status"><i />{savedState}</span>
        <button className="icon-button" onClick={() => setFormOpen(true)} aria-label="Add trade">＋</button>
      </header>

      <aside className="trade-rail">
        <div className="rail-intro"><span className="eyebrow">Today&apos;s review</span><h1>Read the move.<br />Refine the trade.</h1></div>
        <div className="session-stats"><div><small>Trades</small><b>{trades.length}</b></div><div><small>Win rate</small><b>{Math.round(summary.wins / trades.length * 100)}%</b></div><div><small>Net</small><b className={summary.net >= 0 ? "positive" : "negative"}>{money(summary.net)}</b></div></div>
        <div className="trade-list" aria-label="Trade list">
          {trades.map((item) => {
            const result = tradePnl(item);
            return <button key={item.id} className={`trade-row ${item.id === trade.id ? "active" : ""}`} onClick={() => selectTrade(item.id)}>
              <span><strong>{item.symbol}</strong><em className={item.direction === "LONG" ? "long" : "short"}>{item.direction === "LONG" ? "▲ LONG" : "▼ SHORT"}</em><small>{item.trade_style === "session_90m" ? "90m session" : item.trade_style} · {shortTime.format(new Date(item.entry_time))} ET</small></span>
              <b className={result >= 0 ? "positive" : "negative"}>{money(result)}</b>
            </button>;
          })}
        </div>
      </aside>

      <section className="detail">
        <div className="trade-header">
          <div><div className="title-line"><h2>{trade.symbol}</h2><span className={trade.direction === "LONG" ? "direction long" : "direction short"}>{trade.direction === "LONG" ? "▲ LONG" : "▼ SHORT"}</span><span className="style-pill">{trade.trade_style === "session_90m" ? "90m SESSION" : trade.trade_style.toUpperCase()}</span></div><p>{dateTime.format(new Date(trade.entry_time))} · {duration(trade)}</p></div>
          <div className="headline-result"><b className={pnl >= 0 ? "positive" : "negative"}>{money(pnl)}</b><span>{r == null ? "—R" : `${r >= 0 ? "+" : "−"}${Math.abs(r).toFixed(1)}R`}</span></div>
        </div>

        <div className="chart-card specular-card">
          <div className="chart-toolbar"><div className="timeframes">{timeframes.map((value) => <button key={value} className={value === timeframe ? "active" : ""} onClick={() => { setTimeframe(value); setShareBlob(null); }}>{value}</button>)}</div><button className="fit-button" onClick={() => document.querySelector(".chart-host")?.dispatchEvent(new Event("mogmine-fit"))}>⌖ Fit</button></div>
          <TradeChart trade={chartTrade} timeframe={timeframe} onSnapshot={onSnapshot} />
          <div className="chart-source">{trade.yahoo_ticker} · Demo fixture · {timeframe} <span>Trade locked in view</span></div>
          <div className="levels"><div><small>ENTRY</small><b>{price(trade.entry_price)}</b></div><div><small>EXIT</small><b>{price(trade.exit_price)}</b></div><div><small>STOP</small><b className={!trade.stop_loss_price ? "empty" : ""}>{trade.stop_loss_price ? price(trade.stop_loss_price) : "Not recorded"}</b></div><div><small>TARGET</small><b className={!trade.planned_target_price ? "empty" : ""}>{trade.planned_target_price ? price(trade.planned_target_price) : "Not recorded"}</b></div></div>
        </div>

        <div className="mobile-actions"><button className="primary-button" disabled={!shareBlob} onClick={shareCard}>{shareBlob ? "⚡ Share Trade Card" : "Preparing card…"}</button><button className="secondary-button" disabled={!shareBlob} onClick={copyCard}>Copy</button></div>
      </section>

      <aside className="review-panel">
        <section className="note-card specular-card"><div className="section-heading"><h3>Review note</h3><span>PRIVATE</span></div><textarea value={trade.note} onChange={(event) => updateNote(event.target.value)} placeholder="Why did you take it? What would you do differently?" /><p className="note-state">✓ {savedState}</p></section>
        <section className="share-card specular-card"><div className="section-heading"><h3>Trade card</h3><span>NOTE EXCLUDED</span></div><p>Chart, execution and outcome—clean enough to share from your phone.</p><div className="share-buttons"><button className="primary-button" disabled={!shareBlob} onClick={shareCard}>{shareBlob ? "Share card" : "Rendering…"}</button><button className="secondary-button" disabled={!shareBlob} onClick={copyCard}>Copy image</button></div></section>
      </aside>

      <nav className="trade-nav"><button disabled={selectedIndex === 0} onClick={() => selectTrade(trades[selectedIndex - 1].id)}>← Previous</button><span>{selectedIndex + 1} / {trades.length}</span><button disabled={selectedIndex === trades.length - 1} onClick={() => selectTrade(trades[selectedIndex + 1].id)}>Next →</button></nav>
      <nav className="dock"><button className="active">◫<span>Today</span></button><button>⌁<span>Feed</span></button><button onClick={() => setFormOpen(true)}>＋<span>Add</span></button><button>◇<span>Review</span></button></nav>

      {formOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setFormOpen(false)}><section className="trade-form" role="dialog" aria-modal="true" aria-labelledby="new-trade-title"><div className="form-head"><div><span className="eyebrow">Manual entry</span><h2 id="new-trade-title">Log the execution.</h2><p>Required fields make the chart. The rest can stay blank.</p></div><button className="icon-button" onClick={() => setFormOpen(false)} aria-label="Close">×</button></div><ManualTradeForm onSubmit={submitTrade} /></section></div>}
      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}

function localInput(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function ManualTradeForm({ onSubmit }: { onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  const exit = new Date();
  const entry = new Date(exit.getTime() - 30 * 60_000);
  return <form onSubmit={onSubmit}><div className="form-grid">
    <label>Symbol<input name="symbol" required defaultValue="MES" autoCapitalize="characters" /></label>
    <label>Side<select name="direction"><option>LONG</option><option>SHORT</option></select></label>
    <label>Entry time<input name="entry_time" required type="datetime-local" defaultValue={localInput(entry)} /></label>
    <label>Entry price<input name="entry_price" required type="number" step="any" placeholder="6844.25" /></label>
    <label>Exit time<input name="exit_time" required type="datetime-local" defaultValue={localInput(exit)} /></label>
    <label>Exit price<input name="exit_price" required type="number" step="any" placeholder="6849.00" /></label>
    <label>Stop <i>optional</i><input name="stop_loss_price" type="number" step="any" /></label>
    <label>Target <i>optional</i><input name="planned_target_price" type="number" step="any" /></label>
    <label className="wide">Key level <i>optional</i><input name="key_level_price" type="number" step="any" /></label>
    <label className="wide">Private note <i>optional</i><textarea name="note" placeholder="Why I took it / what I would change" /></label>
  </div><button className="primary-button submit" type="submit">Create chart →</button></form>;
}
