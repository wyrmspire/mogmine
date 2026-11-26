"use client";

// CD-3b: the playbook card (docs/23 §5) laid out on the §2 frame: header band, main area, stats row,
// context band, footer. Front: name, best example chart, stats. Back: ordered rules and the drill result.
// The example's bars come only from the per-trade candle cache; the card never fetches (invariant 2).
// Text comes from `lib/playbook-binder.ts`; nothing here formats a number.
// CD-3c: Share opens the export sheet with Shield on; the PNG uses the example chart's screenshot.
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Ref } from "react";
import { PlaybookCardSheet } from "./PlaybookCardSheet";
import { TradeChart } from "./TradeChart";
import type { TradeChartHandle } from "./TradeChart";
import type { StoredCandles } from "@/lib/candles";
import { idbGet } from "@/lib/idb";
import { playbookDrillLine, playbookExampleCaption, playbookSampleLine, playbookStatCells } from "@/lib/playbook-binder";
import { usePlaybooks, setPlaybookPinnedExample } from "@/lib/playbooks-store";
import { useJournal } from "@/lib/store";
import type { PlaybookCardData } from "@/lib/playbook-card";
import { buildPlaybookCard } from "@/lib/playbook-card-image";
import type { CardSide, CardSize } from "@/lib/shareCard";
import { formatDateTime } from "@/lib/time";
import { useAccounts } from "@/lib/accounts-store";
import { usePrefs } from "@/lib/prefs";
import { resolveRSize, riskR } from "@/lib/r-size";
import { observeTrade } from "@/lib/trade-bar-validation";
import { deriveTrade, fromLegacy } from "@/lib/trade-document";
import { buildMarks } from "@/lib/trade-marks";
import { TIMEFRAME_MINUTES, candleCacheKey, isOpen } from "@/lib/trades";
import { formatListTime } from "@/lib/time";
import type { TradeRecord } from "@/lib/trades";

type Bars = { state: "loading" } | { state: "none" } | { state: "ready"; stored: StoredCandles };

export function PlaybookCard({ data, example, shield, zone }: {
  data: PlaybookCardData;
  /** The trade named by `data.example`, or undefined when there is none. */
  example: TradeRecord | undefined;
  shield: boolean;
  zone: string;
}) {
  const [side, setSide] = useState<"front" | "back">("front");
  const cells = playbookStatCells(data, shield);
  // docs/23 §9: the pinned teaching example. Closed, real trades of this playbook are the only choices offered.
  const pinnedId = usePlaybooks().playbooks.find((item) => item.id === data.playbook_id)?.pinned_example_trade_id ?? null;
  const journal = useJournal();
  const choices = useMemo(() => journal.trades
    .filter((trade) => trade.playbook_id === data.playbook_id && !trade.is_sample && !isOpen(trade))
    .sort((a, b) => Date.parse(b.entry_time) - Date.parse(a.entry_time)), [journal.trades, data.playbook_id]);
  const isPinned = data.example?.basis === "pinned";
  const pinSelect = pinnedId && choices.some((trade) => trade.id === pinnedId) ? pinnedId : "";

  // Export state. The sheet opens with Shield on whatever the app's setting is (docs/23 §1.3).
  const [exporting, setExporting] = useState(false);
  const [exportShield, setExportShield] = useState(true);
  const [size, setSize] = useState<CardSize>("4:5");
  const [face, setFace] = useState<CardSide>("front");
  // Each result carries the options it was built for; the sheet shows only one that matches now,
  // so a stale image is never shared after an option changes.
  const [session, setSession] = useState(0);
  const [result, setResult] = useState<{ key: string; blob: Blob | null; failed: boolean } | null>(null);
  const chartRef = useRef<TradeChartHandle>(null);
  // The privacy the chart last drew with. A Shield export never uses a snapshot drawn without it.
  const drawnPrivacy = useRef<boolean | null>(null);
  const chartPrivacy = shield || (exporting && exportShield);
  const key = `${session}|${size}|${face}|${exportShield}|${data.playbook_id}`;
  const current = result?.key === key ? result : null;

  const encode = useCallback(() => {
    if (!exporting) return;
    const snapshot = chartRef.current?.screenshot() ?? null;
    if (snapshot && drawnPrivacy.current !== chartPrivacy) return; // wait for the redraw
    buildPlaybookCard(snapshot, data, { size, side: face, shield: exportShield, dateLabel: formatDateTime(Date.now(), zone) })
      .then((blob) => setResult({ key, blob, failed: false }))
      .catch(() => setResult({ key, blob: null, failed: true }));
  }, [exporting, chartPrivacy, data, size, face, exportShield, zone, key]);

  // Rebuild on every option change (UX-70: the image exists before the tap).
  useEffect(() => { encode(); }, [encode]);

  const onRendered = useCallback((privacy: boolean) => {
    drawnPrivacy.current = privacy;
    encode();
  }, [encode]);

  const open = () => { setSide("front"); setExportShield(true); setSession(session + 1); setExporting(true); };
  const close = useCallback(() => setExporting(false), []);
  const blob = current?.blob ?? null;
  const failed = current?.failed ?? false;

  return (
    <article className="specular-card playbook-card" aria-label={`${data.name} playbook card, viewing ${side} side`}>
      <header className="playbook-card-head">
        <span className="eyebrow">Playbook</span>
        <h2>{data.name}</h2>
        <button
          type="button"
          className="btn-secondary playbook-flip"
          aria-pressed={side === "back"}
          aria-label={side === "front" ? "Flip to view playbook rules" : "Flip to view example chart and stats"}
          onClick={() => setSide(side === "front" ? "back" : "front")}
          style={{ minHeight: 44 }}
        >
          {side === "front" ? "Rules" : "Example"}
        </button>
      </header>

      <div className="playbook-card-face" key={side}>
        {side === "front" ? (
          <>
            <ExampleChart key={example?.id ?? "none"} ref={chartRef} example={example} shield={chartPrivacy} zone={zone} onRendered={onRendered} />
            {data.example && <p className="playbook-card-caption">{isPinned ? "Pinned teaching example" : playbookExampleCaption(data)}</p>}
            {(example || choices.length > 0) && (
              <div className="playbook-card-pin">
                <button
                  type="button"
                  className="btn-secondary"
                  aria-pressed={isPinned}
                  disabled={!example}
                  onClick={() => example && setPlaybookPinnedExample(data.playbook_id, isPinned ? null : example.id)}
                  style={{ minHeight: 44 }}
                >
                  {isPinned ? "Pinned example" : "Pin example"}
                </button>
                {choices.length > 0 && (
                  <select
                    aria-label="Choose the pinned teaching example"
                    value={pinSelect}
                    onChange={(event) => setPlaybookPinnedExample(data.playbook_id, event.target.value || null)}
                    style={{ minHeight: 44 }}
                  >
                    <option value="">Automatic</option>
                    {choices.map((trade) => (
                      <option key={trade.id} value={trade.id}>{trade.direction === "LONG" ? "Long" : "Short"} {trade.symbol} · {formatListTime(trade.entry_time, zone)}</option>
                    ))}
                  </select>
                )}
              </div>
            )}
            {cells.length ? (
              <div className="stat-row playbook-card-stats" role="region" aria-label="Playbook performance statistics">
                {cells.map((cell) => (
                  <div className="stat" key={cell.label}>
                    <small id={`stat-${data.playbook_id}-${cell.label}`}>{cell.label}</small>
                    <b aria-labelledby={`stat-${data.playbook_id}-${cell.label}`} className={cell.value.length > 8 ? "playbook-stat-text" : undefined}>{cell.value}</b>
                  </div>
                ))}
              </div>
            ) : (
              <p className="playbook-card-shield">Shield is on: results are hidden. Rules and the example still show.</p>
            )}
          </>
        ) : (
          <div className="playbook-card-back" role="region" aria-label="Playbook rules and drills">
            <h3>Rules</h3>
            {data.rules.length ? (
              <ol className="playbook-card-rules" aria-label="Checklist rules">{data.rules.map((rule, i) => <li key={`${i}-${rule}`}>{rule}</li>)}</ol>
            ) : (
              <p className="muted">No rules on this playbook. Add them in Tune.</p>
            )}
            <h3>Drills</h3>
            <p className="num playbook-card-drill" aria-label="Drill performance">{playbookDrillLine(data, shield)}</p>
          </div>
        )}
      </div>

      <footer className="playbook-card-foot num">
        <span>mogmine</span>
        <span>{playbookSampleLine(data)}</span>
        <button type="button" className="btn-secondary playbook-share" onClick={open} aria-label={`Share ${data.name} playbook card image`} style={{ minHeight: 44 }}>Share card</button>
      </footer>

      {exporting && (
        <PlaybookCardSheet
          name={data.name} blob={blob} failed={failed} size={size} side={face} shield={exportShield}
          onSize={setSize} onSide={setFace} onShield={setExportShield} onRetry={encode} onClose={close}
        />
      )}
    </article>
  );
}

function ExampleChart({ ref, example, shield, zone, onRendered }: {
  ref: Ref<TradeChartHandle>;
  example: TradeRecord | undefined;
  shield: boolean;
  zone: string;
  onRendered: (privacy: boolean) => void;
}) {
  const [bars, setBars] = useState<Bars>({ state: "loading" });
  const accounts = useAccounts();
  const prefs = usePrefs();

  useEffect(() => {
    if (!example) return;
    let alive = true;
    void idbGet<StoredCandles>(candleCacheKey(example)).catch(() => undefined).then((stored) => {
      if (alive) setBars(stored?.candles?.length ? { state: "ready", stored } : { state: "none" });
    });
    return () => { alive = false; };
  }, [example]);

  const marks = useMemo(() => {
    if (!example || bars.state !== "ready") return [];
    const { stored } = bars;
    const derived = deriveTrade(fromLegacy(example));
    const observed = observeTrade(derived, stored.candles, TIMEFRAME_MINUTES[stored.baseTimeframe]);
    const accountRiskR = riskR(example, resolveRSize(example, accounts.accounts, prefs));
    return buildMarks(derived, observed, stored.baseTimeframe, "medium", shield, { candleTimes: stored.candles.map(({ time }) => time), accountRiskR });
  }, [example, bars, shield, accounts.accounts, prefs]);

  const rendered = useCallback(() => onRendered(shield), [onRendered, shield]);

  if (!example) return <div className="chart-frame playbook-card-chart"><div className="chart-skeleton"><span>No example yet</span></div></div>;
  return (
    <div className="chart-frame playbook-card-chart">
      {bars.state === "ready" ? (
        <TradeChart ref={ref} trade={example} bars={bars.stored.candles} timeframe={bars.stored.baseTimeframe} marks={marks} zone={zone} privacy={shield} onRendered={rendered} />
      ) : bars.state === "loading" ? (
        <div className="chart-skeleton"><div className="skeleton" /></div>
      ) : (
        <div className="chart-skeleton"><span>No saved bars for this trade. <Link href={`/trades/${example.id}`} aria-label={`Open trade ${example.symbol} to load candles`}>Open it</Link> to load them.</span></div>
      )}
    </div>
  );
}
