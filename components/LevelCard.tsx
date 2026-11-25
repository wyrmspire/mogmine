"use client";

// LB-B2 (docs/03 §3 LB-6/LB-7, D-E): the tap-to-read level card, the keyboard level list, and re-exports of
// the pure helpers in `lib/level-card.ts`. The card is DOM chrome beside the chart canvas, like the OHLC HUD
// (Invariant 1: not a position box), so `chart.takeScreenshot` never draws it.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { formatPrice } from "@/lib/format";
import type { LevelLine } from "@/lib/chart-levels";
import type { LevelHit } from "@/lib/level-hit-test";
import {
  EXPORT_LEVEL_GROUPS, LEVEL_CARD_DISMISS_MS, LEVEL_CARD_EDGE_PX, LEVEL_CARD_HUD_PX,
  clampPopoverPosition, displayLevelNames, formatLevelCardData, levelHitForTick, selectExportLevelPills,
} from "@/lib/level-card";
import type { LevelCardMember, LevelCardView } from "@/lib/level-card";
import { setPrefs, usePrefs } from "@/lib/prefs";

export {
  EXPORT_LEVEL_GROUPS, LEVEL_CARD_DISMISS_MS, LEVEL_CARD_EDGE_PX, LEVEL_CARD_HUD_PX,
  clampPopoverPosition, formatLevelCardData, levelHitForTick, selectExportLevelPills,
};
export type { LevelCardMember, LevelCardView };

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
              <span className="level-list-names">{displayLevelNames(line.names)}</span>
              <span className="level-list-price">{formatPrice(line.price, symbol)}</span>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
