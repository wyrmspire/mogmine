"use client";

// DR-3: one trade's review card on the day screen (docs/06 §4). A layout on the shared frame: the fitted chart
// (ReviewChart, levels and VWAP off) with the seven card lines beside it (landscape, wide screens) or below it
// (portrait). The card reports its chart to the day screen so "Share day" can compose the sheet without a re-render.
import Link from "next/link";
import { useEffect, useRef } from "react";
import { useAccounts } from "@/lib/accounts-store";
import { useCandles } from "@/lib/candles";
import { usePrefs } from "@/lib/prefs";
import type { ReviewCardOrientation } from "@/lib/prefs-sanitize";
import { buildReviewCardCopy } from "@/lib/day-sheet";
import type { ReviewCardCopy } from "@/lib/day-sheet";
import { resolveRSize } from "@/lib/r-size";
import type { TradeRecord } from "@/lib/trades";
import { ReviewChart } from "./ReviewChart";

export { buildReviewCardCopy };
export type { ReviewCardCopy };

export type ReviewCardSnapshotHandler = (tradeId: string, snapshot: HTMLCanvasElement, shield: boolean) => void;

interface ReviewCardProps {
  trade: TradeRecord;
  orientation: ReviewCardOrientation;
  shield: boolean;
  zone: string;
  onSnapshotReady?: ReviewCardSnapshotHandler;
}

/**
 * Copies whatever the chart has painted in `container` onto one canvas, at the chart's on-screen size. Primitives
 * (position boxes) live on the chart's own canvases, so they are included. HTML overlays are not; the export
 * shows only the chart. Null while no chart canvas exists yet.
 */
export function captureChartCanvas(container: HTMLElement): HTMLCanvasElement | null {
  const canvases = Array.from(container.querySelectorAll("canvas"));
  const box = container.getBoundingClientRect();
  if (!canvases.length || box.width <= 0 || box.height <= 0) return null;
  const scale = 2;
  const out = document.createElement("canvas");
  out.width = Math.round(box.width * scale);
  out.height = Math.round(box.height * scale);
  const ctx = out.getContext("2d");
  if (!ctx) return null;
  ctx.scale(scale, scale);
  let drawn = 0;
  for (const canvas of canvases) {
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    ctx.drawImage(canvas, rect.left - box.left, rect.top - box.top, rect.width, rect.height);
    drawn++;
  }
  return drawn > 0 ? out : null;
}

export function ReviewCard({ trade, orientation, shield, zone, onSnapshotReady }: ReviewCardProps) {
  const accounts = useAccounts();
  const prefs = usePrefs();
  const candles = useCandles(trade.id);
  const frameRef = useRef<HTMLDivElement>(null);
  const readyRef = useRef(onSnapshotReady);
  useEffect(() => { readyRef.current = onSnapshotReady; });

  const copy = buildReviewCardCopy(trade, resolveRSize(trade, accounts.accounts, prefs), shield, zone);
  const candleStatus = candles?.status;
  const unavailable = candleStatus === "none";

  // The chart paints a moment after its bars arrive, so poll briefly for its canvases, then report the snapshot.
  // Re-runs when the trade, privacy, orientation or candle status changes, so the snapshot matches the export's Shield
  // and a chart whose bars load late is still captured.
  useEffect(() => {
    if (unavailable) return;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const attempt = () => {
      const canvas = frameRef.current ? captureChartCanvas(frameRef.current) : null;
      if (canvas) {
        readyRef.current?.(trade.id, canvas, shield);
        return;
      }
      if (++tries < 20) timer = setTimeout(attempt, 250);
    };
    timer = setTimeout(attempt, 300);
    return () => clearTimeout(timer);
  }, [trade, shield, orientation, candleStatus, unavailable]);

  const lines = [copy.fills, `Stop ${copy.stop}`, `Target ${copy.target}`, `Result ${copy.result}`, `Risk ${copy.risk}`, copy.holdAndRules];
  return (
    <article className={`review-card is-${orientation}`} data-orientation={orientation} aria-label={`${trade.symbol} ${copy.header}`}>
      <Link className="review-card-title" href={`/trades/${trade.id}`}>
        <strong>{trade.symbol}</strong>
        <span>{copy.header}</span>
      </Link>
      <div className="review-card-body">
        <div className="review-card-chart" ref={frameRef}>
          {unavailable
            ? <p className="review-chart-none">Candles unavailable for this trade, so the card has no chart.</p>
            : <ReviewChart trade={trade} sealed={false} zone={zone} privacy={shield} />}
        </div>
        <ul className="review-card-lines num">
          {lines.map((line, index) => <li key={index}>{line}</li>)}
        </ul>
      </div>
    </article>
  );
}

/** Grid and card styles. Rendered once by the day screen. Portrait is one column; landscape is two from 1024 px. */
export function ReviewCardStyles() {
  return (
    <style>{`
      .review-card-grid { display: grid; gap: 16px; grid-template-columns: minmax(0, 1fr); }
      @media (min-width: 1024px) {
        .review-card-grid[data-orientation="landscape"] { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      }
      .review-card { min-width: 0; padding: 12px; border: 1px solid var(--chart-border); border-radius: 14px; background: var(--surface, #0D0F17); box-shadow: inset 0 1px 0 var(--gold-mid); }
      .review-card-title { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; min-height: 44px; min-width: 0; overflow-wrap: anywhere; }
      .review-card-body { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
      .review-card-chart { position: relative; width: 100%; min-width: 0; aspect-ratio: 4 / 5; }
      .review-card-chart > .chart-frame, .review-card-chart > .review-chart-none { width: 100%; height: 100%; }
      .review-card-lines { margin: 0; padding: 0; list-style: none; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; min-width: 0; }
      .review-card-lines li { padding: 2px 0; }
      .review-card.is-landscape .review-card-chart { aspect-ratio: 16 / 9; }
      @media (min-width: 1024px) {
        .review-card.is-landscape .review-card-body { flex-direction: row; align-items: flex-start; }
        .review-card.is-landscape .review-card-chart { flex: 1 1 60%; }
        .review-card.is-landscape .review-card-lines { flex: 1 1 40%; }
      }
    `}</style>
  );
}
