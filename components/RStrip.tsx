import { rStripCaption, rStripInputFromTrade, rStripLayout } from "@/lib/rstrip";
import type { StripTrade } from "@/lib/rstrip";

interface Props {
  trade: StripTrade;
  excursions?: { maePrice?: number | null; mfePrice?: number | null } | null;
  /** Hide the result (exit / MAE / MFE) for blind review. */
  blind?: boolean;
  /** Wider strip under Trade Detail. */
  size?: "row" | "detail";
}

function x(position: number, left: number, width: number) {
  return left + position * width;
}

/**
 * A thin risk-to-reward strip: stop on the left, target on the right, a tick at entry,
 * a marker at exit, faint MAE/MFE. Works in Shield and with no candles (issue #81).
 */
export function RStrip({ trade, excursions, blind = false, size = "row" }: Props) {
  const input = rStripInputFromTrade(trade, blind ? null : excursions);
  if (blind) {
    input.exit = null;
    input.maePrice = null;
    input.mfePrice = null;
  }
  const layout = rStripLayout(input);
  const wide = size === "detail";
  const width = wide ? 320 : 64;
  const height = wide ? 44 : 30;
  const pad = wide ? 10 : 4;
  const inner = width - pad * 2;
  const mid = height / 2;
  if (!layout) {
    return <svg className={`rstrip ${wide ? "detail" : ""}`} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" />;
  }

  const label = blind ? "Planned stop, entry and target" : rStripCaption(trade, layout);
  // Colour follows the money, not the classification: a cut-early exit that lost is red (issue #81 review).
  const exitTone = layout.exitOutcome === "favorable" ? "var(--profit-text)" : layout.exitOutcome === "adverse" ? "var(--loss-text)" : "var(--text-primary)";
  const trackFrom = layout.stop ?? Math.min(layout.entry, layout.exit ?? layout.entry, layout.target ?? layout.entry);
  const trackTo = layout.target ?? Math.max(layout.entry, layout.exit ?? layout.entry, layout.stop ?? layout.entry);

  return (
    <svg
      className={`rstrip ${wide ? "detail" : ""}`}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={label}
    >
      <line className="rstrip-track" x1={x(trackFrom, pad, inner)} y1={mid} x2={x(trackTo, pad, inner)} y2={mid} />
      {layout.mae != null && <line className="rstrip-extent" x1={x(layout.mae, pad, inner)} y1={mid - 5} x2={x(layout.mae, pad, inner)} y2={mid + 5} />}
      {layout.mfe != null && <line className="rstrip-extent" x1={x(layout.mfe, pad, inner)} y1={mid - 5} x2={x(layout.mfe, pad, inner)} y2={mid + 5} />}
      {layout.stop != null && <line className="rstrip-stop" x1={x(layout.stop, pad, inner)} y1={mid - 6} x2={x(layout.stop, pad, inner)} y2={mid + 6} />}
      {layout.target != null && <line className="rstrip-target" x1={x(layout.target, pad, inner)} y1={mid - 6} x2={x(layout.target, pad, inner)} y2={mid + 6} />}
      <line className="rstrip-entry" x1={x(layout.entry, pad, inner)} y1={mid - 8} x2={x(layout.entry, pad, inner)} y2={mid + 8} />
      {layout.exit != null && (
        <circle className="rstrip-exit" cx={x(layout.exit, pad, inner)} cy={mid} r={wide ? 4 : 3} style={{ fill: exitTone }} />
      )}
    </svg>
  );
}
