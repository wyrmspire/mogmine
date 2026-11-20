"use client";

import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { MoodAxes, MoodShapeLayer, useTradeMood } from "./MoodShape";
import { describeMood, moodPath, readyCandidates, scoreAtPoint, spokeById } from "@/lib/mood";
import type { MoodOrigin, MoodPhase } from "@/lib/mood";
import { acceptMoodSuggestion, addSpokeFromCandidate, dismissCandidate, dismissMoodSuggestion, setSpokeScore, suggestFromNotes, undoMoodRecord, useMood } from "@/lib/mood-store";
import { useJournal } from "@/lib/store";
import { showToast } from "@/lib/toast";
import type { TradeRecord } from "@/lib/trades";

const SIZE = 300;
const PADDING = 46;
const STEP = 0.05;

const ORIGIN_TEXT: Record<MoodOrigin, string> = { user: "You", voice_ai: "From notes", tag: "From tag" };
const PHASE_TEXT: Record<MoodPhase, string> = { pre_exit: "before exit", post_exit: "after exit", unknown: "" };
const pct = (value: number) => `${Math.round(value * 100)}`;

/**
 * Edit the Mood Shape: drag a spoke's point (≥44px targets), or use arrow keys on it. Each finished
 * drag is one record from the trader. Suggestions from the notes are shown for Accept and never
 * replace a spoke the trader set (UX-33).
 */
export function MoodEditorSheet({ trade, onClose }: { trade: TradeRecord; onClose: () => void }) {
  const mood = useMood();
  const journal = useJournal();
  const vector = useTradeMood(trade);
  const [drag, setDrag] = useState<{ index: number; value: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const suggestion = mood.suggestions[trade.id];
  const ready = trade.is_sample ? [] : readyCandidates(mood.candidates, mood.registry, mood.threshold);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); previousFocus?.focus(); };
  }, [onClose]);

  const values = vector.values.map((value, index) => (drag?.index === index ? drag.value : value));
  const geometry = moodPath(values, { size: SIZE, padding: PADDING });

  const commit = (index: number, value: number | null) => {
    const spoke = vector.detail[index].spoke;
    const before = vector.values[index];
    if (value === before) return;
    const record = setSpokeScore(trade.id, spoke.id, value);
    showToast(value == null ? `${spoke.label} set to not scored` : `${spoke.label} ${pct(value)}`, { label: "Undo", run: () => undoMoodRecord(record.id) });
  };

  const valueAt = (event: ReactPointerEvent, index: number) => {
    const svg = svgRef.current;
    if (!svg) return 0;
    const box = svg.getBoundingClientRect();
    const x = ((event.clientX - box.left) / box.width) * SIZE;
    const y = ((event.clientY - box.top) / box.height) * SIZE;
    return scoreAtPoint(x, y, index, vector.values.length, SIZE, { padding: PADDING });
  };

  const onPointerDown = (event: ReactPointerEvent<SVGGElement>, index: number) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ index, value: valueAt(event, index) });
  };
  const onPointerMove = (event: ReactPointerEvent<SVGGElement>, index: number) => {
    if (drag?.index !== index) return;
    setDrag({ index, value: valueAt(event, index) });
  };
  const onPointerUp = (index: number) => {
    if (drag?.index !== index) return;
    commit(index, drag.value);
    setDrag(null);
  };
  const onKeyDown = (event: ReactKeyboardEvent, index: number) => {
    const current = vector.values[index] ?? 0.5;
    const keys: Record<string, number> = { ArrowUp: STEP, ArrowRight: STEP, ArrowDown: -STEP, ArrowLeft: -STEP, PageUp: 0.2, PageDown: -0.2 };
    if (event.key in keys) { event.preventDefault(); commit(index, Math.round(Math.min(1, Math.max(0, current + keys[event.key])) * 100) / 100); }
    else if (event.key === "Home") { event.preventDefault(); commit(index, 0); }
    else if (event.key === "End") { event.preventDefault(); commit(index, 1); }
  };

  const suggest = () => {
    const { suggestion: made, keptYours } = suggestFromNotes(trade);
    if (Object.keys(made.scores).length) return;
    const hasText = [trade.note, trade.pre_trade_thesis, trade.management_notes, trade.post_exit_notes].some((text) => text.trim());
    if (!hasText) showToast("Write a note first, then ask again");
    else if (keptYours.length) showToast(`Your notes speak to ${keptYours.map((id) => spokeById(mood.registry, id)?.label ?? id).join(", ")}, which you set yourself. Kept yours.`);
    else showToast("Nothing in the notes speaks to these spokes");
  };

  const addCandidate = (id: string, label: string) => {
    const scored = addSpokeFromCandidate(id, journal.trades);
    showToast(`Added ${label}. Scored on ${scored} past ${scored === 1 ? "trade" : "trades"} from their notes.`);
  };

  return (
    <div className="sheet-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="sheet mood-sheet" role="dialog" aria-modal="true" aria-labelledby="mood-sheet-title">
        <div className="sheet-head">
          <div>
            <span className="eyebrow">Mood Shape · private</span>
            <h2 id="mood-sheet-title">How it felt</h2>
            <p>{describeMood({ ...vector, values })}</p>
          </div>
          <button ref={closeRef} type="button" className="icon-button" aria-label="Close" onClick={onClose}>✕</button>
        </div>

        <div className="mood-editor">
          <svg ref={svgRef} viewBox={`0 0 ${SIZE} ${SIZE}`} className="mood-shape editor" role="group" aria-label="Mood spokes. Drag a point, or focus it and use the arrow keys.">
            <MoodAxes count={values.length} size={SIZE} padding={PADDING} labels={vector.detail.map((item) => item.spoke.short)} />
            <MoodShapeLayer values={values} size={SIZE} padding={PADDING} />
            {geometry?.points.map((point, index) => {
              const item = vector.detail[index];
              const value = values[index];
              return (
                <g
                  key={item.spoke.id}
                  className={`mood-handle ${value == null ? "unknown" : ""} ${item.origin ?? ""}`}
                  role="slider"
                  tabIndex={0}
                  aria-label={item.spoke.label}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={value == null ? undefined : Math.round(value * 100)}
                  aria-valuetext={value == null ? "Not scored" : `${pct(value)} of 100${item.origin ? `, ${ORIGIN_TEXT[item.origin]}` : ""}`}
                  onPointerDown={(event) => onPointerDown(event, index)}
                  onPointerMove={(event) => onPointerMove(event, index)}
                  onPointerUp={() => onPointerUp(index)}
                  onPointerCancel={() => setDrag(null)}
                  onKeyDown={(event) => onKeyDown(event, index)}
                >
                  {/* 48 user units on a 300-unit drawing is ≥ 44px at the sheet's phone width. */}
                  <circle className="hit" cx={point.x} cy={point.y} r={26} />
                  <circle className="dot" cx={point.x} cy={point.y} r={value == null ? 5 : 7} />
                </g>
              );
            })}
          </svg>
        </div>

        <ul className="mood-list">
          {vector.detail.map((item, index) => (
            <li key={item.spoke.id}>
              <span className="mood-name">{item.spoke.label}</span>
              <span className="mood-value num">{values[index] == null ? "—" : pct(values[index] as number)}</span>
              <span className="mood-source">
                {item.origin ? ORIGIN_TEXT[item.origin] : "Not scored"}
                {item.origin && item.origin !== "tag" && PHASE_TEXT[item.phase] ? ` · ${PHASE_TEXT[item.phase]}` : ""}
                {item.evidence && item.origin !== "user" && <q>{item.evidence}</q>}
              </span>
              {item.origin === "user" && <button type="button" className="btn-ghost mood-clear" onClick={() => commit(index, null)} aria-label={`Set ${item.spoke.label} to not scored`}>Clear</button>}
            </li>
          ))}
        </ul>

        {suggestion && Object.keys(suggestion.scores).length > 0 ? (
          <div className="mood-suggest" role="group" aria-label="Suggested from your notes">
            <h4>Suggested from your notes <span>tap to accept</span></h4>
            <div className="chip-row">
              {Object.entries(suggestion.scores).map(([spoke, value]) => (
                <span key={spoke} className="mood-chip">
                  <button type="button" className="chip outlined" onClick={() => acceptMoodSuggestion(trade.id, [spoke])}>
                    {spokeById(mood.registry, spoke)?.label ?? spoke} {pct(value)}
                    {suggestion.evidence[spoke] && <q>{suggestion.evidence[spoke]}</q>}
                  </button>
                  <button type="button" className="chip-dismiss" aria-label={`Dismiss ${spokeById(mood.registry, spoke)?.label ?? spoke}`} onClick={() => dismissMoodSuggestion(trade.id, spoke)}>✕</button>
                </span>
              ))}
            </div>
            <div className="actions">
              <button type="button" className="btn-secondary" onClick={() => acceptMoodSuggestion(trade.id)}>Accept all</button>
              <button type="button" className="btn-ghost" onClick={() => dismissMoodSuggestion(trade.id)}>Dismiss</button>
            </div>
            <p className="note-state">Read on this device from your notes. Spokes you set yourself are never changed.</p>
          </div>
        ) : (
          <div className="actions mood-actions">
            <button type="button" className="btn-secondary" onClick={suggest}>Suggest from notes</button>
          </div>
        )}

        {ready.map((candidate) => (
          <div key={candidate.id} className="mood-candidate" role="group" aria-label={`New spoke: ${candidate.label}`}>
            <p><b>Add spoke “{candidate.label}”?</b> Your notes named it on {candidate.count} trades. Past trades are scored from their notes; where the notes say nothing it stays not scored.</p>
            <div className="actions">
              <button type="button" className="btn-secondary" onClick={() => addCandidate(candidate.id, candidate.label)}>Add spoke</button>
              <button type="button" className="btn-ghost" onClick={() => dismissCandidate(candidate.id)}>No thanks</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
