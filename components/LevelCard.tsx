"use client";

// LB-B2 (docs/03 §3 LB-6/LB-7, D-E): the tap-to-read level card, the keyboard level list, and the export selector.
// The card is DOM chrome beside the chart canvas, like the OHLC HUD (Invariant 1: not a position box), so
// `chart.takeScreenshot` never draws it.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { formatPrice } from "@/lib/format";
import { MERGE_TICKS, type LevelPill } from "@/lib/level-pills";
import type { LevelLine } from "@/lib/chart-levels";
import type { LevelHit } from "@/lib/level-hit-test";
import { setPrefs, usePrefs } from "@/lib/prefs";

/** The card closes itself after this long (LB-6). */
export const LEVEL_CARD_DISMISS_MS = 6000;
/** Trade Card export draws at most this many labelled level groups (D-E). */
export const EXPORT_LEVEL_GROUPS = 4;
/** Keeps the card clear of the top OHLC HUD readout (`.chart-hud`, top 8px). */
export const LEVEL_CARD_HUD_PX = 32;
const EDGE_PX = 4;
const OFFSET_X_PX = 12;

export interface LevelCardMember {
  name: string;
  price: string;
  /** `computed`, `planned`, or both when a merged line mixes the two. */
  source: string;
  /** Set for a settlement proxy (the ray is dashed). */
  tag: string | null;
}

export interface LevelCardView {
  title: string;
  price: string;
  members: LevelCardMember[];
}

/** `PDL / ADR Low` reads as `PDL · ADR Low` in the card. */
const displayNames = (names: string) => names.replace(/ \/ /g, " · ");

function sourceOf(line: LevelLine): string {
  const planned = line.keys.some((key) => key.startsWith("plan:"));
  const computed = line.keys.some((key) => !key.startsWith("plan:"));
  if (planned && computed) return "planned + computed";
  return planned ? "planned" : "computed";
}

/** The card's text for a hit: every merged member with its exact price, source, and proxy tag. */
export function formatLevelCardData(hit: LevelHit, symbol: string): LevelCardView {
  return {
    title: hit.zone ? displayNames(hit.zone.label) : "Session level",
    price: formatPrice(hit.price, symbol),
    members: hit.lines.map((line) => ({
      name: displayNames(line.names),
      price: formatPrice(line.price, symbol),
      source: sourceOf(line),
      tag: line.proxy ? "proxy" : null,
    })),
  };
}

/**
 * Where the card's top-left corner goes: beside the tap, kept inside the frame by `EDGE_PX` and below the HUD band.
 * Shrinks toward the frame's edge when the card is larger than the frame (never a negative position).
 */
export function clampPopoverPosition(
  anchor: { x: number; y: number },
  cardSize: { width: number; height: number },
  frameSize: { width: number; height: number },
  hudHeight = LEVEL_CARD_HUD_PX,
): { left: number; top: number } {
  const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), Math.max(low, high));
  const left = clamp(anchor.x + OFFSET_X_PX, EDGE_PX, frameSize.width - cardSize.width - EDGE_PX);
  const top = clamp(anchor.y - cardSize.height / 2, Math.max(EDGE_PX, hudHeight), frameSize.height - cardSize.height - EDGE_PX);
  return { left: Math.round(left), top: Math.round(top) };
}

/**
 * D-E: the level pills an export draws. The trade's key level (when set) comes first, then the merged level groups
 * nearest the entry. Entry, stop and target pills are never exported. At most `maxGroups` in total.
 */
export function selectExportLevelPills(
  pills: readonly LevelPill[],
  entryPrice: number,
  keyLevelPrice: number | null,
  maxGroups = EXPORT_LEVEL_GROUPS,
): LevelPill[] {
  if (maxGroups <= 0) return [];
  const key = keyLevelPrice == null ? undefined : pills.find((pill) => pill.tone === "key" && pill.price === keyLevelPrice);
  const groups = pills
    .filter((pill) => pill.tone == null)
    .map((pill, index) => ({ pill, index, distance: Math.abs(pill.price - entryPrice) }))
    .sort((a, b) => a.distance - b.distance || a.index - b.index)
    .map(({ pill }) => pill);
  return [...(key ? [key] : []), ...groups.slice(0, maxGroups - (key ? 1 : 0))];
}

/**
 * A hit for a list row: the ray at `tick` and the merged group around it, placed at the given `x`.
 * Null when the ray is not on the pane (`priceToY` returns null).
 */
export function levelHitForTick(
  lines: readonly LevelLine[],
  tick: number,
  x: number,
  priceToY: (price: number) => number | null,
): LevelHit | null {
  const anchor = lines.find((line) => line.price_ticks === tick);
  if (!anchor) return null;
  const y = priceToY(anchor.price);
  if (y == null || !Number.isFinite(y)) return null;
  return {
    kind: "group", price: anchor.price, y, x,
    lines: lines.filter((line) => Math.abs(line.price_ticks - tick) <= MERGE_TICKS),
  };
}

/** The level card over the chart. Non-modal: chart gestures keep working; `onClose` runs on ×, Escape, or 6 s. */
export function LevelCard({ hit, symbol, onClose }: { hit: LevelHit; symbol: string; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  const view = useMemo(() => formatLevelCardData(hit, symbol), [hit, symbol]);

  // Measured on the frame (`.chart-frame`, the offset parent) before paint, so the card never flashes off-frame.
  useLayoutEffect(() => {
    const card = ref.current;
    const frame = card?.offsetParent as HTMLElement | null | undefined;
    if (!card || !frame) return;
    setPlace(clampPopoverPosition({ x: hit.x, y: hit.y }, { width: card.offsetWidth, height: card.offsetHeight }, { width: frame.clientWidth, height: frame.clientHeight }));
  }, [hit]);

  useEffect(() => {
    const timer = window.setTimeout(onClose, LEVEL_CARD_DISMISS_MS);
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => { window.clearTimeout(timer); document.removeEventListener("keydown", onKey); };
  }, [hit, onClose]);

  return (
    <div
      ref={ref}
      className="level-card"
      role="dialog"
      aria-label="Session level details"
      style={place ? { left: place.left, top: place.top } : { left: 0, top: 0, visibility: "hidden" }}
    >
      <div className="level-card-head">
        <span className="level-card-title">{view.title}</span>
        <button type="button" className="level-card-close" aria-label="Close level details" onClick={onClose}>×</button>
      </div>
      <ul className="level-card-rows">
        {view.members.map((member, index) => (
          <li key={index}>
            <span className="level-card-name">{member.name}{member.tag && <em> · {member.tag}</em>}</span>
            <span className="level-card-price">{member.price}</span>
            <small className="level-card-source">{member.source}</small>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The `Tap | Always` label mode and a keyboard-reachable list of every drawn level (LB-5, LB-6). */
export function LevelsDisclosureList({ levels, symbol, onHighlightTick }: {
  levels: readonly LevelLine[];
  symbol: string;
  /** Focusing or hovering a row passes its tick; leaving passes `null`. */
  onHighlightTick: (tick: number | null) => void;
}) {
  const { levelLabels } = usePrefs();
  return (
    <details className="levels-disclosure">
      <summary>Levels ({levels.length})</summary>
      <div className="level-labels-toggle" role="group" aria-label="Level labels">
        {(["tap", "always"] as const).map((mode) => (
          <button key={mode} type="button" aria-pressed={levelLabels === mode} onClick={() => setPrefs({ levelLabels: mode })}>
            {mode === "tap" ? "Tap" : "Always"}
          </button>
        ))}
      </div>
      {levels.length === 0 ? <p className="levels-disclosure-empty">No levels drawn.</p> : (
        <ul className="levels-disclosure-list">
          {levels.map((line) => (
            <li
              key={line.price_ticks}
              tabIndex={0}
              onFocus={() => onHighlightTick(line.price_ticks)}
              onBlur={() => onHighlightTick(null)}
              onMouseEnter={() => onHighlightTick(line.price_ticks)}
              onMouseLeave={() => onHighlightTick(null)}
            >
              <span className="level-list-names">{displayNames(line.names)}</span>
              <span className="level-list-price">{formatPrice(line.price, symbol)}</span>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
